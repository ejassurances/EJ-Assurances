export type ClientCandidatCreationRapide = {
  client_id: string;
  nom: string;
  prenom: string | null;
  email: string | null;
  mobile: string | null;
  telephone: string | null;
  date_naissance: string | null;
  via: string;
};

export type EntreeCreationRapide = {
  client: {
    civilite: string | null;
    prenom: string | null;
    nom: string;
    date_naissance: string | null;
    email: string | null;
    mobile: string | null;
    telephone: string | null;
    adresse: string | null;
    code_postal: string | null;
    ville: string | null;
  };
  dossier: {
    type_assurance: string;
    intitule: string;
    besoin: string | null;
    commentaire_initial: string | null;
  };
  confirmer_client_id: string | null;
};

export type ResultatEcritureAtomique =
  | {
      status: "created";
      client_id: string;
      dossier_id: string;
      dossier_reference: string;
      client_created: boolean;
    }
  | { status: "duplicate_required"; candidate: ClientCandidatCreationRapide }
  | { status: "invalid_confirmation" };

export type ResultatCreationRapide =
  | {
      status: "created";
      client_id: string;
      dossier_id: string;
      dossier_reference: string;
      client_created: boolean;
    }
  | { status: "confirmation_required"; candidate: ClientCandidatCreationRapide }
  | { status: "invalid_confirmation" };

export type DependancesCreationRapide = {
  trouverCorrespondance(
    client: EntreeCreationRapide["client"],
  ): Promise<ClientCandidatCreationRapide | null>;
  creerAtomiquement(
    entree: EntreeCreationRapide,
    clientConfirmeId: string | null,
  ): Promise<ResultatEcritureAtomique>;
  apresCreationClient?(
    resultat: Extract<ResultatEcritureAtomique, { status: "created" }>,
  ): Promise<void>;
  journaliserErreurAutomatisation?(erreur: unknown): void;
};

/** Regroupe les champs libres dans la colonne notes existante, sans détourner les catégories projet. */
export function composerNotesDossierRapide(dossier: EntreeCreationRapide["dossier"]): string {
  return [
    `Intitulé du dossier : ${dossier.intitule}`,
    dossier.besoin ? `Objet / besoin : ${dossier.besoin}` : null,
    dossier.commentaire_initial ? `Commentaire initial : ${dossier.commentaire_initial}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Orchestration testable de la création rapide. Toute écriture métier est
 * déléguée à une seule opération atomique fournie par le serveur.
 */
export async function executerCreationRapide(
  entree: EntreeCreationRapide,
  dependances: DependancesCreationRapide,
): Promise<ResultatCreationRapide> {
  // Après confirmation, l'opération SQL revalide elle-même l'identité avec la
  // normalisation exacte de la base (notamment pour les téléphones formatés).
  const candidat = entree.confirmer_client_id
    ? null
    : await dependances.trouverCorrespondance(entree.client);
  if (candidat) {
    return { status: "confirmation_required", candidate: candidat };
  }

  const resultat = await dependances.creerAtomiquement(entree, entree.confirmer_client_id ?? null);
  if (resultat.status === "duplicate_required") {
    return { status: "confirmation_required", candidate: resultat.candidate };
  }
  if (resultat.status === "invalid_confirmation") return resultat;

  if (resultat.client_created && dependances.apresCreationClient) {
    try {
      await dependances.apresCreationClient(resultat);
    } catch (erreur) {
      dependances.journaliserErreurAutomatisation?.(erreur);
    }
  }

  return resultat;
}
