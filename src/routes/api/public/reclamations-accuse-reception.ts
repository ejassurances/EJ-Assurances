import { createFileRoute } from "@tanstack/react-router";
import { authorizePublicJob } from "@/lib/public-job-auth";

/**
 * Accusé de réception automatique des réclamations à J+4.
 * Envoi factuel (reçu, en cours de traitement), sans prise de position ni
 * solution : la solution elle-même reste toujours validée par un humain.
 * Envoi uniquement pendant les horaires d'ouverture du cabinet (jours ouvrés,
 * 9h-18h heure de Paris) : hors créneau, le job reporte au passage suivant.
 */

const CABINET = "EJ Partners Assurances";

function dansHorairesOuverture(): boolean {
  const paris = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Paris" }));
  const jour = paris.getDay();
  const heure = paris.getHours();
  return jour >= 1 && jour <= 5 && heure >= 9 && heure < 18;
}

export const Route = createFileRoute("/api/public/reclamations-accuse-reception")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorizePublicJob(request)) return new Response("Unauthorized", { status: 401 });

        if (!dansHorairesOuverture()) return Response.json({ ok: true, reporte: true, envois: 0 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { sendTemplateEmail } = await import("@/lib/email-templates/send-email");

        const seuil = new Date(Date.now() - 4 * 24 * 3600 * 1000).toISOString();
        const { data, error } = await supabaseAdmin
          .from("reclamations")
          .select("id, client_id, resume, statut, date_ouverture, clients(nom, prenom, email)")
          .is("date_accuse_reception", null)
          .neq("statut", "clos")
          .lte("date_ouverture", seuil)
          .limit(200);
        if (error) return Response.json({ error: error.message }, { status: 500 });

        let envois = 0;
        for (const r of (data ?? []) as any[]) {
          const email: string | null = r.clients?.email ?? null;
          if (!email) continue;
          const nom = [r.clients?.prenom, r.clients?.nom].filter(Boolean).join(" ") || "Madame, Monsieur";
          try {
            await sendTemplateEmail("relation-client-reponse", email, {
              templateData: {
                clientName: nom,
                cabinetName: CABINET,
                titre: "Accusé de réception de votre réclamation",
                paragraphes: [
                  "Nous accusons réception de votre réclamation.",
                  "Elle est en cours de traitement par notre service dédié. Ce message est un accusé de réception : il ne contient aucune position ni réponse sur le fond de votre demande.",
                  `L'équipe ${CABINET}`,
                ],
              },
            });
          } catch (e) {
            console.error("[reclamations] accusé de réception non envoyé", e);
            continue;
          }

          const maintenant = new Date().toISOString();
          await supabaseAdmin
            .from("reclamations")
            .update({
              date_accuse_reception: maintenant,
              statut: "accuse_reception_envoye",
              updated_at: maintenant,
            } as never)
            .eq("id", r.id);
          await supabaseAdmin.from("activites").insert({
            client_id: r.client_id,
            type: "email",
            titre: "Accusé de réception de réclamation envoyé au client",
            contenu: `Réclamation : ${r.resume ?? "—"}\nDestinataire : ${email}`,
          } as never);
          envois += 1;
        }

        return Response.json({ ok: true, reclamations: (data ?? []).length, envois });
      },
    },
  },
});
