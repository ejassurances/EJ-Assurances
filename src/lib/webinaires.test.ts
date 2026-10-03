import { describe, expect, it } from "vitest";
import {
  FUNNEL_ETAPES,
  estFunnelEtape,
  funnelEtapeSuivante,
  funnelProgression,
  peutAvancerVers,
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
});
