import { createFileRoute } from "@tanstack/react-router";
import { authorizePublicJob } from "@/lib/public-job-auth";
import { revisionAnnuelleDue } from "@/lib/cartographie-risques";

/**
 * Rappel annuel de révision de la cartographie des risques LCB-FT : si la
 * dernière validation globale date de plus d'un an (ou n'a jamais été faite),
 * crée UNE tâche admin de révision (pas de doublon si déjà ouverte).
 *
 * À appeler 1×/jour avec l'en-tête `x-relance-token: <RELANCE_PIECES_TOKEN>`
 * ou `apikey: <clé publiable>`.
 */
export const Route = createFileRoute("/api/public/cartographie-risques-revision")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await authorizePublicJob(request))) return new Response("Unauthorized", { status: 401 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { creerTacheAdmin } = await import("@/lib/agent-taches.server");

        const { data, error } = await supabaseAdmin
          .from("cartographie_risques")
          .select("revise_le")
          .limit(500);
        if (error) return Response.json({ error: error.message }, { status: 500 });

        const lignes = (data ?? []) as { revise_le: string | null }[];
        if (lignes.length === 0) return Response.json({ ok: true, ignore: "aucune ligne" });

        const dates = lignes.map((l) => l.revise_le).filter(Boolean) as string[];
        const derniere = dates.length === lignes.length ? dates.sort()[0]! : null;
        if (!revisionAnnuelleDue(derniere)) {
          return Response.json({ ok: true, derniere_validation: derniere, revision: "à jour" });
        }

        const titre = "Révision annuelle de la cartographie des risques à faire";
        const { data: deja } = await supabaseAdmin
          .from("taches")
          .select("id")
          .eq("titre", titre)
          .in("statut", ["a_faire", "en_cours"])
          .limit(1);
        if ((deja ?? []).length > 0) {
          return Response.json({ ok: true, tache: "existante" });
        }

        await creerTacheAdmin(supabaseAdmin as never, {
          titre,
          description: [
            derniere
              ? `Dernière validation globale : ${new Date(derniere).toLocaleDateString("fr-FR")} (plus d'un an).`
              : "La cartographie des risques n'a jamais été formellement validée.",
            "",
            "Réexaminer chaque facteur (probabilité, impact, mesures de maîtrise) puis cliquer sur",
            "« Valider la version actuelle » : Conformité → onglet Cartographie des risques.",
          ].join("\n"),
          priorite: "haute",
        });

        return Response.json({ ok: true, derniere_validation: derniere, tache: "creee" });
      },
    },
  },
});
