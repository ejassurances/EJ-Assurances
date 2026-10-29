import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { IconMail } from "@tabler/icons-react";
import { contactsObjet, type ContactsObjet } from "@/lib/contacts-objet.functions";
import { envoyerEmailCrm } from "@/lib/emails.functions";

export type TypeObjetEmail = "client" | "dossier" | "contrat" | "sinistre" | "reclamation";

/** Ouvre le webmail du cabinet pour consulter sa boîte IONOS. */
function urlWebmailIonos() {
  return "https://mail.ionos.fr/";
}

/**
 * Modal d'envoi rapide multi-destinataires attaché à un objet du CRM.
 * Le premier contact coché devient le destinataire principal (To:), les
 * suivants passent automatiquement en copie (Cc:).
 */
export function EnvoiRapideEmailDialog({
  type,
  id,
  open,
  onClose,
  onSent,
}: {
  type: TypeObjetEmail;
  id: string;
  open: boolean;
  onClose: () => void;
  onSent?: () => void;
}) {
  const charger = useServerFn(contactsObjet);
  const envoyer = useServerFn(envoyerEmailCrm);
  const [data, setData] = useState<ContactsObjet | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [manuel, setManuel] = useState("");
  const [sujet, setSujet] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [erreurEnvoi, setErreurEnvoi] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setData(null);
    setSelection([]);
    charger({ data: { type, id } })
      .then((res) => {
        setData(res);
        setSujet(res.reference ? `[${res.reference}] ` : "");
        if (res.contacts[0]) setSelection([res.contacts[0].email]);
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Contacts indisponibles."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, type, id]);

  if (!open) return null;

  const basculer = (email: string) =>
    setSelection((prev) => (prev.includes(email) ? prev.filter((e) => e !== email) : [...prev, email]));

  const supplementaires = manuel
    .split(/[,;\s]+/)
    .map((e) => e.trim())
    .filter((e) => e.includes("@"));
  const tous = [...selection, ...supplementaires.filter((e) => !selection.includes(e))];
  const to = tous[0] ?? "";
  const cc = tous.slice(1).join(", ");

  const soumettre = async (e: React.FormEvent) => {
    e.preventDefault();
    setErreurEnvoi(null);
    if (!to) {
      const erreur = "Sélectionnez au moins un destinataire ou saisissez une adresse e-mail valide.";
      setErreurEnvoi(erreur);
      toast.error(erreur);
      return;
    }
    if (!sujet.trim()) {
      const erreur = "Renseignez l’objet du message.";
      setErreurEnvoi(erreur);
      toast.error(erreur);
      return;
    }
    if (!message.trim()) {
      const erreur = "Renseignez le contenu du message.";
      setErreurEnvoi(erreur);
      toast.error(erreur);
      return;
    }
    setBusy(true);
    try {
      await envoyer({
        data: {
          to,
          cc: cc || null,
          sujet: sujet.trim(),
          message,
          thread_id: null,
          client_id: type === "client" ? id : null,
          dossier_id: type === "dossier" ? id : null,
          contrat_id: type === "contrat" ? id : null,
          compagnie_id: null,
        },
      });
      toast.success("E-mail envoyé depuis la boîte du cabinet.");
      setMessage("");
      onSent?.();
      onClose();
    } catch (err) {
      const detail = err instanceof Error ? err.message : "Envoi impossible.";
      setErreurEnvoi(detail);
      toast.error(detail);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8">
      <form onSubmit={soumettre} className="crm-card w-full max-w-xl space-y-4 p-6 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="crm-eyebrow">Envoi rapide</p>
            <h2 className="text-base font-semibold text-ink">{data?.intitule ?? "Chargement…"}</h2>
            {data?.reference && <p className="text-xs text-ink-muted">Référence {data.reference}</p>}
          </div>
          <button type="button" onClick={onClose} className="text-sm text-ink-muted hover:underline">
            Fermer
          </button>
        </div>

        <div className="space-y-2">
          <p className="text-xs text-ink-muted">
            Cochez les contacts : le premier sélectionné devient le destinataire principal, les suivants passent en
            copie.
          </p>
          {!data ? (
            <p className="text-sm text-ink-muted">Chargement des contacts…</p>
          ) : data.contacts.length === 0 ? (
            <p className="text-sm text-ink-muted">Aucun contact renseigné sur cet objet — saisissez une adresse.</p>
          ) : (
            <ul className="divide-y divide-line rounded-md border border-line">
              {data.contacts.map((c) => {
                const rang = selection.indexOf(c.email);
                return (
                  <li key={c.email} className="flex items-center gap-3 px-3 py-2">
                    <input
                      type="checkbox"
                      checked={rang >= 0}
                      onChange={() => basculer(c.email)}
                      className="h-4 w-4 accent-[#D4AF37]"
                      aria-label={`Sélectionner ${c.nom}`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-ink">
                        {c.nom} <span className="text-xs text-ink-muted">· {c.libelle}</span>
                      </p>
                      <p className="truncate text-xs text-ink-muted">{c.email}</p>
                    </div>
                    {rang === 0 && (
                      <span className="rounded-full bg-[#0A192F] px-2 py-0.5 text-[10px] font-semibold uppercase text-white">
                        Principal
                      </span>
                    )}
                    {rang > 0 && (
                      <span className="rounded-full border border-[color:var(--crm-gold)] px-2 py-0.5 text-[10px] font-semibold uppercase text-[color:var(--crm-gold)]">
                        Copie
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <input
            placeholder="Autres adresses (séparées par des virgules)"
            value={manuel}
            onChange={(e) => setManuel(e.target.value)}
            className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
          />
        </div>

        <div className="rounded-md bg-surface px-3 py-2 text-xs text-ink-muted">
          <p>
            <span className="font-semibold text-ink">À :</span> {to || "—"}
          </p>
          <p>
            <span className="font-semibold text-ink">Cc :</span> {cc || "—"}
          </p>
        </div>

        <input
          required
          placeholder="Objet *"
          value={sujet}
          onChange={(e) => setSujet(e.target.value)}
          className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
        />
        <textarea
          required
          rows={8}
          placeholder="Votre message…"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
        />

        {erreurEnvoi && (
          <p role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
            {erreurEnvoi}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-full border border-line px-4 py-1.5 text-sm">
            Annuler
          </button>
          <a
            href={urlWebmailIonos()}
            target="_blank"
            rel="noreferrer"
            className="rounded-full border border-line px-4 py-1.5 text-sm hover:bg-surface"
          >
            Ouvrir le webmail IONOS
          </a>
          <button
            type="submit"
            disabled={busy}
            className="rounded-full bg-[#0A192F] px-5 py-1.5 text-sm text-white hover:bg-[#0A192F]/90 disabled:opacity-60"
          >
            {busy ? "Envoi…" : "Envoyer"}
          </button>
        </div>
      </form>
    </div>
  );
}

/** Bouton « Envoyer un e-mail » à placer sur n'importe quel objet du CRM. */
export function BoutonEnvoiEmail({
  type,
  id,
  onSent,
  className,
  libelle = "Envoyer un e-mail",
}: {
  type: TypeObjetEmail;
  id: string;
  onSent?: () => void;
  className?: string;
  libelle?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          className ??
          "inline-flex items-center gap-2 rounded-full border border-line px-4 py-2 text-sm font-medium hover:bg-surface"
        }
      >
        <IconMail className="h-4 w-4" aria-hidden />
        {libelle}
      </button>
      <EnvoiRapideEmailDialog type={type} id={id} open={open} onClose={() => setOpen(false)} onSent={onSent} />
    </>
  );
}
