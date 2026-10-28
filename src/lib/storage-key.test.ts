import { describe, expect, it } from "vitest";
import { normaliserNomFichierPourStockage } from "@/lib/storage-key";

describe("normaliserNomFichierPourStockage", () => {
  it("preserves a simple filename and its extension", () => {
    expect(normaliserNomFichierPourStockage("contrat-2026.pdf")).toBe("contrat-2026.pdf");
  });

  it("normalizes accents and spaces", () => {
    expect(normaliserNomFichierPourStockage("Attestation d’assurance été.pdf")).toBe(
      "Attestation-d-assurance-ete.pdf",
    );
  });

  it("removes path separators and unsafe characters", () => {
    expect(normaliserNomFichierPourStockage("../../client\\contrat?.pdf")).toBe("contrat-.pdf");
  });

  it("returns a safe fallback for an empty or unusable name", () => {
    expect(normaliserNomFichierPourStockage("")).toBe("document");
    expect(normaliserNomFichierPourStockage("///")).toBe("document");
  });

  it("limits the generated filename length", () => {
    expect(normaliserNomFichierPourStockage(`${"a".repeat(200)}.pdf`).length).toBeLessThanOrEqual(160);
  });
});
