/**
 * Pipeline projet (Lot 3) — étapes ordonnées d'un dossier, de la création
 * jusqu'au contrat actif. Chaque étape porte son libellé client, sa
 * description back-office et le responsable de l'action.
 */

export type EtapeKey =
  | "nouveau"
  | "en_cours"
  | "lettre_mission_envoyee"
  | "dda_validee"
  | "devis_en_cours"
  | "devoir_conseil_envoye"
  | "devoir_conseil_signe"
  | "devoir_conseil_refuse"
  | "souscription_envoyee"
  | "contrat_valide"
  | "contrat_actif"
  | "cloture"
  | "signe"
  | "perdu";

export type EtapeDef = {
  key: EtapeKey;
  label: string;
  description: string;
  responsable: "client" | "cabinet" | "compagnie";
  /** Étape hors du chemin nominal (refus, perte, clôture). */
  horsParcours?: boolean;
};

export const ETAPES: EtapeDef[] = [
  {
    key: "nouveau",
    label: "Dossier créé",
    description: "Le dossier est ouvert, le recueil des besoins reste à réaliser.",
    responsable: "cabinet",
  },
  {
    key: "en_cours",
    label: "Recueil des besoins",
    description: "Recueil des besoins en cours de collecte auprès du client.",
    responsable: "cabinet",
  },
  {
    key: "lettre_mission_envoyee",
    label: "Lettre de mission envoyée",
    description: "En attente de la signature électronique du client.",
    responsable: "client",
  },
  {
    key: "dda_validee",
    label: "DDA validée",
    description: "Lettre de mission signée : le cabinet peut engager la recherche.",
    responsable: "cabinet",
  },
  {
    key: "devis_en_cours",
    label: "Étude & devis",
    description: "Comparaison des offres et construction de la recommandation.",
    responsable: "cabinet",
  },
  {
    key: "devoir_conseil_envoye",
    label: "Devoir de conseil envoyé",
    description: "Le client doit accepter ou refuser la recommandation.",
    responsable: "client",
  },
  {
    key: "devoir_conseil_signe",
    label: "Devoir de conseil signé",
    description: "Recommandation acceptée : passage à la souscription.",
    responsable: "cabinet",
  },
  {
    key: "souscription_envoyee",
    label: "Souscription transmise",
    description: "Dossier transmis à la compagnie pour instruction.",
    responsable: "compagnie",
  },
  {
    key: "contrat_valide",
    label: "Contrat validé",
    description: "Accord de la compagnie, en attente de prise d'effet.",
    responsable: "compagnie",
  },
  {
    key: "contrat_actif",
    label: "Contrat actif",
    description: "Le contrat est en vigueur, le projet est finalisé.",
    responsable: "cabinet",
  },
];

export const ETAPES_HORS_PARCOURS: EtapeDef[] = [
  {
    key: "devoir_conseil_refuse",
    label: "Devoir de conseil refusé",
    description: "Le client a refusé la recommandation : motif tracé pour l'ACPR.",
    responsable: "client",
    horsParcours: true,
  },
  {
    key: "cloture",
    label: "Projet clôturé",
    description: "Projet archivé, sans suite.",
    responsable: "cabinet",
    horsParcours: true,
  },
  {
    key: "perdu",
    label: "Projet perdu",
    description: "Le client n'a pas donné suite.",
    responsable: "cabinet",
    horsParcours: true,
  },
  {
    key: "signe",
    label: "Signé (historique)",
    description: "Ancien statut conservé pour les dossiers antérieurs.",
    responsable: "cabinet",
    horsParcours: true,
  },
];

const TOUTES = [...ETAPES, ...ETAPES_HORS_PARCOURS];

/** Garde de type : la valeur est-elle une clé d'étape connue ? */
export function estEtapeValide(v: string): v is EtapeKey {
  return TOUTES.some((e) => e.key === v);
}

export function etapeDef(key: string): EtapeDef | undefined {
  return TOUTES.find((e) => e.key === key);
}

export function etapeLabel(key: string): string {
  return etapeDef(key)?.label ?? key;
}

/** Index de l'étape sur le chemin nominal (-1 si hors parcours). */
export function etapeIndex(key: string): number {
  return ETAPES.findIndex((e) => e.key === key);
}

/** Étape suivante suggérée sur le chemin nominal. */
export function etapeSuivante(key: string): EtapeDef | null {
  const i = etapeIndex(key);
  if (i < 0 || i >= ETAPES.length - 1) return null;
  return ETAPES[i + 1] ?? null;
}

export function estFinalisee(key: string): boolean {
  return key === "contrat_actif" || key === "cloture" || key === "perdu";
}


/**
 * Lot B — pipeline cible. Le champ dossiers.statut reste temporairement
 * compatible avec l'historique ; dossiers.pipeline_etape porte désormais
 * l'étape métier cible et dossiers.blocage_* porte l'état de blocage séparé.
 */
export type PipelineEtapeCible =
  | "nouveau"
  | "qualification"
  | "pieces_en_cours"
  | "conformite_a_verifier"
  | "lettre_mission"
  | "recherche_devis"
  | "analyse_recommandation"
  | "fic_a_valider"
  | "fic_envoye"
  | "souscription_a_lancer"
  | "suivi_compagnie"
  | "contrat_actif"
  | "post_vente"
  | "termine_archive";

export type PipelineEtapeCibleDef = {
  key: PipelineEtapeCible;
  label: string;
  responsable: "agent" | "humain" | "client" | "compagnie";
};

export const PIPELINE_CIBLE: PipelineEtapeCibleDef[] = [
  { key: "nouveau", label: "Nouveau / à qualifier", responsable: "agent" },
  { key: "qualification", label: "Qualification", responsable: "agent" },
  { key: "pieces_en_cours", label: "Pièces / recueil en cours", responsable: "agent" },
  { key: "conformite_a_verifier", label: "Conformité à vérifier", responsable: "humain" },
  { key: "lettre_mission", label: "Lettre de mission", responsable: "client" },
  { key: "recherche_devis", label: "Recherche / demandes de devis", responsable: "agent" },
  { key: "analyse_recommandation", label: "Analyse / recommandation", responsable: "humain" },
  { key: "fic_a_valider", label: "FIC à valider humainement", responsable: "humain" },
  { key: "fic_envoye", label: "FIC envoyé / signature en attente", responsable: "client" },
  { key: "souscription_a_lancer", label: "Souscription à lancer", responsable: "humain" },
  { key: "suivi_compagnie", label: "Suivi compagnie", responsable: "compagnie" },
  { key: "contrat_actif", label: "Contrat validé / actif", responsable: "compagnie" },
  { key: "post_vente", label: "Post-vente / suivi", responsable: "agent" },
  { key: "termine_archive", label: "Terminé / archivé", responsable: "agent" },
];

export type BlocageDossier = {
  actif: boolean;
  code?: string | null;
  motif?: string | null;
  elementAttendu?: string | null;
  responsable?: string | null;
  depuis?: string | null;
};
