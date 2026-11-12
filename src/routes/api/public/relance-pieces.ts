import { createFileRoute } from "@tanstack/react-router";
import { authorizePublicJob } from "@/lib/public-job-auth";
import { STATUTS_DOSSIER_AVANT_LM } from "@/lib/referentiels";
import { appUrl } from "@/lib/app-url";
import { CODES_DOCUMENTS_PRET, relanceFormulaireDue } from "@/lib/relances-formulaire";

/**
 * Relance « documents non déposés » (parcours du 11/11/2026) : deux rappels
 * seulement, J+2 puis J+5 après la création du dossier, tant que l'offre de
 * prêt / le tableau d'amortissement (ou la simulation) ne sont pas déposés.
 * Arrêt dès le dépôt ou dès que le dossier quitte les étapes d'avant lettre
 * de mission. Le recueil des besoins est rempli par le cabinet au rendez-vous
 * et les pièces KYC sont demandées après : ils ne sont plus relancés ici.
 *
 * Appelé une fois par jour par le planificateur, avec l'en-tête `apikey`
 * (clé publiable du projet) ou `x-relance-token`.
 */
export const Route = createFileRoute("/api/public/relance-pieces")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await authorizePublicJob(request)))
          return new Response("Unauthorized", { status: 401 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { planifierLotEmails } = await import("@/lib/emails-file-attente.server");

        const seuil = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();

        const { data: dossiers, error } = await supabaseAdmin
          .from("dossiers")
          .select(
            "id, reference, client_id, client_nom, client_email, created_at, recueil_besoins, relance_pieces_envoyee_le, accuse_reception_envoye_le",
          )
          .not("client_email", "is", null)
          .in("statut", [...STATUTS_DOSSIER_AVANT_LM])
          .lte("created_at", seuil)
          .limit(200);
        if (error) return Response.json({ error: error.message }, { status: 500 });

        const lot: {
          template: string;
          destinataire: string;
          donnees: Record<string, unknown>;
          idempotency_key: string;
        }[] = [];
        const details: { dossier: string; pieces: number; accuse: boolean; relance: string }[] = [];

        for (const d of dossiers ?? []) {
          // Pièces de prêt du dossier (parcours du 11/11 : avant le rendez-vous,
          // seuls l'offre de prêt et le tableau d'amortissement — ou la
          // simulation pour un acquéreur — sont demandés ; KYC et recueil viennent après).
          const { data: pieces } = await supabaseAdmin
            .from("dossier_pieces_requises")
            .select("code, libelle, statut")
            .eq("dossier_id", d.id)
            .in("code", [...CODES_DOCUMENTS_PRET]);
          const deposes = (pieces ?? []).some((p) => p.statut !== "manquante");
          const relance = relanceFormulaireDue({
            creeLe: d.created_at,
            derniereRelanceLe: d.relance_pieces_envoyee_le,
            documentsPretDeposes: deposes,
          });
          if (!relance) continue;

          const manquants: string[] = (pieces ?? [])
            .filter((p) => p.statut === "manquante" && p.code !== "simulation_pret")
            .map((p) => p.libelle);
          if (manquants.length === 0) {
            manquants.push("Offre de prêt", "Tableau d'amortissement");
          }
          if (manquants.length === 0) continue;

          const accuse = !d.accuse_reception_envoye_le;

          // Envoi étalé : mise en file d'attente (premier email à 10h00 Paris,
          // puis un toutes les 5 minutes) au lieu d'un envoi immédiat en rafale.
          lot.push({
            template: "pieces-manquantes",
            destinataire: d.client_email!,
            donnees: {
              clientName: d.client_nom,
              reference: d.reference,
              pieces: manquants,
              accuse,
              relance,
              link: appUrl("/espace/mon-espace"),
            },
            idempotency_key: `relance-pieces-${d.id}-${relance}`,
          });

          await supabaseAdmin
            .from("dossiers")
            .update({
              relance_pieces_envoyee_le: new Date().toISOString(),
              ...(accuse ? { accuse_reception_envoye_le: new Date().toISOString() } : {}),
            })
            .eq("id", d.id);

          details.push({ dossier: d.reference, pieces: manquants.length, accuse, relance });
        }

        const { planifies, premier } = await planifierLotEmails(
          supabaseAdmin,
          `relance-pieces-${new Date().toISOString().slice(0, 10)}`,
          lot,
        );

        return Response.json({ ok: true, planifies, premier_envoi: premier, details });
      },
    },
  },
});
