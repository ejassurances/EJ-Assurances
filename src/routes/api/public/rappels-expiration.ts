import { createFileRoute } from "@tanstack/react-router";
import { authorizePublicJob } from "@/lib/public-job-auth";
import { appUrl } from "@/lib/app-url";

/**
 * Rappel automatique d'expiration des pièces justificatives.
 *
 * Parcourt les documents (KYC client + documents de dossier) dont la date de fin
 * de validité arrive à échéance dans moins de 30 jours (ou est déjà dépassée),
 * envoie un e-mail au client pour demander la pièce renouvelée et crée une tâche
 * de suivi pour l'admin.
 *
 * À appeler 1×/jour avec l'en-tête `x-relance-token: <RELANCE_PIECES_TOKEN>`.
 */
export const Route = createFileRoute("/api/public/rappels-expiration")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorizePublicJob(request)) return new Response("Unauthorized", { status: 401 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { sendTemplateEmail } = await import("@/lib/email-templates/send-email");

        const limite = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
        const relanceSeuil = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();

        type Item = { table: "client_kyc_documents" | "documents"; id: string; libelle: string; date: string };
        const parClient = new Map<string, Item[]>();

        const { data: kyc, error: kycErr } = await supabaseAdmin
          .from("client_kyc_documents")
          .select("id,client_id,nom,type,date_expiration,rappel_expiration_envoye_le")
          .not("date_expiration", "is", null)
          .lte("date_expiration", limite)
          .neq("statut", "refuse")
          .limit(500);
        if (kycErr) return Response.json({ error: kycErr.message }, { status: 500 });

        for (const d of kyc ?? []) {
          if (d.rappel_expiration_envoye_le && d.rappel_expiration_envoye_le > relanceSeuil) continue;
          const liste = parClient.get(d.client_id) ?? [];
          liste.push({
            table: "client_kyc_documents",
            id: d.id,
            libelle: d.nom ?? d.type,
            date: d.date_expiration as string,
          });
          parClient.set(d.client_id, liste);
        }

        const { data: docs, error: docErr } = await supabaseAdmin
          .from("documents")
          .select("id,client_id,file_name,categorie,date_expiration,rappel_expiration_envoye_le")
          .not("date_expiration", "is", null)
          .not("client_id", "is", null)
          .lte("date_expiration", limite)
          .limit(500);
        if (docErr) return Response.json({ error: docErr.message }, { status: 500 });

        for (const d of docs ?? []) {
          if (d.rappel_expiration_envoye_le && d.rappel_expiration_envoye_le > relanceSeuil) continue;
          const liste = parClient.get(d.client_id as string) ?? [];
          liste.push({
            table: "documents",
            id: d.id,
            libelle: d.file_name,
            date: d.date_expiration as string,
          });
          parClient.set(d.client_id as string, liste);
        }

        if (parClient.size === 0) return Response.json({ ok: true, clients: 0, envoyes: 0 });

        const { data: admins } = await supabaseAdmin.from("user_roles").select("user_id").eq("role", "admin").limit(1);
        const adminId = admins?.[0]?.user_id ?? null;

        const { data: clients } = await supabaseAdmin
          .from("clients")
          .select("id,prenom,nom,email,commercial_id")
          .in("id", [...parClient.keys()]);

        let envoyes = 0;
        const details: { client: string; documents: number; sent: boolean }[] = [];

        for (const c of clients ?? []) {
          const items = parClient.get(c.id) ?? [];
          if (items.length === 0) continue;
          const nomComplet = `${c.prenom ?? ""} ${c.nom}`.trim();

          let sent = false;
          if (c.email) {
            try {
              const res = await sendTemplateEmail("documents-expiration", c.email, {
                templateData: {
                  clientName: nomComplet,
                  documents: items.map(
                    (i) => `${i.libelle} (valide jusqu'au ${new Date(i.date).toLocaleDateString("fr-FR")})`,
                  ),
                  link: appUrl("/espace/mon-espace"),
                },
                idempotencyKey: `expiration-${c.id}-${new Date().toISOString().slice(0, 10)}`,
              });
              sent = res.sent;
            } catch {
              sent = false;
            }
          }

          await supabaseAdmin.from("taches").insert({
            client_id: c.id,
            titre: `Pièces à renouveler — ${nomComplet}`,
            description: items
              .map((i) => `${i.libelle} : fin de validité le ${new Date(i.date).toLocaleDateString("fr-FR")}`)
              .join("\n"),
            echeance: items.map((i) => i.date).sort()[0],
            priorite: "haute",
            statut: "a_faire",
            assignee_id: c.commercial_id ?? adminId,
          } as never);

          const maintenant = new Date().toISOString();
          const kycIds = items.filter((i) => i.table === "client_kyc_documents").map((i) => i.id);
          const docIds = items.filter((i) => i.table === "documents").map((i) => i.id);
          if (kycIds.length > 0) {
            await supabaseAdmin
              .from("client_kyc_documents")
              .update({ rappel_expiration_envoye_le: maintenant } as never)
              .in("id", kycIds);
          }
          if (docIds.length > 0) {
            await supabaseAdmin
              .from("documents")
              .update({ rappel_expiration_envoye_le: maintenant } as never)
              .in("id", docIds);
          }

          if (sent) envoyes += 1;
          details.push({ client: nomComplet, documents: items.length, sent });
        }

        return Response.json({ ok: true, clients: details.length, envoyes, details });
      },
    },
  },
});
