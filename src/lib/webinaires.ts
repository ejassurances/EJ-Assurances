/**
 * Lot G — référentiel du funnel webinaire (acquisition).
 * Étapes de référence validées (Notion « CRM Assurance ») :
 *   inscription → présence → clic → formulaire → étude → FIC → signature → contrat → CA.
 * Miroir applicatif de public.webinaire_participants.etape_courante.
 */

export const FUNNEL_ETAPES = [
  "inscription",
  "presence",
  "clic",
  "formulaire_debut",
  "formulaire_fin",
  "etude",
  "fic",
  "signature",
  "contrat",
  "ca",
] as const;

export type FunnelEtape = (typeof FUNNEL_ETAPES)[number];

export const FUNNEL_ETAPE_LABEL: Record<FunnelEtape, string> = {
  inscription: "Inscription",
  presence: "Présence",
  clic: "Clic",
  formulaire_debut: "Formulaire commencé",
  formulaire_fin: "Formulaire terminé",
  etude: "Étude",
  fic: "FIC",
  signature: "Signature",
  contrat: "Contrat",
  ca: "CA",
};

export function funnelIndex(etape: string): number {
  return (FUNNEL_ETAPES as readonly string[]).indexOf(etape);
}

export function estFunnelEtape(v: string): v is FunnelEtape {
  return funnelIndex(v) >= 0;
}

/** Étape suivante du funnel, ou null si déjà au bout (CA). */
export function funnelEtapeSuivante(etape: FunnelEtape): FunnelEtape | null {
  const i = funnelIndex(etape);
  return i >= 0 && i < FUNNEL_ETAPES.length - 1 ? FUNNEL_ETAPES[i + 1] : null;
}

/** Progression (0 → 1) d'un participant dans le funnel. */
export function funnelProgression(etape: FunnelEtape): number {
  const i = funnelIndex(etape);
  return i < 0 ? 0 : i / (FUNNEL_ETAPES.length - 1);
}

/** Avancer uniquement : la cible est-elle strictement après l'étape actuelle ? */
export function peutAvancerVers(actuelle: FunnelEtape, cible: FunnelEtape): boolean {
  return funnelIndex(cible) > funnelIndex(actuelle);
}

/**
 * Compte cumulatif du funnel : pour chaque étape, le nombre de participants
 * l'ayant AU MOINS atteinte (un participant à « contrat » a franchi « clic »).
 * Entrée : les `etape_courante` des participants d'une session.
 */
export function compterFunnelCumulatif(etapes: string[]): Record<FunnelEtape, number> {
  const base = Object.fromEntries(FUNNEL_ETAPES.map((e) => [e, 0])) as Record<FunnelEtape, number>;
  for (const e of etapes) {
    const i = funnelIndex(e);
    if (i < 0) continue;
    for (let k = 0; k <= i; k++) base[FUNNEL_ETAPES[k]] += 1;
  }
  return base;
}

/** Taux de conversion (0 → 1) entre deux étapes du funnel, à partir du cumul. */
export function tauxConversion(cumul: Record<FunnelEtape, number>, de: FunnelEtape, vers: FunnelEtape): number {
  const base = cumul[de];
  return base > 0 ? cumul[vers] / base : 0;
}

/**
 * Étape d'une séquence de relance (CONFIGURÉE par webinaire, pas en dur) :
 * déclenchée quand le participant a atteint `declencheur`, envoyée `delaiHeures`
 * après, via le `template` ; annulée si le participant a atteint `arretSi`.
 * Le contenu réel des séquences vit dans webinaires.emails_config (donnée métier).
 */
export type SequenceStep = {
  cle: string;
  declencheur: FunnelEtape;
  delaiHeures: number;
  template: string;
  arretSi?: FunnelEtape;
};

/** Décide si un step de séquence doit être planifié pour `etapeCourante`. */
export function doitPlanifierStep(etapeCourante: string, step: SequenceStep): boolean {
  const iCur = funnelIndex(etapeCourante);
  const iTrig = funnelIndex(step.declencheur);
  if (iCur < 0 || iTrig < 0 || iCur < iTrig) return false; // déclencheur non atteint
  if (step.arretSi) {
    const iStop = funnelIndex(step.arretSi);
    if (iStop >= 0 && iCur >= iStop) return false; // objectif atteint → on n'envoie plus
  }
  return true;
}

/** Lit/valide la config séquences d'un webinaire (jsonb). Tolérant : [] si invalide. */
export function lireSequences(emailsConfig: unknown): SequenceStep[] {
  const raw = (emailsConfig as { sequences?: unknown })?.sequences;
  if (!Array.isArray(raw)) return [];
  const steps: SequenceStep[] = [];
  for (const s of raw) {
    if (
      s &&
      typeof s.cle === "string" &&
      estFunnelEtape(s.declencheur) &&
      typeof s.delaiHeures === "number" &&
      typeof s.template === "string" &&
      (s.arretSi === undefined || estFunnelEtape(s.arretSi))
    ) {
      steps.push({
        cle: s.cle,
        declencheur: s.declencheur,
        delaiHeures: s.delaiHeures,
        template: s.template,
        arretSi: s.arretSi,
      });
    }
  }
  return steps;
}
