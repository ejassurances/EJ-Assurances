import { describe, expect, it } from "vitest";
import {
  appliquerValeursPret,
  croiserLecturesPret,
  filtrerValeursPret,
  type LecturePret,
} from "./import-pret-verification";

const offre: LecturePret = {
  source: "offre.pdf",
  nature: "offre_pret",
  confiance: 0.8,
  valeurs: { montant_capital: 200000, duree_mois: 240 },
};
describe("documents de prêt facultatifs", () => {
  it("sans document : aucun chiffre inventé", () =>
    expect(croiserLecturesPret([]).valeurs).toEqual({}));
  it("un document incomplet suffit, les valeurs absentes restent absentes", () => {
    expect(croiserLecturesPret([offre]).valeurs).toEqual({
      montant_capital: 200000,
      duree_mois: 240,
    });
    expect(appliquerValeursPret({}, offre.valeurs)).toEqual({ capital: 200000, duree_mois: 240 });
  });
  it("contradiction : aucune source choisie arbitrairement", () => {
    const r = croiserLecturesPret([
      offre,
      {
        ...offre,
        source: "tableau.pdf",
        nature: "tableau_amortissement",
        valeurs: { montant_capital: 180000 },
      },
    ]);
    expect(r.contradictions).toEqual(["montant_capital"]);
    expect(r.valeurs.montant_capital).toBeUndefined();
    expect(r.provenance.montant_capital).toHaveLength(2);
  });
  it("non détecté/échec ne bloque pas et ne produit rien", () =>
    expect(croiserLecturesPret([{ ...offre, valeurs: {}, erreur: "illisible" }]).valeurs).toEqual(
      {},
    ));
  it("aucune donnée médicale ou statut fumeur ne passe la liste blanche", () =>
    expect(
      filtrerValeursPret({
        fumeur: true,
        pathologie: "x",
        montant_capital: 200000,
        taux_nominal: NaN,
      }),
    ).toEqual({ montant_capital: 200000 }));
  it("une valeur humaine n'est jamais écrasée", () =>
    expect(appliquerValeursPret({ capital: 170000 }, offre.valeurs).capital).toBe(170000));
});
