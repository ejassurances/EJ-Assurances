import { createFileRoute } from "@tanstack/react-router";
import { authorizePublicJob } from "@/lib/public-job-auth";

/**
 * Job d'envoi automatique des devoirs de conseil VALIDÉS par le cabinet dont le
 * délai de réflexion (6 h après la signature de la lettre de mission) est
 * écoulé, pendant les horaires d'ouverture. Un devoir de conseil non validé
 * n'est jamais envoyé. Appelé toutes les 15 minutes par le planificateur avec
 * l'en-tête `apikey` (clé publiable du projet) ou `x-relance-token`.
 */
export const Route = createFileRoute("/api/public/devoirs-conseil-envois")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const anon =
          process.env["SUPABASE_PUBLISHABLE_KEY"] || process.env["VITE_SUPABASE_PUBLISHABLE_KEY"] || null;
        if (!authorizePublicJob(request)) return new Response("Unauthorized", { status: 401 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { envoyerDevoirsConseilValidesDus } = await import("@/lib/devoir-conseil.server");
        try {
          const res = await envoyerDevoirsConseilValidesDus(supabaseAdmin);
          return Response.json({ ok: true, ...res });
        } catch (e) {
          return Response.json({ error: e instanceof Error ? e.message : "erreur" }, { status: 500 });
        }
      },
    },
  },
});
