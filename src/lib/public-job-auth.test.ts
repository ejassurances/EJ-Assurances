import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));

import { authorizePublicJob } from "./public-job-auth";

const req = (token?: string) =>
  new Request("https://exemple.test/api/public/job", {
    method: "POST",
    headers: token ? { "x-relance-token": token } : {},
  });

describe("authorizePublicJob (vault seul)", () => {
  it("jeton correct → true", async () => {
    expect(await authorizePublicJob(req("secret-123"), async () => "secret-123")).toBe(true);
  });

  it("jeton faux → false, sans écrire le secret dans les logs", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await authorizePublicJob(req("secret-999"), async () => "secret-123")).toBe(false);
    expect(await authorizePublicJob(req("court"), async () => "secret-123")).toBe(false);
    const logs = spy.mock.calls.flat().join(" ");
    expect(logs).not.toContain("secret-123");
    expect(logs).not.toContain("secret-999");
    expect(logs).toContain("jeton différent");
    expect(logs).toContain("longueur du jeton différente");
    spy.mockRestore();
  });

  it("vault vide → false", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await authorizePublicJob(req("secret-123"), async () => null)).toBe(false);
    expect(await authorizePublicJob(req("secret-123"), async () => "")).toBe(false);
    expect(spy.mock.calls.flat().join(" ")).toContain("absent du vault");
    spy.mockRestore();
  });

  it("ignore RELANCE_PIECES_TOKEN", async () => {
    process.env["RELANCE_PIECES_TOKEN"] = "env-token";
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await authorizePublicJob(req("env-token"), async () => "secret-123")).toBe(false);
    delete process.env["RELANCE_PIECES_TOKEN"];
  });
});
