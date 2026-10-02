import { createFileRoute } from "@tanstack/react-router";
import { authorizePublicJob } from "@/lib/public-job-auth";

/**
 * Rappel automatique sur les sinistres sans action : tout dossier resté au
 * statut 'ouvert' ou 'en_analyse' depuis plus de 3 jours déclenche UNE tâche
 * admin de rappel (pas de doublon grâce à `rappel_sans_action_le`).
 *
 * À appeler 1×/jour avec l'en-tête `x-relance-token: <RELANCE_PIECES_TOKEN>`
 * ou `apikey: <clé publiable>`.
 */
export const Route = createFileRoute("/api/public/relance-sinistres")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorizePublicJob(request)) return new Response("Unauthorized", { status: 401 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { creerTacheAdmin } = await import("@/lib/agent-taches.server");

        const seuil = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
        const { data, error } = await supabaseAdmin
          .from("sinistres")
          .select("id, client_id, resume, statut, date_ouverture, updated_at, clients(nom, prenom)")
          .in("statut", ["ouvert", "en_analyse"])
          .is("rappel_sans_action_le", null)
          .lte("date_ouverture", seuil)
          .limit(200);
        if (error) return Response.json({ error: error.message }, { status: 500 });

        let taches = 0;
        for (const s of (data ?? []) as any[]) {
          const nom = [s.clients?.prenom, s.clients?.nom].filter(Boolean).join(" ") || "Client";
          await creerTacheAdmin(supabaseAdmin as never, {
            titre: `Sinistre sans action depuis plus de 3 jours — ${nom}`,
            description: [
              `Statut actuel : ${s.statut}`,
              `Ouvert le : ${s.date_ouverture ? new Date(s.date_ouverture).toLocaleDateString("fr-FR") : "—"}`,
              `Résumé : ${s.resume ?? "—"}`,
              `Fiche sinistre : /espace/sinistres/${s.id}`,
            ].join("\n"),
            client_id: s.client_id,
            priorite: "haute",
          });
          await supabaseAdmin
            .from("sinistres")
            .update({ rappel_sans_action_le: new Date().toISOString() } as never)
            .eq("id", s.id);
          taches += 1;
        }

        return Response.json({ ok: true, sinistres: (data ?? []).length, taches });
      },
    },
  },
});
