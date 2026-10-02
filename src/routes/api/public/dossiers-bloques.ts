import { createFileRoute } from "@tanstack/react-router";
import { authorizePublicJob } from "@/lib/public-job-auth";

/**
 * Surveillance quotidienne des dossiers bloqués (statut inchangé depuis plus de
 * 5 jours ouvrés, incohérences documentaires). À appeler 1×/jour avec l'en-tête
 * `apikey` (clé publiable du projet) ou `x-relance-token`.
 */
export const Route = createFileRoute("/api/public/dossiers-bloques")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await authorizePublicJob(request))) return new Response("Unauthorized", { status: 401 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { surveillerDossiersBloques } = await import("@/lib/dossiers-bloques.server");
        try {
          const res = await surveillerDossiersBloques(supabaseAdmin as never);
          return Response.json({ ok: true, ...res });
        } catch (e) {
          return Response.json({ error: e instanceof Error ? e.message : "erreur" }, { status: 500 });
        }
      },
    },
  },
});
