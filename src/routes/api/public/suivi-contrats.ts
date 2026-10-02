import { createFileRoute } from "@tanstack/react-router";
import { authorizePublicJob } from "@/lib/public-job-auth";

/**
 * Conseil dans la durée — envoi groupé quotidien des points de suivi périodique.
 * À appeler 1×/jour avec l'en-tête `apikey` (clé publiable du projet) ou
 * `x-relance-token: <RELANCE_PIECES_TOKEN>`.
 */
export const Route = createFileRoute("/api/public/suivi-contrats")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorizePublicJob(request)) return new Response("Unauthorized", { status: 401 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { envoyerSuivisContratsDus } = await import("@/lib/suivi-contrats.server");
        try {
          const res = await envoyerSuivisContratsDus(supabaseAdmin as never);
          return Response.json({ ok: true, ...res });
        } catch (e) {
          return Response.json({ error: e instanceof Error ? e.message : "erreur" }, { status: 500 });
        }
      },
    },
  },
});
