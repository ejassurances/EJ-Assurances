import { describe, expect, it } from "vitest";
import {
  appliquerValeursPret,
  croiserLecturesPret,
  filtrerValeursPret,
  fusionnerRecueilPret,
  preparerConfirmationPret,
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

it("normalise les corrections numériques et rejette les dates impossibles", () => {
  expect(
    filtrerValeursPret({
      montant_capital: "200 000,50",
      date_premiere_echeance: "2026-02-31",
      duree_mois: "240",
    }),
  ).toEqual({ montant_capital: 200000.5, duree_mois: 240 });
});

describe("confirmation et réouverture du prêt", () => {
  const dossierVide = { recueil_besoins: {}, analyse_ia: {}, capital: null, duree_mois: null };
  const confirmation = { confirme_par: "conseiller", confirme_le: "2026-10-28T17:41:00Z" };

  it("préremplit l'offre avant sauvegarde avec les clés réellement affichées", () => {
    expect(appliquerValeursPret({}, {
      banque: "LCL", montant_capital: 200000, duree_mois: 240, taux_nominal: 3.4,
      date_premiere_echeance: "2026-12-05", cotisation_assurance_mensuelle: 35,
    })).toEqual({
      banque: "LCL", capital: 200000, duree_mois: 240, taux_pret: 3.4,
      date_premiere_echeance: "2026-12-05", assurance_banque_mensuelle: 35,
    });
  });

  it("préremplit un tableau incomplet sans inventer prêteur ni taux", () => {
    const tableau: LecturePret = { source: "tableau.pdf", nature: "tableau_amortissement", confiance: 0.9,
      valeurs: { montant_capital: 150000, duree_mois: 180, capital_restant_du: 130000,
        date_premiere_echeance: "2025-01-05" } };
    expect(appliquerValeursPret({}, croiserLecturesPret([tableau]).valeurs)).toEqual({
      capital: 150000, duree_mois: 180, capital_restant_du: 130000, date_premiere_echeance: "2025-01-05",
    });
  });

  it("conserve les valeurs confirmées lors du rechargement du formulaire monté", () => {
    expect(fusionnerRecueilPret({ banque: "", capital: null, notes_contrat: "Saisie locale" },
      { banque: "LCL", capital: 200000, taux_pret: 3.4 })).toEqual({
      banque: "LCL", capital: 200000, taux_pret: 3.4, notes_contrat: "Saisie locale",
    });
  });

  it("une saisie locale et un taux zéro priment sur le rechargement", () => {
    expect(fusionnerRecueilPret({ banque: "BNP", taux_pret: 0 }, { banque: "LCL", taux_pret: 3.4 }))
      .toEqual({ banque: "BNP", taux_pret: 0 });
  });

  it("prépare une sauvegarde puis une réouverture JSON sans perdre les valeurs ni l'audit", () => {
    const valeurs = { ...offre.valeurs, banque: "LCL", taux_nominal: 3.4, mensualite: 1125.25,
      date_premiere_echeance: "2026-12-05", date_fin_pret: "2046-11-05" };
    const payload = preparerConfirmationPret(dossierVide, valeurs, [{ ...offre, valeurs }], confirmation);
    const relu = JSON.parse(JSON.stringify(payload)) as typeof payload;
    expect(relu.capital).toBe(200000);
    expect(relu.duree_mois).toBe(240);
    expect(relu.recueil_besoins).toMatchObject({ banque: "LCL", taux_pret: 3.4,
      date_premiere_echeance: "2026-12-05" });
    expect(relu.recueil_besoins).not.toHaveProperty("mensualite");
    expect(relu.recueil_besoins).not.toHaveProperty("date_fin_pret");
    expect(relu.analyse_ia.imports_pret_verifies.at(-1)).toMatchObject({ valeurs: {
      mensualite: 1125.25, date_fin_pret: "2046-11-05",
    } });
  });

  it("préserve les colonnes d'un dossier existant même si son recueil est vide", () => {
    const payload = preparerConfirmationPret({ ...dossierVide, capital: 170000, duree_mois: 180 },
      offre.valeurs, [offre], confirmation);
    expect(payload.recueil_besoins).toMatchObject({ capital: 170000, duree_mois: 180 });
    expect(payload.capital).toBe(170000);
  });
});
