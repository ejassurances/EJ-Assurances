import { describe, expect, it } from "vitest";
import { commissionDepuisDevis, tauxDefautDevis, tauxEnFraction } from "./commission-devis";
import type { RegleCommission } from "./commissions-bareme";

const regleCompagnie: RegleCommission = {
  id: "r1",
  niveau: "compagnie",
  branche: "emprunteur",
  compagnie_id: "c1",
  type: "pourcentage",
  montant_fixe: null,
  taux_pourcentage: 8,
  base_calcul: "prime",
  notes: null,
};

describe("taux par défaut d'un devis", () => {
  it("retient la règle compagnie avant la règle branche", () => {
    const branche: RegleCommission = {
      ...regleCompagnie,
      id: "r2",
      niveau: "branche",
      compagnie_id: null,
      taux_pourcentage: 6,
    };
    expect(tauxDefautDevis([branche, regleCompagnie], "emprunteur", "c1")).toMatchObject({
      taux: 8,
      base: "prime",
      source: "compagnie",
    });
  });

  it("sans barème emprunteur : aucun taux supposé", () => {
    expect(tauxDefautDevis([], "emprunteur", null)).toMatchObject({
      taux: null,
      base: "prime",
      source: "defaut",
    });
  });

  it("sans barème hors emprunteur : aucun taux supposé", () => {
    expect(tauxDefautDevis([], "sante", null)).toMatchObject({
      taux: null,
      base: "prime",
      source: "defaut",
    });
  });
});

describe("commission prévisionnelle depuis le devis", () => {
  it("refuse les économies comme commission compagnie", () => {
    const r = commissionDepuisDevis(
      { taux: 5, base: "economie_realisee" },
      { economie: 4000, quotitePct: 75, totalQuotites: 100 },
    );
    expect(r).toEqual({ mensuel: null, mois: null, total: null });
  });

  it("applique le taux à chaque cotisation sur les mois restants", () => {
    const r = commissionDepuisDevis(
      { taux: 10, base: "prime" },
      { cotisationMensuelle: 30, moisRestants: 24 },
    );
    expect(r).toEqual({ mensuel: 3, mois: 24, total: 72 });
  });

  it("ne devine rien sans assiette", () => {
    expect(commissionDepuisDevis({ taux: 5, base: "prime" }, {}).total).toBeNull();
  });

  it("convertit le pourcentage en fraction pour la fiche contrat", () => {
    expect(tauxEnFraction(5)).toBe(0.05);
    expect(tauxEnFraction(null)).toBeNull();
  });
});
