import { createFileRoute } from "@tanstack/react-router";
import { authorizePublicJob } from "@/lib/public-job-auth";
import { statutAttendu } from "@/lib/formations-personnel";

/**
 * Rappel des formations du personnel : met à jour le statut des formations dont
 * la date d'expiration est dépassée ('expiree') ou à moins de 30 jours
 * ('a_renouveler'), et crée une tâche admin unique par collaborateur/thème.
 *
 * À appeler 1×/jour avec l'en-tête `x-relance-token: <RELANCE_PIECES_TOKEN>`
 * ou `apikey: <clé publiable>`.
 */
export const Route = createFileRoute("/api/public/formations-rappels")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await authorizePublicJob(request))) return new Response("Unauthorized", { status: 401 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { creerTacheAdmin } = await import("@/lib/agent-taches.server");

        const { data, error } = await supabaseAdmin
          .from("formations_personnel")
          .select("id, collaborateur_id, theme, date_expiration, statut")
          .not("date_expiration", "is", null)
          .limit(500);
        if (error) return Response.json({ error: error.message }, { status: 500 });

        const lignes = (data ?? []) as {
          id: string;
          collaborateur_id: string;
          theme: string;
          date_expiration: string | null;
          statut: string;
        }[];

        const { data: profils } = await supabaseAdmin.from("profiles").select("id, full_name, email");
        const nomDe = (id: string) => {
          const p = ((profils ?? []) as any[]).find((x) => x.id === id);
          return p?.full_name || p?.email || "Collaborateur";
        };

        let majs = 0;
        let taches = 0;

        for (const l of lignes) {
          const attendu = statutAttendu(l.date_expiration);
          if (attendu === "valide") continue;

          if (attendu !== l.statut) {
            await supabaseAdmin
              .from("formations_personnel")
              .update({ statut: attendu } as never)
              .eq("id", l.id);
            majs += 1;
          }

          const titre = `Formation à renouveler — ${nomDe(l.collaborateur_id)} — ${l.theme}`;
          const { data: deja } = await supabaseAdmin
            .from("taches")
            .select("id")
            .eq("titre", titre)
            .in("statut", ["a_faire", "en_cours"])
            .limit(1);
          if ((deja ?? []).length > 0) continue;

          await creerTacheAdmin(supabaseAdmin as never, {
            titre,
            description: [
              attendu === "expiree"
                ? `Formation expirée depuis le ${new Date(l.date_expiration!).toLocaleDateString("fr-FR")}.`
                : `Formation valable jusqu'au ${new Date(l.date_expiration!).toLocaleDateString("fr-FR")} (moins de 30 jours).`,
              "",
              "Planifier la session puis déposer l'attestation : Conformité → onglet Formation du personnel.",
            ].join("\n"),
            priorite: attendu === "expiree" ? "urgente" : "haute",
          });
          taches += 1;
        }

        return Response.json({ ok: true, statuts_mis_a_jour: majs, taches_creees: taches });
      },
    },
  },
});
