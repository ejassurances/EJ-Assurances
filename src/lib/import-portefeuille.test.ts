import { describe, expect, it } from "vitest";
import { cheminPieceImport, nomFichierStockage, normaliserChampsAttestation } from "./import-portefeuille";

describe("import portefeuille", () => {
  it("retire accents et espaces du nom de fichier (cause du « Invalid key »)", () => {
    expect(nomFichierStockage("Certificat adhesion santé - Lisa LOUIS.pdf")).toBe(
      "Certificat_adhesion_sante_-_Lisa_LOUIS.pdf",
    );
  });

  it("place l'identifiant du dossier en premier segment du chemin", () => {
    expect(cheminPieceImport("d1", "cni", "Carte é.pdf", 42)).toBe("d1/import-portefeuille/cni-42-Carte_e.pdf");
  });

  it("n'invente pas de date mal formée", () => {
    const c = normaliserChampsAttestation({ nom: "HAMMI", date_effet: "11/01/2026", cotisation_mensuelle: "25,25" });
    expect(c.date_effet).toBeNull();
    expect(c.cotisation_mensuelle).toBe(25.25);
    expect(c.prenom).toBeNull();
  });
});
