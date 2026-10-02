import { createFileRoute } from "@tanstack/react-router";
import { authorizePublicJob } from "@/lib/public-job-auth";
import { STATUTS_DOSSIER_AVANT_LM } from "@/lib/referentiels";
import { appUrl } from "@/lib/app-url";

/**
 * Agent commercial — relance J+2 : accusé de réception et liste des pièces
 * manquantes envoyés au client 2 jours après la création du dossier, dès que
 * le recueil des besoins est incomplet ou que des pièces obligatoires (dossier
 * ou KYC) manquent. Une seule relance tous les 2 jours, l'accusé de réception
 * n'étant envoyé qu'une seule fois par dossier.
 *
 * Appelé une fois par jour par le planificateur, avec l'en-tête `apikey`
 * (clé publiable du projet) ou `x-relance-token`.
 */
export const Route = createFileRoute("/api/public/relance-pieces")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorizePublicJob(request)) return new Response("Unauthorized", { status: 401 });

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
        const details: { dossier: string; pieces: number; accuse: boolean }[] = [];


        for (const d of dossiers ?? []) {
          if (d.relance_pieces_envoyee_le && d.relance_pieces_envoyee_le > seuil) continue;

          const manquants: string[] = [];

          // Recueil des besoins incomplet.
          const recueil = (d.recueil_besoins ?? null) as Record<string, unknown> | null;
          const recueilVide = !recueil || Object.keys(recueil).length === 0;
          if (recueilVide) manquants.push("Recueil de vos besoins à compléter dans votre espace client");

          // Pièces obligatoires du dossier.
          const { data: pieces } = await supabaseAdmin
            .from("dossier_pieces_requises")
            .select("libelle")
            .eq("dossier_id", d.id)
            .eq("obligatoire", true)
            .eq("statut", "manquante");
          for (const p of pieces ?? []) manquants.push(p.libelle);

          // Pièces KYC du client (identité, domicile, RIB).
          if (d.client_id) {
            const { data: kyc } = await supabaseAdmin
              .from("client_kyc_documents")
              .select("type, statut")
              .eq("client_id", d.client_id);
            const valides = new Set<string>(
              (kyc ?? [])
                .filter((k) => k.statut === "valide" || k.statut === "en_attente")
                .map((k) => k.type as string),
            );
            const attendus: { type: string; libelle: string }[] = [
              { type: "cni", libelle: "Pièce d'identité en cours de validité" },
              { type: "justificatif_domicile", libelle: "Justificatif de domicile de moins de 3 mois" },
              { type: "rib", libelle: "RIB" },
            ];
            for (const a of attendus) if (!valides.has(a.type)) manquants.push(a.libelle);

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
              link: appUrl("/espace/mon-espace"),
            },
            idempotency_key: `relance-pieces-${d.id}-${new Date().toISOString().slice(0, 10)}`,
          });

          await supabaseAdmin
            .from("dossiers")
            .update({
              relance_pieces_envoyee_le: new Date().toISOString(),
              ...(accuse ? { accuse_reception_envoye_le: new Date().toISOString() } : {}),
            })
            .eq("id", d.id);

          details.push({ dossier: d.reference, pieces: manquants.length, accuse });
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
