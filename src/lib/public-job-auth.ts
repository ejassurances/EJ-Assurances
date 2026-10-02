import { timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export async function authorizePublicJob(request: Request): Promise<boolean> {
  const provided = (request.headers.get("x-relance-token") ?? "").trim();
  if (!provided) return false;

  let expected = (process.env["RELANCE_PIECES_TOKEN"] ?? "").trim();

  if (!expected) {
    const { data, error } = await supabaseAdmin.rpc("get_private_runtime_secret", {
      p_name: "crm_public_job_token",
    });
    if (!error && typeof data === "string") expected = data.trim();
  }

  if (!expected) return false;

  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}
