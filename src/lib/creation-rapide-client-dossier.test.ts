import { describe, expect, it, vi } from "vitest";
import {
  executerCreationRapide,
  composerNotesDossierRapide,
  type ClientCandidatCreationRapide,
  type EntreeCreationRapide,
} from "./creation-rapide-client-dossier";

const entree: EntreeCreationRapide = {
  client: {
    civilite: "Mme",
    prenom: "Jeanne",
    nom: "Dupont",
    date_naissance: "1988-04-12",
    email: "jeanne@example.fr",
    mobile: "0612345678",
    telephone: null,
    adresse: "1 rue des Lilas",
    code_postal: "75001",
    ville: "Paris",
  },
  dossier: {
    type_assurance: "sante",
    intitule: "Complémentaire santé",
    besoin: "Étude individuelle",
    commentaire_initial: "Rappeler vendredi",
  },
  confirmer_client_id: null,
};

const candidat: ClientCandidatCreationRapide = {
  client_id: "client-existant",
  nom: "Dupont",
  prenom: "Jeanne",
  email: "jeanne@example.fr",
  mobile: "0612345678",
  telephone: null,
  date_naissance: "1988-04-12",
  via: "email",
};

describe("executerCreationRapide", () => {
  it("crée un nouveau client et son dossier dans une seule écriture atomique", async () => {
    const creerAtomiquement = vi.fn().mockResolvedValue({
      status: "created",
      client_id: "nouveau-client",
      dossier_id: "nouveau-dossier",
      dossier_reference: "D-20261005-ABC123",
      client_created: true,
    });
    const apresCreationClient = vi.fn();

    const resultat = await executerCreationRapide(entree, {
      trouverCorrespondance: vi.fn().mockResolvedValue(null),
      creerAtomiquement,
      apresCreationClient,
    });

    expect(resultat.status).toBe("created");
    expect(creerAtomiquement).toHaveBeenCalledTimes(1);
    expect(creerAtomiquement).toHaveBeenCalledWith(entree, null);
    expect(apresCreationClient).toHaveBeenCalledTimes(1);
  });

  it("réutilise le client confirmé et ne relance pas les automatismes de nouvelle fiche", async () => {
    const entreeConfirmee = { ...entree, confirmer_client_id: candidat.client_id };
    const apresCreationClient = vi.fn();
    const creerAtomiquement = vi.fn().mockResolvedValue({
      status: "created",
      client_id: candidat.client_id,
      dossier_id: "nouveau-dossier",
      dossier_reference: "D-20261005-ABC123",
      client_created: false,
    });

    const resultat = await executerCreationRapide(entreeConfirmee, {
      trouverCorrespondance: vi.fn().mockResolvedValue(candidat),
      creerAtomiquement,
      apresCreationClient,
    });

    expect(resultat).toMatchObject({ status: "created", client_id: candidat.client_id });
    expect(creerAtomiquement).toHaveBeenCalledWith(entreeConfirmee, candidat.client_id);
    expect(apresCreationClient).not.toHaveBeenCalled();
  });

  it("demande confirmation pour une correspondance probable avant toute écriture", async () => {
    const creerAtomiquement = vi.fn();

    const resultat = await executerCreationRapide(entree, {
      trouverCorrespondance: vi.fn().mockResolvedValue(candidat),
      creerAtomiquement,
    });

    expect(resultat).toEqual({ status: "confirmation_required", candidate: candidat });
    expect(creerAtomiquement).not.toHaveBeenCalled();
  });

  it("ne laisse pas de client seul lorsque l'écriture atomique échoue", async () => {
    const apresCreationClient = vi.fn();
    const creerAtomiquement = vi.fn().mockRejectedValue(new Error("Écriture refusée"));

    await expect(
      executerCreationRapide(entree, {
        trouverCorrespondance: vi.fn().mockResolvedValue(null),
        creerAtomiquement,
        apresCreationClient,
      }),
    ).rejects.toThrow("Écriture refusée");
    expect(creerAtomiquement).toHaveBeenCalledTimes(1);
    expect(apresCreationClient).not.toHaveBeenCalled();
  });

  it("intercepte une correspondance apparue entre la recherche et l'écriture", async () => {
    const creerAtomiquement = vi
      .fn()
      .mockResolvedValue({ status: "duplicate_required", candidate: candidat });
    const apresCreationClient = vi.fn();

    const resultat = await executerCreationRapide(entree, {
      trouverCorrespondance: vi.fn().mockResolvedValue(null),
      creerAtomiquement,
      apresCreationClient,
    });

    expect(resultat).toEqual({ status: "confirmation_required", candidate: candidat });
    expect(apresCreationClient).not.toHaveBeenCalled();
  });

  it("refuse une confirmation périmée sans écrire", async () => {
    const entreePerimee = { ...entree, confirmer_client_id: "ancien-client" };
    const creerAtomiquement = vi.fn().mockResolvedValue({ status: "invalid_confirmation" });
    const trouverCorrespondance = vi.fn();

    const resultat = await executerCreationRapide(entreePerimee, {
      trouverCorrespondance,
      creerAtomiquement,
    });

    expect(resultat).toEqual({ status: "invalid_confirmation" });
    expect(trouverCorrespondance).not.toHaveBeenCalled();
    expect(creerAtomiquement).toHaveBeenCalledWith(entreePerimee, "ancien-client");
  });

  it("garde la réussite de la création si une synchronisation secondaire échoue", async () => {
    const journaliserErreurAutomatisation = vi.fn();
    const resultat = await executerCreationRapide(entree, {
      trouverCorrespondance: vi.fn().mockResolvedValue(null),
      creerAtomiquement: vi.fn().mockResolvedValue({
        status: "created",
        client_id: "nouveau-client",
        dossier_id: "nouveau-dossier",
        dossier_reference: "D-20261005-ABC123",
        client_created: true,
      }),
      apresCreationClient: vi.fn().mockRejectedValue(new Error("Brevo indisponible")),
      journaliserErreurAutomatisation,
    });

    expect(resultat.status).toBe("created");
    expect(journaliserErreurAutomatisation).toHaveBeenCalledWith(expect.any(Error));
  });
});

describe("composerNotesDossierRapide", () => {
  it("préserve l’intitulé, le besoin et le commentaire avec des libellés distincts", () => {
    expect(composerNotesDossierRapide(entree.dossier)).toBe(
      "Intitulé du dossier : Complémentaire santé\nObjet / besoin : Étude individuelle\nCommentaire initial : Rappeler vendredi",
    );
  });
});
