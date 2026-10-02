import { createFileRoute } from "@tanstack/react-router";
import { authorizePublicJob } from "@/lib/public-job-auth";

/**
 * Route de rattrapage : analyse Gemini du recueil des besoins de tous les
 * dossiers dont le recueil est complété (statut « DDA validée ») et qui n'ont
 * pas encore d'analyse. Les dossiers analysés passent en « devis en cours ».
 *
 * Appelée par le planificateur avec l'en-tête `apikey` (clé publiable du
 * projet) ou `x-relance-token`.
 */
export const Route = createFileRoute("/api/public/analyse-recueil")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await authorizePublicJob(request))) return new Response("Unauthorized", { status: 401 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { analyserRecueilDossier } = await import("@/lib/analyse-recueil.server");

        // Rattrapage ciblé possible : { "dossier_id": "..." }
        let cible: string | null = null;
        try {
          const corps = (await request.json()) as { dossier_id?: unknown };
          if (typeof corps?.dossier_id === "string") cible = corps.dossier_id;
        } catch {
          // corps vide : traitement du lot
        }

        const requete = supabaseAdmin.from("dossiers").select("id, reference");
        const { data: dossiers, error } = cible
          ? await requete.eq("id", cible).limit(1)
          : await requete
              .in("statut", ["dda_validee", "en_cours"])
              .is("analyse_ia", null)
              .not("recueil_besoins", "is", null)
              .limit(25);
        if (error) return Response.json({ error: error.message }, { status: 500 });

        const details: { dossier: string; ok: boolean; statut?: string; erreur?: string }[] = [];
        for (const d of dossiers ?? []) {
          try {
            const res = await analyserRecueilDossier(supabaseAdmin, d.id);
            details.push({ dossier: d.reference, ok: true, statut: res.statut });
          } catch (e) {
            details.push({
              dossier: d.reference,
              ok: false,
              erreur: e instanceof Error ? e.message : "erreur inconnue",
            });
          }
        }

        return Response.json({ ok: true, traites: details.length, details });
      },
    },
  },
});
