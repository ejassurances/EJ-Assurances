/**
 * Lot 7 — Gouvernance de l'Agent IA (module PUR, sans réseau ni écriture).
 *
 * Traduit une PERMISSION PAR ACTION (donnée de gouvernance remplie par le
 * cabinet dans `agent_permissions`) en décision d'exécution, selon les quatre
 * niveaux arrêtés dans le plan Notion (Lot 7) :
 *
 *  - autonome            → exécution automatique possible, AVEC journalisation ;
 *  - validation_humaine  → l'Agent PRÉPARE, une tâche humaine valide ensuite ;
 *  - execution_humaine   → l'action doit être FAITE par un humain (l'Agent ne
 *                          l'exécute jamais, il prépare/escalade la tâche) ;
 *  - escalade            → cas non couvert / règle à créer : BLOCAGE + demande
 *                          explicite à Erwan.
 *
 * Règle de sûreté : une action inconnue, inactive, ou dont la permission est
 * absente est traitée comme `escalade`. L'Agent ne transforme jamais une
 * habitude observée en règle métier ; en cas de doute, il escalade.
 *
 * Ce module n'invente aucune règle métier : la classification par action reste
 * une donnée (table `agent_permissions`), pas du code.
 */

export const NIVEAUX_PERMISSION = [
  "autonome",
  "validation_humaine",
  "execution_humaine",
  "escalade",
] as const;

export type NiveauPermission = (typeof NIVEAUX_PERMISSION)[number];

/** Défaut conservateur appliqué à toute action non explicitement autorisée. */
export const NIVEAU_PAR_DEFAUT: NiveauPermission = "escalade";

export type PermissionAction = {
  action_type: string;
  niveau: NiveauPermission | string;
  actif: boolean;
};

export type DecisionGouvernance = {
  niveau: NiveauPermission;
  /** L'Agent peut-il exécuter l'action lui-même, automatiquement ? */
  peutExecuterAuto: boolean;
  /** L'Agent prépare mais une validation humaine est requise avant effet. */
  exigeValidationHumaine: boolean;
  /** L'action elle-même doit être réalisée par un humain (jamais par l'Agent). */
  exigeExecutionHumaine: boolean;
  /** Cas non couvert / sensible non autorisé : bloquer et escalader à Erwan. */
  doitEscalader: boolean;
  motif: string;
};

function estNiveau(v: unknown): v is NiveauPermission {
  return typeof v === "string" && (NIVEAUX_PERMISSION as readonly string[]).includes(v);
}

/**
 * Niveau effectif d'une permission chargée depuis la base. Une permission
 * absente, inactive ou de niveau inconnu retombe sur le défaut (`escalade`).
 */
export function niveauEffectif(perm: PermissionAction | null | undefined): NiveauPermission {
  if (!perm || perm.actif === false) return NIVEAU_PAR_DEFAUT;
  return estNiveau(perm.niveau) ? perm.niveau : NIVEAU_PAR_DEFAUT;
}

/**
 * Traduit un niveau de permission en décision d'exécution.
 * `actionSensible` force l'escalade quelle que soit la permission : une action
 * marquée sensible n'est jamais exécutée automatiquement (sécurité d'abord).
 */
export function deciderExecution(
  niveau: NiveauPermission,
  opts: { actionSensible?: boolean } = {},
): DecisionGouvernance {
  if (opts.actionSensible && niveau !== "escalade") {
    return {
      niveau,
      peutExecuterAuto: false,
      exigeValidationHumaine: niveau === "validation_humaine",
      exigeExecutionHumaine: niveau === "execution_humaine",
      doitEscalader: niveau !== "validation_humaine" && niveau !== "execution_humaine",
      motif: "Action marquée sensible — exécution automatique interdite",
    };
  }

  switch (niveau) {
    case "autonome":
      return {
        niveau,
        peutExecuterAuto: true,
        exigeValidationHumaine: false,
        exigeExecutionHumaine: false,
        doitEscalader: false,
        motif: "Action autorisée en autonomie — exécuter avec journalisation",
      };
    case "validation_humaine":
      return {
        niveau,
        peutExecuterAuto: false,
        exigeValidationHumaine: true,
        exigeExecutionHumaine: false,
        doitEscalader: false,
        motif: "Préparation par l'Agent, validation humaine obligatoire avant effet",
      };
    case "execution_humaine":
      return {
        niveau,
        peutExecuterAuto: false,
        exigeValidationHumaine: false,
        exigeExecutionHumaine: true,
        doitEscalader: false,
        motif: "Action réservée à un humain — l'Agent ne l'exécute pas",
      };
    case "escalade":
    default:
      return {
        niveau: "escalade",
        peutExecuterAuto: false,
        exigeValidationHumaine: false,
        exigeExecutionHumaine: false,
        doitEscalader: true,
        motif: "Cas non couvert ou non autorisé — blocage et escalade à Erwan",
      };
  }
}

/** Raccourci : décision à partir d'une permission brute (base) + sensibilité. */
export function evaluerPermission(
  perm: PermissionAction | null | undefined,
  opts: { actionSensible?: boolean } = {},
): DecisionGouvernance {
  return deciderExecution(niveauEffectif(perm), opts);
}
