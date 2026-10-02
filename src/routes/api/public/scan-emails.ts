import { createFileRoute } from "@tanstack/react-router";
import { authorizePublicJob } from "@/lib/public-job-auth";

/**
 * Traitement des files de travail des agents IA. La boîte de réception générale
 * n'est JAMAIS lue : le staff pose manuellement le premier libellé de service
 * (Service Client, Service Partenaire, Service Achat, Service Commission,
 * Direction Juridique et Conformite, Service Reclamation, Gestion Commerciale). Les agents
 * lisent uniquement les sous-étiquettes « A_Traiter » de ces services, puis
 * font passer chaque mail en « En_Attente_De_Validation » ou « Archive ».
 *
 * Planifié toutes les 20 minutes en heures ouvrées.
 *
 * En-tête attendu : `x-relance-token: <RELANCE_PIECES_TOKEN>` ou
 * `apikey: <clé publiable>`.
 */
export const Route = createFileRoute("/api/public/scan-emails")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorizePublicJob(request)) return new Response("Unauthorized", { status: 401 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Les écritures du CRM sont tracées au nom d'un administrateur (repli
        // documenté sur un mandataire ou le premier compte du projet).
        const { identiteTechnique } = await import("@/lib/agent-taches.server");
        const identite = await identiteTechnique(supabaseAdmin as never);
        if (!identite) {
          console.error("[scan-emails] aucun compte utilisable pour tracer les écritures");
          return Response.json(
            { error: "Aucun compte utilisable : créez un utilisateur du cabinet (rôle admin)." },
            { status: 500 },
          );
        }
        const userId = identite.userId;

        // Corps optionnel : { limite, maxResults } pour rattraper un retard.
        const corps = (await request.json().catch(() => null)) as
          | { limite?: number; maxResults?: number }
          | null;
        const limite = Math.max(1, Math.min(Number(corps?.limite) || 5, 30));
        const maxResults = Math.max(5, Math.min(Number(corps?.maxResults) || 25, 100));

        try {
          const { listerFilesATraiter } = await import("@/lib/gmail.server");
          const { rattacherLot, executerAgents } = await import("@/lib/emails-agents.server");
          const { aiguillerLot } = await import("@/lib/emails-aiguillage.server");

          // Source UNIQUE : les sous-étiquettes « A_Traiter » des services,
          // posées manuellement par le staff. Jamais l'inbox.
          const tous = await listerFilesATraiter({ maxParFile: maxResults });

          // Correction d'aiguillage AVANT tout traitement métier : un mail rangé
          // dans le mauvais service est renvoyé (reformulé) à l'adresse réelle
          // du bon service (sans l'expéditeur), puis retiré du lot de ce passage.
          const aiguillage = await aiguillerLot(supabaseAdmin, {
            messages: tous,
            userId,
            limite: limite * 2,
          });
          const renvoyes = new Set(aiguillage.ids);
          const messages = tous.filter((m) => !renvoyes.has(m.id));
          const ids = messages.map((m) => m.id);

          const suivi = await rattacherLot(supabaseAdmin, { messages, userId });
          const agents = await executerAgents(supabaseAdmin, {
            messages,
            ids,
            userId,
            limite,
          });


          return Response.json({
            ok: true,
            messages: tous.length,
            mal_aiguilles_renvoyes: aiguillage.renvoyes,
            aiguillage_erreurs: aiguillage.erreurs,
            ...suivi,
            ...agents,
          });

        } catch (e) {
          const message = e instanceof Error ? e.message : "erreur inconnue";
          console.error("[scan-emails] échec du tri automatique", e);
          const { creerTacheAdmin } = await import("@/lib/agent-taches.server");
          await creerTacheAdmin(supabaseAdmin as never, {
            titre: "Tri automatique des emails en échec",
            description: [
              `Erreur : ${message}`,
              "",
              "Vérifier la connexion Gmail et les étiquettes du cabinet, puis relancer depuis l'onglet Emails.",
            ].join("\n"),
            priorite: "haute",
            created_by: userId,
          });
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },
  },
});
