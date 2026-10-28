/**
 * Taux de commission porté par un devis comparé (étape 6 — Simulations).
 *
 * Le taux est SAISI (la plupart des partenaires n'ont pas d'API de tarification),
 * prérempli depuis le barème du cabinet selon compagnie + branche. Il est ensuite
 * la SEULE source de la commission prévisionnelle du contrat individuel de
 * l'assuré : aucun second calcul indépendant.
 *
 * Information strictement interne : jamais exposée au client, au prescripteur ni
 * dans un document remis.
 */
import { resoudreRegle, type RegleCommission, type SourceRegle } from "@/lib/commissions-bareme";

export type BaseCommission = "prime" | "economie_realisee";
export type SourceTaux = SourceRegle | "manuel";

export interface TauxDevis {
  /** Pourcentage appliqué à l'assiette (5 = 5 %). Null si la règle est un montant fixe. */
  taux: number | null;
  /** Montant fixe par contrat, si la règle du barème est de type « fixe ». */
  montant_fixe: number | null;
  base: BaseCommission;
  source: SourceTaux;
}

/** Taux proposé par défaut pour un devis, d'après le barème (compagnie > branche > défaut). */
export function tauxDefautDevis(
  regles: RegleCommission[],
  branche: string | null,
  compagnieId: string | null,
): TauxDevis {
  const { regle, source } = resoudreRegle(regles, branche, compagnieId);
  if (regle.base_calcul === "economie_realisee" || (regle.taux_pourcentage == null && regle.montant_fixe == null))
    return { taux: null, montant_fixe: null, base: "prime", source };
  if (regle.type === "fixe") {
    return { taux: null, montant_fixe: Number(regle.montant_fixe ?? 0), base: "prime", source };
  }
  return {
    taux: Number(regle.taux_pourcentage ?? 0),
    montant_fixe: null,
    base: regle.base_calcul === "economie_realisee" ? "economie_realisee" : "prime",
    source,
  };
}

export interface AssietteCommission {
  /** Cotisation mensuelle du contrat de l'assuré (prime pure, hors frais et taxes). */
  cotisationMensuelle?: number | null;
  /** Économie réalisée sur la durée restante du prêt, pour l'ensemble du prêt. */
  economie?: number | null;
  /** Nombre d'échéances restantes (mois restants du prêt). */
  moisRestants?: number | null;
  /** Quotité de l'assuré et somme des quotités du prêt, pour le prorata. */
  quotitePct?: number | null;
  totalQuotites?: number | null;
}

export interface CommissionPrevue {
  /** Montant d'une échéance de commission. */
  mensuel: number | null;
  /** Nombre d'échéances de commission. */
  mois: number | null;
  /** Total prévisionnel. */
  total: number | null;
}

const arrondi = (n: number) => Math.round(n * 100) / 100;

/**
 * Commission prévisionnelle d'un contrat d'assuré, calculée depuis le taux du
 * devis retenu.
 *
 * - Base « prime » : le taux s'applique à chaque cotisation mensuelle, sur toutes
 *   les échéances restantes.
 * - Base « économie réalisée » : le taux s'applique une seule fois à l'économie
 *   (prélèvement sur la première mensualité, usage emprunteur).
 */
export function commissionDepuisDevis(
  taux: { taux: number | null; montant_fixe?: number | null; base: BaseCommission },
  assiette: AssietteCommission,
): CommissionPrevue {
  if (taux.base === "economie_realisee") return { mensuel: null, mois: null, total: null };

  if (taux.montant_fixe != null && (taux.taux == null || taux.taux === 0)) {
    const m = arrondi(Number(taux.montant_fixe));
    return { mensuel: m, mois: 1, total: m };
  }
  const pct = taux.taux != null ? Number(taux.taux) : null;
  if (pct == null || !Number.isFinite(pct)) return { mensuel: null, mois: null, total: null };


  if (assiette.cotisationMensuelle == null) return { mensuel: null, mois: null, total: null };
  const mensuel = arrondi((Number(assiette.cotisationMensuelle) * pct) / 100);
  const mois =
    assiette.moisRestants != null && Number(assiette.moisRestants) > 0
      ? Math.round(Number(assiette.moisRestants))
      : null;
  return { mensuel, mois, total: mois != null ? arrondi(mensuel * mois) : null };
}

/** Taux exprimé en fraction pour `contrats.commission_cabinet_taux` (5 % → 0,05). */
export function tauxEnFraction(pourcentage: number | null | undefined): number | null {
  if (pourcentage == null) return null;
  const n = Number(pourcentage);
  if (!Number.isFinite(n)) return null;
  return Math.round((n / 100) * 10000) / 10000;
}
