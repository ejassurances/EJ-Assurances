import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import {
  reponsesEnAttente,
  modifierReponse,
  envoyerReponseValidee,
  abandonnerReponse,
} from "@/lib/relation-client.functions";

type Reponse = {
  id: string;
  client_id: string;
  gmail_message_id: string | null;
  email_sujet: string | null;
  intention: string | null;
  confiance: number | null;
  resume: string | null;
  destinataire: string | null;
  objet: string | null;
  corps: string | null;
  motif: string | null;
  created_at: string;
  clients?: { nom: string | null; prenom: string | null; email: string | null } | null;
};

/**
 * Agent relation client — file d'attente des réponses niveau 2 : le cabinet
 * valide, édite ou abandonne. Aucun envoi automatique ici.
 */
export function ReponsesIaPanel({ clientId }: { clientId?: string }) {
  const lister = useServerFn(reponsesEnAttente);
  const modifier = useServerFn(modifierReponse);
  const envoyer = useServerFn(envoyerReponseValidee);
  const abandonner = useServerFn(abandonnerReponse);

  const [rows, setRows] = useState<Reponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [edition, setEdition] = useState<Record<string, { objet: string; corps: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    try {
      const res = await lister({ data: { client_id: clientId ?? null } });
      setRows((res.reponses ?? []) as Reponse[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Chargement impossible");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const champ = (r: Reponse) => edition[r.id] ?? { objet: r.objet ?? "", corps: r.corps ?? "" };

  const enregistrer = async (r: Reponse) => {
    const v = champ(r);
    setBusy(r.id);
    try {
      await modifier({ data: { id: r.id, objet: v.objet, corps: v.corps } });
      toast.success("Brouillon enregistré");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Enregistrement impossible");
    } finally {
      setBusy(null);
    }
  };

  const valider = async (r: Reponse) => {
    const v = champ(r);
    setBusy(r.id);
    try {
      await modifier({ data: { id: r.id, objet: v.objet, corps: v.corps } });
      await envoyer({ data: { id: r.id } });
      toast.success("Réponse envoyée au client");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Envoi impossible");
    } finally {
      setBusy(null);
    }
  };

  const jeter = async (r: Reponse) => {
    setBusy(r.id);
    try {
      await abandonner({ data: { id: r.id } });
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Abandon impossible");
    } finally {
      setBusy(null);
    }
  };

  if (loading) return null;
  if (rows.length === 0) return null;

  return (
    <section className="crm-card min-w-0 space-y-4 p-5">
      <div>
        <p className="crm-eyebrow">Réponses à valider ({rows.length})</p>
        <p className="text-xs text-ink-muted">
          Brouillons préparés par l'agent relation client sur des demandes non automatisables. Rien n'est envoyé sans
          votre validation.
        </p>
      </div>

      <ul className="space-y-4">
        {rows.map((r) => {
          const v = champ(r);
          const nom = [r.clients?.prenom, r.clients?.nom].filter(Boolean).join(" ") || "Client";
          return (
            <li key={r.id} className="crm-card space-y-3 bg-background p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-medium text-ink">
                  {nom}
                  {r.destinataire ? <span className="text-ink-muted"> · {r.destinataire}</span> : null}
                </p>
                <p className="text-xs text-ink-muted">{new Date(r.created_at).toLocaleString("fr-FR")}</p>
              </div>
              <p className="text-xs text-ink-muted">
                Email d'origine : {r.email_sujet ?? "(sans objet)"}
                {r.gmail_message_id ? (
                  <>
                    {" · "}
                    <a
                      href={`https://mail.ionos.fr/`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline"
                    >
                      ouvrir le webmail IONOS
                    </a>
                  </>
                ) : null}
              </p>
              {r.motif && <p className="text-xs text-ink-muted">Motif : {r.motif}</p>}
              {r.resume && <p className="text-xs text-ink-muted">Demande : {r.resume}</p>}

              <input
                value={v.objet}
                onChange={(e) => setEdition((s) => ({ ...s, [r.id]: { ...v, objet: e.target.value } }))}
                placeholder="Objet"
                className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm"
              />
              <textarea
                value={v.corps}
                onChange={(e) => setEdition((s) => ({ ...s, [r.id]: { ...v, corps: e.target.value } }))}
                rows={8}
                className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm"
              />

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => valider(r)}
                  disabled={busy === r.id}
                  className="rounded-full bg-[#0A192F] px-4 py-2 text-sm font-medium text-white hover:bg-[#0A192F]/90 disabled:opacity-50"
                >
                  {busy === r.id ? "…" : "Valider et envoyer"}
                </button>
                <button
                  onClick={() => enregistrer(r)}
                  disabled={busy === r.id}
                  className="rounded-full border border-line px-4 py-2 text-sm hover:bg-surface disabled:opacity-50"
                >
                  Enregistrer le brouillon
                </button>
                <button
                  onClick={() => jeter(r)}
                  disabled={busy === r.id}
                  className="rounded-full border border-line px-4 py-2 text-sm text-destructive hover:bg-surface disabled:opacity-50"
                >
                  Abandonner
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
