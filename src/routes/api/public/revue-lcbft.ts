import { createFileRoute } from "@tanstack/react-router";
import { authorizePublicJob } from "@/lib/public-job-auth";

/**
 * Revue périodique LCB-FT : tout client dont `prochaine_revue_le` est dépassée
 * passe au statut 'a_reviser' et déclenche UNE tâche admin de revue.
 *
 * À appeler 1×/jour avec l'en-tête `x-relance-token: <RELANCE_PIECES_TOKEN>`
 * ou `apikey: <clé publiable>`.
 */
export const Route = createFileRoute("/api/public/revue-lcbft")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorizePublicJob(request)) return new Response("Unauthorized", { status: 401 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { creerTacheAdmin } = await import("@/lib/agent-taches.server");

        const aujourdhui = new Date().toISOString().slice(0, 10);
        const { data, error } = await supabaseAdmin
          .from("client_risque_lcbft")
          .select("id, client_id, score_risque, niveau_vigilance, prochaine_revue_le, clients(nom, prenom)")
          .neq("statut", "a_reviser")
          .not("prochaine_revue_le", "is", null)
          .lte("prochaine_revue_le", aujourdhui)
          .limit(200);
        if (error) return Response.json({ error: error.message }, { status: 500 });

        let taches = 0;
        for (const r of (data ?? []) as any[]) {
          const nom = [r.clients?.prenom, r.clients?.nom].filter(Boolean).join(" ") || "Client";
          await supabaseAdmin
            .from("client_risque_lcbft")
            .update({ statut: "a_reviser" } as never)
            .eq("id", r.id);
          await creerTacheAdmin(supabaseAdmin as never, {
            titre: `Revue LCB-FT à faire — ${nom}`,
            description: [
              `Niveau de vigilance actuel : ${r.niveau_vigilance}`,
              `Score de risque : ${r.score_risque}/100`,
              `Revue attendue depuis le : ${r.prochaine_revue_le}`,
              `Fiche client : /espace/clients/${r.client_id}`,
            ].join("\n"),
            client_id: r.client_id,
            priorite: "haute",
          });
          taches += 1;
        }

        return Response.json({ ok: true, clients: (data ?? []).length, taches });
      },
    },
  },
});
