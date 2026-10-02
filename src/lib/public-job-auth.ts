import { timingSafeEqual } from "node:crypto";

export function authorizePublicJob(request: Request): boolean {
  const expected = (process.env["RELANCE_PIECES_TOKEN"] ?? "").trim();
  const provided = (request.headers.get("x-relance-token") ?? "").trim();
  if (!expected || !provided) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}
