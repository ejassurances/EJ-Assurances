import { describe, expect, it } from "vitest";
import {
  calculerCommissionPrevisionnelle,
  calculerFraisDistribution,
  choisirBareme,
  type BaremeCompagnie,
} from "./remuneration-contrat";

describe("frais de distribution", () => {
  it.each([
    [120, 4000, 200],
    [180, 7350, 367.5],
    [240, 12000, 600],
  ])("emprunteur %i mois : 5 %% de l'économie totale", (duree, eco, frais) => {
    const r = calculerFraisDistribution({ isEmprunteur: true, dureeMois: duree, economieRealisee: eco });
    expect(r.montant).toBe(frais);
  });
  it("emprunteur : utilise coût groupe − coût délégué si économie absente", () => {
    const r = calculerFraisDistribution({ isEmprunteur: true, dureeMois: 240, coutGroupeTotal: 20000, coutDelegueTotal: 8000 });
    expect(r.montant).toBe(600);
  });
  it("emprunteur : données incohérentes → à vérifier", () => {
    const r = calculerFraisDistribution({ isEmprunteur: true, dureeMois: 240, economieRealisee: 5000, coutGroupeTotal: 20000, coutDelegueTotal: 8000 });
    expect(r.statut).toBe("a_verifier");
    expect(r.montant).toBeNull();
  });
  it("emprunteur : économie absente → à vérifier", () => {
    expect(calculerFraisDistribution({ isEmprunteur: true, dureeMois: 180 }).statut).toBe("a_verifier");
  });
  it("emprunteur : durée absente → à vérifier", () => {
    expect(calculerFraisDistribution({ isEmprunteur: true, economieRealisee: 4000 }).statut).toBe("a_verifier");
  });
  it("contrat classique : 20 €", () => {
    expect(calculerFraisDistribution({ branche: "sante" }).montant).toBe(20);
  });
  it("assurance vie : 0 €", () => {
    expect(calculerFraisDistribution({ branche: "assurance_vie" }).montant).toBe(0);
  });
});

const base: BaremeCompagnie = {
  id: "b1", compagnie_id: "c1", branche: "sante", produit_id: null,
  mode: "lineaire", taux_annee_1: 10, taux_renouvellement: null, date_effet: "2026-01-01", date_fin: null,
};

describe("commission compagnie", () => {
  it("linéaire : même taux chaque année", () => {
    const r = calculerCommissionPrevisionnelle({ contratId: "k", bareme: base, primeAnnuelle: 1200, dureeMois: 36 });
    expect(r.lignes.map((l) => l.montant)).toEqual([120, 120, 120]);
  });
  it("précompte : année 1 distincte des renouvellements", () => {
    const r = calculerCommissionPrevisionnelle({
      contratId: "k", bareme: { ...base, mode: "precompte", taux_annee_1: 30, taux_renouvellement: 5 }, primeAnnuelle: 1000, dureeMois: 36,
    });
    expect(r.lignes.map((l) => l.montant)).toEqual([300, 50, 50]);
  });
  it("sans barème : non calculable", () => {
    const r = calculerCommissionPrevisionnelle({ contratId: "k", bareme: null, primeAnnuelle: 1000, dureeMois: 12 });
    expect(r.statut).toBe("non_calculable");
  });
  it("changement de durée : nombre d'années recalculé, dernière année au prorata", () => {
    const r = calculerCommissionPrevisionnelle({ contratId: "k", bareme: base, primeAnnuelle: 1200, dureeMois: 18 });
    expect(r.lignes.map((l) => l.montant)).toEqual([120, 60]);
  });
  it("changement de barème : la date d'effet du contrat choisit la bonne version", () => {
    const ancien = { ...base, id: "old", date_fin: "2026-06-30" };
    const nouveau = { ...base, id: "new", taux_annee_1: 12, date_effet: "2026-07-01" };
    expect(choisirBareme([ancien, nouveau], { compagnieId: "c1", branche: "sante", date: "2026-03-01" })?.id).toBe("old");
    expect(choisirBareme([ancien, nouveau], { compagnieId: "c1", branche: "sante", date: "2026-09-01" })?.id).toBe("new");
  });
  it("recalcul idempotent : mêmes clés, aucune ligne en double", () => {
    const a = calculerCommissionPrevisionnelle({ contratId: "k", bareme: base, primeAnnuelle: 1200, dureeMois: 36 });
    const b = calculerCommissionPrevisionnelle({ contratId: "k", bareme: base, primeAnnuelle: 1200, dureeMois: 36 });
    expect(b.lignes).toEqual(a.lignes);
    expect(new Set(a.lignes.map((l) => l.cle)).size).toBe(a.lignes.length);
  });
});

import { lignesAPersister } from "@/lib/remuneration-previsionnelle";

describe("lignesAPersister (prévisionnel enregistré)", () => {
  const bareme = {
    id: "b1", compagnie_id: "c1", branche: "prevoyance", mode: "precompte" as const,
    taux_annee_1: 40, taux_renouvellement: 10, date_effet: "2026-01-01", date_fin: null,
  };
  it("frais et commission restent sur des lignes séparées, clés stables", () => {
    const com = calculerCommissionPrevisionnelle({ contratId: "k", bareme, primeAnnuelle: 1200, dureeMois: 24 });
    const frais = calculerFraisDistribution({ branche: "prevoyance" });
    const rows = lignesAPersister("k", frais, com, bareme);
    expect(rows.map((r) => r.cle)).toEqual(["k:frais_distribution:1", "k:commission:1", "k:commission:2"]);
    expect(rows[0].montant).toBe(20);
    expect(rows[1].montant).toBe(480);
    expect(rows[2].montant).toBe(120);
    expect(lignesAPersister("k", frais, com, bareme)).toEqual(rows);
  });
  it("sans barème : une ligne commission non calculable, aucun montant", () => {
    const com = calculerCommissionPrevisionnelle({ contratId: "k", bareme: null, primeAnnuelle: 1200, dureeMois: 24 });
    const rows = lignesAPersister("k", calculerFraisDistribution({ branche: "assurance_vie" }), com, null);
    expect(rows[0].montant).toBe(0);
    expect(rows[1]).toMatchObject({ statut: "non_calculable", montant: null });
  });
});
