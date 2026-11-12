import { describe, expect, it } from "vitest";
import { classerTop3, courtageOffertActif } from "./classement-top3";

const offres = [
  { id: "a", primesTotales: 9000, fraisDossier: 50 },
  { id: "b", primesTotales: 8000, fraisDossier: 300 },
  { id: "c", primesTotales: null },
  { id: "d", primesTotales: 8100, fraisDossier: 0 },
  { id: "e", primesTotales: 12000, fraisDossier: 0 },
];

describe("classerTop3", () => {
  it("refuse tout prix sans assurance actuelle", () => {
    const r = classerTop3({ coutAssuranceActuelle: null, nbAssures: 1, offres, courtageOffert: true });
    expect(r.statut).toBe("sans_reference");
    expect(r.offres).toHaveLength(0);
  });

  it("classe sur le coût total, sans prix en fin, TOP 3 marqué (courtage offert)", () => {
    const r = classerTop3({ coutAssuranceActuelle: 20000, nbAssures: 1, offres, courtageOffert: true });
    expect(r.statut).toBe("ok");
    expect(r.offres.map((o) => o.id)).toEqual(["d", "b", "a", "e", "c"]);
    expect(r.offres.filter((o) => o.top3).map((o) => o.id)).toEqual(["d", "b", "a"]);
    expect(r.offres[1]?.coutTotal).toBe(8300);
    expect(r.offres[4]?.rang).toBeNull();
  });

  it("ajoute les frais de distribution hors offre et signale les frais de dossier manquants", () => {
    const r = classerTop3({
      coutAssuranceActuelle: 20000,
      nbAssures: 1,
      offres: [{ id: "x", primesTotales: 10000 }],
      courtageOffert: false,
    });
    const o = r.offres[0]!;
    // économie brute 10 000 → 5 % = 500 > plancher 175
    expect(o.fraisDistribution).toBe(500);
    expect(o.coutTotal).toBe(10500);
    expect(o.economieNette).toBe(9500);
    expect(o.fraisDossierManquants).toBe(true);
  });

  it("offre de courtage offert active jusqu'au 31/12/2026 inclus", () => {
    expect(courtageOffertActif(new Date("2026-12-31T12:00:00Z"))).toBe(true);
    expect(courtageOffertActif(new Date("2027-01-01T12:00:00Z"))).toBe(false);
  });
});
