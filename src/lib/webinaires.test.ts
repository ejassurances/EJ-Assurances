import { describe, expect, it } from "vitest";
import {
  FUNNEL_ETAPES,
  compterFunnelCumulatif,
  estFunnelEtape,
  funnelEtapeSuivante,
  funnelProgression,
  peutAvancerVers,
  tauxConversion,
  doitPlanifierStep,
  lireSequences,
} from "./webinaires";

describe("funnel webinaire — Lot G", () => {
  it("expose les 10 étapes de la spec dans l'ordre", () => {
    expect(FUNNEL_ETAPES).toHaveLength(10);
    expect(FUNNEL_ETAPES[0]).toBe("inscription");
    expect(FUNNEL_ETAPES[9]).toBe("ca");
  });

  it("valide les étapes connues et rejette les autres", () => {
    expect(estFunnelEtape("fic")).toBe(true);
    expect(estFunnelEtape("inconnu")).toBe(false);
  });

  it("donne l'étape suivante, null au bout", () => {
    expect(funnelEtapeSuivante("inscription")).toBe("presence");
    expect(funnelEtapeSuivante("contrat")).toBe("ca");
    expect(funnelEtapeSuivante("ca")).toBeNull();
  });

  it("calcule la progression", () => {
    expect(funnelProgression("inscription")).toBe(0);
    expect(funnelProgression("ca")).toBe(1);
  });

  it("n'avance que vers l'avant", () => {
    expect(peutAvancerVers("inscription", "clic")).toBe(true);
    expect(peutAvancerVers("clic", "inscription")).toBe(false);
    expect(peutAvancerVers("clic", "clic")).toBe(false);
  });

  it("compte le funnel de façon cumulative et calcule un taux", () => {
    // 3 participants : l'un à 'clic', un à 'contrat', un à 'inscription'.
    const cumul = compterFunnelCumulatif(["clic", "contrat", "inscription"]);
    expect(cumul.inscription).toBe(3); // tous ont au moins l'inscription
    expect(cumul.clic).toBe(2); // 'clic' et 'contrat'
    expect(cumul.contrat).toBe(1);
    expect(cumul.ca).toBe(0);
    expect(tauxConversion(cumul, "inscription", "clic")).toBeCloseTo(2 / 3);
  });

  it("planifie un step seulement si déclenché et objectif non atteint", () => {
    const step = { cle: "relance1", declencheur: "inscription" as const, delaiHeures: 24, template: "relance_webinaire", arretSi: "presence" as const };
    expect(doitPlanifierStep("inscription", step)).toBe(true); // déclenché, pas encore présent
    expect(doitPlanifierStep("presence", step)).toBe(false); // objectif atteint → stop
    expect(doitPlanifierStep("inscription", { ...step, declencheur: "clic" })).toBe(false); // déclencheur non atteint
  });

  it("lit la config séquences de façon tolérante", () => {
    expect(lireSequences(null)).toEqual([]);
    expect(lireSequences({ sequences: "x" })).toEqual([]);
    const ok = lireSequences({
      sequences: [
        { cle: "r1", declencheur: "inscription", delaiHeures: 24, template: "t", arretSi: "presence" },
        { cle: "invalide", declencheur: "pas_une_etape", delaiHeures: 1, template: "t" },
      ],
    });
    expect(ok).toHaveLength(1);
    expect(ok[0].cle).toBe("r1");
  });
});
