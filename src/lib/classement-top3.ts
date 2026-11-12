/**
 * CLASSEMENT DES DEVIS EMPRUNTEUR — TOP 3 (demande d'Erwan du 11/11/2026) — fonction PURE.
 *
 * Règles :
 *  1. Coût total client d'une offre = primes sur la durée restante
 *     + frais de dossier de la compagnie + frais de distribution du cabinet.
 *  2. Classement du moins cher au plus cher sur ce coût total ;
 *     les offres sans prix vont en fin de liste (jamais un prix inventé).
 *  3. Les 3 premières offres chiffrées sont marquées TOP 3.
 *  4. Aucun classement ni prix sans l'assurance actuelle du prospect
 *     (ou la proposition de la banque pour un acquéreur) : sans référence,
 *     on ne peut ni mesurer l'économie ni calculer les frais de distribution.
 *  5. Offre « frais de courtage offerts » (contrat validé au plus tard le
 *     31/12/2026) : les frais de distribution valent 0 dans le coût client.
 *  La commission du cabinet est une donnée interne : elle n'entre pas dans le
 *  coût client et n'est jamais affichée au client.
 */
import { calculerFraisCourtage } from "./frais-courtage";

export type OffreEntree = {
  id: string;
  /** Coût des primes sur la durée restante du prêt (null = pas de prix). */
  primesTotales: number | null;
  /** Frais de dossier de la compagnie (null = non saisis, comptés 0 et signalés). */
  fraisDossier?: number | null;
  fraisAdhesion?: number | null;
};

export type OffreClassee = {
  id: string;
  rang: number | null;
  top3: boolean;
  primesTotales: number | null;
  fraisDossier: number;
  fraisDossierManquants: boolean;
  fraisDistribution: number | null;
  coutTotal: number | null;
  /** Économie nette pour le client : coût de l'assurance actuelle − coût total. */
  economieNette: number | null;
};

export type ClassementTop3 =
  | { statut: "sans_reference"; message: string; offres: [] }
  | { statut: "ok"; offres: OffreClassee[] };

export const FIN_OFFRE_COURTAGE_OFFERT = "2026-12-31";

export function courtageOffertActif(aujourdhui: Date = new Date()): boolean {
  return aujourdhui.toISOString().slice(0, 10) <= FIN_OFFRE_COURTAGE_OFFERT;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function classerTop3(params: {
  /** Coût restant de l'assurance actuelle (ou de la proposition bancaire). */
  coutAssuranceActuelle: number | null;
  nbAssures: number;
  offres: OffreEntree[];
  courtageOffert: boolean;
}): ClassementTop3 {
  const ref = params.coutAssuranceActuelle;
  if (ref == null || !Number.isFinite(ref) || ref <= 0) {
    return {
      statut: "sans_reference",
      message:
        "Aucun prix sans l'assurance actuelle du prospect (ou la proposition de la banque pour un acquéreur). Demandez le certificat d'adhésion.",
      offres: [],
    };
  }

  const calculees: OffreClassee[] = params.offres.map((o) => {
    const fraisDossierManquants = o.fraisDossier == null;
    const fraisDossier = (o.fraisDossier ?? 0) + (o.fraisAdhesion ?? 0);
    if (o.primesTotales == null || !Number.isFinite(o.primesTotales)) {
      return {
        id: o.id,
        rang: null,
        top3: false,
        primesTotales: null,
        fraisDossier,
        fraisDossierManquants,
        fraisDistribution: null,
        coutTotal: null,
        economieNette: null,
      };
    }
    const economieBrute = ref - o.primesTotales;
    let fraisDistribution: number | null;
    if (params.courtageOffert) fraisDistribution = 0;
    else {
      const f = calculerFraisCourtage({
        economieBrute,
        nbAssures: params.nbAssures,
        fraisDossierPartenaire: o.fraisDossier ?? 0,
        fraisAdhesionPartenaire: o.fraisAdhesion ?? 0,
      });
      // Pas d'économie : pas d'offre à recommander, mais le prix reste affiché avec le plancher.
      fraisDistribution = f ? f.montant : r2(175 * Math.max(1, params.nbAssures));
    }
    const coutTotal = r2(o.primesTotales + fraisDossier + fraisDistribution);
    return {
      id: o.id,
      rang: null,
      top3: false,
      primesTotales: o.primesTotales,
      fraisDossier,
      fraisDossierManquants,
      fraisDistribution,
      coutTotal,
      economieNette: r2(ref - coutTotal),
    };
  });

  const chiffrees = calculees
    .filter((o) => o.coutTotal != null)
    .sort((a, b) => (a.coutTotal as number) - (b.coutTotal as number));
  chiffrees.forEach((o, i) => {
    o.rang = i + 1;
    o.top3 = i < 3;
  });
  const sansPrix = calculees.filter((o) => o.coutTotal == null);
  return { statut: "ok", offres: [...chiffrees, ...sansPrix] };
}
