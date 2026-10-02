import { createFileRoute } from "@tanstack/react-router";
import { authorizePublicJob } from "@/lib/public-job-auth";
import { joursAvantFinTrimestre, trimestreCourant } from "@/lib/controle-interne";

/**
 * Rappel de fin de trimestre du contrôle interne de 1er niveau : à 7 jours ou
 * moins de la fin du trimestre, s'il reste des dossiers 'a_faire' dans
 * l'échantillon courant, crée UNE tâche admin de rappel (une seule par trimestre).
 *
 * À appeler 1×/jour avec l'en-tête `x-relance-token: <RELANCE_PIECES_TOKEN>`
 * ou `apikey: <clé publiable>`.
 */
export const Route = createFileRoute("/api/public/controle-interne-rappel")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorizePublicJob(request)) return new Response("Unauthorized", { status: 401 });

        const jours = joursAvantFinTrimestre();
        if (jours > 7) return Response.json({ ok: true, ignore: "trimestre en cours", jours });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { creerTacheAdmin } = await import("@/lib/agent-taches.server");

        const periode = trimestreCourant();
        const { data, error } = await supabaseAdmin
          .from("controles_internes")
          .select("id, client_id, clients(nom, prenom, reference)")
          .eq("periode", periode)
          .eq("statut", "a_faire")
          .limit(200);
        if (error) return Response.json({ error: error.message }, { status: 500 });

        const restants = (data ?? []) as any[];
        if (restants.length === 0) return Response.json({ ok: true, restants: 0 });

        const titre = `Contrôle interne ${periode} — ${restants.length} dossiers restants avant la fin du trimestre`;
        const { data: dejaFait } = await supabaseAdmin
          .from("taches")
          .select("id")
          .ilike("titre", `Contrôle interne ${periode} — %dossiers restants%`)
          .limit(1);
        if ((dejaFait ?? []).length > 0) return Response.json({ ok: true, restants: restants.length, tache: "existante" });

        await creerTacheAdmin(supabaseAdmin as never, {
          titre,
          description: [
            `Fin du trimestre dans ${jours} jour(s).`,
            "Dossiers de l'échantillon encore à contrôler :",
            ...restants.map(
              (r) =>
                `• ${[r.clients?.prenom, r.clients?.nom].filter(Boolean).join(" ") || "Client"} (${r.clients?.reference ?? "—"})`,
            ),
            "",
            "Saisie des résultats : Conformité → onglet Contrôle interne.",
          ].join("\n"),
          priorite: "urgente",
        });

        return Response.json({ ok: true, restants: restants.length, tache: "creee" });
      },
    },
  },
});
