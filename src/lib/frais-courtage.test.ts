import { describe, expect, it } from "vitest";
import { calculerFraisCourtage } from "./frais-courtage";

/** Total payé par le client : frais de distribution + frais de dossier de la compagnie. */
const totalClient = (economie: number, nbAssures: number, fraisDossier: number) => {
  const r = calculerFraisCourtage({
    economieBrute: economie,
    nbAssures,
    fraisDossierPartenaire: fraisDossier,
  });
  return r ? r.montant + fraisDossier : null;
};

describe("calculerFraisCourtage — règle du 07/11/2026", () => {
  it("applique le plancher et ajoute les frais de dossier (économie 2 000 €)", () => {
    const r = calculerFraisCourtage({
      economieBrute: 2000,
      nbAssures: 1,
      fraisDossierPartenaire: 50,
    });
    expect(r?.base).toBe(100);
    expect(r?.montant).toBe(175);
    expect(totalClient(2000, 1, 50)).toBe(225);
  });

  it("inclut les frais de dossier au-dessus du plancher (économie 6 000 €)", () => {
    const r = calculerFraisCourtage({
      economieBrute: 6000,
      nbAssures: 1,
      fraisDossierPartenaire: 50,
    });
    expect(r?.base).toBe(300);
    expect(r?.montant).toBe(250);
    expect(r?.partPartenaireDeduite).toBe(50);
    expect(totalClient(6000, 1, 50)).toBe(300);
  });

  it("ne descend jamais sous le plancher dans la zone intermédiaire (base 200 €)", () => {
    const r = calculerFraisCourtage({
      economieBrute: 4000,
      nbAssures: 1,
      fraisDossierPartenaire: 50,
    });
    expect(r?.montant).toBe(175);
    expect(r?.partPartenaireDeduite).toBe(25);
    expect(totalClient(4000, 1, 50)).toBe(225);
  });

  it("compte le plancher par personne assurée", () => {
    const r = calculerFraisCourtage({
      economieBrute: 5000,
      nbAssures: 2,
      fraisDossierPartenaire: 0,
    });
    expect(r?.plancher).toBe(350);
    expect(r?.montant).toBe(350);
  });

  it("ne calcule rien sans économie ni assuré", () => {
    expect(calculerFraisCourtage({ economieBrute: null, nbAssures: 1 })).toBeNull();
    expect(calculerFraisCourtage({ economieBrute: 1000, nbAssures: 0 })).toBeNull();
  });
});
