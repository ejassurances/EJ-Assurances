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
