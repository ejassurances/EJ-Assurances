/* eslint-disable prettier/prettier -- legacy file formatting debt; keep other lint rules enabled */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const schema = z.object({
  client_id: z.string().uuid().optional().nullable(),
  contrat_id: z.string().uuid().optional().nullable(),
  client: z.object({
    civilite: z.string().trim().max(20).optional().nullable(),
    nom: z.string().trim().min(1).max(120),
    prenom: z.string().trim().max(120).optional().nullable(),
    date_naissance: z.string().max(10).optional().nullable(),
    email: z.string().trim().max(255).optional().nullable(),
    mobile: z.string().trim().max(30).optional().nullable(),
    telephone: z.string().trim().max(30).optional().nullable(),
    adresse: z.string().trim().max(255).optional().nullable(),
    code_postal: z.string().trim().max(20).optional().nullable(),
    ville: z.string().trim().max(120).optional().nullable(),
  }),
  contrat: z.object({
    assureur: z.string().trim().min(1).max(160),
    numero: z.string().trim().max(120).optional().nullable(),
    produit: z.string().trim().min(1).max(160),
    date_effet: z.string().max(10).optional().nullable(),
    date_echeance: z.string().max(10).optional().nullable(),
  }),
  fichiers: z.array(z.object({
    code: z.enum(["attestation_assurance", "cni", "justificatif_domicile", "rib"]),
    file_name: z.string().trim().min(1).max(255),
    mime_type: z.enum(["application/pdf", "image/jpeg", "image/png", "image/webp"]),
    base64: z.string().min(1).max(11_200_000),
  })).max(4).optional().default([]),
});

/** Importe un contrat de portefeuille ; si aucun client fiable n'est retrouvé, crée sa fiche à partir des données de l'attestation. */
export const enregistrerContratImportPortefeuille = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => schema.parse(input))
  .handler(async ({ data, context }) => {
    let autorise = false;
    for (const role of ["admin", "mandataire", "prescripteur"] as const) {
      const { data: ok } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: role });
      if (ok === true) { autorise = true; break; }
    }
    if (!autorise) throw new Error("Import de contrat non autorisé.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { normaliserIdentite, trouverClientExistant } = await import("@/lib/client-dedoublonnage.server");
    let clientId = data.client_id ?? null;
    if (!clientId) {
      const match = await trouverClientExistant(supabaseAdmin, {
        nom: data.client.nom, prenom: data.client.prenom, date_naissance: data.client.date_naissance,
        email: data.client.email, mobile: data.client.mobile, telephone: data.client.telephone,
        exigerDateNaissancePourNom: true,
      });
      clientId = match?.client_id ?? null;
    }

    // Sur une attestation de second contrat, la date de naissance et les contacts
    // peuvent être absents. Dans ce cas, rattacher uniquement si le couple
    // nom/prénom normalisé correspond à UNE seule fiche. En cas d'homonymie,
    // bloquer plutôt que créer silencieusement une fiche client en double.
    if (!clientId && !data.client.date_naissance?.trim() && data.client.nom.trim() && data.client.prenom?.trim()) {
      const valeursRecherche = [...new Set([data.client.nom.trim(), data.client.prenom.trim()])];
      const recherches = await Promise.all(
        valeursRecherche.map((valeur) =>
          supabaseAdmin
            .from("clients")
            .select("id, nom, prenom")
            .ilike("nom", valeur)
            .limit(100),
        ),
      );
      const identiteNom = normaliserIdentite(data.client.nom);
      const identitePrenom = normaliserIdentite(data.client.prenom);
      const correspondants = [
        ...new Map(
          recherches
            .flatMap(({ data: lignes }) => lignes ?? [])
            .filter((client) => {
              const nom = normaliserIdentite(client.nom);
              const prenom = normaliserIdentite(client.prenom);
              return (
                (nom === identiteNom && prenom === identitePrenom) ||
                (nom === identitePrenom && prenom === identiteNom)
              );
            })
            .map((client) => [client.id, client]),
        ).values(),
      ];
      if (correspondants.length === 1) {
        clientId = correspondants[0]!.id;
      } else if (correspondants.length > 1) {
        throw new Error(
          "Plusieurs fiches correspondent à ce nom et prénom. Sélectionnez la fiche client existante avant d'importer le contrat ; aucune nouvelle fiche n'a été créée.",
        );
      }
    }

    if (!clientId) {
      // L'import de portefeuille est une action explicite : si aucun client fiable
      // n'est retrouvé, créer sa fiche permet de conserver le contrat et son attestation.
      // Le rapprochement préalable reste obligatoire pour éviter les doublons évidents.
      const { data: createdClient, error: clientError } = await supabaseAdmin
        .from("clients")
        .insert({
          civilite: data.client.civilite || "M.",
          nom: data.client.nom,
          prenom: data.client.prenom || null,
          date_naissance: data.client.date_naissance || null,
          email: data.client.email || null,
          mobile: data.client.mobile || null,
          telephone: data.client.telephone || null,
          adresse: data.client.adresse || null,
          code_postal: data.client.code_postal || null,
          ville: data.client.ville || null,
          created_by: context.userId,
        })
        .select("id")
        .single();
      if (clientError || !createdClient) {
        throw new Error("Création de la fiche client impossible : " + (clientError?.message ?? "erreur inconnue"));
      }
      clientId = createdClient.id;
    }
    const { data: access } = await context.supabase.rpc("can_access_client", { _client_id: clientId });
    if (access !== true) throw new Error("Vous n'avez pas accès à cette fiche client.");

    let contratId = data.contrat_id ?? null;
    if (contratId) {
      const { data: existing, error } = await supabaseAdmin.from("contrats").select("id,client_id").eq("id", contratId).maybeSingle();
      if (error || !existing || existing.client_id !== clientId) throw new Error("Le contrat sélectionné ne correspond plus à cette fiche client.");
      const { error: updateError } = await supabaseAdmin.from("contrats").update({
        numero: data.contrat.numero || undefined, assureur: data.contrat.assureur, produit: data.contrat.produit,
        date_effet: data.contrat.date_effet || undefined, date_echeance: data.contrat.date_echeance || undefined,
        updated_at: new Date().toISOString(),
      }).eq("id", contratId);
      if (updateError) throw new Error("Mise à jour du contrat impossible : " + updateError.message);
    } else {
      const { data: created, error } = await supabaseAdmin.from("contrats").insert({
        client_id: clientId, numero: data.contrat.numero || null, assureur: data.contrat.assureur,
        produit: data.contrat.produit, date_effet: data.contrat.date_effet || null,
        date_echeance: data.contrat.date_echeance || null, statut: "en_cours", created_by: context.userId,
      }).select("id").single();
      if (error || !created) throw new Error("Création du contrat impossible : " + (error?.message ?? "erreur inconnue"));
      contratId = created.id;
    }

    const { normaliserNomFichierPourStockage } = await import("@/lib/storage-key");
    const archives: string[] = [];
    for (const piece of data.fichiers) {
      const raw = atob(piece.base64);
      if (!raw.length || raw.length > 8 * 1024 * 1024) throw new Error("Fichier vide ou supérieur à 8 Mo : " + piece.file_name);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      const kyc = piece.code !== "attestation_assurance";
      const path = kyc
        ? `${clientId}/kyc/${Date.now()}-${piece.code}-${normaliserNomFichierPourStockage(piece.file_name)}`
        : `${clientId}/contrats/${contratId}/${Date.now()}-${normaliserNomFichierPourStockage(piece.file_name)}`;
      const { error: uploadError } = await supabaseAdmin.storage.from("dossier-documents").upload(path, bytes, { contentType: piece.mime_type, upsert: false });
      if (uploadError) throw new Error("Archivage de " + piece.file_name + " impossible : " + uploadError.message);
      const { error } = kyc
        ? await supabaseAdmin.from("client_kyc_documents").insert({
            client_id: clientId, type: piece.code as "cni" | "justificatif_domicile" | "rib", nom: piece.file_name, storage_path: path,
            uploaded_by: context.userId, statut: "a_valider",
          })
        : await supabaseAdmin.from("documents").insert({
            client_id: clientId, contrat_id: contratId, dossier_id: null, uploader_id: context.userId,
            storage_path: path, file_name: piece.file_name, file_size: bytes.length, mime_type: piece.mime_type,
            type_document: "attestation_assurance", categorie: "contrat", source: "import_portefeuille",
            statut_exploitabilite: "recu",
          });
      if (error) {
        await supabaseAdmin.storage.from("dossier-documents").remove([path]);
        throw new Error("Enregistrement de " + piece.file_name + " impossible : " + error.message);
      }
      archives.push(piece.file_name);
    }
    return { ok: true as const, client_id: clientId, contrat_id: contratId, archives };
  });
