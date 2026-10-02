import { createFileRoute } from "@tanstack/react-router";
import { authorizePublicJob } from "@/lib/public-job-auth";

/**
 * Traitement de la boîte de réception principale Gmail.
 *
 * DÉCLENCHEMENT MANUEL UNIQUEMENT : aucune planification n'est posée tant que
 * le cabinet n'a pas validé la mise en service. Aucun email n'est envoyé —
 * seuls des brouillons sont créés et les messages sont classés.
 *
 * En-tête attendu : `x-relance-token: <RELANCE_PIECES_TOKEN>` ou
 * `apikey: <clé publiable>`.
 */
export const Route = createFileRoute("/api/public/gmail-inbox")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorizePublicJob(request)) return new Response("Unauthorized", { status: 401 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { identiteTechnique } = await import("@/lib/agent-taches.server");
        const identite = await identiteTechnique(supabaseAdmin as never);

        const corps = (await request.json().catch(() => null)) as
          | { limite?: number; maxResults?: number }
          | null;

        try {
          const { traiterInboxPrincipale } = await import("@/lib/gmail-inbox.server");
          const resultat = await traiterInboxPrincipale(supabaseAdmin as never, identite?.userId ?? null, {
            limite: Number(corps?.limite) || 10,
            maxResults: Number(corps?.maxResults) || 25,
          });
          return Response.json({ ok: true, ...resultat });
        } catch (e) {
          console.error("[gmail-inbox] échec du passage", e);
          return Response.json(
            { error: e instanceof Error ? e.message : "erreur inconnue" },
            { status: 500 },
          );
        }
      },
    },
  },
});
