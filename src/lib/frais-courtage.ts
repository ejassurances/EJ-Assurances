/**
 * FRAIS DE COURTAGE (= FRAIS DE DISTRIBUTION, synonymes) — fonction PURE.
 *
 * Règle validée par Erwan le 07/11/2026 (remplace celle du 22/09/2026, à 10 %) :
 *  1. Base = 5 % de l'économie brute totale réalisée par le client
 *     (différence de prix avec le contrat actuel sur la durée restante du prêt,
 *     avant tout frais).
 *  2. Plancher = 175 € par personne assurée : le cabinet ne gagne jamais moins,
 *     sauf accord d'un administrateur (mode « offert » ou « montant fixe »).
 *  3. Le client paie le montant le plus élevé entre la base et
 *     « plancher + frais de dossier de la compagnie ». Les frais de dossier sont
 *     donc inclus dans la base au-dessus du plancher, et s'ajoutent au plancher
 *     en dessous.
 *     Exemples : économie 2 000 €, frais de dossier 50 € → 175 € + 50 € ;
 *     économie 6 000 €, frais de dossier 50 € → 300 € (250 € cabinet, 50 € compagnie).
 *
 * `montant` est la part du cabinet (frais de distribution) ; les frais de
 * dossier et d'adhésion de la compagnie s'ajoutent à côté dans les totaux.
 *
 * Ce que cette fonction NE couvre PAS : le paiement en 1 ou 12 fois, la
 * demande de remise et sa validation par un administrateur. Chantiers séparés.
 */

export interface FraisCourtageEntree {
  /** Économie brute réalisée (cotisations seules), sur la durée résiduelle du prêt. */
  economieBrute: number | null;
  /** Nombre d'assurés sur le contrat (têtes assurées). */
  nbAssures: number | null;
  /** Frais de dossier retenus par le partenaire (grossiste/compagnie), pas pour le cabinet. */
  fraisDossierPartenaire?: number | null;
  /** Frais d'adhésion retenus par le partenaire, pas pour le cabinet. */
  fraisAdhesionPartenaire?: number | null;
}

export interface FraisCourtageResultat {
  /** Montant final facturé au client au titre des frais de courtage (= frais de distribution). */
  montant: number;
  /** 5 % de l'économie brute, avant application du plancher ou déduction partenaire. */
  base: number;
  /** 175 € × nombre d'assurés. */
  plancher: number;
  /** true si le plancher a été appliqué directement (base ≤ plancher, pas de déduction). */
  planchierApplique: boolean;
  /** Part réellement retenue par le(s) partenaire(s), déduite du montant — 0 si le plancher s'applique tel quel. */
  partPartenaireDeduite: number;
  /** Part qui reste au cabinet une fois la part partenaire déduite. */
  partCabinet: number;
}

const PLANCHER_PAR_ASSURE = 175;
const TAUX_COURTAGE = 0.05;
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Calcule le montant de frais de courtage. Retourne null si les données
 * indispensables (économie, nombre d'assurés) manquent — jamais une
 * estimation inventée à leur place.
 */
export function calculerFraisCourtage(e: FraisCourtageEntree): FraisCourtageResultat | null {
  if (e.economieBrute == null || !Number.isFinite(e.economieBrute) || e.economieBrute <= 0)
    return null;
  if (e.nbAssures == null || !Number.isFinite(e.nbAssures) || e.nbAssures < 1) return null;

  const base = r2(e.economieBrute * TAUX_COURTAGE);
  const plancher = r2(PLANCHER_PAR_ASSURE * e.nbAssures);

  if (base <= plancher) {
    return {
      montant: plancher,
      base,
      plancher,
      planchierApplique: true,
      partPartenaireDeduite: 0,
      partCabinet: plancher,
    };
  }

  const partPartenaire = r2((e.fraisDossierPartenaire ?? 0) + (e.fraisAdhesionPartenaire ?? 0));
  const montant = Math.max(plancher, r2(base - partPartenaire));
  return {
    montant,
    base,
    plancher,
    planchierApplique: false,
    partPartenaireDeduite: r2(Math.max(0, base - montant)),
    partCabinet: montant,
  };
}
