import { describe, expect, it } from "vitest";
import { comparatifCa, encaisseAnnee, encaisseMois, variationPct, cleMois } from "./cockpit-ca";

const coms = [
  { statut: "versee", date_versement: "2026-10-05", montant: 100 },
  { statut: "versee", date_versement: "2026-09-20", montant: 40 },
  { statut: "versee", date_versement: "2025-10-05", montant: 50 },
  { statut: "en_attente", date_versement: "2026-10-01", montant: 999 }, // ignoré (pas versée)
  { statut: "versee", date_versement: null, montant: 999 }, // ignoré (pas de date)
];

describe("cockpit CA — comparatif", () => {
  it("somme l'encaissé par année (versées uniquement)", () => {
    expect(encaisseAnnee(coms, 2026)).toBe(140);
    expect(encaisseAnnee(coms, 2025)).toBe(50);
  });

  it("somme l'encaissé par mois", () => {
    expect(encaisseMois(coms, "2026-10")).toBe(100);
    expect(encaisseMois(coms, "2026-09")).toBe(40);
  });

  it("calcule une variation en %, null si base nulle", () => {
    expect(variationPct(140, 50)).toBe(180);
    expect(variationPct(10, 0)).toBeNull();
  });

  it("décale les clés de mois correctement", () => {
    expect(cleMois(new Date("2026-01-15T00:00:00Z"), -1)).toBe("2025-12");
  });

  it("construit le comparatif complet", () => {
    const c = comparatifCa(coms, new Date("2026-10-15T00:00:00Z"));
    expect(c.annee).toBe(2026);
    expect(c.encaisseAnnee).toBe(140);
    expect(c.encaisseAnneePrecedente).toBe(50);
    expect(c.variationAnnuellePct).toBe(180);
    expect(c.moisCourant).toBe("2026-10");
    expect(c.encaisseMoisCourant).toBe(100);
    expect(c.moisPrecedent).toBe("2026-09");
    expect(c.encaisseMoisPrecedent).toBe(40);
    expect(c.variationMensuellePct).toBe(150);
  });
});
