/**
 * Reprise des réponses suspendues faute de document (statut `attente_document`).
 *
 * Règle du cabinet : quand un client demande un document absent du CRM, l'agent
 * ne répond pas ; il crée une tâche urgente et informe le gestionnaire. Une fois
 * la tâche clôturée (donc le document ajouté), la réponse part automatiquement
 * avec le document en pièce jointe.
 *
 * Traitement borné (lot fixe), idempotent (le statut passe à `envoye` ou
 * `brouillon` dans la même étape) et jamais silencieux (tâche en cas d'échec).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { SupabaseClient } from "@supabase/supabase-js";
import { creerTacheAdmin } from "@/lib/agent-taches.server";
import { TYPE_ATTESTATION } from "@/lib/relation-client.server";

type Admin = SupabaseClient<any, any, any>;

const BUCKET = "dossier-documents";
const CABINET = "EJ Partners Assurances";
const LOT = 10;

type Reponse = {
  id: string;
  client_id: string;
  contrat_id: string | null;
  destinataire: string | null;
  objet: string | null;
  motif: string | null;
  intention: string | null;
};

function idTache(motif: string | null): string | null {
  const trouve = motif?.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return trouve?.[0] ?? null;
}

export async function reprendreDocumentsAttendus(
  admin: Admin,
  userId: string,
): Promise<{ examinees: number; envoyees: number; encore_en_attente: number; erreurs: number }> {
  const { data } = await admin
    .from("client_reponses_ia")
    .select("id, client_id, contrat_id, destinataire, objet, motif, intention")
    .eq("statut", "attente_document")
    .order("created_at", { ascending: true })
    .limit(LOT);
  const reponses = (data as Reponse[] | null) ?? [];

  let envoyees = 0;
  let attente = 0;
  let erreurs = 0;

  for (const reponse of reponses) {
    try {
      const tacheId = idTache(reponse.motif);
      if (tacheId) {
        const { data: tache } = await admin.from("taches").select("statut").eq("id", tacheId).maybeSingle();
        const statut = (tache as { statut: string } | null)?.statut;
        if (statut !== "terminee") {
          attente += 1;
          continue;
        }
      }

      // Le document attendu est aujourd'hui l'attestation d'assurance du contrat.
      const { data: docs } = await admin
        .from("documents")
        .select("file_name, storage_path")
        .eq("contrat_id", reponse.contrat_id ?? "")
        .eq("type_document", TYPE_ATTESTATION)
        .order("created_at", { ascending: false })
        .limit(1);
      const doc = ((docs ?? []) as { file_name: string; storage_path: string }[])[0];
      if (!doc || !reponse.destinataire) {
        attente += 1;
        continue;
      }

      const { data: fichier, error: dlErr } = await admin.storage.from(BUCKET).download(doc.storage_path);
      if (dlErr || !fichier) throw new Error(dlErr?.message ?? "fichier illisible");
      const base64 = Buffer.from(await fichier.arrayBuffer()).toString("base64");

      const { data: clientRow } = await admin
        .from("clients")
        .select("prenom, nom")
        .eq("id", reponse.client_id)
        .maybeSingle();
      const c = (clientRow as { prenom: string | null; nom: string | null } | null) ?? null;
      const nom = [c?.prenom, c?.nom].filter(Boolean).join(" ") || "Madame, Monsieur";

      const { sendTemplateEmail } = await import("@/lib/email-templates/send-email");
      await sendTemplateEmail("relation-client-reponse", reponse.destinataire, {
        templateData: {
          clientName: nom,
          cabinetName: CABINET,
          titre: "Votre document",
          paragraphes: [
            "Vous trouverez en pièce jointe le document que vous nous avez demandé.",
            "Nous vous remercions de votre patience et restons à votre disposition.",
          ],
        },
        attachments: [{ name: doc.file_name, base64 }],
        liens: { client_id: reponse.client_id },
      });

      await admin
        .from("client_reponses_ia")
        .update({
          statut: "envoye",
          corps: `Document envoyé en pièce jointe : ${doc.file_name}`,
          envoye_le: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", reponse.id);

      await admin.from("activites").insert({
        client_id: reponse.client_id,
        type: "email",
        titre: "Document envoyé au client après ajout dans le CRM",
        contenu: `Pièce jointe : ${doc.file_name}`,
      });
      envoyees += 1;
    } catch (e) {
      erreurs += 1;
      await creerTacheAdmin(admin as never, {
        titre: "Envoi du document attendu en échec",
        description: [
          `Réponse suspendue : ${reponse.id}`,
          `Erreur : ${e instanceof Error ? e.message : "erreur inconnue"}`,
          "Action : envoyer le document manuellement au client.",
        ].join("\n"),
        client_id: reponse.client_id,
        priorite: "urgente",
        created_by: userId,
      });
    }
  }

  return { examinees: reponses.length, envoyees, encore_en_attente: attente, erreurs };
}
