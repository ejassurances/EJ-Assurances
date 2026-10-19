import { LABEL_ALERTE, LABEL_ARCHIVE_TRAITEE, LABEL_BROUILLON } from "@/lib/gmail-inbox";

/**
 * Étiquettes métier du cabinet — structure simplifiée, entièrement À PLAT.
 *
 * 3 libellés de DIRECTION :
 *  - « Direction Commerciale »
 *  - « Direction Financiere »
 *  - « Direction Juridique et Conformite »
 *
 * 3 états officiels, partagés par les trois directions :
 *  - « ⚠️ 02_Alerte_Humain_A_Traiter »
 *  - « 📦 03_Archives_Traitees »
 *  - « 📥 01_Brouillon_IA_A_Relire »
 */
const DIRECTION_COMMERCIALE = "Direction Commerciale";
const DIRECTION_FINANCIERE = "Direction Financiere";
const DIRECTION_CONFORMITE = "Direction Juridique et Conformite";

// Noms de variables historiques conservés pour compatibilité avec le code appelant.
const ARCHIVE = LABEL_ARCHIVE_TRAITEE;
const A_VALIDER = LABEL_ALERTE;

/** Les trois états officiels. */
export const LABELS_ETATS = [LABEL_BROUILLON, LABEL_ALERTE, LABEL_ARCHIVE_TRAITEE] as const;

type Couple = { direction: string | null; etat: string | null };

const commercial = (etat: string | null): Couple => ({ direction: DIRECTION_COMMERCIALE, etat });
const financier = (etat: string | null): Couple => ({ direction: DIRECTION_FINANCIERE, etat });
const conforme = (etat: string | null): Couple => ({ direction: DIRECTION_CONFORMITE, etat });

export const COUPLES_LABELS = {
  gc_a_traiter: commercial(null),
  sc_a_traiter: commercial(null),
  sp_a_traiter: commercial(null),
  gc_attente_validation: commercial(A_VALIDER),
  sc_attente_validation: commercial(A_VALIDER),
  sp_attente_validation: commercial(A_VALIDER),
  gc_archive: commercial(ARCHIVE),
  sc_archive: commercial(ARCHIVE),
  sp_archive: commercial(ARCHIVE),
  achat_a_traiter: financier(null),
  achat_archive: financier(ARCHIVE),
  commission_a_traiter: financier(null),
  commission_archive: financier(ARCHIVE),
  rec_a_traiter: conforme(null),
  rec_attente_validation: conforme(A_VALIDER),
  rec_archive: conforme(ARCHIVE),
  veille_a_traiter: conforme(null),
  veille_archive: conforme(ARCHIVE),
  veille_non_impactee: conforme(ARCHIVE),
  a_ignorer: { direction: null, etat: ARCHIVE },
} as const satisfies Record<string, Couple>;

export type LabelCabinet = keyof typeof COUPLES_LABELS;

export const LABELS_CABINET = Object.fromEntries(
  Object.entries(COUPLES_LABELS).map(([cle, c]) => [cle, c.etat ?? c.direction ?? ARCHIVE]),
) as Record<LabelCabinet, string>;

export const LABELS_DIRECTIONS = [
  DIRECTION_COMMERCIALE,
  DIRECTION_FINANCIERE,
  DIRECTION_CONFORMITE,
] as const;

export { DIRECTION_COMMERCIALE, DIRECTION_FINANCIERE, DIRECTION_CONFORMITE, ARCHIVE, A_VALIDER };

/** Seuls les 3 directions et les 3 états officiels peuvent être créés. */
export const LABELS_CREABLES: readonly string[] = [
  DIRECTION_COMMERCIALE,
  DIRECTION_FINANCIERE,
  DIRECTION_CONFORMITE,
  ...LABELS_ETATS,
];
