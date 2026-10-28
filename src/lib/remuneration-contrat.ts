/**
 * Rémunération d'un contrat : frais de distribution ET commission compagnie,
 * calculés séparément et jamais additionnés.
 * Source unique des règles, utilisée par l'écran contrat et le recalcul serveur.
 */

export const TAUX_FRAIS_EMPRUNTEUR = 0.05;
export const FRAIS_FORFAIT_CONTRAT = 20;
export const FRAIS_ASSURANCE_VIE = 0;
const TOLERANCE_EUR = 1;

export type FamilleFrais = "emprunteur" | "assurance_vie" | "autre";

export function familleFrais(input: { isEmprunteur?: boolean | null; branche?: string | null }): FamilleFrais {
  const b = (input.branche ?? "").toLowerCase();
  if (input.isEmprunteur || b === "emprunteur") return "emprunteur";
  if (/(^|_)(assurance_vie|vie|epargne)($|_)/.test(b)) return "assurance_vie";
  return "autre";
}

export type ResultatFrais =
  | { statut: "calcule"; montant: number; assiette: number | null; detail: string }
  | { statut: "a_verifier"; montant: null; motif: string };

const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Frais de distribution.
 * Emprunteur : 5 % de l'économie TOTALE sur toute la durée du prêt.
 * L'économie vient de economie_realisee ; sinon coût groupe − coût délégué
 * (coûts totaux sur toute la durée). Données absentes ou incohérentes : à vérifier.
 */
export function calculerFraisDistribution(input: {
  isEmprunteur?: boolean | null;
  branche?: string | null;
  dureeMois?: number | null;
  economieRealisee?: number | null;
  coutGroupeTotal?: number | null;
  coutDelegueTotal?: number | null;
}): ResultatFrais {
  const famille = familleFrais(input);
  if (famille === "assurance_vie")
    return { statut: "calcule", montant: FRAIS_ASSURANCE_VIE, assiette: null, detail: "Assurance vie : 0 €" };
  if (famille === "autre")
    return { statut: "calcule", montant: FRAIS_FORFAIT_CONTRAT, assiette: null, detail: "Forfait 20 € par contrat" };

  if ([input.dureeMois, input.economieRealisee, input.coutGroupeTotal, input.coutDelegueTotal].some(v => v != null && !Number.isFinite(Number(v))))
    return { statut: "a_verifier", montant: null, motif: "Données numériques invalides" };
  const duree = num(input.dureeMois);
  if (!duree || duree <= 0) return { statut: "a_verifier", montant: null, motif: "Durée du prêt absente" };

  const eco = num(input.economieRealisee);
  const g = num(input.coutGroupeTotal);
  const d = num(input.coutDelegueTotal);
  if ((g !== null && g < 0) || (d !== null && d < 0)) return { statut: "a_verifier", montant: null, motif: "Coût total négatif" };
  const ecart = g !== null && d !== null ? g - d : null;

  let assiette: number;
  if (eco !== null) {
    if (eco < 0) return { statut: "a_verifier", montant: null, motif: "Économie négative" };
    if (ecart !== null && Math.abs(ecart - eco) > TOLERANCE_EUR)
      return { statut: "a_verifier", montant: null, motif: "Économie et coûts totaux incohérents" };
    assiette = eco;
  } else if (ecart !== null) {
    if (ecart < 0) return { statut: "a_verifier", montant: null, motif: "Coût délégué supérieur au coût groupe" };
    assiette = ecart;
  } else {
    return { statut: "a_verifier", montant: null, motif: "Économie totale non renseignée" };
  }
  return {
    statut: "calcule",
    montant: r2(assiette * TAUX_FRAIS_EMPRUNTEUR),
    assiette: r2(assiette),
    detail: `5 % de ${r2(assiette)} € d'économie sur ${duree} mois`,
  };
}

/* ------------------------------ Commission ------------------------------ */

export type ModeCommission = "lineaire" | "precompte";

export interface BaremeCompagnie {
  id: string;
  compagnie_id: string;
  branche: string;
  produit_id?: string | null;
  mode: ModeCommission | null;
  base_calcul?: string | null;
  periodicite?: string | null;
  /** Taux en % de la prime annuelle. Linéaire : taux_annee_1 s'applique à chaque année. */
  taux_annee_1: number | null;
  taux_renouvellement: number | null;
  date_effet: string | null;
  date_fin: string | null;
}

/** Barème applicable à la date d'effet du contrat ; produit précis prioritaire. */
export function choisirBareme(
  baremes: BaremeCompagnie[],
  ctx: { compagnieId: string | null; branche: string | null; produitId?: string | null; date: string | null },
): BaremeCompagnie | null {
  const { compagnieId, branche, date } = ctx;
  if (!compagnieId || !branche || !date) return null;
  const valides = baremes.filter(b => b.compagnie_id === compagnieId && b.branche === branche &&
    b.mode && b.date_effet && b.date_effet <= date && (!b.date_fin || b.date_fin >= date) &&
    (!b.produit_id || b.produit_id === ctx.produitId));
  const specifiques = valides.filter(b => b.produit_id === ctx.produitId && !!b.produit_id);
  const candidats = specifiques.length ? specifiques : valides.filter(b => !b.produit_id);
  // Une période ambiguë n'autorise pas un choix arbitraire.
  return candidats.length === 1 ? candidats[0] ?? null : null;
}

export interface LigneCommission {
  cle: string;
  annee: number;
  base: number;
  taux: number;
  montant: number;
}

export type ResultatCommission =
  | { statut: "calcule"; baremeId: string; mode: ModeCommission; lignes: LigneCommission[]; total: number }
  | { statut: "non_calculable"; motif: string; lignes: [] };

/** Commission prévisionnelle, une ligne par année de prime (clé stable = anti-doublon). */
export function calculerCommissionPrevisionnelle(input: {
  contratId: string;
  bareme: BaremeCompagnie | null;
  primeAnnuelle: number | null;
  primeNetteAnnuelle?: number | null;
  dureeMois: number | null;
}): ResultatCommission {
  const { bareme } = input;
  if (!bareme || !bareme.mode) return { statut: "non_calculable", motif: "Barème à configurer", lignes: [] };
  if (bareme.base_calcul && !["prime", "prime_nette"].includes(bareme.base_calcul))
    return { statut: "non_calculable", motif: "Assiette à revoir : les économies relèvent des frais de distribution", lignes: [] };
  const prime = num(bareme.base_calcul === "prime_nette" ? input.primeNetteAnnuelle : input.primeAnnuelle);
  if (!prime || prime <= 0) return { statut: "non_calculable", motif: "Prime annuelle absente", lignes: [] };
  const duree = num(input.dureeMois);
  if (!duree || duree <= 0 || !Number.isInteger(duree)) return { statut: "non_calculable", motif: "Durée du contrat absente", lignes: [] };
  const t1 = num(bareme.taux_annee_1);
  const tn = bareme.mode === "lineaire" ? t1 : num(bareme.taux_renouvellement);
  if (t1 === null || t1 < 0 || t1 > 100 || (duree > 12 && (tn === null || tn < 0 || tn > 100)))
    return { statut: "non_calculable", motif: "Taux du barème incomplet", lignes: [] };

  const annees = Math.ceil(duree / 12);
  const lignes: LigneCommission[] = [];
  for (let a = 1; a <= annees; a++) {
    const mois = a < annees ? 12 : duree - 12 * (annees - 1);
    const base = r2((prime * mois) / 12);
    const taux = a === 1 ? t1 : tn;
    if (taux === null) return { statut: "non_calculable", motif: "Taux du barème incomplet", lignes: [] };
    lignes.push({ cle: `${input.contratId}:commission:${a}`, annee: a, base, taux, montant: r2((base * taux) / 100) });
  }
  return {
    statut: "calcule",
    baremeId: bareme.id,
    mode: bareme.mode,
    lignes,
    total: r2(lignes.reduce((s, l) => s + l.montant, 0)),
  };
}
