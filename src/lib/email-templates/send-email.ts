import * as React from "react";
import { render } from "@react-email/render";
import { TEMPLATES } from "./registry";

// Server-only: reads BREVO_API_KEY. Never import from client components.

const SITE_NAME = "EJ Partners Assurances";
/** Adresse expéditrice (doit être un expéditeur/domaine vérifié dans Brevo). */
const FROM_EMAIL = "contact@ej-assurances.fr";
const BREVO_API_URL = "https://api.brevo.com/v3";

export type SendTemplateEmailResult =
  | { sent: true }
  | { sent: false; reason: "recipient_suppressed" };

export interface SendTemplateEmailOptions {
  templateData?: Record<string, unknown>;
  /**
   * Variables transmises à Brevo (`params`) avec les noms canoniques en
   * majuscules : PRENOM, LIEN_ACTION, TYPE_ASSURANCE, NOM_COMPAGNIE,
   * NOM_COMPAGNIE_RECOMMANDEE, NOM_PRODUIT, PIECES_MANQUANTES.
   */
  brevoParams?: Record<string, unknown>;
  /** Conservé pour compatibilité des appels existants (dédoublonnage applicatif). */
  idempotencyKey?: string;
  replyTo?: string;
  /** Pièces jointes (contenu encodé en base64). */
  attachments?: { name: string; base64: string }[];
  /**
   * Rattachement de la copie IONOS à la fiche client / au dossier, afin que le
   * message apparaisse dans « Historique des échanges ».
   */
  liens?: {
    client_id?: string | null;
    dossier_id?: string | null;
    contrat_id?: string | null;
    compagnie_id?: string | null;
  };
}

/**
 * Rend un template enregistré et l'envoie directement à l'API Brevo — y compris
 * les quatre courriers d'accompagnement DDA (DER, lettre de mission, devoir de
 * conseil, signature de souscription), dont la traçabilité ACPR est assurée par
 * la copie automatique déposée dans la boîte IONOS du cabinet. La génération des
 * PDF reste inchangée : seul le texte du mail passe par Brevo. Toute erreur
 * d'envoi lève une exception.
 */

export async function sendTemplateEmail(
  templateName: string,
  to: string,
  options: SendTemplateEmailOptions = {},
): Promise<SendTemplateEmailResult> {
  const template = TEMPLATES[templateName];
  if (!template) {
    throw new Error(
      `Template '${templateName}' not found. Available: ${Object.keys(TEMPLATES).join(", ")}`,
    );
  }

  // Template-level `to` takes precedence — notification templates always
  // send to their fixed address.
  const recipient = template.to || to;
  if (!recipient) {
    throw new Error("Recipient is required (the template defines no fixed recipient)");
  }

  const templateData = options.templateData ?? {};
  const element = React.createElement(template.component, templateData);
  const html = await render(element);
  const text = await render(element, { plainText: true });
  const subject =
    typeof template.subject === "function" ? template.subject(templateData) : template.subject;

  const brevoKey = process.env["BREVO_API_KEY"];
  if (!brevoKey) {
    throw new Error("BREVO_API_KEY is not configured");
  }

  const response = await fetch(`${BREVO_API_URL}/smtp/email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": brevoKey,
    },
    body: JSON.stringify({
      sender: { name: SITE_NAME, email: FROM_EMAIL },
      to: [{ email: recipient }],
      subject,
      htmlContent: withHtmlSignature(html),
      textContent: withTextSignature(text),
      ...(options.brevoParams ? { params: options.brevoParams } : {}),
      ...(options.replyTo ? { replyTo: { email: options.replyTo } } : {}),
      ...(options.attachments && options.attachments.length
        ? { attachment: options.attachments.map((a) => ({ name: a.name, content: a.base64 })) }
        : {}),
      tags: [templateName],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    console.error(
      `[email] ECHEC template=${templateName} destinataire=${recipient} status=${response.status} reponse=${body}`,
    );
    throw new Error(`Brevo send failed [${response.status}]: ${body}`);
  }

  let messageId: string | null = null;
  try {
    const payload = (await response.json()) as { messageId?: string };
    messageId = payload.messageId ?? null;
  } catch {
    messageId = null;
  }
  console.log(
    `[email] OK template=${templateName} destinataire=${recipient} messageId=${messageId ?? "n/a"}`,
  );

  // Trace de l'envoi dans la boîte IONOS du cabinet (copie dans « Envoyés »,
  // libellée « Envoyé via Brevo »), puis rattachement de cette copie à la fiche
  // client / au dossier. Aucun échec silencieux : si la copie n'a pas pu être
  // déposée, une tâche admin de vérification est créée.
  let copieId: string | null = null;
  let copieErreur: string | null = null;
  try {
    const { deposerCopieEnvoyee } = await import("@/lib/gmail.server");
    const copie = await deposerCopieEnvoyee({
      to: recipient,
      sujet: subject,
      html: withHtmlSignature(html),
      from: `${SITE_NAME} <${FROM_EMAIL}>`,
      replyTo: options.replyTo ?? null,
      attachments: options.attachments,
    });
    copieId = copie?.id ?? null;
    if (!copieId) copieErreur = "dépôt de la copie refusé par IONOS";
  } catch (e) {
    copieErreur = e instanceof Error ? e.message : "erreur inconnue";
  }

  const liensTrace = { ...(options.liens ?? {}) };
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Certains envois sont déclenchés depuis un dossier ou un contrat, et
    // d'autres ne fournissent pas explicitement de lien CRM. Résoudre d'abord
    // le client depuis les relations connues, puis depuis son adresse email.
    const liens = liensTrace;
    if (!liens.client_id && liens.dossier_id) {
      const { data } = await supabaseAdmin
        .from("dossiers")
        .select("client_id")
        .eq("id", liens.dossier_id)
        .maybeSingle();
      liens.client_id = data?.client_id ?? null;
    }
    if (!liens.client_id && liens.contrat_id) {
      const { data } = await supabaseAdmin
        .from("contrats")
        .select("client_id")
        .eq("id", liens.contrat_id)
        .maybeSingle();
      liens.client_id = data?.client_id ?? null;
    }
    if (!liens.client_id) {
      const adresseExacte = recipient.trim().replace(/[\\%_]/g, "\\$&");
      const recherches = await Promise.all([
        supabaseAdmin.from("clients").select("id").ilike("email", adresseExacte).limit(2),
        supabaseAdmin.from("clients").select("id").ilike("email2", adresseExacte).limit(2),
      ]);
      const clientsTrouves = new Set(
        recherches.flatMap(({ data }) => (data ?? []).map((client) => client.id)),
      );
      if (clientsTrouves.size === 1) {
        liens.client_id = [...clientsTrouves][0];
      } else if (clientsTrouves.size > 1) {
        console.warn(`[email] rattachement Brevo ambigu pour ${recipient}; aucun client choisi`);
      }
    }

    if (copieId) {
      if (
        liens &&
        (liens.client_id || liens.dossier_id || liens.contrat_id || liens.compagnie_id)
      ) {
        const { error } = await supabaseAdmin.from("crm_emails").upsert(
          {
            gmail_message_id: copieId,
            direction: "sortant",
            recu_le: new Date().toISOString(),
            client_id: liens.client_id ?? null,
            dossier_id: liens.dossier_id ?? null,
            contrat_id: liens.contrat_id ?? null,
            compagnie_id: liens.compagnie_id ?? null,
            sujet: subject,
            expediteur_nom: SITE_NAME,
            expediteur_email: FROM_EMAIL,
            notes: `Envoi automatique via Brevo — modèle ${templateName}${messageId ? ` — messageId Brevo ${messageId}` : ""}`,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "gmail_message_id" },
        );
        if (error) throw error;
      }
    } else {
      console.error(`[email] copie IONOS de l’envoi Brevo impossible: ${copieErreur}`);
      const { creerTacheAdmin } = await import("@/lib/agent-taches.server");
      await creerTacheAdmin(supabaseAdmin, {
        titre: `Vérifier la trace IONOS d'un envoi (${templateName})`,
        description:
          `L'e-mail « ${subject} » a bien été envoyé à ${recipient} via Brevo, mais la copie dans la boîte IONOS ` +
          `du cabinet n'a pas pu être déposée (${copieErreur ?? "raison inconnue"}). ` +
          `Vérifier la connexion IONOS et déposer la trace manuellement si nécessaire (exigence ACPR).`,
        client_id: liens.client_id ?? null,
        priorite: "haute",
      });
    }
  } catch (e) {
    console.error("[email] suivi de la copie IONOS impossible:", e);
    if (copieId) {
      try {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { creerTacheAdmin } = await import("@/lib/agent-taches.server");
        await creerTacheAdmin(supabaseAdmin, {
          titre: `Rattacher un email Brevo à la fiche client (${templateName})`,
          description:
            `La copie IONOS existe (${copieId}), mais son rattachement automatique au CRM a échoué. ` +
            `Destinataire : ${recipient}. Objet : ${subject}. Vérifier la fiche client et rattacher l'email.`,
          client_id: liensTrace.client_id ?? null,
          priorite: "haute",
        });
      } catch (tacheErreur) {
        console.error("[email] tâche de rattachement de la copie Brevo impossible:", tacheErreur);
      }
    }
  }

  return { sent: true };
}

/**
 * Signature réglementaire obligatoire, ajoutée automatiquement en pied de
 * TOUS les e-mails sortants du cabinet (mentions ORIAS / ACPR).
 */
const SIGNATURE_LINES = [
  `${SITE_NAME} — Courtier en assurances`,
  `71 Rue du Docteur Roux, 95600 Eaubonne — 01 89 31 40 29 — ${FROM_EMAIL}`,
  "SIRET 500 256 904 — ORIAS n° 25005811 (registre consultable sur www.orias.fr)",
  "Activité soumise au contrôle de l'ACPR — 4 Place de Budapest, CS 92459, 75436 Paris Cedex 09 (acpr.banque-france.fr)",
  "Ce message et ses pièces jointes sont confidentiels et destinés au seul destinataire.",
];

function signatureHtml(): string {
  const lignes = SIGNATURE_LINES.map(
    (l, i) =>
      `<p style="margin:0 0 4px;font-size:11px;line-height:1.5;color:#6b7280;${i === 0 ? "font-weight:600;color:#374151;" : ""}">${l}</p>`,
  ).join("");
  return `<div style="margin-top:28px;padding-top:14px;border-top:1px solid #e5e7eb;font-family:Arial,sans-serif;">${lignes}</div>`;
}

export function withHtmlSignature(html: string): string {
  const signature = signatureHtml();
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${signature}</body>`);
  return `${html}${signature}`;
}

export function withTextSignature(text: string): string {
  return `${text}\n\n---------------------------------------------\n${SIGNATURE_LINES.join("\n")}\n`;
}
