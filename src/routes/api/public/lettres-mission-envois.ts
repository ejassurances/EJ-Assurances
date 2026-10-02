import { createFileRoute } from "@tanstack/react-router";
import { authorizePublicJob } from "@/lib/public-job-auth";

/**
 * Envoi des lettres de mission différées : délai fixe de 8 h après le DER,
 * dans les horaires d'ouverture. À appeler régulièrement (toutes les heures)
 * avec l'en-tête `apikey` (clé publiable du projet) ou `x-relance-token`.
 */
export const Route = createFileRoute("/api/public/lettres-mission-envois")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await authorizePublicJob(request))) return new Response("Unauthorized", { status: 401 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { envoyerLettresMissionDues } = await import("@/lib/lettres-mission.server");
        try {
          const res = await envoyerLettresMissionDues(supabaseAdmin as never);
          return Response.json({ ok: true, ...res });
        } catch (e) {
          return Response.json({ error: e instanceof Error ? e.message : "erreur" }, { status: 500 });
        }
      },
    },
  },
});
