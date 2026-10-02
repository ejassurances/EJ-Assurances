import { createFileRoute } from "@tanstack/react-router";
import { authorizePublicJob } from "@/lib/public-job-auth";

/**
 * Rattrapage des mails classés « A_Ignorer » à tort : un email partenaire
 * contenant des codes courtier, une offre de partenariat, une mise à jour
 * produit ou une invitation à un challenge n'est pas de la publicité. Ces mails
 * sont réanalysés, la compagnie et les produits sont référencés (inactif / en
 * test), une tâche décrit l'ajout, et le mail repasse en
 * « Direction Commerciale/Service Partenaire/A_Traiter ».
 *
 * En-tête attendu : `x-relance-token: <RELANCE_PIECES_TOKEN>` ou
 * `apikey: <clé publiable>`.
 */
export const Route = createFileRoute("/api/public/reprendre-mails-ignores")({
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

        const limite = Number(new URL(request.url).searchParams.get("limite") ?? 150);

        try {
          const { reprendreMailsIgnores } = await import("@/lib/partenaires-offres.server");
          const resultat = await reprendreMailsIgnores(
            supabaseAdmin,
            userId,
            Number.isFinite(limite) ? Math.min(Math.max(limite, 1), 200) : 150,
          );
          return Response.json({ ok: true, ...resultat });
        } catch (e) {
          const message = e instanceof Error ? e.message : "erreur inconnue";
          console.error("[reprendre-mails-ignores]", e);
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },
  },
});
