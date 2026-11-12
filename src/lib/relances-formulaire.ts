/**
 * Relances « documents non déposés » après le formulaire public (parcours du
 * 11/11/2026) — fonction PURE. Deux rappels seulement : J+2 puis J+5 après la
 * création du dossier ; arrêt dès que les documents de prêt sont déposés
 * (ou que le dossier quitte les étapes d'avant rendez-vous).
 */
const JOUR = 24 * 3600 * 1000;

export type RelanceFormulaire = "J+2" | "J+5";

export function relanceFormulaireDue(params: {
  creeLe: string;
  derniereRelanceLe: string | null;
  documentsPretDeposes: boolean;
  maintenant?: Date;
}): RelanceFormulaire | null {
  if (params.documentsPretDeposes) return null;
  const cree = new Date(params.creeLe).getTime();
  const now = (params.maintenant ?? new Date()).getTime();
  const j2 = cree + 2 * JOUR;
  const j5 = cree + 5 * JOUR;
  const derniere = params.derniereRelanceLe ? new Date(params.derniereRelanceLe).getTime() : null;

  if (now >= j5) {
    // J+5 seulement si aucune relance n'a encore été faite à partir de J+5.
    if (derniere == null || derniere < j5) return "J+5";
    return null;
  }
  if (now >= j2 && derniere == null) return "J+2";
  return null;
}

/** Codes de pièces qui arrêtent la relance : documents de prêt (ou simulation pour un acquéreur). */
export const CODES_DOCUMENTS_PRET = [
  "offre_pret",
  "tableau_amortissement",
  "simulation_pret",
] as const;
