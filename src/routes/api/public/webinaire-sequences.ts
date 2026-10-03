import { createFileRoute } from "@tanstack/react-router";
import { authorizePublicJob } from "@/lib/public-job-auth";

/**
 * Lot G — Job de planification des séquences/relances webinaire.
 * Appelé périodiquement par le planificateur (en-tête `apikey`). Lit les
 * séquences configurées par webinaire et enfile les relances dues dans
 * emails_planifies (le job envois-planifies les envoie à échéance). Idempotent.
 */
export const Route = createFileRoute("/api/public/webinaire-sequences")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await authorizePublicJob(request))) return new Response("Unauthorized", { status: 401 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { planifierSequencesWebinaire } = await import("@/lib/webinaires-sequences.server");
        try {
          const res = await planifierSequencesWebinaire(supabaseAdmin);
          return Response.json({ ok: true, ...res });
        } catch (e) {
          return Response.json({ error: e instanceof Error ? e.message : "erreur" }, { status: 500 });
        }
      },
    },
  },
});
