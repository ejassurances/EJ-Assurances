import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  syntheseAnnee,
  previsionsSynthetiques,
  COLONNES_PREVISION,
  type SyntheseAnnee,
  type CommissionPrevision,
  type ContratPourPrevision,
  type CommissionEncaissee,
} from "@/lib/commission-previsions";


export type CaRealSummary = {
  anneeEnCours: number;
  anneePrecedente: number;
  evolutionPct: number | null;
  debutAnneeEnCours: string;
  finPeriodeN1: string;
};

export type RepartitionPoint = {
  nom: string;
  valeur: number;
};

/**
 * Répartition des contrats actifs par compagnie d'assurance. Un contrat sans
 * compagnie rattachée est regroupé sous "Non renseigné".
 */
export const getRepartitionCompagnies = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<RepartitionPoint[]> => {
    const { data } = await context.supabase
      .from("contrats")
      .select("compagnies(nom)")
      .not("statut", "in", "(resilie,annule,cloture)");

    const compte = new Map<string, number>();
    for (const row of data ?? []) {
      const nom = (row as { compagnies: { nom: string } | null }).compagnies?.nom ?? "Non renseigné";
      compte.set(nom, (compte.get(nom) ?? 0) + 1);
    }
    return [...compte.entries()]
      .map(([nom, valeur]) => ({ nom, valeur }))
      .sort((a, b) => b.valeur - a.valeur);
  });

/**
 * Répartition des contrats actifs par famille de produit (type d'assurance :
 * emprunteur, santé, prévoyance, épargne...). Un contrat sans produit/famille
 * rattaché est regroupé sous "Non renseigné".
 */
export const getRepartitionTypeAssurance = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<RepartitionPoint[]> => {
    const [{ data: contrats }, { data: familles }] = await Promise.all([
      context.supabase.from("contrats").select("produit_id, is_emprunteur").not("statut", "in", "(resilie,annule,cloture)"),
      context.supabase.from("produit_familles").select("id, nom"),
    ]);
    const familleParProduit = new Map<string, string>();
    if (contrats && contrats.some((c) => c.produit_id)) {
      const produitIds = [...new Set((contrats ?? []).map((c) => c.produit_id).filter(Boolean))] as string[];
      if (produitIds.length > 0) {
        const { data: produits } = await context.supabase
          .from("produits")
          .select("id, famille_id")
          .in("id", produitIds);
        const nomFamille = new Map((familles ?? []).map((f) => [f.id, f.nom]));
        for (const p of produits ?? []) {
          if (p.famille_id) familleParProduit.set(p.id, nomFamille.get(p.famille_id) ?? "Non renseigné");
        }
      }
    }

    const compte = new Map<string, number>();
    for (const c of contrats ?? []) {
      const nom = (c.produit_id && familleParProduit.get(c.produit_id))
        ?? (c.is_emprunteur ? "Assurance emprunteur" : "Non renseigné");
      compte.set(nom, (compte.get(nom) ?? 0) + 1);
    }
    return [...compte.entries()]
      .map(([nom, valeur]) => ({ nom, valeur }))
      .sort((a, b) => b.valeur - a.valeur);
  });

export type DepartementPoint = {
  code: string; // code département (ex "75", "2A", "971")
  valeur: number;
};

/**
 * Déduit le code département à partir d'un code postal français.
 * Cas particuliers : Corse (2A/2B, approximation par plage numérique —
 * la limite réelle suit les communes, pas les codes postaux) et DOM (971-976).
 */
function departementDepuisCodePostal(codePostal: string | null): string | null {
  if (!codePostal) return null;
  const cp = codePostal.trim().padStart(5, "0");
  if (!/^\d{5}$/.test(cp)) return null;
  if (cp.startsWith("97")) return cp.slice(0, 3); // Guadeloupe, Martinique, Guyane, Réunion...
  if (cp.startsWith("98")) return null; // Monaco / collectivités hors carte départements
  if (cp.startsWith("20")) return Number(cp) < 20200 ? "2A" : "2B";
  return cp.slice(0, 2);
}

/** Répartition des clients (particuliers) par département de résidence. */
export const getRepartitionDepartements = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DepartementPoint[]> => {
    const { data } = await context.supabase.from("clients").select("code_postal");
    const compte = new Map<string, number>();
    for (const c of data ?? []) {
      const code = departementDepuisCodePostal(c.code_postal as string | null);
      if (!code) continue;
      compte.set(code, (compte.get(code) ?? 0) + 1);
    }
    return [...compte.entries()].map(([code, valeur]) => ({ code, valeur }));
  });

export type CaMensuelPoint = {
  mois: string; // "2026-01"
  label: string; // "Jan"
  montant: number;
};

const MOIS_LABELS = ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Août", "Sep", "Oct", "Nov", "Déc"];

/**
 * CA réel (commissions versées) mois par mois, de janvier à aujourd'hui,
 * pour l'année en cours. Source : mêmes commissions "versées" que
 * getCaRealEtN1, agrégées par mois plutôt qu'en un seul total.
 */
export const getCaMensuel = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CaMensuelPoint[]> => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const startCurrent = `${currentYear}-01-01`;
    const endCurrent = now.toISOString().split("T")[0];

    const { data: rows } = await context.supabase
      .from("commissions")
      .select("montant,date_versement")
      .eq("statut", "versee")
      .gte("date_versement", startCurrent)
      .lte("date_versement", endCurrent);

    const moisCourant = now.getMonth(); // 0-indexé, mois déjà écoulés inclus
    const totaux = new Array(moisCourant + 1).fill(0) as number[];
    for (const r of rows ?? []) {
      const dv = r.date_versement as string | null;
      if (!dv) continue;
      const m = new Date(dv).getMonth();
      if (m >= 0 && m <= moisCourant) totaux[m] += Number(r.montant ?? 0);
    }

    return totaux.map((montant, i) => ({
      mois: `${currentYear}-${String(i + 1).padStart(2, "0")}`,
      label: MOIS_LABELS[i],
      montant: Math.round(montant),
    }));
  });

/**
 * Retourne le CA réel (commissions versées) de l'année en cours,
 * le CA sur la période comparable N-1, et l'évolution en %.
 */
export const getCaRealEtN1 = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CaRealSummary> => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const startCurrent = `${currentYear}-01-01`;
    const endCurrent = now.toISOString().split("T")[0];

    const previousYear = currentYear - 1;
    const startPrevious = `${previousYear}-01-01`;
    const endPrevious = `${previousYear}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

    const [{ data: currentRows }, { data: previousRows }] = await Promise.all([
      context.supabase
        .from("commissions")
        .select("montant")
        .eq("statut", "versee")
        .gte("date_versement", startCurrent)
        .lte("date_versement", endCurrent),
      context.supabase
        .from("commissions")
        .select("montant")
        .eq("statut", "versee")
        .gte("date_versement", startPrevious)
        .lte("date_versement", endPrevious),
    ]);

    const sum = (rows: { montant: number | null }[] | null) =>
      (rows ?? []).reduce((acc, r) => acc + Number(r.montant ?? 0), 0);

    const anneeEnCours = sum(currentRows);
    const anneePrecedente = sum(previousRows);
    const evolutionPct = anneePrecedente > 0
      ? Number(((anneeEnCours - anneePrecedente) / anneePrecedente * 100).toFixed(1))
      : null;

    return {
      anneeEnCours,
      anneePrecedente,
      evolutionPct,
      debutAnneeEnCours: startCurrent,
      finPeriodeN1: endPrevious,
    };
  });

/**
 * Synthèse comptable de l'année civile en cours : commissions réellement
 * encaissées, prévisionnel restant à encaisser, et total attendu. Source
 * unique utilisée par le tableau de bord, la page Commissions et l'agent
 * comptabilité, afin que tous les écrans affichent les mêmes montants.
 */
export const getSyntheseAnneeCommissions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SyntheseAnnee> => {
    const [{ data }, { data: contrats }, { data: commissions }] = await Promise.all([
      context.supabase.from("commission_previsions").select(COLONNES_PREVISION),
      context.supabase
        .from("contrats")
        .select("id,dossier_id,compagnie_id,is_emprunteur,statut,date_effet,duree_mois,prime_annuelle,fractionnement"),
      context.supabase.from("commissions").select("contrat_id,montant,date_versement,statut"),
    ]);

    const previsions = (data as unknown as CommissionPrevision[]) ?? [];
    const encaissees = (commissions as unknown as CommissionEncaissee[]) ?? [];
    const toutes = [
      ...previsions,
      ...previsionsSynthetiques(
        (contrats as unknown as ContratPourPrevision[]) ?? [],
        encaissees,
        previsions,
      ),
    ];
    return syntheseAnnee(toutes, encaissees);
  });


export type PilotageCounts = {
  tachesOuvertes: number;
  dossiersBloques: number;
  dossiersAValider: number;
  dossiersSuiviCompagnie: number;
  escaladesAgent: number;
};

/** Vue synthétique orientée action pour le cockpit du cabinet. */
export const getPilotageCounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PilotageCounts> => {
    const db = context.supabase as any;
    const [taches, bloques, validations, suivi, escalades] = await Promise.all([
      db.from("taches")
        .select("id", { count: "exact", head: true })
        .in("statut", ["a_faire", "en_cours", "a_qualifier"])
        .eq("legacy_orpheline", false),
      db.from("dossiers")
        .select("id", { count: "exact", head: true })
        .eq("blocage_actif", true),
      db.from("dossiers")
        .select("id", { count: "exact", head: true })
        .eq("pipeline_etape", "fic_a_valider"),
      db.from("dossiers")
        .select("id", { count: "exact", head: true })
        .eq("pipeline_etape", "suivi_compagnie"),
      db.from("agent_escalations")
        .select("id", { count: "exact", head: true })
        .in("statut", ["a_traiter", "en_cours"]),
    ]);
    return {
      tachesOuvertes: taches.count ?? 0,
      dossiersBloques: bloques.count ?? 0,
      dossiersAValider: validations.count ?? 0,
      dossiersSuiviCompagnie: suivi.count ?? 0,
      escaladesAgent: escalades.count ?? 0,
    };
  });
