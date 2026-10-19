import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { messageComplet } from "@/lib/emails.functions";
import { lireTriageAffichage, type TriageAffichage } from "@/lib/email-triage-affichage";

export interface EmailLiens {
  client_id?: string | null;
  dossier_id?: string | null;
  contrat_id?: string | null;
  compagnie_id?: string | null;
}

type LienEmail = {
  id: string;
  gmail_message_id: string;
  direction: string;
  recu_le: string | null;
  notes: string | null;
  created_at: string;
  triage_ia: unknown;
};

/** Bandeau de lecture du triage IA (présentation seule, données déjà en base). */
function TriageBadge({ t }: { t: TriageAffichage }) {
  const couleur =
    t.statut === "validation"
      ? "border-[color:var(--crm-gold)] text-[color:var(--crm-gold)]"
      : t.statut === "action"
        ? "border-line text-ink"
        : "border-line text-ink-muted";
  return (
    <div className="mt-3 rounded-md border border-line/70 bg-surface-muted/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${couleur}`}
        >
          {t.titre}
        </span>
        {t.intentionLisible && (
          <span className="text-xs font-medium text-ink">Intention : {t.intentionLisible}</span>
        )}
        {t.confiance !== null && (
          <span className="text-[11px] text-ink-muted">
            Confiance IA {Math.round(t.confiance * 100)} %
          </span>
        )}
      </div>
      {t.action && <p className="mt-1 text-xs text-ink-soft">{t.action}</p>}
      {t.statut === "qualification" && (
        <p className="mt-1 text-xs text-ink-soft">
          Expéditeur non identifié ou confiance insuffisante
        </p>
      )}
      {t.motif && <p className="mt-1 text-[11px] text-ink-muted">Motif : {t.motif}</p>}
      <p className="mt-1 text-[11px] text-ink-muted">
        {t.validationHumaine ? "Validation humaine requise" : "Validation humaine non requise"}
      </p>
    </div>
  );
}

type EmailAffiche = LienEmail & {
  sujet: string | null;
  expediteur_nom: string | null;
  expediteur_email: string | null;
  destinataires: string | null;
  extrait: string | null;
  erreur?: string | null;
};

/**
 * Historique des échanges rattachés à un client, un dossier, un contrat ou une
 * compagnie. Affichage passif en lecture seule : seul le lien vers le message
 * L'identifiant historique est conservé en base, le contenu est lu en direct via IMAP IONOS.
 */
export function EmailsLiesPanel({
  liens,
  titre = "Historique des échanges",
}: {
  liens: EmailLiens;
  titre?: string;
}) {
  const [emails, setEmails] = useState<EmailAffiche[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      let query = supabase
        .from("crm_emails")
        .select("id, gmail_message_id, direction, recu_le, notes, created_at, triage_ia")
        .order("recu_le", { ascending: false, nullsFirst: false });
      if (liens.client_id) query = query.eq("client_id", liens.client_id);
      if (liens.dossier_id) query = query.eq("dossier_id", liens.dossier_id);
      if (liens.contrat_id) query = query.eq("contrat_id", liens.contrat_id);
      if (liens.compagnie_id) query = query.eq("compagnie_id", liens.compagnie_id);
      const { data } = await query;
      const lignes = (data ?? []) as LienEmail[];

      const enrichis = await Promise.all(
        lignes.map(async (l): Promise<EmailAffiche> => {
          try {
            const { message } = await messageComplet({ data: { id: l.gmail_message_id } });
            return {
              ...l,
              sujet: message.sujet ?? null,
              expediteur_nom: message.expediteur_nom ?? null,
              expediteur_email: message.expediteur_email ?? null,
              destinataires: message.destinataires ?? null,
              extrait: (message.texte ?? message.snippet ?? null)?.slice(0, 600) ?? null,
            };
          } catch {
            return {
              ...l,
              sujet: null,
              expediteur_nom: null,
              expediteur_email: null,
              destinataires: null,
              extrait: null,
              erreur: "Contenu indisponible (message introuvable dans la boîte du cabinet).",
            };
          }
        }),
      );
      setEmails(enrichis);
      setLoading(false);
    };
    load();
  }, [liens.client_id, liens.dossier_id, liens.contrat_id, liens.compagnie_id]);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="crm-eyebrow">{titre}</h3>
        <p className="mt-1 text-xs text-ink-muted">
          Lecture seule : consultation directe des messages de la boîte du cabinet. Utilisez « Envoyer un e-mail » sur
          la fiche pour écrire.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-ink-muted">Chargement…</p>
      ) : emails.length === 0 ? (
        <p className="text-sm text-ink-muted">Aucun échange rattaché pour le moment.</p>
      ) : (
        <ul className="space-y-2">
          {emails.map((m) => (
            <li key={m.id} className="crm-card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={
                    "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide " +
                    (m.direction === "sortant"
                      ? "border-line text-ink-muted"
                      : "border-[color:var(--crm-gold)] text-[color:var(--crm-gold)]")
                  }
                >
                  {m.direction === "sortant" ? "Envoyé" : "Reçu"}
                </span>
                <p className="text-sm font-medium text-ink">{m.sujet ?? "(sans objet)"}</p>
                <span className="ml-auto text-xs text-ink-muted">
                  {m.recu_le ? new Date(m.recu_le).toLocaleString("fr-FR") : ""}
                </span>
              </div>
              <p className="mt-1 text-xs text-ink-muted">
                {m.direction === "sortant"
                  ? `À ${m.destinataires ?? "—"}`
                  : `De ${m.expediteur_nom ?? ""} ${m.expediteur_email ? `<${m.expediteur_email}>` : ""}`}
              </p>
              {m.extrait && <p className="mt-2 whitespace-pre-wrap text-sm text-ink-soft">{m.extrait}</p>}
              {m.erreur && <p className="mt-2 text-xs italic text-ink-muted">{m.erreur}</p>}
              {m.notes && <p className="mt-2 text-xs italic text-ink-muted">{m.notes}</p>}
              {(() => {
                const t = lireTriageAffichage(m.triage_ia);
                return t ? <TriageBadge t={t} /> : null;
              })()}
              <a
                href={`https://mail.ionos.fr/`}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-block text-xs underline text-ink-muted"
              >
                Ouvrir le webmail IONOS
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
