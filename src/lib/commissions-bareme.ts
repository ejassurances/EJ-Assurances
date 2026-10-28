/**
 * Barème de commissions du cabinet (staff uniquement).
 *
 * Résolution : une règle de niveau « compagnie » pour une branche donnée
 * prévaut sur la règle « branche » correspondante ; à défaut, la règle
 * « branche » ; à défaut, la valeur par défaut codée ici.
 */
import { BRANCHES, type BrancheAssurance } from "@/lib/recueil-besoins-schemas";

export type NiveauRegle = "branche" | "compagnie";
export type TypeCommission = "fixe" | "pourcentage";
export type BaseCalcul = "prime" | "economie_realisee";

export interface RegleCommission {
  id?: string;
  niveau: NiveauRegle;
  branche: string;
  compagnie_id: string | null;
  type: TypeCommission;
  montant_fixe: number | null;
  taux_pourcentage: number | null;
  base_calcul: BaseCalcul;
  notes: string | null;
  /**
   * Cycle de commissionnement : « mensuelle » (défaut) ou « annuelle » pour les
   * produits à cotisation annuelle (ex. trottinette : 5 % chaque année, sans
   * dégressivité).
   */
  periodicite?: "mensuelle" | "annuelle" | null;
  /**
   * Assiette exprimée en prime MENSUELLE pure (cotisation_mensuelle du devoir de
   * conseil / du contrat, hors frais de dossier, d'adhésion, de souscription et
   * hors taxes). Utilisé par la règle par défaut « un mois de cotisation ».
   */
  assiette_mensuelle?: boolean;
}

export const BRANCHES_COMMISSION: { value: BrancheAssurance; label: string }[] = BRANCHES.map((b) => ({
  value: b.value,
  label: b.label,
}));

export const LIBELLE_BASE: Record<BaseCalcul, string> = {
  prime: "Prime",
  economie_realisee: "Économie réalisée",
};

/** Compatibilité historique : absence de barème = aucun taux inventé. */
export function regleParDefaut(branche: string): RegleCommission {
  return { niveau: "branche", compagnie_id: null, branche, type: "pourcentage",
    montant_fixe: null, taux_pourcentage: null, base_calcul: "prime",
    notes: "Commission compagnie non calculable : barème à configurer." };
}

export type SourceRegle = "compagnie" | "branche" | "defaut";

export function resoudreRegle(
  regles: RegleCommission[],
  branche: string | null,
  compagnieId: string | null,
): { regle: RegleCommission; source: SourceRegle } {
  const b = branche ?? "iard";
  if (compagnieId) {
    const spec = regles.find(
      (r) => r.niveau === "compagnie" && r.branche === b && r.compagnie_id === compagnieId,
    );
    if (spec) return { regle: spec, source: "compagnie" };
  }
  const parBranche = regles.find((r) => r.niveau === "branche" && r.branche === b);
  if (parBranche) return { regle: parBranche, source: "branche" };
  return { regle: regleParDefaut(b), source: "defaut" };
}

/** Montant de commission selon la règle applicable. */
export function calculerCommission(
  regle: RegleCommission,
  bases: { prime?: number | null; primeMensuelle?: number | null; economie?: number | null },
): number | null {
  if (regle.base_calcul === "economie_realisee") return null;
  if (regle.type === "fixe") return regle.montant_fixe != null && Number.isFinite(Number(regle.montant_fixe)) ? Number(regle.montant_fixe) : null;
  if (regle.taux_pourcentage == null || !Number.isFinite(Number(regle.taux_pourcentage))) return null;
  const assiette =
    regle.base_calcul === "economie_realisee"
      ? bases.economie
      : regle.assiette_mensuelle
        ? (bases.primeMensuelle ?? null)
        : bases.prime;
  if (assiette == null || !Number.isFinite(Number(assiette))) return null;
  return (Number(assiette) * Number(regle.taux_pourcentage ?? 0)) / 100;
}

export function decrireRegle(regle: RegleCommission): string {
  if (regle.base_calcul === "economie_realisee") return "À revoir : économies = frais de distribution, pas commission";
  if (regle.montant_fixe == null && regle.taux_pourcentage == null) return "Non calculable — barème à configurer";
  const cycle = regle.periodicite === "annuelle" ? " · chaque année" : "";
  if (regle.type === "fixe")
    return `${Number(regle.montant_fixe ?? 0).toLocaleString("fr-FR")} € fixes${cycle}`;
  if (regle.assiette_mensuelle && regle.base_calcul === "prime" && Number(regle.taux_pourcentage) === 100)
    return "Un mois de cotisation (prime mensuelle pure)";
  return `${Number(regle.taux_pourcentage ?? 0).toLocaleString("fr-FR")} % · ${LIBELLE_BASE[regle.base_calcul]}${cycle}`;
}

export const LIBELLE_SOURCE: Record<SourceRegle, string> = {
  compagnie: "Règle compagnie",
  branche: "Règle branche",
  defaut: "À configurer",
};

/** Branche déduite d'un contrat (l'emprunteur est porté par un booléen dédié). */
export function brancheContrat(c: { is_emprunteur?: boolean | null; type_assurance?: string | null }): string {
  if (c.is_emprunteur) return "emprunteur";
  return c.type_assurance ?? "iard";
}

export const fmtEuros = (n: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(n);
