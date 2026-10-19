import { connect } from "cloudflare:sockets";
import {
  ImapFlow,
  createSocketsTransport,
  type FetchMessageObject,
  type MailboxObject,
  type SearchObject,
} from "imapflow";
import PostalMime from "postal-mime";
import {
  ARCHIVE,
  A_VALIDER,
  COUPLES_LABELS,
  LABELS_CABINET,
  LABELS_ETATS,
  type LabelCabinet,
} from "@/lib/gmail-labels";
import { LABELS_TRIAGE_INBOX, lienGmailBrouillon, lienGmailMessage } from "@/lib/gmail-inbox";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { withPendingSchema } from "@/lib/pending-schema-client";

/**
 * Boîte de messagerie IONOS du CRM. IMAP/SMTP uniquement, côté serveur.
 * Les étiquettes métier sont stockées dans crm_email_labels, car IMAP ne
 * fournit pas l'équivalent multi-étiquettes de Gmail.
 */

const PREFIXE_ID = "ionos:";
const PREFIXE_UID = "ionosuid:";
const EMAIL_HEADERS = [
  "from",
  "to",
  "cc",
  "subject",
  "date",
  "message-id",
  "in-reply-to",
  "references",
];
const BASE_URL_WEBMAIL = "https://mail.ionos.fr/";
const db = withPendingSchema(supabaseAdmin);

type IdentifiantMessage = { messageId?: string; path?: string; uidValidity?: string; uid?: number };
type EtiquetteRow = { message_id: string; label: string };
type MailboxMessage = FetchMessageObject & {
  mailboxPath: string;
  mailboxSpecialUse?: string;
  uidValidity: bigint;
};

function configuration() {
  const email = process.env["IONOS_EMAIL_ADDRESS"]?.trim();
  const password = process.env["IONOS_EMAIL_PASSWORD"];
  const absents = [!email && "IONOS_EMAIL_ADDRESS", !password && "IONOS_EMAIL_PASSWORD"].filter(
    Boolean,
  );
  if (absents.length) throw new Error(`Configuration IONOS manquante : ${absents.join(", ")}`);
  return {
    email: email!,
    password: password!,
    imapHost: process.env["IONOS_IMAP_HOST"]?.trim() || "imap.ionos.fr",
    smtpHost: process.env["IONOS_SMTP_HOST"]?.trim() || "smtp.ionos.fr",
  };
}

async function avecImap<T>(action: (client: ImapFlow) => Promise<T>): Promise<T> {
  const cfg = configuration();
  const client = new ImapFlow({
    host: cfg.imapHost,
    port: 993,
    secure: true,
    auth: { user: cfg.email, pass: cfg.password },
    transport: createSocketsTransport(connect),
    logger: false,
    disableAutoIdle: true,
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  await client.connect();
  try {
    return await action(client);
  } finally {
    await client.logout().catch(() => client.close());
  }
}

function encoderBase64Url(texte: string): string {
  const bytes = new TextEncoder().encode(texte);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decoderBase64Url(texte: string): string {
  const normalized = texte.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function nettoyerMessageId(value: string | null | undefined): string | null {
  const ids = value?.match(/<[^<>\s]+>/g);
  return ids?.[ids.length - 1] ?? (value?.trim() || null);
}

function idMessage(
  messageId: string | null | undefined,
  path?: string,
  uidValidity?: bigint,
  uid?: number,
): string {
  if (messageId) return `${PREFIXE_ID}${encoderBase64Url(messageId.trim())}`;
  if (!path || uidValidity === undefined || uid === undefined)
    throw new Error("Message IONOS sans Message-ID et sans localisateur IMAP.");
  return `${PREFIXE_UID}${encoderBase64Url(JSON.stringify({ path, uidValidity: String(uidValidity), uid }))}`;
}

function decoderId(id: string): IdentifiantMessage {
  try {
    if (id.startsWith(PREFIXE_ID))
      return { messageId: decoderBase64Url(id.slice(PREFIXE_ID.length)) };
    if (id.startsWith(PREFIXE_UID))
      return JSON.parse(decoderBase64Url(id.slice(PREFIXE_UID.length))) as IdentifiantMessage;
  } catch {
    // The error below avoids exposing mailbox credentials or protocol details.
  }
  throw new Error("Identifiant de message IONOS invalide ou ancien identifiant Gmail.");
}

function entetesTexte(message: FetchMessageObject): string {
  return message.headers ? new TextDecoder().decode(message.headers) : "";
}

function lireEntete(headers: string, name: string): string {
  const unfolded = headers.replace(/\r?\n[ \t]+/g, " ");
  const match = unfolded.match(new RegExp(`^${name}:\\s*(.*)$`, "im"));
  return match?.[1]?.trim() ?? "";
}

function parseFrom(value: string): { nom: string | null; email: string | null } {
  const match = value.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (match)
    return { nom: match[1]?.replace(/^"|"$/g, "") || null, email: match[2]!.toLowerCase() };
  const trimmed = value.trim();
  return { nom: null, email: trimmed ? trimmed.toLowerCase() : null };
}

export { parseFrom };

export interface EmailResume {
  id: string;
  thread_id: string;
  sujet: string;
  expediteur_nom: string | null;
  expediteur_email: string | null;
  destinataires: string;
  snippet: string;
  date: string | null;
  non_lu: boolean;
  etiquettes: string[];
}

export interface EmailDetail extends EmailResume {
  cc: string;
  texte: string | null;
  html: string | null;
  pieces_jointes: {
    nom: string;
    taille: number | null;
    mime: string | null;
    attachment_id: string | null;
  }[];
}

const LABELS_SYSTEME = /^(INBOX|SENT|DRAFT|SPAM|TRASH|UNREAD|STARRED|IMPORTANT|CATEGORY_.*|CHAT)$/;
const addressText = (addresses?: { name?: string; address?: string }[]) =>
  (addresses ?? [])
    .map((a) =>
      a.name ? `"${a.name.replace(/"/g, '\\"')}" <${a.address ?? ""}>` : (a.address ?? ""),
    )
    .filter(Boolean)
    .join(", ");

async function etiquettesParId(ids: string[]): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (!ids.length) return result;
  const { data, error } = await db
    .from("crm_email_labels")
    .select("message_id, label")
    .in("message_id", ids);
  if (error) throw new Error(`Étiquettes CRM illisibles : ${error.message}`);
  for (const row of (data ?? []) as EtiquetteRow[]) {
    const labels = result.get(row.message_id) ?? [];
    labels.push(row.label);
    result.set(row.message_id, labels);
  }
  return result;
}

function resume(message: MailboxMessage, labels: string[] = []): EmailResume {
  const headers = entetesTexte(message);
  const rawMessageId = nettoyerMessageId(
    message.envelope?.messageId ?? lireEntete(headers, "Message-ID"),
  );
  const id = idMessage(rawMessageId, message.mailboxPath, message.uidValidity, message.uid);
  const refs = lireEntete(headers, "References");
  const inReplyTo = nettoyerMessageId(
    message.envelope?.inReplyTo ?? lireEntete(headers, "In-Reply-To"),
  );
  const rootId = refs.match(/<[^<>\s]+>/)?.[0] ?? inReplyTo ?? rawMessageId;
  const from = message.envelope?.from?.[0];
  const ownAddress = process.env["IONOS_EMAIL_ADDRESS"]?.trim().toLowerCase();
  const fromEmail = from?.address?.toLowerCase() ?? null;
  const flags = [...(message.flags ?? [])].map((f) => f.toUpperCase());
  const systemLabels: string[] = [];
  if (flags.includes("\\DRAFT") || message.mailboxSpecialUse?.toLowerCase() === "\\drafts")
    systemLabels.push("DRAFT");
  if (
    message.mailboxSpecialUse?.toLowerCase() === "\\sent" ||
    (!!ownAddress && fromEmail === ownAddress)
  )
    systemLabels.push("SENT");
  return {
    id,
    thread_id: rootId ? idMessage(rootId) : id,
    sujet: message.envelope?.subject || "(sans objet)",
    expediteur_nom: from?.name || null,
    expediteur_email: fromEmail,
    destinataires: addressText(message.envelope?.to),
    snippet: "",
    date: dateIso(message.internalDate ?? message.envelope?.date),
    non_lu: !flags.includes("\\SEEN"),
    etiquettes: [
      ...new Set([
        ...labels.filter((label) => !LABELS_SYSTEME.test(label.toUpperCase())),
        ...systemLabels,
      ]),
    ],
  };
}

function dateIso(value: Date | string | undefined): string | null {
  if (!value) return null;
  const ts = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(ts) ? new Date(ts).toISOString() : null;
}

async function boites(client: ImapFlow): Promise<MailboxObject[]> {
  return (await client.list()).filter(
    (mailbox) => ![...mailbox.flags].some((flag) => flag.toLowerCase() === "\\noselect"),
  );
}

function boiteSpeciale(
  mailboxes: MailboxObject[],
  specialUse: string,
  fallbackNames: string[],
): MailboxObject | undefined {
  const wanted = specialUse.toLowerCase();
  return (
    mailboxes.find((m) => m.specialUse?.toLowerCase() === wanted) ??
    mailboxes.find((m) =>
      fallbackNames.some((name) => m.name.toLowerCase() === name || m.path.toLowerCase() === name),
    )
  );
}

function boiteInbox(mailboxes: MailboxObject[]): MailboxObject {
  const inbox = boiteSpeciale(mailboxes, "\\inbox", ["inbox"]);
  if (!inbox) throw new Error("Boîte de réception IONOS introuvable.");
  return inbox;
}

function critereMessageIds(ids: string[]): SearchObject {
  const criteria = ids.map((id) => ({ header: { "Message-ID": id } }) satisfies SearchObject);
  if (criteria.length === 1) return criteria[0]!;
  return { or: [criteria[0]!, critereMessageIds(criteria.slice(1))] };
}

const queryMetadata = {
  envelope: true,
  flags: true,
  internalDate: true,
  uid: true,
  headers: EMAIL_HEADERS,
} as const;

async function fetchIds(client: ImapFlow, ids: string[]): Promise<MailboxMessage[]> {
  const parsed = ids.map((id) => ({ id, decoded: decoderId(id) }));
  const byId = new Map<string, MailboxMessage>();
  const mailboxes = await boites(client);
  for (const item of parsed) {
    if (
      !item.decoded.messageId &&
      item.decoded.path &&
      item.decoded.uid &&
      item.decoded.uidValidity
    ) {
      try {
        await client.mailboxOpen(item.decoded.path, { readOnly: true });
        if (String(client.mailbox?.uidValidity) === item.decoded.uidValidity) {
          const found = await client.fetchOne(
            item.decoded.uid,
            { ...queryMetadata },
            { uid: true },
          );
          if (found)
            byId.set(item.id, {
              ...found,
              mailboxPath: item.decoded.path,
              mailboxSpecialUse: mailboxes.find((m) => m.path === item.decoded.path)?.specialUse,
              uidValidity: uidValidityCourant(client),
            });
        }
      } catch {
        // A UID without a Message-ID is only usable in its original mailbox version.
      }
    }
  }

  const targets = parsed.filter((item) => item.decoded.messageId && !byId.has(item.id));
  const idByRaw = new Map(targets.map((item) => [item.decoded.messageId!, item.id] as const));
  if (targets.length) {
    const batches: string[][] = [];
    for (let i = 0; i < targets.length; i += 15)
      batches.push(targets.slice(i, i + 15).map((item) => item.decoded.messageId!));
    for (const mailbox of mailboxes) {
      if (targets.every((item) => byId.has(item.id))) break;
      try {
        await client.mailboxOpen(mailbox.path, { readOnly: true });
        for (const batch of batches) {
          const remaining = batch.filter((raw) => !byId.has(idByRaw.get(raw)!));
          if (!remaining.length) continue;
          const uids = await client.search(critereMessageIds(remaining), { uid: true });
          if (!Array.isArray(uids) || !uids.length) continue;
          const fetched = await client.fetchAll(uids, queryMetadata, { uid: true });
          for (const message of fetched) {
            const raw = nettoyerMessageId(
              message.envelope?.messageId ?? lireEntete(entetesTexte(message), "Message-ID"),
            );
            const targetId = raw ? idByRaw.get(raw) : undefined;
            if (!targetId) continue;
            const candidate = {
              ...message,
              mailboxPath: mailbox.path,
              mailboxSpecialUse: mailbox.specialUse,
              uidValidity: uidValidityCourant(client),
            };
            const existing = byId.get(targetId);
            if (!existing || dateNumber(candidate.internalDate) > dateNumber(existing.internalDate))
              byId.set(targetId, candidate);
          }
        }
      } catch (error) {
        console.warn(
          `[ionos] Recherche impossible dans la boîte ${mailbox.path}:`,
          error instanceof Error ? error.message : error,
        );
      }
    }
  }
  return [...byId.values()];
}

function dateNumber(value: Date | string | undefined): number {
  if (!value) return 0;
  return value instanceof Date ? value.getTime() : Date.parse(value) || 0;
}

function uidValidityCourant(client: ImapFlow): bigint {
  return client.mailbox?.uidValidity ?? 0n;
}

async function resumePourIds(client: ImapFlow, ids: string[]): Promise<EmailResume[]> {
  const labels = await etiquettesParId(ids);
  const messages = await fetchIds(client, ids);
  return messages.map((message) => {
    const email = resume(
      message,
      labels.get(
        idMessage(
          nettoyerMessageId(
            message.envelope?.messageId ?? lireEntete(entetesTexte(message), "Message-ID"),
          ),
          message.mailboxPath,
          message.uidValidity,
          message.uid,
        ),
      ) ?? [],
    );
    return email;
  });
}

async function listeInbox(params: {
  recherche?: string | null;
  pageToken?: string | null;
  maxResults?: number;
}): Promise<{ messages: EmailResume[]; nextPageToken: string | null }> {
  const limit = Math.max(1, Math.min(params.maxResults ?? 25, 100));
  const offset = params.pageToken ? Number.parseInt(params.pageToken, 10) : 0;
  if (!Number.isSafeInteger(offset) || offset < 0)
    throw new Error("Jeton de pagination IONOS invalide.");
  return avecImap(async (client) => {
    const mailbox = boiteInbox(await boites(client));
    await client.mailboxOpen(mailbox.path, { readOnly: true });
    let uids: number[];
    let total: number;
    const search = params.recherche?.trim();
    if (search) {
      const found = await client.search({ text: search }, { uid: true });
      uids = Array.isArray(found) ? found.sort((a, b) => b - a) : [];
      total = uids.length;
      uids = uids.slice(offset, offset + limit);
    } else {
      total = client.mailbox?.exists ?? 0;
      const end = total - offset;
      const start = Math.max(1, end - limit + 1);
      uids =
        end >= start
          ? await client
              .fetchAll(`${start}:${end}`, { uid: true }, { uid: false })
              .then((rows) => rows.map((row) => row.uid).reverse())
          : [];
    }
    const fetched = uids.length ? await client.fetchAll(uids, queryMetadata, { uid: true }) : [];
    const rawIds = fetched.map((message) =>
      idMessage(
        nettoyerMessageId(
          message.envelope?.messageId ?? lireEntete(entetesTexte(message), "Message-ID"),
        ),
        mailbox.path,
        uidValidityCourant(client),
        message.uid,
      ),
    );
    const labels = await etiquettesParId(rawIds);
    const messages = fetched.map((message) => {
      const key = idMessage(
        nettoyerMessageId(
          message.envelope?.messageId ?? lireEntete(entetesTexte(message), "Message-ID"),
        ),
        mailbox.path,
        uidValidityCourant(client),
        message.uid,
      );
      return resume(
        {
          ...message,
          mailboxPath: mailbox.path,
          mailboxSpecialUse: mailbox.specialUse,
          uidValidity: uidValidityCourant(client),
        },
        labels.get(key) ?? [],
      );
    });
    const prochain = offset + messages.length;
    return { messages, nextPageToken: prochain < total ? String(prochain) : null };
  });
}

/** Boîte IONOS (il n'existe pas d'onglet Gmail « Principal » sur IMAP). */
export const REQUETE_BOITE_PRINCIPALE = "IONOS:INBOX";
export const REQUETE_INBOX_PRINCIPALE_STRICTE = "IONOS:INBOX";

export async function listerBoitePrincipale(params: {
  recherche?: string | null;
  pageToken?: string | null;
  maxResults?: number;
}) {
  return listeInbox(params);
}

export async function listerInboxPrincipale(params?: {
  maxResults?: number;
  pageToken?: string | null;
}) {
  return listeInbox({ maxResults: params?.maxResults, pageToken: params?.pageToken });
}

export const LABEL_PARENT_RATTRAPAGE = "Direction Commerciale";

export async function listerParLabel(nom: string, maxResults = 100): Promise<EmailResume[]> {
  const { data, error } = await db
    .from("crm_email_labels")
    .select("message_id")
    .eq("label", nom)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(maxResults, 1), 200));
  if (error) throw new Error(`Lecture de la file « ${nom} » impossible : ${error.message}`);
  const ids = [...new Set((data ?? []).map((row) => row.message_id))];
  if (!ids.length) return [];
  return avecImap((client) => resumePourIds(client, ids));
}

export async function listerRattrapage(_params?: { maxResults?: number }): Promise<EmailResume[]> {
  return listerParLabel(LABEL_PARENT_RATTRAPAGE);
}

export async function retirerLabelRattrapage(id: string): Promise<void> {
  await retirerEtiquettes(id, [LABEL_PARENT_RATTRAPAGE]);
}

export async function lireMessage(id: string): Promise<EmailDetail> {
  return avecImap(async (client) => {
    const found = await fetchIds(client, [id]);
    const meta = found[0];
    if (!meta) throw new Error("Message introuvable dans les boîtes IONOS.");
    await client.mailboxOpen(meta.mailboxPath, { readOnly: true });
    const full = await client.fetchOne(
      meta.uid,
      { uid: true, source: true, flags: true, internalDate: true, envelope: true },
      { uid: true },
    );
    if (!full?.source) throw new Error("Contenu du message indisponible dans IONOS.");
    const parsed = await PostalMime.parse(new Uint8Array(full.source), {
      attachmentEncoding: "base64",
    });
    const labels = await etiquettesParId([id]);
    const fullMessage: MailboxMessage = {
      ...meta,
      ...full,
      mailboxPath: meta.mailboxPath,
      mailboxSpecialUse: meta.mailboxSpecialUse,
      uidValidity: meta.uidValidity,
    };
    const summary = resume(fullMessage, labels.get(id) ?? []);
    const pieces = parsed.attachments
      .map((attachment, index) => ({ attachment, index }))
      .filter(({ attachment }) => !!attachment.filename)
      .map(({ attachment, index }) => ({
        nom: attachment.filename ?? `piece-${index + 1}`,
        taille:
          typeof attachment.content === "string"
            ? Math.floor(attachment.content.length * 0.75)
            : attachment.content.byteLength,
        mime: attachment.mimeType || null,
        attachment_id: String(index),
      }));
    return {
      ...summary,
      cc: addressText(
        parsed.cc
          ?.flatMap((address) => ("group" in address && address.group ? address.group : [address]))
          .map((address) => ({ name: address.name, address: address.address })),
      ),
      texte: typeof parsed.text === "string" ? parsed.text : null,
      html: typeof parsed.html === "string" ? parsed.html : null,
      pieces_jointes: pieces,
    };
  });
}

async function messagesDuFil(client: ImapFlow, rootMessageId: string): Promise<MailboxMessage[]> {
  const criteria: SearchObject = {
    or: [
      { header: { "Message-ID": rootMessageId } },
      {
        or: [
          { header: { "In-Reply-To": rootMessageId } },
          { header: { References: rootMessageId } },
        ],
      },
    ],
  };
  const result: MailboxMessage[] = [];
  for (const mailbox of await boites(client)) {
    try {
      await client.mailboxOpen(mailbox.path, { readOnly: true });
      const uids = await client.search(criteria, { uid: true });
      if (!Array.isArray(uids) || !uids.length) continue;
      const rows = await client.fetchAll(uids, queryMetadata, { uid: true });
      result.push(
        ...rows.map((row) => ({
          ...row,
          mailboxPath: mailbox.path,
          mailboxSpecialUse: mailbox.specialUse,
          uidValidity: uidValidityCourant(client),
        })),
      );
    } catch (error) {
      console.warn(
        `[ionos] Lecture du fil impossible dans ${mailbox.path}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }
  const uniques = new Map<string, MailboxMessage>();
  for (const message of result) {
    const messageId = nettoyerMessageId(
      message.envelope?.messageId ?? lireEntete(entetesTexte(message), "Message-ID"),
    );
    if (!messageId) continue;
    const existing = uniques.get(messageId);
    if (!existing || dateNumber(message.internalDate) > dateNumber(existing.internalDate))
      uniques.set(messageId, message);
  }
  return [...uniques.values()];
}

export async function reponseCabinetPosterieure(
  threadId: string | null | undefined,
  messageClientId: string | null | undefined,
): Promise<boolean> {
  if (!threadId) return false;
  try {
    const rootMessageId = decoderId(threadId).messageId;
    if (!rootMessageId) return true;
    const cfg = configuration();
    return await avecImap(async (client) => {
      const thread = await messagesDuFil(client, rootMessageId);
      const refMessageId = messageClientId ? decoderId(messageClientId).messageId : rootMessageId;
      const reference = thread.find(
        (m) =>
          nettoyerMessageId(m.envelope?.messageId ?? lireEntete(entetesTexte(m), "Message-ID")) ===
          refMessageId,
      );
      if (!reference) return true;
      const dateReference = dateNumber(reference.internalDate);
      const { estEmailInterne } = await import("@/lib/domaines-internes");
      return thread.some((message) => {
        if (message === reference || dateNumber(message.internalDate) <= dateReference)
          return false;
        if ([...(message.flags ?? [])].some((flag) => flag.toUpperCase() === "\\DRAFT"))
          return false;
        const from = message.envelope?.from?.[0]?.address?.toLowerCase();
        return (
          message.mailboxSpecialUse?.toLowerCase() === "\\sent" ||
          (!!from && (from === cfg.email.toLowerCase() || estEmailInterne(from)))
        );
      });
    });
  } catch (error) {
    console.error(
      "[ionos] Vérification du fil impossible — envoi automatique bloqué par prudence",
      error instanceof Error ? error.message : error,
    );
    return true;
  }
}

function encoderBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)),
    );
  }
  return btoa(binary);
}

export async function telechargerPieceJointe(
  messageId: string,
  attachmentId: string,
): Promise<{ base64: string; taille: number }> {
  const index = Number.parseInt(attachmentId, 10);
  const source = await avecImap(async (client) => {
    const found = await fetchIds(client, [messageId]);
    if (!found[0]) throw new Error("Message introuvable dans les boîtes IONOS.");
    await client.mailboxOpen(found[0].mailboxPath, { readOnly: true });
    const message = await client.fetchOne(found[0].uid, { uid: true, source: true }, { uid: true });
    if (!message?.source) throw new Error("Pièce jointe indisponible dans IONOS.");
    return new Uint8Array(message.source);
  });
  const parsed = await PostalMime.parse(source, { attachmentEncoding: "base64" });
  const attachment = parsed.attachments[index];
  if (!attachment) throw new Error("Pièce jointe introuvable dans le message IONOS.");
  if (typeof attachment.content === "string") {
    const base64 =
      attachment.encoding === "base64"
        ? attachment.content
        : encoderBase64(new TextEncoder().encode(attachment.content));
    return { base64, taille: attachment.content.length };
  }
  return {
    base64: encoderBase64(new Uint8Array(attachment.content)),
    taille: attachment.content.byteLength,
  };
}

function encodeSujet(sujet: string): string {
  return /^[\x20-\x7E]*$/.test(sujet)
    ? sujet
    : `=?UTF-8?B?${encoderBase64(new TextEncoder().encode(sujet))}?=`;
}

function base64Lignes(value: string): string {
  const bytes = new TextEncoder().encode(value);
  const encoded = encoderBase64(bytes);
  return encoded.match(/.{1,76}/g)?.join("\r\n") ?? "";
}

function creerMessageMime(params: {
  to: string;
  cc?: string | null;
  sujet: string;
  html: string;
  from: string;
  replyTo?: string | null;
  inReplyTo?: string | null;
  references?: string | null;
  attachments?: { name: string; base64: string; mime?: string }[];
  messageId?: string;
  date?: Date;
  marqueur?: string;
}): { raw: string; messageId: string } {
  const date = params.date ?? new Date();
  const domain = params.from.match(/@([^\s>]+)/)?.[1] ?? "ej-assurances.fr";
  const messageId = params.messageId ?? `<${crypto.randomUUID()}@${domain}>`;
  const headerValue = (value: string) => {
    if (/[\r\n]/.test(value)) throw new Error("En-tête e-mail invalide.");
    return value;
  };
  const headers = [
    `From: ${headerValue(params.from)}`,
    `To: ${headerValue(params.to)}`,
    ...(params.cc ? [`Cc: ${headerValue(params.cc)}`] : []),
    ...(params.replyTo ? [`Reply-To: ${headerValue(params.replyTo)}`] : []),
    `Subject: ${encodeSujet(headerValue(params.sujet))}`,
    `Date: ${date.toUTCString()}`,
    `Message-ID: ${messageId}`,
    ...(params.inReplyTo ? [`In-Reply-To: ${headerValue(params.inReplyTo)}`] : []),
    ...(params.references ? [`References: ${headerValue(params.references)}`] : []),
    ...(params.marqueur ? [`X-EJP-Envoi: ${headerValue(params.marqueur)}`] : []),
    "MIME-Version: 1.0",
  ];
  const htmlPart = [
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Lignes(params.html),
  ];
  let body: string[];
  if (params.attachments?.length) {
    const boundary = `ejp_${crypto.randomUUID().replace(/-/g, "")}`;
    body = [
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      ...htmlPart,
      ...params.attachments.flatMap((attachment) => {
        const filename = attachment.name.replace(/[\r\n"\\]/g, "_");
        const mime = (attachment.mime ?? "application/octet-stream").replace(/[\r\n]/g, "");
        const normalizedBase64 = attachment.base64.replace(/\s/g, "");
        return [
          `--${boundary}`,
          `Content-Type: ${mime}; name="${filename.replace(/[^\x20-\x7E]/g, "_")}"`,
          "Content-Transfer-Encoding: base64",
          `Content-Disposition: attachment; filename="${filename.replace(/[^\x20-\x7E]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
          "",
          ...(normalizedBase64.match(/.{1,76}/g) ?? []),
        ];
      }),
      `--${boundary}--`,
      "",
    ];
  } else {
    body = htmlPart;
  }
  return { raw: `${headers.join("\r\n")}\r\n${body.join("\r\n")}`, messageId };
}

function adressesEnvelope(value: string): string[] {
  return [
    ...new Set(
      value.match(
        /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?)+/gi,
      ) ?? [],
    ),
  ];
}

function base64Utf8(value: string): string {
  return encoderBase64(new TextEncoder().encode(value));
}

async function envoyerSmtp(raw: string, from: string, recipients: string[]): Promise<void> {
  const cfg = configuration();
  const fromAddress = adressesEnvelope(from)[0] ?? cfg.email;
  if (!recipients.length) throw new Error("Aucun destinataire e-mail valide.");
  const socket = connect({ hostname: cfg.smtpHost, port: 465 }, { secureTransport: "on" });
  await socket.opened;
  const reader = socket.readable.getReader();
  const writer = socket.writable.getWriter();
  const decoder = new TextDecoder();
  let pending = "";

  const readResponse = async (): Promise<{ code: number; lines: string[] }> => {
    const lines: string[] = [];
    while (true) {
      let end = pending.indexOf("\r\n");
      while (end < 0) {
        const result = await new Promise<ReadableStreamReadResult<Uint8Array>>(
          (resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("Délai SMTP dépassé.")), 15_000);
            reader.read().then(
              (value) => {
                clearTimeout(timer);
                resolve(value);
              },
              (error: unknown) => {
                clearTimeout(timer);
                reject(error);
              },
            );
          },
        );
        if (result.done) throw new Error("Connexion SMTP interrompue.");
        pending += decoder.decode(result.value, { stream: true });
        end = pending.indexOf("\r\n");
      }
      const line = pending.slice(0, end);
      pending = pending.slice(end + 2);
      lines.push(line);
      if (/^\d{3} /.test(line)) return { code: Number(line.slice(0, 3)), lines };
    }
  };
  const command = async (value: string, accepted: number[]) => {
    await writer.write(new TextEncoder().encode(`${value}\r\n`));
    const response = await readResponse();
    if (!accepted.includes(response.code))
      throw new Error(
        `Commande SMTP refusée (${response.code}) : ${response.lines.at(-1)?.slice(4, 180) ?? "erreur serveur"}`,
      );
    return response;
  };

  try {
    const greeting = await readResponse();
    if (greeting.code !== 220) throw new Error(`Connexion SMTP refusée (${greeting.code}).`);
    await command("EHLO crm.ej-assurances.fr", [250]);
    await command("AUTH LOGIN", [334]);
    await command(base64Utf8(cfg.email), [334]);
    await command(base64Utf8(cfg.password), [235]);
    await command(`MAIL FROM:<${fromAddress}>`, [250]);
    for (const recipient of recipients) await command(`RCPT TO:<${recipient}>`, [250, 251]);
    await command("DATA", [354]);
    const normalized = raw.replace(/\r?\n/g, "\r\n").replace(/(^|\r\n)\./g, "$1..");
    await writer.write(new TextEncoder().encode(`${normalized.replace(/\r?\n*$/, "")}\r\n.\r\n`));
    const delivered = await readResponse();
    if (delivered.code !== 250) throw new Error(`Envoi SMTP refusé (${delivered.code}).`);
    await command("QUIT", [221]).catch(() => undefined);
  } finally {
    reader.releaseLock();
    writer.releaseLock();
    await socket.close().catch(() => undefined);
  }
}

async function ajouterEtiquettes(id: string, labels: string[]): Promise<void> {
  const rows = [...new Set(labels)].map((label) => ({ message_id: id, label }));
  if (!rows.length) return;
  const { error } = await db
    .from("crm_email_labels")
    .upsert(rows, { onConflict: "message_id,label", ignoreDuplicates: true });
  if (error) throw new Error(`Étiquettes CRM non enregistrées : ${error.message}`);
}

async function retirerEtiquettes(id: string, labels: string[]): Promise<void> {
  if (!labels.length) return;
  const { error } = await db
    .from("crm_email_labels")
    .delete()
    .eq("message_id", id)
    .in("label", labels);
  if (error) throw new Error(`Étiquettes CRM non retirées : ${error.message}`);
}

export const LABEL_COPIE_BREVO = "Envoyé via Brevo";
export { LABELS_CABINET, type LabelCabinet };

export async function envoyerMessage(params: {
  to: string;
  cc?: string | null;
  sujet: string;
  html: string;
  threadId?: string | null;
  from?: string | null;
  replyTo?: string | null;
  attachments?: { name: string; base64: string; mime?: string }[];
}): Promise<{ id: string; threadId: string }> {
  const cfg = configuration();
  let parent: MailboxMessage | undefined;
  let rootMessageId: string | null = null;
  if (params.threadId) {
    rootMessageId = decoderId(params.threadId).messageId ?? null;
    if (rootMessageId)
      parent = await avecImap(
        async (client) =>
          (await messagesDuFil(client, rootMessageId!)).sort(
            (a, b) => dateNumber(b.internalDate) - dateNumber(a.internalDate),
          )[0],
      );
  }
  const parentId = parent
    ? nettoyerMessageId(
        parent.envelope?.messageId ?? lireEntete(entetesTexte(parent), "Message-ID"),
      )
    : rootMessageId;
  const parentHeaders = parent ? entetesTexte(parent) : "";
  const referenceChain = lireEntete(parentHeaders, "References");
  const references = [
    ...new Set([...(referenceChain.match(/<[^<>\s]+>/g) ?? []), ...(parentId ? [parentId] : [])]),
  ].join(" ");
  const from = params.from?.trim() || cfg.email;
  const message = creerMessageMime({
    ...params,
    from,
    inReplyTo: parentId,
    references: references || null,
  });
  const recipients = [
    ...new Set([...adressesEnvelope(params.to), ...adressesEnvelope(params.cc ?? "")]),
  ];
  await envoyerSmtp(message.raw, from, recipients);

  const id = idMessage(message.messageId);
  try {
    await avecImap(async (client) => {
      const sent = await assurerBoite(client, "sent");
      await client.append(sent.path, message.raw, ["\\Seen"]);
    });
  } catch (error) {
    console.error(
      "[ionos] Envoi accepté, copie non archivée dans Envoyés:",
      error instanceof Error ? error.message : error,
    );
  }
  return { id, threadId: params.threadId ? idMessage(rootMessageId) : id };
}

export async function deposerCopieEnvoyee(params: {
  to: string;
  sujet: string;
  html: string;
  from: string;
  replyTo?: string | null;
  attachments?: { name: string; base64: string; mime?: string }[];
  date?: Date;
}): Promise<{ id: string } | null> {
  try {
    const message = creerMessageMime({ ...params, marqueur: "brevo" });
    const id = idMessage(message.messageId);
    await avecImap(async (client) => {
      const sent = await assurerBoite(client, "sent");
      await client.append(sent.path, message.raw, ["\\Seen"], params.date);
    });
    await ajouterEtiquettes(id, [LABEL_COPIE_BREVO]);
    return { id };
  } catch (error) {
    console.error(
      "[ionos] Copie de l'envoi Brevo non déposée:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

async function assurerBoite(
  client: ImapFlow,
  role: "sent" | "drafts" | "archive" | "trash",
): Promise<MailboxObject> {
  const aliases = {
    sent: {
      use: "\\sent",
      names: ["sent", "sent items", "envoyés", "envoyés items"],
      create: "Sent",
    },
    drafts: { use: "\\drafts", names: ["drafts", "brouillons", "entwürfe"], create: "Drafts" },
    archive: { use: "\\archive", names: ["archive", "archives"], create: "Archives" },
    trash: {
      use: "\\trash",
      names: ["trash", "corbeille", "deleted items", "éléments supprimés"],
      create: "Trash",
    },
  }[role];
  let found = boiteSpeciale(await boites(client), aliases.use, aliases.names);
  if (!found) {
    await client.mailboxCreate(aliases.create).catch(() => undefined);
    found = boiteSpeciale(await boites(client), aliases.use, aliases.names);
  }
  if (!found) throw new Error(`Dossier IONOS « ${aliases.create} » introuvable.`);
  return found;
}

export async function modifierLabels(
  id: string,
  params: { ajouter?: string[]; retirer?: string[] },
): Promise<void> {
  const ajouter = params.ajouter ?? [];
  const retirer = params.retirer ?? [];
  const system = new Set(["INBOX", "UNREAD", "TRASH"]);
  await ajouterEtiquettes(
    id,
    ajouter.filter((label) => !system.has(label.toUpperCase())),
  );
  await retirerEtiquettes(
    id,
    retirer.filter((label) => !system.has(label.toUpperCase())),
  );
  if (ajouter.some((label) => label.toUpperCase() === "UNREAD")) await marquerLu(id, false);
  if (retirer.some((label) => label.toUpperCase() === "UNREAD")) await marquerLu(id, true);
  if (retirer.some((label) => label.toUpperCase() === "INBOX")) await archiverMessage(id);
  if (ajouter.some((label) => label.toUpperCase() === "INBOX")) await remettreInbox(id);
  if (ajouter.some((label) => label.toUpperCase() === "TRASH")) await mettreCorbeille(id);
}

async function localiser(client: ImapFlow, id: string): Promise<MailboxMessage> {
  const found = await fetchIds(client, [id]);
  if (!found[0]) throw new Error("Message introuvable dans les boîtes IONOS.");
  return found[0];
}

export async function mettreCorbeille(id: string): Promise<void> {
  await avecImap(async (client) => {
    const message = await localiser(client, id);
    const trash = await assurerBoite(client, "trash");
    if (message.mailboxPath !== trash.path) {
      await client.mailboxOpen(message.mailboxPath);
      await client.messageMove(message.uid, trash.path, { uid: true });
    }
  });
}

export async function archiverMessage(id: string): Promise<void> {
  await avecImap(async (client) => {
    const message = await localiser(client, id);
    const mailboxes = await boites(client);
    const inbox = boiteInbox(mailboxes);
    if (message.mailboxPath !== inbox.path) return;
    const archive = await assurerBoite(client, "archive");
    await client.mailboxOpen(message.mailboxPath);
    await client.messageMove(message.uid, archive.path, { uid: true });
  });
}

async function remettreInbox(id: string): Promise<void> {
  await avecImap(async (client) => {
    const message = await localiser(client, id);
    const inbox = boiteInbox(await boites(client));
    if (message.mailboxPath === inbox.path) return;
    await client.mailboxOpen(message.mailboxPath);
    await client.messageMove(message.uid, inbox.path, { uid: true });
  });
}

export async function marquerLu(id: string, lu: boolean): Promise<void> {
  await avecImap(async (client) => {
    const message = await localiser(client, id);
    await client.mailboxOpen(message.mailboxPath);
    if (lu) await client.messageFlagsAdd(message.uid, ["\\Seen"], { uid: true });
    else await client.messageFlagsRemove(message.uid, ["\\Seen"], { uid: true });
  });
}

export async function nomLabelReel(nom: string): Promise<string> {
  return nom;
}

export async function resoudreLabel(nom: string): Promise<string> {
  if (!nom.trim()) throw new Error("Une étiquette CRM ne peut pas être vide.");
  return nom;
}

export async function poserLabelCabinet(
  id: string,
  cle: LabelCabinet,
  options?: { retirer?: LabelCabinet[]; sortirDeLInbox?: boolean },
): Promise<void> {
  const couple = COUPLES_LABELS[cle];
  const ajouter = [couple.direction, couple.etat].filter((name): name is string => !!name);
  const retirer = new Set<string>();
  for (const etat of LABELS_ETATS) if (etat !== couple.etat) retirer.add(etat);
  for (const key of options?.retirer ?? []) {
    const { etat, direction } = COUPLES_LABELS[key];
    if (etat && etat !== couple.etat) retirer.add(etat);
    if (direction && couple.direction && direction !== couple.direction) retirer.add(direction);
  }
  await retirerEtiquettes(
    id,
    [...retirer].filter((label) => !ajouter.includes(label)),
  );
  await ajouterEtiquettes(id, ajouter);
  if (options?.sortirDeLInbox) await archiverMessage(id);
}

export async function marquerEtat(id: string, etat: "archives" | "a_valider"): Promise<void> {
  const cible = etat === "archives" ? ARCHIVE : A_VALIDER;
  await retirerEtiquettes(
    id,
    LABELS_ETATS.filter((label) => label !== cible),
  );
  await ajouterEtiquettes(id, [cible]);
}

export async function retirerEtat(id: string): Promise<void> {
  await retirerEtiquettes(id, [...LABELS_ETATS]);
}

export async function etiqueterMessage(
  id: string,
  nom: string,
  options?: { sortirDeLInbox?: boolean },
): Promise<void> {
  await resoudreLabel(nom);
  await ajouterEtiquettes(id, [nom]);
  if (options?.sortirDeLInbox) await archiverMessage(id);
}

export const FILES_A_TRAITER: readonly LabelCabinet[] = [
  "gc_a_traiter",
  "achat_a_traiter",
  "rec_a_traiter",
];

export async function listerFilesATraiter(params?: {
  maxParFile?: number;
}): Promise<EmailResume[]> {
  const max = Math.max(1, Math.min(params?.maxParFile ?? 25, 100));
  const labels = [...new Set(FILES_A_TRAITER.map((key) => LABELS_CABINET[key]))];
  const { data, error } = await db
    .from("crm_email_labels")
    .select("message_id, label")
    .in("label", labels)
    .order("created_at", { ascending: false })
    .limit(max * labels.length);
  if (error) throw new Error(`Files IONOS indisponibles : ${error.message}`);
  const idsParLabel = new Map<string, string[]>();
  for (const row of (data ?? []) as EtiquetteRow[]) {
    const ids = idsParLabel.get(row.label) ?? [];
    if (ids.length < max) ids.push(row.message_id);
    idsParLabel.set(row.label, ids);
  }
  const ids = [...new Set([...idsParLabel.values()].flat())];
  if (!ids.length) return [];
  const labelsById = await etiquettesParId(ids);
  return avecImap(async (client) => {
    const messages = await fetchIds(client, ids);
    return messages
      .filter((message) => {
        const resumeMessage = resume(
          message,
          labelsById.get(
            idMessage(
              nettoyerMessageId(
                message.envelope?.messageId ?? lireEntete(entetesTexte(message), "Message-ID"),
              ),
              message.mailboxPath,
              message.uidValidity,
              message.uid,
            ),
          ) ?? [],
        );
        return !resumeMessage.etiquettes.some((label) =>
          LABELS_ETATS.some((state) => state.toLowerCase() === label.trim().toLowerCase()),
        );
      })
      .map((message) =>
        resume(
          message,
          labelsById.get(
            idMessage(
              nettoyerMessageId(
                message.envelope?.messageId ?? lireEntete(entetesTexte(message), "Message-ID"),
              ),
              message.mailboxPath,
              message.uidValidity,
              message.uid,
            ),
          ) ?? [],
        ),
      );
  });
}

export function porteEtatTraitement(etiquettes: string[]): boolean {
  const states = LABELS_ETATS.map((label) => label.toLowerCase());
  return etiquettes.some((label) => states.includes(label.trim().toLowerCase()));
}

export async function retirerLabelsParPrefixe(
  id: string,
  prefixes: string[],
): Promise<{ retires: string[] }> {
  const labels = await etiquettesParId([id]);
  const concernes = (labels.get(id) ?? []).filter((label) =>
    prefixes.some((prefix) => label.toLowerCase().startsWith(prefix.toLowerCase())),
  );
  await retirerEtiquettes(id, concernes);
  return { retires: concernes };
}

export async function etiquettesMessage(id: string): Promise<string[]> {
  return (await etiquettesParId([id])).get(id) ?? [];
}

export async function classerInbox(
  id: string,
  label: string,
  options?: { garderDansInbox?: boolean },
): Promise<void> {
  await resoudreLabel(label);
  await retirerEtiquettes(
    id,
    LABELS_TRIAGE_INBOX.filter((existing) => existing !== label),
  );
  await ajouterEtiquettes(id, [label]);
  if (!options?.garderDansInbox) await archiverMessage(id);
}

export async function creerBrouillon(params: {
  to: string;
  sujet: string;
  html: string;
  threadId?: string | null;
}): Promise<{ id: string; lien: string }> {
  const cfg = configuration();
  let parent: MailboxMessage | undefined;
  let rootMessageId: string | null = null;
  if (params.threadId) {
    rootMessageId = decoderId(params.threadId).messageId ?? null;
    if (rootMessageId)
      parent = await avecImap(
        async (client) =>
          (await messagesDuFil(client, rootMessageId!)).sort(
            (a, b) => dateNumber(b.internalDate) - dateNumber(a.internalDate),
          )[0],
      );
  }
  const parentId = parent
    ? nettoyerMessageId(
        parent.envelope?.messageId ?? lireEntete(entetesTexte(parent), "Message-ID"),
      )
    : rootMessageId;
  const message = creerMessageMime({
    to: params.to,
    sujet: params.sujet,
    html: params.html,
    from: cfg.email,
    inReplyTo: parentId,
    references: rootMessageId,
  });
  await avecImap(async (client) => {
    const drafts = await assurerBoite(client, "drafts");
    await client.append(drafts.path, message.raw, ["\\Draft", "\\Seen"]);
  });
  const id = idMessage(message.messageId);
  await ajouterEtiquettes(id, ["DRAFT"]);
  return { id, lien: lienGmailBrouillon(id) };
}

export { lienGmailMessage };

export function lienIonosWebmail(): string {
  return BASE_URL_WEBMAIL;
}
