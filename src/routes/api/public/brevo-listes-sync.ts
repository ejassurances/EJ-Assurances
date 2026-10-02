import { createFileRoute } from "@tanstack/react-router";
import { authorizePublicJob } from "@/lib/public-job-auth";

/**
 * Création / vérification des listes de contacts Brevo (une par branche, plus
 * « Clients actifs », « Prospects », « Prescripteurs ») et synchronisation des
 * contacts depuis le CRM. À appeler 1×/jour avec l'en-tête `apikey`.
 */
export const Route = createFileRoute("/api/public/brevo-listes-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await authorizePublicJob(request))) return new Response("Unauthorized", { status: 401 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { synchroniserListesBrevo } = await import("@/lib/brevo-listes.server");
        try {
          const res = await synchroniserListesBrevo(supabaseAdmin as never);
          return Response.json({ ok: true, ...res });
        } catch (e) {
          return Response.json({ error: e instanceof Error ? e.message : "erreur" }, { status: 500 });
        }
      },
    },
  },
});
