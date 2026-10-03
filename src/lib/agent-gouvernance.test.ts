import { describe, expect, it } from "vitest";
import {
  deciderExecution,
  evaluerPermission,
  niveauEffectif,
  NIVEAU_PAR_DEFAUT,
} from "./agent-gouvernance";

describe("agent — gouvernance / permissions par action", () => {
  it("autonome → exécution automatique avec journalisation", () => {
    const d = deciderExecution("autonome");
    expect(d.peutExecuterAuto).toBe(true);
    expect(d.doitEscalader).toBe(false);
  });

  it("validation_humaine → préparation puis validation, pas d'auto", () => {
    const d = deciderExecution("validation_humaine");
    expect(d.peutExecuterAuto).toBe(false);
    expect(d.exigeValidationHumaine).toBe(true);
    expect(d.doitEscalader).toBe(false);
  });

  it("execution_humaine → l'Agent n'exécute jamais", () => {
    const d = deciderExecution("execution_humaine");
    expect(d.peutExecuterAuto).toBe(false);
    expect(d.exigeExecutionHumaine).toBe(true);
    expect(d.doitEscalader).toBe(false);
  });

  it("escalade → blocage + escalade", () => {
    const d = deciderExecution("escalade");
    expect(d.peutExecuterAuto).toBe(false);
    expect(d.doitEscalader).toBe(true);
  });

  it("défaut conservateur : permission absente/inactive/inconnue → escalade", () => {
    expect(NIVEAU_PAR_DEFAUT).toBe("escalade");
    expect(niveauEffectif(null)).toBe("escalade");
    expect(niveauEffectif({ action_type: "x", niveau: "autonome", actif: false })).toBe("escalade");
    expect(niveauEffectif({ action_type: "x", niveau: "n_importe_quoi", actif: true })).toBe(
      "escalade",
    );
    expect(evaluerPermission(null).doitEscalader).toBe(true);
  });

  it("action sensible : jamais d'exécution automatique même si autonome", () => {
    const d = evaluerPermission(
      { action_type: "x", niveau: "autonome", actif: true },
      { actionSensible: true },
    );
    expect(d.peutExecuterAuto).toBe(false);
    expect(d.doitEscalader).toBe(true);
  });

  it("permission active valide → niveau respecté", () => {
    const d = evaluerPermission({ action_type: "relance_prevue", niveau: "autonome", actif: true });
    expect(d.peutExecuterAuto).toBe(true);
  });
});
