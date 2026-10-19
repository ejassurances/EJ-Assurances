import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * Import d'une facture d'achat reçue par email : téléchargement de la pièce
 * jointe Gmail, lecture IA des montants, création de la facture en « à payer »
 * avec le justificatif archivé dans le bucket privé.
 */

type StaffClient = {
  from: (table: "user_roles") => {
    select: (cols: string) => { eq: (col: string, val: string) => PromiseLike<{ data: { role: string }[] | null }> };
  };
};

async function exigerStaff(supabase: unknown, userId: string) {
  const { data } = await (supabase as StaffClient).from("user_roles").select("role").eq("user_id", userId);
  const roles = (data ?? []).map((r) => r.role);
  if (!roles.includes("admin") && !roles.includes("mandataire")) throw new Error("Accès réservé au cabinet.");
}

export const importerFactureDepuisEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        gmail_message_id: z.string().min(5).max(1024),
        attachment_id: z.string().min(5).max(600),
        nom_fichier: z.string().min(1).max(300),
        mime: z.string().max(120).optional().nullable(),
        expediteur_nom: z.string().max(200).optional().nullable(),
        expediteur_email: z.string().max(255).optional().nullable(),
        sujet: z.string().max(500).optional().nullable(),
        recu_le: z.string().max(40).optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await exigerStaff(context.supabase, context.userId);

    const { telechargerPieceJointe } = await import("@/lib/gmail.server");
    const { base64 } = await telechargerPieceJointe(data.gmail_message_id, data.attachment_id);

    const mime = data.mime || (data.nom_fichier.toLowerCase().endsWith(".pdf") ? "application/pdf" : "application/octet-stream");

    // Lecture IA des montants (non bloquante : la facture est créée même en cas d'échec).
    let lue: Awaited<ReturnType<typeof import("@/lib/facture-email.server").lireFactureDepuisFichier>> | null = null;
    let avertissement: string | null = null;
    try {
      const { lireFactureDepuisFichier } = await import("@/lib/facture-email.server");
      lue = await lireFactureDepuisFichier({ nom: data.nom_fichier, mime, base64 });
    } catch (e) {
      avertissement = e instanceof Error ? e.message : "Lecture automatique indisponible.";
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Anti-doublon : même pièce jointe déjà importée.
    const marqueur = `[email:${data.gmail_message_id}:${data.attachment_id.slice(0, 24)}]`;
    const { data: dejaLa } = await supabaseAdmin
      .from("factures_achat")
      .select("id")
      .like("notes", `%${marqueur}%`)
      .maybeSingle();
    if (dejaLa) return { id: dejaLa.id, deja_importee: true, avertissement: null, lue: null };

    const octets = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const nomNettoye = data.nom_fichier.replace(/[^\w.\-]+/g, "_").slice(-80);
    const chemin = `emails/${data.gmail_message_id}/${Date.now()}-${nomNettoye}`;
    const { error: upErr } = await supabaseAdmin.storage
      .from("factures-achat")
      .upload(chemin, octets, { contentType: mime, upsert: false });
    if (upErr) throw new Error(`Archivage du justificatif impossible : ${upErr.message}`);

    const { rapprocherFournisseur } = await import("@/lib/fournisseurs.server");
    const fiche = await rapprocherFournisseur({
      nom: lue?.fournisseur ?? data.expediteur_nom ?? null,
      email: data.expediteur_email ?? null,
    });

    const fournisseur =
      fiche?.nom ||
      lue?.fournisseur ||
      data.expediteur_nom ||
      (data.expediteur_email ? data.expediteur_email.split("@")[1] || data.expediteur_email : null) ||
      "Fournisseur à préciser";

    const ht = lue?.montant_ht ?? 0;
    const tva = lue?.montant_tva ?? 0;
    const ttc = lue?.montant_ttc ?? Number((ht + tva).toFixed(2));

    const notes = [
      `Reçue par email de ${data.expediteur_email ?? "expéditeur inconnu"}`,
      data.sujet ? `Objet : ${data.sujet}` : null,
      lue?.nature ? `Nature : ${lue.nature}` : null,
      lue?.confiance !== null && lue?.confiance !== undefined
        ? `Lecture IA (confiance ${(lue.confiance * 100).toFixed(0)} %) — à vérifier avant génération de l'écriture.`
        : avertissement,
      marqueur,
    ]
      .filter(Boolean)
      .join("\n");

    const { data: creee, error } = await supabaseAdmin
      .from("factures_achat")
      .insert({
        fournisseur: fournisseur.slice(0, 160),
        fournisseur_id: fiche?.id ?? null,
        numero_facture: lue?.numero_facture ?? null,
        date_facture: lue?.date_facture ?? (data.recu_le ? data.recu_le.slice(0, 10) : new Date().toISOString().slice(0, 10)),
        date_echeance: lue?.date_echeance ?? null,
        montant_ht: ht,
        montant_tva: tva,
        montant_ttc: ttc,
        compte_charge: fiche?.compte_charge_defaut ?? undefined,
        statut: "a_payer",
        notes,
        fichier_path: chemin,
        fichier_nom: data.nom_fichier.slice(0, 300),
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (error || !creee) {
      await supabaseAdmin.storage.from("factures-achat").remove([chemin]);
      throw new Error(error?.message ?? "Création de la facture impossible");
    }

    return { id: creee.id, deja_importee: false, avertissement, lue };
  });

/**
 * Import manuel d'une facture PDF (ou image) déposée depuis l'espace comptabilité.
 * L'IA lit les montants et propose le compte de charge du plan comptable.
 */
export const importerFactureFichier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        nom_fichier: z.string().min(1).max(300),
        mime: z.string().max(120).optional().nullable(),
        base64: z.string().min(100),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await exigerStaff(context.supabase, context.userId);

    const mime =
      data.mime || (data.nom_fichier.toLowerCase().endsWith(".pdf") ? "application/pdf" : "application/octet-stream");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: comptes } = await supabaseAdmin
      .from("plan_comptable")
      .select("numero, libelle")
      .eq("actif", true)
      .gte("numero", "600000")
      .lt("numero", "700000")
      .order("numero");

    let lue: Awaited<ReturnType<typeof import("@/lib/facture-email.server").lireFactureDepuisFichier>> | null = null;
    let avertissement: string | null = null;
    try {
      const { lireFactureDepuisFichier } = await import("@/lib/facture-email.server");
      lue = await lireFactureDepuisFichier(
        { nom: data.nom_fichier, mime, base64: data.base64 },
        (comptes ?? []) as { numero: string; libelle: string }[],
      );
    } catch (e) {
      avertissement = e instanceof Error ? e.message : "Lecture automatique indisponible.";
    }

    const octets = Uint8Array.from(atob(data.base64), (c) => c.charCodeAt(0));
    const nomNettoye = data.nom_fichier.replace(/[^\w.\-]+/g, "_").slice(-80);
    const chemin = `imports/${context.userId}/${Date.now()}-${nomNettoye}`;
    const { error: upErr } = await supabaseAdmin.storage
      .from("factures-achat")
      .upload(chemin, octets, { contentType: mime, upsert: false });
    if (upErr) throw new Error(`Archivage du justificatif impossible : ${upErr.message}`);

    const ht = lue?.montant_ht ?? 0;
    const tva = lue?.montant_tva ?? 0;
    const ttc = lue?.montant_ttc ?? Number((ht + tva).toFixed(2));

    const notes = [
      "Importée manuellement (PDF).",
      lue?.nature ? `Nature : ${lue.nature}` : null,
      lue?.compte_charge ? `Compte proposé par l'IA : ${lue.compte_charge}` : null,
      lue?.confiance !== null && lue?.confiance !== undefined
        ? `Lecture IA (confiance ${(lue.confiance * 100).toFixed(0)} %) — à vérifier avant génération de l'écriture.`
        : avertissement,
    ]
      .filter(Boolean)
      .join("\n");

    const { rapprocherFournisseur } = await import("@/lib/fournisseurs.server");
    const fiche = await rapprocherFournisseur({ nom: lue?.fournisseur ?? null });

    const insertion: Record<string, unknown> = {
      fournisseur: (fiche?.nom ?? lue?.fournisseur ?? "Fournisseur à préciser").slice(0, 160),
      fournisseur_id: fiche?.id ?? null,
      numero_facture: lue?.numero_facture ?? null,
      date_facture: lue?.date_facture ?? new Date().toISOString().slice(0, 10),
      date_echeance: lue?.date_echeance ?? null,
      montant_ht: ht,
      montant_tva: tva,
      montant_ttc: ttc,
      statut: "a_payer",
      notes,
      fichier_path: chemin,
      fichier_nom: data.nom_fichier.slice(0, 300),
      created_by: context.userId,
    };
    const compte = lue?.compte_charge ?? fiche?.compte_charge_defaut;
    if (compte) insertion["compte_charge"] = compte;

    const { data: creee, error } = await supabaseAdmin
      .from("factures_achat")
      .insert(insertion as never)
      .select("id")
      .single();
    if (error || !creee) {
      await supabaseAdmin.storage.from("factures-achat").remove([chemin]);
      throw new Error(error?.message ?? "Création de la facture impossible");
    }

    return {
      id: creee.id,
      avertissement,
      fournisseur: insertion["fournisseur"] as string,
      montant_ttc: ttc,
      compte_charge: lue?.compte_charge ?? null,
      nom_fichier: data.nom_fichier,
    };
  });
