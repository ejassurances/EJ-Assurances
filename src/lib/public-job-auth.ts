import { timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

type LecteurSecret = () => Promise<string | null>;

/** Source unique du jeton attendu : le vault (`crm_public_job_token`). */
async function lireJetonVault(): Promise<string | null> {
  const { data, error } = await supabaseAdmin.rpc("get_private_runtime_secret", {
    p_name: "crm_public_job_token",
  });
  if (error) {
    console.error(`[public-job-auth] lecture du vault impossible : ${error.message}`);
    return null;
  }
  return typeof data === "string" ? data : null;
}

/**
 * Vérifie l'en-tête `x-relance-token` des tâches planifiées. Le jeton attendu
 * provient UNIQUEMENT du vault. Les causes de refus sont journalisées sans
 * jamais écrire le secret ni le jeton reçu.
 */
export async function authorizePublicJob(
  request: Request,
  lireSecret: LecteurSecret = lireJetonVault,
): Promise<boolean> {
  const chemin = (() => {
    try {
      return new URL(request.url).pathname;
    } catch {
      return "?";
    }
  })();
  const provided = (request.headers.get("x-relance-token") ?? "").trim();
  if (!provided) {
    console.error(`[public-job-auth] refus ${chemin} : en-tête x-relance-token absent`);
    return false;
  }

  const expected = ((await lireSecret()) ?? "").trim();
  if (!expected) {
    console.error(`[public-job-auth] refus ${chemin} : secret crm_public_job_token absent du vault`);
    return false;
  }

  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) {
    console.error(`[public-job-auth] refus ${chemin} : longueur du jeton différente`);
    return false;
  }
  if (!timingSafeEqual(a, b)) {
    console.error(`[public-job-auth] refus ${chemin} : jeton différent`);
    return false;
  }
  return true;
}
