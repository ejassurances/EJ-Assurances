import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * File d'attente d'envoi d'emails (anti-spam) : les emails d'un même lot
 * partent à partir de 10h00 (heure de Paris), espacés de 5 minutes
 * (10h00, 10h05, 10h10, ...). Un job passe régulièrement et envoie ce qui est dû.
 */

export const DECALAGE_MINUTES = 5;
const HEURE_ENVOI = 10;

/** Décalage de Paris par rapport à UTC, en minutes, pour un instant donné. */
function offsetParisMinutes(d: Date): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Paris",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p = fmt.formatToParts(d);
  const v = (t: string) => Number(p.find((x) => x.type === t)?.value ?? "0");
  const local = Date.UTC(
    v("year"),
    v("month") - 1,
    v("day"),
    v("hour") % 24,
    v("minute"),
    v("second"),
  );
  return Math.round((local - Math.floor(d.getTime() / 1000) * 1000) / 60000);
}

/** Prochain créneau 10h00 (Paris) à partir de maintenant. */
export function prochainCreneau(maintenant: Date = new Date()): Date {
  const off = offsetParisMinutes(maintenant);
  const local = new Date(maintenant.getTime() + off * 60000);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  const j = local.getUTCDate();
  let cible = Date.UTC(y, m, j, HEURE_ENVOI, 0, 0) - off * 60000;
  if (cible <= maintenant.getTime()) cible = Date.UTC(y, m, j + 1, HEURE_ENVOI, 0, 0) - off * 60000;
  return new Date(cible);
}

export interface EmailPlanifie {
  template: string;
  destinataire: string;
  donnees: Record<string, unknown>;
  idempotency_key?: string | null;
  contexte?: Record<string, unknown>;
}

/**
 * Planifie un lot d'emails : le premier à 10h00 (Paris), les suivants toutes
 * les 5 minutes. Retourne les heures d'envoi retenues.
 */
export async function planifierLotEmails(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  lot: string,
  emails: EmailPlanifie[],
  maintenant: Date = new Date(),
): Promise<{ planifies: number; premier: string | null }> {
  if (emails.length === 0) return { planifies: 0, premier: null };
  const base = prochainCreneau(maintenant);
  const rows = emails.map((e, i) => ({
    lot,
    template: e.template,
    destinataire: e.destinataire,
    donnees: JSON.parse(JSON.stringify(e.donnees)),
    idempotency_key: e.idempotency_key ?? null,
    contexte: JSON.parse(JSON.stringify(e.contexte ?? {})),
    envoyer_le: new Date(base.getTime() + i * DECALAGE_MINUTES * 60000).toISOString(),
    statut: "en_attente",
  }));
  const { error } = await admin
    .from("emails_planifies")
    .upsert(rows as never, { onConflict: "idempotency_key", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
  return { planifies: rows.length, premier: base.toISOString() };
}

/** Envoie les emails dus (statut 'en_attente' et envoyer_le <= maintenant). */
export async function envoyerEmailsDus(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  limite = 30,
): Promise<{ envoyes: number; echecs: number }> {
  const { sendTemplateEmail } = await import("@/lib/email-templates/send-email");
  const { data, error } = await admin
    .from("emails_planifies")
    .select("id, template, destinataire, donnees, idempotency_key, contexte")
    .eq("statut", "en_attente")
    .lte("envoyer_le", new Date().toISOString())
    .order("envoyer_le", { ascending: true })
    .limit(limite);
  if (error) throw new Error(error.message);

  let envoyes = 0;
  let echecs = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const e of (data ?? []) as any[]) {
    try {
      // Parcours site public : l'espace client (et le DER) doit exister avant
      // l'e-mail qui y renvoie le prospect.
      if (e.template === "public-intake-recueil") {
        const { preparerEspaceParcoursPublic } = await import("@/lib/parcours-public.server");
        const prep = await preparerEspaceParcoursPublic(admin as never, {
          client_id: e.contexte?.client_id ?? e.contexte?.liens?.client_id ?? null,
        });
        if (!prep.ok) throw new Error(`Espace client non préparé : ${prep.erreur ?? "erreur"}`);
      }
      const res = await sendTemplateEmail(e.template as string, e.destinataire as string, {
        templateData: (e.donnees ?? {}) as Record<string, unknown>,
        idempotencyKey: (e.idempotency_key as string | null) ?? undefined,
        liens: (e.contexte?.liens ??
          (e.contexte?.client_id
            ? { client_id: e.contexte.client_id, dossier_id: e.contexte.dossier_id ?? null }
            : undefined)) as never,
      });
      await admin
        .from("emails_planifies")
        .update({
          statut: res.sent ? "envoye" : "ignore",
          envoye_le: new Date().toISOString(),
          erreur: null,
        })
        .eq("id", e.id);
      if (res.sent) envoyes += 1;
      if (res.sent) await noterEnvoiDansCrm(admin, e);
    } catch (err) {
      echecs += 1;
      await admin
        .from("emails_planifies")
        .update({ statut: "echec", erreur: err instanceof Error ? err.message : "erreur inconnue" })
        .eq("id", e.id);
    }
  }
  return { envoyes, echecs };
}

/**
 * Trace CRM de chaque email réellement envoyé : une note dans « Historique des
 * échanges » du client concerné (identifié via `contexte.liens.client_id`).
 * Jamais bloquant : un échec de note n'annule pas l'envoi.
 */
async function noterEnvoiDansCrm(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  e: any,
): Promise<void> {
  const clientId: string | null = e?.contexte?.liens?.client_id ?? e?.contexte?.client_id ?? null;
  if (!clientId) return;
  const titre: string = e?.donnees?.titre ?? e?.template ?? "Email";
  try {
    await admin.from("activites").insert({
      client_id: clientId,
      type: "email",
      titre: "Email envoyé au client",
      contenu: [
        `Objet : ${titre}`,
        `Destinataire : ${e?.destinataire ?? "—"}`,
        `Modèle : ${e?.template ?? "—"}`,
        `Envoyé le : ${new Date().toISOString()}`,
      ].join("\n"),
    } as never);
  } catch (err) {
    console.error("[emails-file-attente] note CRM non enregistrée", err);
  }
}
