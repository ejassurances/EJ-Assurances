import { createFileRoute } from "@tanstack/react-router";
import { authorizePublicJob } from "@/lib/public-job-auth";

/**
 * Correctif rétroactif : messages Gmail étiquetés « Gestion Commerciale » ou
 * « Service Client » alors qu'ils proviennent d'un domaine de compagnie /
 * partenaire connu. Les mauvaises étiquettes sont retirées, « Service
 * Partenaire » appliquée, et les brouillons de réponse client générés par
 * erreur sont supprimés.
 *
 * En-tête attendu : `x-relance-token: <RELANCE_PIECES_TOKEN>` ou
 * `apikey: <clé publiable>`.
 */
export const Route = createFileRoute("/api/public/corriger-labels-partenaires")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorizePublicJob(request)) return new Response("Unauthorized", { status: 401 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { identiteTechnique } = await import("@/lib/agent-taches.server");
        const identite = await identiteTechnique(supabaseAdmin as never);
        if (!identite) {
          return Response.json(
            { error: "Aucun compte utilisable : créez un utilisateur du cabinet (rôle admin)." },
            { status: 500 },
          );
        }
        const userId = identite.userId;

        const mode = new URL(request.url).searchParams.get("mode");

        try {
          if (mode === "identifier") {
            // Rattrapage : identification du client concerné + note de suivi
            // sur les emails partenaires déjà routés.
            const { identifierClientsPartenairesRetroactif } = await import("@/lib/partenaires-emails.server");
            const resultat = await identifierClientsPartenairesRetroactif(supabaseAdmin, userId);
            return Response.json({ ok: true, mode: "identifier", ...resultat });
          }
          const { corrigerLabelsPartenaires } = await import("@/lib/partenaires-emails.server");
          const resultat = await corrigerLabelsPartenaires(supabaseAdmin, userId);
          return Response.json({ ok: true, ...resultat });
        } catch (e) {
          const message = e instanceof Error ? e.message : "erreur inconnue";
          console.error("[corriger-labels-partenaires]", e);
          return Response.json({ error: message }, { status: 500 });
        }

      },
    },
  },
});
