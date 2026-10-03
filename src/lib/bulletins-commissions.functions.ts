import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * Import d'un bulletin de commissions : archivage du fichier, lecture IA des
 * lignes, puis rapprochement automatique avec les contrats et les clients.
 */

const BUCKET = "bordereaux-commissions";

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

const normaliser = (v: string) =>
  v
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

export const importerBulletinCommission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        nom_fichier: z.string().min(1).max(300),
        mime: z.string().max(120).optional().nullable(),
        base64: z.string().min(20).max(30_000_000),
        assureur: z.string().max(160).optional().nullable(),
        periode: z.string().max(40).optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await exigerStaff(context.supabase, context.userId);

    const mime =
      data.mime ||
      (data.nom_fichier.toLowerCase().endsWith(".pdf") ? "application/pdf" : "application/octet-stream");

    let lu: Awaited<ReturnType<typeof import("@/lib/bulletin-commission.server").lireBulletinCommission>> | null =
      null;
    let avertissement: string | null = null;
    try {
      const { lireBulletinCommission } = await import("@/lib/bulletin-commission.server");
      lu = await lireBulletinCommission({ nom: data.nom_fichier, mime, base64: data.base64 });
    } catch (e) {
      avertissement = e instanceof Error ? e.message : "Analyse automatique indisponible.";
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const octets = Uint8Array.from(atob(data.base64), (c) => c.charCodeAt(0));
    const nomNettoye = data.nom_fichier.replace(/[^\w.\-]+/g, "_").slice(-80);
    const chemin = `bulletins/${Date.now()}-${nomNettoye}`;
    const { error: upErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(chemin, octets, { contentType: mime, upsert: false });
    if (upErr) throw new Error(`Archivage du bulletin impossible : ${upErr.message}`);

    const lignes = lu?.lignes ?? [];
    const totalLignes = lignes.reduce((s, l) => s + (l.montant ?? 0), 0);

    const { data: bordereau, error: bErr } = await supabaseAdmin
      .from("bordereaux_commissions")
      .insert({
        assureur: (data.assureur || lu?.assureur || "Compagnie à préciser").slice(0, 160),
        periode: (data.periode || lu?.periode || new Date().toISOString().slice(0, 7)).slice(0, 40),
        montant_total: lu?.montant_total ?? Number(totalLignes.toFixed(2)),
        nb_lignes: lignes.length,
        statut: "importe",
        fichier_path: chemin,
        fichier_nom: data.nom_fichier.slice(0, 300),
        fichier_source: data.nom_fichier.slice(0, 300),
        analyse_le: new Date().toISOString(),
        analyse_avertissement: avertissement,
        notes: avertissement
          ? `Analyse IA indisponible : ${avertissement}`
          : `Analyse IA (confiance ${((lu?.confiance ?? 0) * 100).toFixed(0)} %) — rapprochement à vérifier.`,
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (bErr || !bordereau) {
      await supabaseAdmin.storage.from(BUCKET).remove([chemin]);
      throw new Error(bErr?.message ?? "Création du bulletin impossible");
    }

    // Référentiels pour le rapprochement.
    const [{ data: contrats }, { data: clients }] = await Promise.all([
      supabaseAdmin.from("contrats").select("id,numero,client_id,dossier_id,produit"),
      supabaseAdmin.from("clients").select("id,nom,prenom"),
    ]);

    const parNumero = new Map<string, { id: string; client_id: string | null; dossier_id: string | null }>();
    for (const c of contrats ?? []) {
      if (c.numero) parNumero.set(normaliser(c.numero), { id: c.id, client_id: c.client_id, dossier_id: c.dossier_id });
    }
    const clientsIndex = (clients ?? []).map((c) => ({
      id: c.id,
      cles: [
        `${c.nom ?? ""}${c.prenom ?? ""}`,
        `${c.prenom ?? ""}${c.nom ?? ""}`,
      ]
        .map(normaliser)
        .filter((k) => k.length >= 4),
    }));

    let rapprochees = 0;
    const aInserer = lignes.map((l) => {
      const numeroCle = l.numero_contrat ? normaliser(l.numero_contrat) : "";
      const contrat = numeroCle ? parNumero.get(numeroCle) : undefined;
      let client_id = contrat?.client_id ?? null;

      if (!client_id && l.client_nom) {
        const cible = normaliser(l.client_nom);
        const trouve = clientsIndex.find((c) => c.cles.some((k) => cible.includes(k) || k.includes(cible)));
        client_id = trouve?.id ?? null;
      }
      const rapproche = Boolean(contrat || client_id);
      if (rapproche) rapprochees += 1;

      return {
        bordereau_id: bordereau.id,
        client_nom_detecte: l.client_nom,
        numero_contrat_detecte: l.numero_contrat,
        produit_detecte: l.produit,
        periode_detectee: l.periode,
        montant: l.montant ?? 0,
        assiette: l.assiette,
        taux: l.taux,
        client_id,
        contrat_id: contrat?.id ?? null,
        dossier_id: contrat?.dossier_id ?? null,
        statut: rapproche ? "rapprochee" : "a_rapprocher",
        confiance: lu?.confiance ?? null,
        brut: JSON.parse(JSON.stringify(l)) as never,
      };
    });

    if (aInserer.length > 0) {
      const { error: lErr } = await supabaseAdmin.from("bordereau_lignes").insert(aInserer);
      if (lErr) throw new Error(`Enregistrement des lignes impossible : ${lErr.message}`);
    }

    return {
      bordereau_id: bordereau.id,
      nb_lignes: aInserer.length,
      nb_rapprochees: rapprochees,
      avertissement,
    };
  });

/** Rattache manuellement une ligne à un client / contrat. */
export const rattacherLigneBulletin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        ligne_id: z.string().uuid(),
        client_id: z.string().uuid().nullable().optional(),
        contrat_id: z.string().uuid().nullable().optional(),
        ignorer: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await exigerStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let client_id = data.client_id ?? null;
    let dossier_id: string | null = null;
    if (data.contrat_id) {
      const { data: contrat } = await supabaseAdmin
        .from("contrats")
        .select("client_id,dossier_id")
        .eq("id", data.contrat_id)
        .maybeSingle();
      client_id = client_id ?? contrat?.client_id ?? null;
      dossier_id = contrat?.dossier_id ?? null;
    }

    const statut = data.ignorer ? "ignoree" : client_id || data.contrat_id ? "rapprochee" : "a_rapprocher";
    const { error } = await supabaseAdmin
      .from("bordereau_lignes")
      .update({ client_id, contrat_id: data.contrat_id ?? null, dossier_id, statut })
      .eq("id", data.ligne_id);
    if (error) throw new Error(error.message);
    return { ok: true, statut };
  });

/** Crée les commissions du cabinet à partir des lignes rapprochées d'un bulletin. */
export const genererCommissionsBulletin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ bordereau_id: z.string().uuid(), beneficiaire_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await exigerStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: lignes } = await supabaseAdmin
      .from("bordereau_lignes")
      .select("id,montant,client_nom_detecte,numero_contrat_detecte,contrat_id,dossier_id,commission_id,statut")
      .eq("bordereau_id", data.bordereau_id);

    let creees = 0;
    for (const l of lignes ?? []) {
      if (l.commission_id || l.statut !== "rapprochee") continue;
      const { data: commission, error } = await supabaseAdmin
        .from("commissions")
        .insert({
          dossier_id: l.dossier_id,
          contrat_id: l.contrat_id,
          bordereau_id: data.bordereau_id,
          beneficiaire_id: data.beneficiaire_id,
          montant: Number(l.montant),
          // Règle Lot 5 : le bordereau rapproché est un relevé REÇU, pas un
          // encaissement. La commission reste « prévue » / « validé bordereau »
          // jusqu'à confirmation du virement bancaire.
          statut: "prevue",
          etat_encaissement: "valide_bordereau",
          notes: `Bulletin de commissions — ${l.client_nom_detecte ?? "client"}${
            l.numero_contrat_detecte ? ` / contrat ${l.numero_contrat_detecte}` : ""
          }`,
        })
        .select("id")
        .single();
      if (error || !commission) continue;
      await supabaseAdmin.from("bordereau_lignes").update({ commission_id: commission.id }).eq("id", l.id);
      creees += 1;
    }

    await supabaseAdmin.from("bordereaux_commissions").update({ statut: "traite" }).eq("id", data.bordereau_id);
    return { creees };
  });
