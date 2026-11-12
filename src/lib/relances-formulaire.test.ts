import { describe, expect, it } from "vitest";
import { relanceFormulaireDue } from "./relances-formulaire";

const creeLe = "2026-11-10T09:00:00Z";
const at = (iso: string) => new Date(iso);

describe("relanceFormulaireDue", () => {
  it("rien avant J+2", () => {
    expect(relanceFormulaireDue({ creeLe, derniereRelanceLe: null, documentsPretDeposes: false, maintenant: at("2026-11-11T10:00:00Z") })).toBeNull();
  });
  it("J+2 puis rien jusqu'à J+5, puis J+5, puis stop", () => {
    expect(relanceFormulaireDue({ creeLe, derniereRelanceLe: null, documentsPretDeposes: false, maintenant: at("2026-11-12T10:00:00Z") })).toBe("J+2");
    expect(relanceFormulaireDue({ creeLe, derniereRelanceLe: "2026-11-12T10:00:00Z", documentsPretDeposes: false, maintenant: at("2026-11-14T10:00:00Z") })).toBeNull();
    expect(relanceFormulaireDue({ creeLe, derniereRelanceLe: "2026-11-12T10:00:00Z", documentsPretDeposes: false, maintenant: at("2026-11-15T10:00:00Z") })).toBe("J+5");
    expect(relanceFormulaireDue({ creeLe, derniereRelanceLe: "2026-11-15T10:00:00Z", documentsPretDeposes: false, maintenant: at("2026-11-20T10:00:00Z") })).toBeNull();
  });
  it("arrêt dès dépôt des documents", () => {
    expect(relanceFormulaireDue({ creeLe, derniereRelanceLe: null, documentsPretDeposes: true, maintenant: at("2026-11-12T10:00:00Z") })).toBeNull();
  });
  it("dossier ancien jamais relancé : une seule relance J+5", () => {
    expect(relanceFormulaireDue({ creeLe, derniereRelanceLe: null, documentsPretDeposes: false, maintenant: at("2026-11-30T10:00:00Z") })).toBe("J+5");
  });
});
