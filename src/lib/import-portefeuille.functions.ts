import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  TAILLE_MAX_PIECE,
  PIECES_KYC_IMPORT,
  cheminPieceImport,
  normaliserChampsAttestation,
  type ChampsAttestation,
  type CodePieceImport,
} from "@/lib/import-portefeuille";
import { BRANCHES_CREATION } from "@/lib/recueil-besoins-schemas";

const BUCKET = "dossier-documents";
const MIMES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

const fichierSchema = z.object({
  nom: z.string().min(1).max(255),
  mime: z.string().refine((m) => MIMES.includes(m), "Format accepté : PDF, JPG, PNG ou WEBP."),
  base64: z.string().min(1),
});

function octets(base64: string): Uint8Array {
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  if (out.length > TAILLE_MAX_PIECE) throw new Error("Fichier trop volumineux (10 Mo maximum).");
  return out;
}

async function verifierStaff(context: { supabase: any; userId: string }) {
  for (const role of ["admin", "mandataire", "prescripteur"] as const) {
    const { data } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: role });
    if (data === true) return;
  }
  throw new Error("Action non autorisée.");
}

/** Lecture IA de l'attestation : préremplissage uniquement, rien n'est écrit. */
export const extraireAttestationPortefeuille = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => fichierSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ champs: ChampsAttestation | null; erreur: string | null }> => {
    await verifierStaff(context);
    octets(data.base64);
    const cle = process.env["GEMINI_API_KEY"];
    if (!cle) return { champs: null, erreur: "Lecture automatique indisponible : saisissez les champs." };
    const { geminiFetch } = await import("@/lib/gemini-gateway.server");
    const branches = BRANCHES_CREATION.map((b) => `${b.value} (${b.label})`).join(", ");
    const prompt =
      "Tu lis une attestation, un certificat d'adhésion ou un contrat d'assurance français. " +
      "Réponds UNIQUEMENT par un objet JSON avec les clés : civilite, prenom, nom, date_naissance, email, mobile, " +
      "adresse, code_postal, ville, assureur, produit, numero_contrat, date_effet, date_fin, cotisation_mensuelle, branche_suggeree. " +
      "Dates au format AAAA-MM-JJ. cotisation_mensuelle en nombre. N'invente rien : valeur absente => null. " +
      `branche_suggeree doit être une de ces valeurs ou null : ${branches}.`;
    let derniere = "";
    for (const modele of ["gemini-3.6-flash", "gemini-2.5-flash"]) {
      try {
        const res = await geminiFetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${cle}` },
          body: JSON.stringify({
            model: modele,
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: prompt },
                  { type: "file", file: { filename: data.nom, file_data: `data:${data.mime};base64,${data.base64}` } },
                ],
              },
            ],
          }),
        });
        if (!res.ok) {
          derniere = `${res.status}`;
          continue;
        }
        const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
        const texte = (json.choices?.[0]?.message?.content ?? "").replace(/```(?:json)?/gi, "");
        const debut = texte.indexOf("{");
        const fin = texte.lastIndexOf("}");
        if (debut === -1 || fin <= debut) {
          derniere = "réponse illisible";
          continue;
        }
        const champs = normaliserChampsAttestation(JSON.parse(texte.slice(debut, fin + 1)));
        if (champs.branche_suggeree && !BRANCHES_CREATION.some((b) => b.value === champs.branche_suggeree))
          champs.branche_suggeree = null;
        return { champs, erreur: null };
      } catch (e) {
        derniere = e instanceof Error ? e.message : String(e);
      }
    }
    console.error("[import portefeuille] lecture IA échouée", derniere);
    return { champs: null, erreur: "Lecture automatique impossible : saisissez les champs à la main." };
  });

const archivageSchema = z.object({
  client_id: z.string().uuid(),
  dossier_id: z.string().uuid(),
  attestation: fichierSchema,
  kyc: z.object({ cni: fichierSchema, justificatif_domicile: fichierSchema, rib: fichierSchema }),
});

type ResultatPiece = { code: CodePieceImport; ok: boolean; erreur?: string };

/**
 * Archive l'attestation (documents) et les KYC (client_kyc_documents), puis les
 * relie à dossier_pieces_requises. Tout passe par le client de l'utilisateur :
 * les règles d'accès existantes s'appliquent (1er segment = dossier). Si
 * l'écriture en base échoue, le fichier déposé est retiré du stockage.
 * Les autres pièces requises restent « manquantes ».
 */
export const archiverPiecesPortefeuille = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => archivageSchema.parse(input))
  .handler(async ({ data, context }) => {
    await verifierStaff(context);
    const sb = context.supabase;
    const { data: acces } = await sb.rpc("can_access_dossier", { _dossier_id: data.dossier_id });
    if (acces !== true) throw new Error("Accès au dossier refusé.");
    const { data: dossier } = await sb.from("dossiers").select("client_id").eq("id", data.dossier_id).maybeSingle();
    if (!dossier || dossier.client_id !== data.client_id) throw new Error("Le dossier ne correspond pas au client.");

    const resultats: ResultatPiece[] = [];
    const maintenant = new Date().toISOString();

    const deposer = async (code: CodePieceImport, f: z.infer<typeof fichierSchema>) => {
      const chemin = cheminPieceImport(data.dossier_id, code, f.nom);
      const { error } = await sb.storage.from(BUCKET).upload(chemin, octets(f.base64), {
        contentType: f.mime,
        upsert: false,
      });
      if (error) throw new Error(`Dépôt du fichier refusé : ${error.message}`);
      return chemin;
    };
    const nettoyer = async (chemin: string) => {
      const { error } = await sb.storage.from(BUCKET).remove([chemin]);
      if (error) console.error("[import portefeuille] nettoyage du fichier impossible", chemin, error.message);
    };
    const lierPiece = async (code: string, champ: "document_id" | "kyc_document_id", id: string) => {
      const { error } = await sb
        .from("dossier_pieces_requises")
        .update({ [champ]: id, statut: "recue", recue_le: maintenant })
        .eq("dossier_id", data.dossier_id)
        .eq("code", code);
      if (error) throw new Error(`Rattachement à la pièce requise impossible : ${error.message}`);
    };

    // 1. Attestation -> documents
    {
      let chemin: string | null = null;
      try {
        chemin = await deposer("attestation", data.attestation);
        const { data: doc, error } = await sb
          .from("documents")
          .insert({
            client_id: data.client_id,
            dossier_id: data.dossier_id,
            uploader_id: context.userId,
            storage_path: chemin,
            file_name: data.attestation.nom,
            file_size: octets(data.attestation.base64).length,
            mime_type: data.attestation.mime,
            type_document: "attestation_assurance",
          })
          .select("id")
          .single();
        if (error || !doc) throw new Error(`Enregistrement du document impossible : ${error?.message ?? "inconnu"}`);
        chemin = null;
        await lierPiece("attestation_assurance", "document_id", doc.id).catch(() => undefined);
        resultats.push({ code: "attestation", ok: true });
      } catch (e) {
        if (chemin) await nettoyer(chemin);
        resultats.push({ code: "attestation", ok: false, erreur: e instanceof Error ? e.message : String(e) });
      }
    }

    // 2. KYC -> client_kyc_documents
    for (const p of PIECES_KYC_IMPORT) {
      const f = data.kyc[p.code];
      let chemin: string | null = null;
      try {
        chemin = await deposer(p.code, f);
        const { data: kyc, error } = await sb
          .from("client_kyc_documents")
          .insert({
            client_id: data.client_id,
            type: p.code,
            nom: f.nom,
            storage_path: chemin,
            uploaded_by: context.userId,
          })
          .select("id")
          .single();
        if (error || !kyc) throw new Error(`Enregistrement de la pièce impossible : ${error?.message ?? "inconnu"}`);
        chemin = null;
        await lierPiece(p.code, "kyc_document_id", kyc.id);
        resultats.push({ code: p.code, ok: true });
      } catch (e) {
        if (chemin) await nettoyer(chemin);
        console.error("[import portefeuille] pièce non archivée", p.code, e);
        resultats.push({ code: p.code, ok: false, erreur: e instanceof Error ? e.message : String(e) });
      }
    }

    return { resultats, complet: resultats.every((r) => r.ok) };
  });
