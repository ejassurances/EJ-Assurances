import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const valeurSchema = z.object({
  couverture: z.enum(["oui", "non", "option", "inconnu"]),
  plafond: z.string().max(300).nullable().optional(),
  franchise: z.string().max(300).nullable().optional(),
  delai_carence: z.string().max(300).nullable().optional(),
  conditions: z.string().max(800).nullable().optional(),
  extrait: z.string().max(1200).nullable().optional(),
  confiance: z.number().min(0).max(1).nullable().optional(),
});

/**
 * Compare deux jeux de garanties sur leurs champs substantiels uniquement
 * (couverture, plafond, franchise, délai de carence, conditions) — ignore
 * l'extrait de texte brut (peut varier verbatim selon le document source
 * même à sens identique) et le score de confiance IA (pas un attribut du
 * produit). Retourne vrai seulement si TOUTES les garanties comparables
 * correspondent exactement : aucune tolérance floue inventée.
 */
function garantiesIdentiques(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const cles = new Set([...Object.keys(a), ...Object.keys(b)]);
  const CHAMPS = ["couverture", "plafond", "franchise", "delai_carence", "conditions"] as const;
  for (const cle of cles) {
    const va = a[cle] as Record<string, unknown> | undefined;
    const vb = b[cle] as Record<string, unknown> | undefined;
    if (!va || !vb) return false; // garantie présente d'un côté seulement
    for (const champ of CHAMPS) {
      const na = (va[champ] ?? "").toString().trim().toLowerCase();
      const nb = (vb[champ] ?? "").toString().trim().toLowerCase();
      if (na !== nb) return false;
    }
  }
  return true;
}

export type DoublonGrossiste = {
  produit_id: string;
  produit_nom: string;
  compagnie_id: string;
  compagnie_nom: string;
  compagnie_type: string | null;
  /** true si CE candidat (compagnie directe) doit être privilégié sur le produit validé (chez un grossiste). */
  a_privilegier: boolean;
};

/**
 * Détecte, pour un produit dont la grille vient d'être validée, si un autre
 * produit — même assureur porteur, même famille, mais chez une compagnie
 * (grossiste) différente — porte des garanties identiques. Ne compare que
 * des grilles elles-mêmes validées (statut "valide") : jamais un brouillon
 * contre une référence fiable.
 */
async function detecterDoublonsGrossiste(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  produitId: string,
): Promise<DoublonGrossiste[]> {
  const { data: produit } = await supabase
    .from("produits")
    .select("id, nom, compagnie_id, famille_id, assureur_porteur, compagnies(type_partenaire)")
    .eq("id", produitId)
    .maybeSingle();
  if (!produit?.assureur_porteur) return [];
  const typePartenaireCible = (produit as { compagnies: { type_partenaire: string } | null }).compagnies
    ?.type_partenaire as string | null;

  const { data: grille } = await supabase
    .from("produit_garanties")
    .select("valeurs")
    .eq("produit_id", produitId)
    .eq("statut", "valide")
    .maybeSingle();
  if (!grille?.valeurs) return [];

  const { data: candidats } = await supabase
    .from("produits")
    .select("id, nom, compagnie_id, compagnies(nom, type_partenaire)")
    .eq("assureur_porteur", produit.assureur_porteur)
    .eq("famille_id", produit.famille_id)
    .neq("compagnie_id", produit.compagnie_id)
    .neq("id", produitId);
  if (!candidats || candidats.length === 0) return [];

  const doublons: DoublonGrossiste[] = [];
  for (const c of candidats as {
    id: string;
    nom: string;
    compagnie_id: string;
    compagnies: { nom: string; type_partenaire: string } | null;
  }[]) {
    const { data: grilleCandidate } = await supabase
      .from("produit_garanties")
      .select("valeurs")
      .eq("produit_id", c.id)
      .eq("statut", "valide")
      .maybeSingle();
    if (!grilleCandidate?.valeurs) continue;
    if (garantiesIdentiques(grille.valeurs, grilleCandidate.valeurs)) {
      const typeCandidat = c.compagnies?.type_partenaire ?? null;
      doublons.push({
        produit_id: c.id,
        produit_nom: c.nom,
        compagnie_id: c.compagnie_id,
        compagnie_nom: c.compagnies?.nom ?? "Compagnie inconnue",
        compagnie_type: typeCandidat,
        // À privilégier si CE candidat est une compagnie directe alors que le
        // produit validé est chez un grossiste — jamais l'inverse.
        a_privilegier: typeCandidat === "compagnie" && typePartenaireCible === "courtier_grossiste",
      });
    }
  }
  return doublons;
}

async function assertStaff(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  admin = false,
) {
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  const roles = ((data ?? []) as { role: string }[]).map((r) => r.role);
  if (admin ? !roles.includes("admin") : !roles.some((r) => r === "admin" || r === "mandataire")) {
    throw new Error(admin ? "Réservé à l'administrateur du cabinet" : "Accès réservé au cabinet");
  }
  return roles;
}

/** Lance l'analyse IA d'un CG/IPID : crée une PROPOSITION, jamais une grille validée. */
export const analyserDocumentGaranties = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ document_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { analyserDocumentProduit } = await import("./produit-garanties-extraction.server");
    return analyserDocumentProduit(context.supabase, data.document_id, context.userId);
  });

/**
 * Standardisation du contrat : analyse croisée de plusieurs documents
 * (CG + IPID + fiche produit + fiche CCSF) en une seule proposition.
 */
export const analyserDocumentsGaranties = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ document_ids: z.array(z.string().uuid()).min(1).max(4) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { analyserDocumentsProduit } = await import("./produit-garanties-extraction.server");
    return analyserDocumentsProduit(context.supabase, data.document_ids, context.userId);
  });

/**
 * Préremplit une proposition depuis la fiche produit, ou depuis les CG si
 * aucune fiche produit n'est enregistrée. La validation reste humaine.
 */
export const analyserGarantiesAutomatiquement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ produit_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { analyserGarantiesProduitAutomatiquement } = await import("./produit-garanties-extraction.server");
    return analyserGarantiesProduitAutomatiquement(context.supabase, data.produit_id, context.userId);
  });

/** Enregistre la grille comme brouillon (saisie humaine en cours). */
export const enregistrerGrilleBrouillon = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        produit_id: z.string().uuid(),
        famille_code: z.string().max(50),
        grille_version: z.number().int().min(1),
        valeurs: z.record(z.string(), valeurSchema),
        document_source_id: z.string().uuid().nullable().optional(),
        notes: z.string().max(2000).nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { error } = await context.supabase.from("produit_garanties").upsert(
      {
        produit_id: data.produit_id,
        famille_code: data.famille_code,
        grille_version: data.grille_version,
        valeurs: data.valeurs,
        statut: "brouillon",
        document_source_id: data.document_source_id ?? null,
        notes: data.notes ?? null,
        created_by: context.userId,
      },
      { onConflict: "produit_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Validation humaine explicite de la grille (admin uniquement). */
export const validerGrilleGaranties = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        produit_id: z.string().uuid(),
        famille_code: z.string().max(50),
        grille_version: z.number().int().min(1),
        valeurs: z.record(z.string(), valeurSchema),
        document_source_id: z.string().uuid().nullable().optional(),
        proposition_id: z.string().uuid().nullable().optional(),
        notes: z.string().max(2000).nullable().optional(),
        /** Validation humaine explicite de l'assureur porteur proposé par l'IA. */
        assureur_porteur: z.string().max(120).nullable().optional(),
        reference_contrat: z.string().max(120).nullable().optional(),

      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId, true);

    const { error } = await context.supabase.from("produit_garanties").upsert(
      {
        produit_id: data.produit_id,
        famille_code: data.famille_code,
        grille_version: data.grille_version,
        valeurs: data.valeurs,
        statut: "valide",
        document_source_id: data.document_source_id ?? null,
        notes: data.notes ?? null,
        valide_par: context.userId,
        valide_le: new Date().toISOString(),
        created_by: context.userId,
      },
      { onConflict: "produit_id" },
    );
    if (error) throw new Error(error.message);

    // Assureur porteur / référence de contrat : écrits seulement si l'admin les a validés.
    const patchProduit: { assureur_porteur?: string; reference_contrat?: string } = {};
    if (data.assureur_porteur) patchProduit.assureur_porteur = data.assureur_porteur.trim();
    if (data.reference_contrat) patchProduit.reference_contrat = data.reference_contrat.trim();
    if (Object.keys(patchProduit).length > 0) {
      const { error: pErr } = await context.supabase
        .from("produits")
        .update(patchProduit)
        .eq("id", data.produit_id);
      if (pErr) throw new Error(pErr.message);
    }


    if (data.proposition_id) {
      await context.supabase
        .from("produit_garanties_propositions")
        .update({ statut: "acceptee", traite_par: context.userId, traite_le: new Date().toISOString() })
        .eq("id", data.proposition_id);
    }

    await context.supabase.rpc("log_audit", {
      _action: "valider_grille_garanties",
      _target_type: "produit_garanties",
      _target_id: data.produit_id,
      _metadata: {
        grille_version: data.grille_version,
        proposition_id: data.proposition_id ?? null,
        assureur_porteur: data.assureur_porteur ?? null,
        reference_contrat: data.reference_contrat ?? null,
      },
    });


    const doublons = await detecterDoublonsGrossiste(context.supabase, data.produit_id);

    if (doublons.length > 0) {
      await context.supabase.rpc("log_audit", {
        _action: "doublon_grossiste_detecte",
        _target_type: "produit_garanties",
        _target_id: data.produit_id,
        _metadata: {
          assureur_porteur: data.assureur_porteur ?? null,
          doublons: doublons.map((d) => ({ produit_id: d.produit_id, compagnie: d.compagnie_nom })),
        },
      });
    }

    return { ok: true, doublons };
  });

/** Rejet d'une proposition IA (aucune donnée reprise). */
export const rejeterPropositionGaranties = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ proposition_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("produit_garanties_propositions")
      .update({ statut: "rejetee", traite_par: context.userId, traite_le: new Date().toISOString() })
      .eq("id", data.proposition_id);
    if (error) throw new Error(error.message);

    await context.supabase.rpc("log_audit", {
      _action: "rejeter_proposition_garanties",
      _target_type: "produit_garanties_propositions",
      _target_id: data.proposition_id,
      _metadata: {},
    });
    return { ok: true };
  });

/** Analyse un « tableau de garanties » santé : une PROPOSITION par formule détectée. */
export const analyserTableauGaranties = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ document_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { analyserTableauGarantiesFormules } = await import("./formule-garanties-extraction.server");
    return analyserTableauGarantiesFormules(context.supabase, data.document_id, context.userId);
  });

/** Accepte une proposition de formule : crée/retrouve la formule puis écrit sa grille. */
export const accepterPropositionFormule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        proposition_id: z.string().uuid(),
        statut: z.enum(["brouillon", "valide"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId, data.statut === "valide");
    const { traiterPropositionFormule } = await import("./formule-garanties.server");
    return traiterPropositionFormule(context.supabase, data.proposition_id, data.statut, context.userId);
  });

/** Rejet d'une proposition de formule (aucune donnée reprise). */
export const rejeterPropositionFormule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ proposition_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("formule_garanties_propositions")
      .update({ statut: "rejetee", traite_par: context.userId, traite_le: new Date().toISOString() })
      .eq("id", data.proposition_id);
    if (error) throw new Error(error.message);
    await context.supabase.rpc("log_audit", {
      _action: "rejeter_proposition_formule",
      _target_type: "formule_garanties_propositions",
      _target_id: data.proposition_id,
      _metadata: {},
    });
    return { ok: true };
  });

/**
 * État des grilles de garanties d'une famille de produits : documents
 * analysables, proposition IA en attente, grille validée.
 * Lecture seule — sert l'atelier de standardisation par famille.
 */
export const listerEtatGrillesFamille = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ famille_code: z.string().max(50) }).parse(input))
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { etatGrillesFamille } = await import("./produit-garanties-etat.server");
    return etatGrillesFamille(context.supabase, data.famille_code);
  });

/**
 * Remonte dans le CRM les CG déposées à la main dans le Drive officiel
 * ([Compagnie]/[Branche]). Seul le lien Drive est enregistré.
 */
export const synchroniserCgDrive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertStaff(context.supabase, context.userId);
    const { synchroniserCgDepuisDrive } = await import("./cg-drive-sync.server");
    return synchroniserCgDepuisDrive(context.supabase, context.userId);
  });

/** Crée dans le Drive des CG un dossier par compagnie/branche du CRM (sans doublon). */
export const creerDossiersCompagniesDrive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertStaff(context.supabase, context.userId);
    const { creerDossiersCompagniesSurDrive } = await import("./cg-drive-sync.server");
    return creerDossiersCompagniesSurDrive(context.supabase);
  });

/** Téléverse vers le Drive les CG encore stockées dans le CRM, correctement classées. */
export const televerserCgVersDrive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertStaff(context.supabase, context.userId);
    const { televerserDocumentsCrmVersDrive } = await import("./cg-drive-sync.server");
    return televerserDocumentsCrmVersDrive(context.supabase);
  });
