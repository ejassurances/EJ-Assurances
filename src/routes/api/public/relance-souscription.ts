import { createFileRoute } from "@tanstack/react-router";
import { authorizePublicJob } from "@/lib/public-job-auth";

/**
 * Relance automatique des compagnies sans retour sur une demande de
 * souscription : J+3 puis J+7 après l'envoi, avec création d'une tâche
 * de suivi pour le gestionnaire.
 *
 * À appeler par un planificateur (1×/jour) avec l'en-tête
 * `x-relance-token: <RELANCE_PIECES_TOKEN>`.
 */
export const Route = createFileRoute("/api/public/relance-souscription")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorizePublicJob(request)) return new Response("Unauthorized", { status: 401 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { relancerSouscriptionsEnAttente } = await import("@/lib/souscription.server");

        try {
          const res = await relancerSouscriptionsEnAttente(supabaseAdmin);
          return Response.json(res);
        } catch (e) {
          return Response.json(
            { error: e instanceof Error ? e.message : "Relance impossible" },
            { status: 500 },
          );
        }
      },
    },
  },
});
