/**
 * Lot J — comparatif CA encaissé (cockpit) : année N vs N-1, mois vs mois-1.
 * Réutilise la DÉFINITION existante de l'encaissé (commission statut « versee »,
 * sommée par date_versement) — voir syntheseAnnee. Aucune règle nouvelle.
 */
export type CommissionVersee = {
  statut: string;
  date_versement: string | null;
  montant: number | null;
};

const r = (n: number): number => Math.round(n * 100) / 100;

/** Encaissé d'une année civile (commissions versées, par année de versement). */
export function encaisseAnnee(commissions: CommissionVersee[], annee: number): number {
  const total = commissions
    .filter((c) => c.statut === "versee" && (c.date_versement ?? "").slice(0, 4) === String(annee))
    .reduce((s, c) => s + Number(c.montant ?? 0), 0);
  return r(total);
}

/** Encaissé d'un mois (clé « YYYY-MM »). */
export function encaisseMois(commissions: CommissionVersee[], cleMois: string): number {
  const total = commissions
    .filter((c) => c.statut === "versee" && (c.date_versement ?? "").slice(0, 7) === cleMois)
    .reduce((s, c) => s + Number(c.montant ?? 0), 0);
  return r(total);
}

/** Variation en % entre courant et précédent ; null si base nulle (incalculable). */
export function variationPct(courant: number, precedent: number): number | null {
  if (precedent === 0) return null;
  return r(((courant - precedent) / precedent) * 100);
}

/** Clé « YYYY-MM » du mois décalé de `delta` mois par rapport à une date. */
export function cleMois(d: Date, delta = 0): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + delta, 1));
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, "0")}`;
}

export type ComparatifCa = {
  annee: number;
  encaisseAnnee: number;
  encaisseAnneePrecedente: number;
  variationAnnuellePct: number | null;
  moisCourant: string;
  encaisseMoisCourant: number;
  moisPrecedent: string;
  encaisseMoisPrecedent: number;
  variationMensuellePct: number | null;
};

/** Construit le comparatif complet à partir des commissions versées. */
export function comparatifCa(commissions: CommissionVersee[], maintenant: Date = new Date()): ComparatifCa {
  const annee = maintenant.getUTCFullYear();
  const mc = cleMois(maintenant, 0);
  const mp = cleMois(maintenant, -1);
  const encN = encaisseAnnee(commissions, annee);
  const encN1 = encaisseAnnee(commissions, annee - 1);
  const encMc = encaisseMois(commissions, mc);
  const encMp = encaisseMois(commissions, mp);
  return {
    annee,
    encaisseAnnee: encN,
    encaisseAnneePrecedente: encN1,
    variationAnnuellePct: variationPct(encN, encN1),
    moisCourant: mc,
    encaisseMoisCourant: encMc,
    moisPrecedent: mp,
    encaisseMoisPrecedent: encMp,
    variationMensuellePct: variationPct(encMc, encMp),
  };
}
