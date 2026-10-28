/**
 * Commissions prévisionnelles par dossier (flux grossiste).
 *
 * Estimation à la validation du devoir de conseil, puis actualisation à
 * réception d'un bordereau (trigger SQL sur la table commissions).
 */
import { calculerCommission, type RegleCommission } from "@/lib/commissions-bareme";

/** Cycle de cotisation / de commissionnement. */
export type Periodicite = "mensuelle" | "annuelle";

/** Normalise une valeur de fractionnement contrat ou de règle en périodicité. */
export function periodiciteDe(valeur: string | null | undefined): Periodicite {
  return String(valeur ?? "").toLowerCase().startsWith("annuel") ? "annuelle" : "mensuelle";
}

/** Nombre de mois entre deux versements de commission. */
export function pasEnMois(p: Periodicite | null | undefined): number {
  return p === "annuelle" ? 12 : 1;
}

export interface CommissionPrevision {
  id: string;
  dossier_id: string;
  contrat_id: string | null;
  branche: string | null;
  compagnie_id: string | null;
  montant_mensuel_estime: number | null;
  mois_restants_initial: number | null;
  date_estimation: string | null;
  montant_mensuel_reel: number | null;
  mois_restants_actuels: number | null;
  montant_previsionnel_total: number | null;
  statut: string;
  /**
   * Cycle du versement : « mensuelle » (montant_mensuel_* versé chaque mois) ou
   * « annuelle » (montant_mensuel_* = montant versé à chaque échéance annuelle,
   * sans dégressivité — ex. assurance trottinette, 5 % chaque année).
   */
  periodicite?: Periodicite | null;
  /** Réduction commerciale des frais de courtage accordée au client (0 à 15 %). */
  reduction_courtage_pct?: number | null;
  /**
   * Décalage, en mois, entre le mois courant et le premier mois encore à
   * encaisser (contrat à effet futur, ou mois déjà encaissés à ne pas
   * recompter). 0 = versements dès le mois courant.
   */
  mois_debut_offset?: number | null;
}

/** Colonnes à lire pour tout calcul de prévisionnel. */
export const COLONNES_PREVISION =
  "id,dossier_id,contrat_id,branche,compagnie_id,montant_mensuel_estime,mois_restants_initial,date_estimation,montant_mensuel_reel,mois_restants_actuels,montant_previsionnel_total,statut,reduction_courtage_pct,periodicite";

/** Réduction de courtage bornée à l'intervalle autorisé (0-15 %). */
export function reductionValide(pct: number | null | undefined): number {
  const n = Number(pct ?? 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(15, n);
}

/**
 * Montant effectif d'une échéance de commission : réel si connu, sinon estimé,
 * réduction appliquée. L'unité est le mois pour une prévision mensuelle, l'année
 * pour une prévision annuelle.
 */
export function mensuelEffectif(p: CommissionPrevision): number | null {
  const brut = p.montant_mensuel_reel ?? p.montant_mensuel_estime;
  if (brut == null) return null;
  const net = Number(brut) * (1 - reductionValide(p.reduction_courtage_pct) / 100);
  return Math.round(net * 100) / 100;
}


/**
 * Montant d'une échéance de commission : règle du barème appliquée à la
 * cotisation d'une échéance. Pour une périodicité annuelle, on passe la
 * cotisation ANNUELLE : le taux s'y applique tel quel (pas de division ni de
 * multiplication par 12), chaque année, sans dégressivité.
 */
export function montantMensuelEstime(
  regle: RegleCommission,
  cotisationEcheance: number | null,
): number | null {
  if (regle.base_calcul === "economie_realisee") return null;
  if (regle.type === "fixe") return regle.montant_fixe;
  if (cotisationEcheance == null) return null;
  // Assiette = prime d'assurance pure de l'échéance, hors frais et taxes.
  return calculerCommission(
    { ...regle, base_calcul: "prime" },
    { prime: cotisationEcheance, primeMensuelle: cotisationEcheance },
  );
}

/**
 * Total prévisionnel : montant d'échéance × nombre d'échéances restantes.
 * En annuel, le nombre d'échéances est le nombre d'années entamées restantes.
 */
export function totalPrevisionnel(
  montantEcheance: number | null,
  moisRestants: number | null,
  periodicite: Periodicite = "mensuelle",
): number | null {
  if (montantEcheance == null || moisRestants == null) return null;
  const echeances = periodicite === "annuelle" ? Math.ceil(moisRestants / 12) : moisRestants;
  return Math.round(montantEcheance * echeances * 100) / 100;
}

/** Mois restants saisis dans le recueil des besoins (branche emprunteur). */
export function moisRestantsRecueil(
  branche: string | null,
  recueil: Record<string, unknown> | null | undefined,
): number | null {
  if (branche !== "emprunteur" || !recueil) return null;
  const v = recueil["mois_restants"];
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

export type LignePrevisionnelAnnee = { annee: number; montant: number };

/** Contrat actif minimal nécessaire pour estimer une commission récurrente. */
export interface ContratPourPrevision {
  id: string;
  dossier_id: string | null;
  compagnie_id: string | null;
  is_emprunteur: boolean | null;
  statut: string | null;
  date_effet: string | null;
  duree_mois: number | null;
  prime_annuelle: number | null;
  /** « mensuelle » / « annuelle » : cycle de paiement de la cotisation. */
  fractionnement?: string | null;
}

/** Commission déjà encaissée, utilisée pour déduire le rythme mensuel réel. */
export interface CommissionEncaissee {
  contrat_id: string | null;
  montant: number | null;
  date_versement: string | null;
  statut: string | null;
}

const STATUTS_CONTRAT_ACTIF = new Set(["actif", "contrat_actif"]);

function ecartMois(depuis: Date, vers: Date): number {
  return (vers.getFullYear() - depuis.getFullYear()) * 12 + (vers.getMonth() - depuis.getMonth());
}

function moisEcoules(dateEffet: string, aujourdhui: Date): number {
  const d = new Date(dateEffet);
  if (Number.isNaN(d.getTime())) return 0;
  return Math.max(0, ecartMois(d, aujourdhui));
}

/**
 * Prévisions déduites des contrats actifs qui n'ont pas encore de ligne dans
 * commission_previsions (contrats importés, ou validés avant la mise en place
 * du module). Le mensuel retenu est la moyenne des commissions réellement
 * encaissées sur le contrat ; à défaut, 5 % de la cotisation mensuelle.
 */
export function previsionsSynthetiques(
  contrats: ContratPourPrevision[],
  commissions: CommissionEncaissee[],
  previsionsExistantes: CommissionPrevision[],
  aujourdhui = new Date(),
): CommissionPrevision[] {
  const dejaCouverts = new Set(
    previsionsExistantes.map((p) => p.contrat_id).filter((id): id is string => Boolean(id)),
  );

  const parContrat = new Map<string, { total: number; mois: Set<string>; dernierMois: string | null }>();
  for (const c of commissions) {
    if (!c.contrat_id || c.statut !== "versee") continue;
    const cle = (c.date_versement ?? "").slice(0, 7);
    const agg = parContrat.get(c.contrat_id) ?? { total: 0, mois: new Set<string>(), dernierMois: null };
    agg.total += Number(c.montant ?? 0);
    if (cle) {
      agg.mois.add(cle);
      if (!agg.dernierMois || cle > agg.dernierMois) agg.dernierMois = cle;
    }
    parContrat.set(c.contrat_id, agg);
  }

  const out: CommissionPrevision[] = [];
  for (const ct of contrats) {
    if (dejaCouverts.has(ct.id)) continue;
    if (!STATUTS_CONTRAT_ACTIF.has(ct.statut ?? "")) continue;

    const hist = parContrat.get(ct.id);
    const periodicite = periodiciteDe(ct.fractionnement);
    const mensuel =
      hist && hist.mois.size > 0
        ? periodicite === "annuelle"
          ? hist.total / Math.max(1, new Set([...hist.mois].map((m) => m.slice(0, 4))).size)
          : hist.total / hist.mois.size
        : null;
    if (mensuel == null || mensuel <= 0) continue;

    const duree = ct.duree_mois != null ? Number(ct.duree_mois) : null;
    const restants =
      duree != null && ct.date_effet
        ? Math.max(0, duree - moisEcoules(ct.date_effet, aujourdhui))
        : duree;
    if (restants == null || restants <= 0) continue;

    // Premier mois encore à encaisser : jamais avant la date d'effet, jamais
    // un mois déjà réglé par la compagnie (sinon double comptage avec le CA).
    let offset = 0;
    if (ct.date_effet) {
      const eff = new Date(ct.date_effet);
      if (!Number.isNaN(eff.getTime())) offset = Math.max(0, ecartMois(aujourdhui, eff));
    }
    if (hist?.dernierMois) {
      const [an, mo] = hist.dernierMois.split("-").map(Number);
      const suivant = new Date(an, (mo ?? 1) - 1 + 1, 1);
      offset = Math.max(offset, ecartMois(aujourdhui, suivant));
    }
    offset = Math.max(0, offset);

    out.push({
      mois_debut_offset: offset,
      id: `synth-${ct.id}`,
      dossier_id: ct.dossier_id ?? "",
      contrat_id: ct.id,
      branche: ct.is_emprunteur ? "emprunteur" : null,
      compagnie_id: ct.compagnie_id,
      montant_mensuel_estime: Math.round(mensuel * 100) / 100,
      mois_restants_initial: restants,
      date_estimation: null,
      montant_mensuel_reel: null,
      mois_restants_actuels: restants,
      montant_previsionnel_total: totalPrevisionnel(mensuel, restants, periodicite),
      periodicite,
      statut: "estimee",
    });
  }
  return out;
}


/**
 * Répartition du prévisionnel sur les années à venir : chaque dossier verse son
 * montant mensuel (réel si connu, sinon estimé) jusqu'à épuisement de ses mois
 * restants, à compter du mois courant.
 */
export function repartirTresorerie(
  previsions: CommissionPrevision[],
  aujourdhui = new Date(),
): LignePrevisionnelAnnee[] {
  const parAnnee = new Map<number, number>();
  const anneeDebut = aujourdhui.getFullYear();
  const moisDebut = aujourdhui.getMonth(); // 0-11

  for (const p of previsions) {
    const mensuel = mensuelEffectif(p);
    const mois = p.mois_restants_actuels ?? p.mois_restants_initial;
    if (mensuel == null || mois == null || mois <= 0) continue;
    const offset = Math.max(0, Number(p.mois_debut_offset ?? 0));
    // Une commission annuelle n'est versée qu'une fois tous les 12 mois.
    const pas = pasEnMois(periodiciteDe(p.periodicite));
    for (let i = offset; i < offset + mois; i += pas) {
      const annee = anneeDebut + Math.floor((moisDebut + i) / 12);
      parAnnee.set(annee, (parAnnee.get(annee) ?? 0) + Number(mensuel));
    }
  }

  return [...parAnnee.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([annee, montant]) => ({ annee, montant: Math.round(montant * 100) / 100 }));
}


/** Synthèse comptable d'une année civile : encaissé, restant à encaisser, total attendu. */
export type SyntheseAnnee = {
  annee: number;
  encaisse: number;
  previsionnelRestant: number;
  totalAttendu: number;
};

/**
 * Source unique de vérité pour la valorisation du cabinet : le CA d'une année
 * est la somme des commissions réellement versées sur l'année, plus le
 * prévisionnel des mois de l'année qui restent à encaisser.
 */
export function syntheseAnnee(
  previsions: CommissionPrevision[],
  commissions: CommissionEncaissee[],
  annee = new Date().getFullYear(),
  aujourdhui = new Date(),
): SyntheseAnnee {
  const encaisse = commissions
    .filter((c) => c.statut === "versee" && (c.date_versement ?? "").slice(0, 4) === String(annee))
    .reduce((s, c) => s + Number(c.montant ?? 0), 0);
  const ligne = repartirTresorerie(previsions, aujourdhui).find((l) => l.annee === annee);
  const previsionnelRestant = ligne?.montant ?? 0;
  const r = (n: number) => Math.round(n * 100) / 100;
  return {
    annee,
    encaisse: r(encaisse),
    previsionnelRestant: r(previsionnelRestant),
    totalAttendu: r(encaisse + previsionnelRestant),
  };
}
