import { describe, expect, it } from "vitest";
import {
  classerAnnee,
  suitPaliersFixes,
  anneesSecuriseesPour,
  paliersCaParAnnee,
  totauxPaliers,
  ANNEES_SECURISEES_FIXES,
  ANNEES_SECURISEES_RECONDUCTION_BASE,
  PONDERATION_PROBABILISE,
  type EcheanceCA,
} from "./ca-paliers";

function echeances(
  nbAnnees: number,
  montant: number,
  meta: {
    contratId?: string;
    familleCode?: string | null;
    estEmprunteur?: boolean;
    anneeDepart?: number;
  } = {},
): EcheanceCA[] {
  const anneeDepart = meta.anneeDepart ?? 2026;
  return Array.from({ length: nbAnnees }, (_, i) => ({
    contratId: meta.contratId ?? "c1",
    familleCode: meta.familleCode ?? null,
    estEmprunteur: meta.estEmprunteur ?? false,
    anneeContrat: i + 1,
    anneeCalendaire: anneeDepart + i,
    commissionCabinet: montant,
  }));
}

describe("CA paliers — règle Notion (vert 100 % / orange 70 %)", () => {
  it("constantes conformes au plan", () => {
    expect(ANNEES_SECURISEES_FIXES).toBe(8);
    expect(ANNEES_SECURISEES_RECONDUCTION_BASE).toBe(1);
    expect(PONDERATION_PROBABILISE).toBe(0.7);
  });

  it("suitPaliersFixes / anneesSecuriseesPour : 8 ans emprunteur+épargne, 1 an sinon", () => {
    expect(suitPaliersFixes({ familleCode: "emprunteur", estEmprunteur: true })).toBe(true);
    expect(suitPaliersFixes({ familleCode: "epargne", estEmprunteur: false })).toBe(true);
    expect(suitPaliersFixes({ familleCode: "sante", estEmprunteur: false })).toBe(false);
    expect(anneesSecuriseesPour({ familleCode: "emprunteur", estEmprunteur: true })).toBe(8);
    expect(anneesSecuriseesPour({ familleCode: "epargne", estEmprunteur: false })).toBe(8);
    expect(anneesSecuriseesPour({ familleCode: "sante", estEmprunteur: false })).toBe(1);
    expect(anneesSecuriseesPour({ familleCode: null, estEmprunteur: false })).toBe(1);
  });

  it("classerAnnee respecte le seuil", () => {
    expect(classerAnnee(8, 8)).toBe("securise");
    expect(classerAnnee(9, 8)).toBe("probabilise");
    expect(classerAnnee(1, 1)).toBe("securise");
    expect(classerAnnee(2, 1)).toBe("probabilise");
  });

  it("emprunteur : 8 ans vert, reste orange ×0,7, axe jusqu'à la dernière échéance", () => {
    const { lignes, contratsReconductionBase } = paliersCaParAnnee(
      echeances(10, 100, { estEmprunteur: true, familleCode: "emprunteur" }),
    );
    expect(contratsReconductionBase).toEqual([]);
    expect(lignes).toHaveLength(10);
    expect(lignes[7]).toEqual({ annee: 2033, securise: 100, probabilise: 0, total: 100 }); // année 8
    expect(lignes[8]).toEqual({ annee: 2034, securise: 0, probabilise: 70, total: 70 }); // année 9
  });

  it("assurance-vie (épargne) : même règle 8 ans", () => {
    const { lignes } = paliersCaParAnnee(
      echeances(9, 100, { familleCode: "epargne", contratId: "av1" }),
    );
    expect(lignes[7]).toEqual({ annee: 2033, securise: 100, probabilise: 0, total: 100 });
    expect(lignes[8]).toEqual({ annee: 2034, securise: 0, probabilise: 70, total: 70 });
  });

  it("tacite reconduction (santé) : base 1 an vert, reste orange, et contrat listé", () => {
    const { lignes, contratsReconductionBase } = paliersCaParAnnee(
      echeances(3, 100, { familleCode: "sante", contratId: "sante1" }),
    );
    expect(contratsReconductionBase).toEqual(["sante1"]);
    expect(lignes[0]).toEqual({ annee: 2026, securise: 100, probabilise: 0, total: 100 }); // année 1 vert
    expect(lignes[1]).toEqual({ annee: 2027, securise: 0, probabilise: 70, total: 70 }); // année 2 orange
    expect(lignes[2]).toEqual({ annee: 2028, securise: 0, probabilise: 70, total: 70 });
  });

  it("ignore les échéances sans montant et agrège plusieurs contrats sur la même année", () => {
    const e: EcheanceCA[] = [
      {
        contratId: "a",
        familleCode: "emprunteur",
        estEmprunteur: true,
        anneeContrat: 1,
        anneeCalendaire: 2026,
        commissionCabinet: 100,
      },
      {
        contratId: "b",
        familleCode: "emprunteur",
        estEmprunteur: true,
        anneeContrat: 9,
        anneeCalendaire: 2026,
        commissionCabinet: 200,
      },
      {
        contratId: "c",
        familleCode: "emprunteur",
        estEmprunteur: true,
        anneeContrat: 2,
        anneeCalendaire: 2026,
        commissionCabinet: null,
      },
    ];
    const { lignes } = paliersCaParAnnee(e);
    expect(lignes).toEqual([{ annee: 2026, securise: 100, probabilise: 140, total: 240 }]);
  });

  it("totaux tous millésimes", () => {
    const { lignes } = paliersCaParAnnee(echeances(10, 100, { estEmprunteur: true }));
    expect(totauxPaliers(lignes)).toEqual({ securise: 800, probabilise: 140, total: 940 });
  });
});
