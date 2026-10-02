import { createFileRoute } from "@tanstack/react-router";
import { authorizePublicJob } from "@/lib/public-job-auth";

/**
 * Reprise des réponses clients suspendues faute de document (statut
 * `attente_document`) : une fois la tâche du gestionnaire clôturée et le document
 * présent dans le CRM, la réponse part automatiquement avec la pièce jointe.
 *
 * Lot borné à 10 réponses par passage, idempotent (le statut change dans la même
 * étape). En-tête attendu : `x-relance-token` ou `apikey`.
 */
export const Route = createFileRoute("/api/public/documents-attendus")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await authorizePublicJob(request))) return new Response("Unauthorized", { status: 401 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { identiteTechnique } = await import("@/lib/agent-taches.server");
        const identite = await identiteTechnique(supabaseAdmin as never);
        if (!identite) {
          return Response.json(
            { error: "Aucun compte utilisable : créez un utilisateur du cabinet (rôle admin)." },
            { status: 500 },
          );
        }

        try {
          const { reprendreDocumentsAttendus } = await import("@/lib/documents-attendus.server");
          const rapport = await reprendreDocumentsAttendus(supabaseAdmin, identite.userId);
          return Response.json({ ok: true, ...rapport });
        } catch (e) {
          const message = e instanceof Error ? e.message : "erreur inconnue";
          console.error("[documents-attendus] échec", e);
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },
  },
});
