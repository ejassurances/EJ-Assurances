import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { IconFileAlert } from "@tabler/icons-react";

import { detailSinistre, preparerBrouillonSinistre, cloturerSinistre } from "@/lib/sinistres.functions";
import { ACTION_LABEL, STATUT_LABEL } from "./espace.sinistres";
import { PageHeader } from "@/components/page-header";
import { BoutonEnvoiEmail } from "@/components/envoi-rapide-email";

export const Route = createFileRoute("/_authenticated/espace/sinistres/$id")({
  head: () => ({
    meta: [
      { title: "Fiche sinistre — EJ Partners Assurances" },
      {
        name: "description",
        content: "Détail d'un sinistre : résumé, analyse de couverture et actions manuelles du cabinet.",
      },
      { property: "og:title", content: "Fiche sinistre — EJ Partners Assurances" },
      { property: "og:description", content: "Résumé, analyse de couverture et actions du cabinet." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FicheSinistre,
});

type Sinistre = {
  id: string;
  client_id: string;
  contrat_id: string | null;
  statut: string;
  resume: string | null;
  description: string | null;
  analyse_couverture: string | null;
  action_recommandee: string | null;
  notes: string | null;
  date_ouverture: string;
  clos_le: string | null;
  gmail_message_id: string | null;
  clients?: { nom: string | null; prenom: string | null; email: string | null } | null;
  contrats?: { numero: string | null; assureur: string | null; produit: string | null } | null;
};

type Brouillon = {
  id: string;
  objet: string | null;
  corps: string | null;
  motif: string | null;
  destinataire: string | null;
  created_at: string;
};

function FicheSinistre() {
  const { id } = Route.useParams();
  const charger = useServerFn(detailSinistre);
  const preparer = useServerFn(preparerBrouillonSinistre);
  const cloturer = useServerFn(cloturerSinistre);

  const [s, setS] = useState<Sinistre | null>(null);
  const [brouillons, setBrouillons] = useState<Brouillon[]>([]);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const res = await charger({ data: { id } });
      setS(res.sinistre as Sinistre);
      setBrouillons((res.brouillons ?? []) as Brouillon[]);
      setNotes(((res.sinistre as Sinistre).notes ?? "") as string);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Chargement impossible");
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const action = async (type: "reponse_non_couvert" | "transmission_compagnie") => {
    setBusy(true);
    try {
      await preparer({ data: { id, type } });
      toast.success("Brouillon créé — à éditer et envoyer depuis l'onglet Emails");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Préparation impossible");
    } finally {
      setBusy(false);
    }
  };

  const fermer = async () => {
    setBusy(true);
    try {
      await cloturer({ data: { id, notes } });
      toast.success("Dossier clôturé");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Clôture impossible");
    } finally {
      setBusy(false);
    }
  };

  if (!s) return <p className="text-sm text-ink-muted">Chargement…</p>;

  const nom = [s.clients?.prenom, s.clients?.nom].filter(Boolean).join(" ") || "Client";

  return (
    <div className="space-y-6">
      <Link to="/espace/sinistres" className="text-xs text-ink-muted underline">
        ← Tous les sinistres
      </Link>

      <PageHeader
        eyebrow="Dossier sinistre"
        title={`Sinistre — ${nom}`}
        description={
          `${STATUT_LABEL[s.statut] ?? s.statut} · ouvert le ${new Date(s.date_ouverture).toLocaleDateString("fr-FR")}` +
          (s.clos_le ? ` · clos le ${new Date(s.clos_le).toLocaleDateString("fr-FR")}` : "")
        }
        icon={IconFileAlert}
      >
        <BoutonEnvoiEmail
          type="sinistre"
          id={s.id}
          className="inline-flex items-center gap-2 rounded-full border border-white/30 px-3 py-1.5 text-xs text-white hover:bg-white/10"
        />
      </PageHeader>

      <section className="crm-card space-y-3 p-5">
        <h2 className="font-serif text-lg">Résumé</h2>
        <p className="text-sm text-ink">{s.resume ?? s.description ?? "—"}</p>
        <div className="text-xs text-ink-muted">
          <p>
            Client :{" "}
            <Link to="/espace/clients/$id" params={{ id: s.client_id }} className="underline">
              fiche client
            </Link>
            {s.clients?.email ? ` · ${s.clients.email}` : ""}
          </p>
          {s.contrats && (
            <p>
              Contrat : {s.contrats.numero ?? "—"} — {s.contrats.produit ?? ""} {s.contrats.assureur ?? ""}
            </p>
          )}
          {s.gmail_message_id && (
            <p>
              <a
                href={`https://mail.ionos.fr/`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                Email d'origine dans le webmail IONOS
              </a>
            </p>
          )}
        </div>
      </section>

      <section className="crm-card space-y-2 p-5">
        <h2 className="font-serif text-lg">Analyse de couverture</h2>
        <p className="whitespace-pre-line text-sm text-ink">{s.analyse_couverture ?? "Analyse non disponible."}</p>
        <p className="text-xs text-ink-muted">
          Action recommandée :{" "}
          {s.action_recommandee ? (ACTION_LABEL[s.action_recommandee] ?? s.action_recommandee) : "—"} — aide à la
          décision, aucun envoi automatique.
        </p>
      </section>

      <section className="crm-card space-y-3 p-5">
        <h2 className="font-serif text-lg">Actions du cabinet</h2>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => action("reponse_non_couvert")}
            disabled={busy}
            className="rounded-full border border-line px-4 py-2 text-sm hover:bg-background disabled:opacity-50"
          >
            Préparer une réponse non couverte
          </button>
          <button
            onClick={() => action("transmission_compagnie")}
            disabled={busy}
            className="rounded-full border border-line px-4 py-2 text-sm hover:bg-background disabled:opacity-50"
          >
            Transmettre à la compagnie
          </button>
          <button
            onClick={fermer}
            disabled={busy || s.statut === "clos"}
            className="rounded-full bg-[#0A192F] px-4 py-2 text-sm font-medium text-white hover:bg-[#0A192F]/90 disabled:opacity-50"
          >
            Clôturer le dossier
          </button>
        </div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          placeholder="Notes internes (enregistrées à la clôture)"
          className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
        />
      </section>

      <section className="crm-card space-y-3 p-5">
        <h2 className="font-serif text-lg">Brouillons liés au client</h2>
        {brouillons.length === 0 ? (
          <p className="text-sm text-ink-muted">Aucun brouillon en attente.</p>
        ) : (
          <ul className="space-y-3">
            {brouillons.map((b) => (
              <li key={b.id} className="rounded-md border border-line bg-background p-3 text-sm">
                <p className="font-medium">{b.objet ?? "(sans objet)"}</p>
                {b.destinataire && <p className="text-xs text-ink-muted">À : {b.destinataire}</p>}
                {b.motif && <p className="text-xs text-ink-muted">{b.motif}</p>}
                <p className="mt-2 whitespace-pre-line text-xs text-ink-muted">{b.corps}</p>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-ink-muted">
          Lecture seule. Utilisez le bouton « Envoyer un e-mail » en haut du sinistre pour écrire aux intervenants.
        </p>
      </section>
    </div>
  );
}
