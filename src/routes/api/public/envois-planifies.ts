import { createFileRoute } from "@tanstack/react-router";
import { authorizePublicJob } from "@/lib/public-job-auth";
/**
 * Job d'envoi de la file d'attente d'emails : envoie tout ce qui est dû
 * (voir src/lib/emails-file-attente.server.ts). Appelé toutes les 5 minutes
 * par le planificateur avec l'en-tête `apikey` (clé publiable du projet).
 */
export const Route = createFileRoute("/api/public/envois-planifies")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await authorizePublicJob(request))) return new Response("Unauthorized", { status: 401 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { envoyerEmailsDus } = await import("@/lib/emails-file-attente.server");
        try {
          const res = await envoyerEmailsDus(supabaseAdmin);
          return Response.json({ ok: true, ...res });
        } catch (e) {
          return Response.json({ error: e instanceof Error ? e.message : "erreur" }, { status: 500 });
        }
      },
    },
  },
});
