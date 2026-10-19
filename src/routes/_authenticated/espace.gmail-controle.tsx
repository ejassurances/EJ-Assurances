import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { IconMail, IconAlertTriangle, IconPencil, IconArchive } from "@tabler/icons-react";
import { PageHeader } from "@/components/page-header";
import { useAuth } from "@/lib/auth-context";
import {
  chargerControleGmail,
  type DecisionHistorique,
  type LigneControleEmail,
} from "@/lib/gmail-controle.functions";

export const Route = createFileRoute("/_authenticated/espace/gmail-controle")({
  component: GmailControlePage,
  head: () => ({
    meta: [
      { title: "Contrôle du traitement des e-mails — EJ Partners Assurances" },
      {
        name: "description",
        content:
          "Écran de contrôle du traitement de la boîte de réception : alertes à traiter, brouillons à relire et historique des décisions.",
      },
      { property: "og:title", content: "Contrôle du traitement des e-mails — EJ Partners Assurances" },
      {
        property: "og:description",
        content: "Alertes, brouillons à relire et historique des décisions du traitement de la boîte de réception.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

type Onglet = "alerte" | "brouillon" | "archive" | "historique";

const ONGLETS: { id: Onglet; label: string; icone: typeof IconMail }[] = [
  { id: "alerte", label: "Alertes à traiter", icone: IconAlertTriangle },
  { id: "brouillon", label: "Brouillons à relire", icone: IconPencil },
  { id: "archive", label: "Traités et archivés", icone: IconArchive },
  { id: "historique", label: "Historique des décisions", icone: IconMail },
];

const LIBELLE_DECISION: Record<string, string> = {
  brouillon_a_relire: "Brouillon préparé, à relire",
  alerte_humain: "Validation humaine nécessaire",
  archive_reponse_existante: "Réponse du cabinet déjà envoyée",
  archive_sans_reponse: "Aucune réponse nécessaire",
};

function dateFr(v: string | null) {
  if (!v) return "—";
  return new Date(v).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

function GmailControlePage() {
  const { role, loading: authLoading } = useAuth();
  const [onglet, setOnglet] = useState<Onglet>("alerte");
  const [emails, setEmails] = useState<LigneControleEmail[]>([]);
  const [decisions, setDecisions] = useState<DecisionHistorique[]>([]);
  const [chargement, setChargement] = useState(true);
  const staff = role === "admin" || role === "mandataire";

  useEffect(() => {
    if (authLoading || !staff) return;
    let vivant = true;
    (async () => {
      setChargement(true);
      try {
        const res = await chargerControleGmail();
        if (!vivant) return;
        setEmails(res.emails);
        setDecisions(res.decisions);
      } finally {
        if (vivant) setChargement(false);
      }
    })();
    return () => {
      vivant = false;
    };
  }, [authLoading, staff]);

  const parStatut = useMemo(
    () => ({
      alerte: emails.filter((e) => e.statut_traitement === "alerte"),
      brouillon: emails.filter((e) => e.statut_traitement === "brouillon"),
      archive: emails.filter((e) => e.statut_traitement === "archive"),
    }),
    [emails],
  );

  if (authLoading) return <p className="text-sm text-ink-muted">Chargement…</p>;
  if (!staff) return <p className="text-sm text-ink-muted">Accès réservé aux administrateurs et mandataires.</p>;

  const liste = onglet === "historique" ? [] : parStatut[onglet];

  return (
    <div className="space-y-4">
      <PageHeader
        icon={IconMail}
        title="Contrôle du traitement des e-mails"
        description="Lecture de la boîte de réception IONOS, délai de 45 minutes, classement et brouillons. Aucun envoi automatique par ce traitement."
      />

      <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        Ce traitement prépare des brouillons IONOS à relire avant envoi. Il ne déclenche pas d'envoi automatique et ne
        démarre pas encore tout seul.
      </p>

      <div className="flex flex-wrap gap-2">
        {ONGLETS.map((o) => {
          const n = o.id === "historique" ? decisions.length : parStatut[o.id].length;
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => setOnglet(o.id)}
              className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition ${
                onglet === o.id
                  ? "border-brand-gold bg-brand-navy text-white"
                  : "border-border bg-white text-ink hover:bg-muted"
              }`}
            >
              <o.icone size={14} />
              {o.label}
              <span className="rounded bg-black/10 px-1.5 py-0.5">{n}</span>
            </button>
          );
        })}
      </div>

      {chargement ? (
        <p className="text-sm text-ink-muted">Chargement…</p>
      ) : onglet === "historique" ? (
        <div className="overflow-x-auto rounded-md border border-border bg-white">
          <table className="w-full text-xs">
            <thead className="bg-muted text-left">
              <tr>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Décision</th>
                <th className="px-3 py-2">Origine</th>
                <th className="px-3 py-2">Motif</th>
                <th className="px-3 py-2">Confiance</th>
              </tr>
            </thead>
            <tbody>
              {decisions.map((d) => (
                <tr key={d.id} className="border-t border-border">
                  <td className="px-3 py-2 whitespace-nowrap">{dateFr(d.created_at)}</td>
                  <td className="px-3 py-2">{LIBELLE_DECISION[d.decision] ?? d.decision}</td>
                  <td className="px-3 py-2">{d.origine === "humaine" ? "Humaine" : "Automatique"}</td>
                  <td className="px-3 py-2">{d.motif ?? "—"}</td>
                  <td className="px-3 py-2">{d.confiance == null ? "—" : `${Math.round(d.confiance * 100)} %`}</td>
                </tr>
              ))}
              {decisions.length === 0 && (
                <tr>
                  <td className="px-3 py-4 text-ink-muted" colSpan={5}>
                    Aucune décision enregistrée.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="space-y-2">
          {liste.map((e) => (
            <article key={e.id} className="rounded-md border border-border bg-white p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold text-ink">{e.sujet || "(sans objet)"}</h3>
                <span className="text-xs text-ink-muted">Reçu le {dateFr(e.recu_le)}</span>
              </div>
              <p className="mt-1 text-xs text-ink-muted">
                {e.expediteur_nom ? `${e.expediteur_nom} — ` : ""}
                {e.expediteur_email ?? "expéditeur inconnu"}
              </p>
              <p className="mt-2 text-xs text-ink">
                <span className="font-medium">{LIBELLE_DECISION[e.decision ?? ""] ?? "En attente de traitement"}</span>
                {e.motif ? ` — ${e.motif}` : ""}
                {e.confiance != null ? ` (confiance ${Math.round(e.confiance * 100)} %)` : ""}
              </p>
              <p className="mt-1 text-xs text-ink-muted">
                Rattachement :{" "}
                {e.client_id ? "fiche client" : e.compagnie_id ? "fiche partenaire" : "à confirmer manuellement"}
                {e.label_gmail ? ` · Classé dans ${e.label_gmail}` : ""}
                {e.traite_le ? ` · Traité le ${dateFr(e.traite_le)}` : ""}
              </p>
              <div className="mt-2 flex flex-wrap gap-3 text-xs">
                {e.lien_gmail && (
                  <a className="text-brand-navy underline" href={e.lien_gmail} target="_blank" rel="noreferrer">
                    Ouvrir le webmail IONOS
                  </a>
                )}
                {e.lien_brouillon && (
                  <a className="text-brand-navy underline" href={e.lien_brouillon} target="_blank" rel="noreferrer">
                    Ouvrir le brouillon
                  </a>
                )}
                {e.lien_reponse && (
                  <a className="text-brand-navy underline" href={e.lien_reponse} target="_blank" rel="noreferrer">
                    Voir la réponse envoyée
                  </a>
                )}
              </div>
            </article>
          ))}
          {liste.length === 0 && <p className="text-sm text-ink-muted">Aucun message dans cette liste.</p>}
        </div>
      )}
    </div>
  );
}
