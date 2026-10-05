/**
 * CA prévisionnel — paliers « sécurisé / probabilisé » (vert / orange).
 *
 * Règle métier : page Notion « CRM Assurance » → « Prévisionnel pluriannuel »
 * et « Visualisation prévisionnelle ».
 *  - Vert  = CA prévisionnel SÉCURISÉ à 100 %.
 *  - Orange = CA prévisionnel PROBABILISÉ, pondéré à 70 %.
 *  - Assurance emprunteur : 8 premières années sécurisées (Notion, explicite).
 *  - Assurance-vie / épargne : 8 premières années sécurisées (validé par Erwan).
 *  - Assurances à tacite reconduction (santé, prévoyance, MRH, auto…) : « la
 *    première année du contrat est à 100 % ; une reconduction effectivement
 *    constatée sécurise la période suivante à 100 % ». En l'ABSENCE de tout
 *    événement de reconduction enregistré (cas actuel du CRM), cette règle se
 *    résout à : 1 année sécurisée, puis probabilisé. La zone verte s'étendra
 *    automatiquement quand les reconductions seront enregistrées (voir
 *    `anneesSecuriseesPour` + l'historique, non disponible aujourd'hui).
 *  - L'axe n'a pas de borne fixe : la projection s'arrête à la dernière échéance
 *    connue (donc à la fin du contrat le plus lointain).
 *
 * Aucune valeur n'est inventée : 8 ans (emprunteur/épargne) et 1 an (tacite
 * reconduction sans historique) proviennent directement du référentiel Notion.
 *
 * Module PUR : aucune lecture réseau ni base. Il consomme l'échéancier déjà
 * calculé (`contrat_echeances`).
 */

/** Pondération de la zone probabilisée (Notion : 70 %). */
export const PONDERATION_PROBABILISE = 0.7;

/** Paliers fixes (emprunteur, AV/épargne) : 8 premières années sécurisées. */
export const ANNEES_SECURISEES_FIXES = 8;

/**
 * Tacite reconduction SANS reconduction enregistrée : 1 année sécurisée
 * (Notion : « la première année du contrat est à 100 % »). Base extensible dès
 * que l'historique des reconductions existera.
 */
export const ANNEES_SECURISEES_RECONDUCTION_BASE = 1;

/**
 * Familles de produits suivant la règle à paliers fixes (8 ans). Les autres
 * familles relèvent de la tacite reconduction (base 1 an, extensible).
 */
export const FAMILLES_PALIERS_FIXES: ReadonlySet<string> = new Set(["emprunteur", "epargne"]);

export type Palier = "securise" | "probabilise";

/** Une ligne d'échéancier d'un contrat (issue de `contrat_echeances`). */
export type EcheanceCA = {
  contratId: string;
  /** Code de la famille produit (`produit_familles.code`), si connu. */
  familleCode: string | null;
  estEmprunteur: boolean;
  /** Année du contrat, en base 1 (1 = première année). */
  anneeContrat: number;
  /** Année calendaire de la période (issue de `date_debut_periode`). */
  anneeCalendaire: number;
  /** CA cabinet de la période (commission assurance côté cabinet). */
  commissionCabinet: number | null;
};

/** CA prévisionnel d'une année calendaire, réparti par palier. */
export type LignePalierAnnee = {
  annee: number;
  /** CA sécurisé (vert), à 100 %. */
  securise: number;
  /** CA probabilisé (orange), DÉJÀ pondéré (× 0,7). */
  probabilise: number;
  /** securise + probabilise. */
  total: number;
};

export type ResultatPaliers = {
  lignes: LignePalierAnnee[];
  /**
   * Contrats à tacite reconduction projetés avec la base « 1 an sécurisé » : leur
   * zone verte s'étendra quand les reconductions seront enregistrées. Listés
   * pour transparence (aucune donnée de reconduction n'existe aujourd'hui).
   */
  contratsReconductionBase: string[];
};

const arrondi = (n: number): number => Math.round(n * 100) / 100;

/** Un contrat suit-il la règle à paliers fixes (emprunteur ou AV/épargne) ? */
export function suitPaliersFixes(e: {
  familleCode: string | null;
  estEmprunteur: boolean;
}): boolean {
  if (e.estEmprunteur) return true;
  return e.familleCode != null && FAMILLES_PALIERS_FIXES.has(e.familleCode);
}

/**
 * Nombre d'années sécurisées (vert) pour un contrat : 8 pour emprunteur/épargne,
 * 1 pour les contrats à tacite reconduction tant qu'aucune reconduction n'est
 * enregistrée. (Signature prête à recevoir une durée sécurisée recalculée depuis
 * l'historique des reconductions, le jour où cette donnée existera.)
 */
export function anneesSecuriseesPour(e: {
  familleCode: string | null;
  estEmprunteur: boolean;
}): number {
  return suitPaliersFixes(e) ? ANNEES_SECURISEES_FIXES : ANNEES_SECURISEES_RECONDUCTION_BASE;
}

/** Classe une année de contrat : sécurisée jusqu'à N, puis probabilisée. */
export function classerAnnee(anneeContrat: number, anneesSecurisees: number): Palier {
  return anneeContrat <= anneesSecurisees ? "securise" : "probabilise";
}

/**
 * Agrège l'échéancier en CA prévisionnel par année calendaire, réparti entre
 * zone sécurisée (vert, 100 %) et zone probabilisée (orange, pondérée à 70 %).
 * Couvre toutes les familles : emprunteur/épargne (8 ans) et tacite reconduction
 * (1 an de base). La projection s'arrête naturellement à la dernière échéance.
 */
export function paliersCaParAnnee(
  echeances: EcheanceCA[],
  opts: { pondProbabilise?: number } = {},
): ResultatPaliers {
  const pond = opts.pondProbabilise ?? PONDERATION_PROBABILISE;

  const parAnnee = new Map<number, { securise: number; probabilise: number }>();
  const reconductionBase = new Set<string>();

  for (const e of echeances) {
    if (!suitPaliersFixes(e)) reconductionBase.add(e.contratId);
    const montant = Number(e.commissionCabinet ?? 0);
    if (!montant) continue;
    const acc = parAnnee.get(e.anneeCalendaire) ?? { securise: 0, probabilise: 0 };
    if (classerAnnee(e.anneeContrat, anneesSecuriseesPour(e)) === "securise") {
      acc.securise += montant;
    } else {
      acc.probabilise += montant * pond;
    }
    parAnnee.set(e.anneeCalendaire, acc);
  }

  const lignes = [...parAnnee.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([annee, v]) => ({
      annee,
      securise: arrondi(v.securise),
      probabilise: arrondi(v.probabilise),
      total: arrondi(v.securise + v.probabilise),
    }));

  return { lignes, contratsReconductionBase: [...reconductionBase] };
}

/** Totaux tous millésimes confondus (pratique pour une carte de synthèse). */
export function totauxPaliers(lignes: LignePalierAnnee[]): {
  securise: number;
  probabilise: number;
  total: number;
} {
  const s = lignes.reduce((a, l) => a + l.securise, 0);
  const p = lignes.reduce((a, l) => a + l.probabilise, 0);
  return { securise: arrondi(s), probabilise: arrondi(p), total: arrondi(s + p) };
}
