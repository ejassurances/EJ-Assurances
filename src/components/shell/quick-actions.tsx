/**
 * Actions rapides de la barre supérieure : e-mail, tâche, ajout, appel.
 * Chaque bouton rond ouvre l'écran ou la modale correspondante du CRM.
 */
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  IconChecklist,
  IconFileText,
  IconMail,
  IconPhone,
  IconPlus,
  IconShieldExclamation,
  IconUserPlus,
} from "@tabler/icons-react";

import { EnvoiRapideEmailDialog } from "@/components/envoi-rapide-email";
import { IconAction } from "@/components/shell/icon-action";
import { supabase } from "@/integrations/supabase/client";
import { creerTache } from "@/lib/taches.functions";
import { PRIORITES_TACHE } from "@/lib/referentiels";

type ClientLeger = {
  id: string;
  nom: string;
  reference: string | null;
  email: string | null;
  telephone: string | null;
};

/** Modale générique : voile + carte centrée. */
function Modale({
  titre,
  eyebrow,
  onClose,
  children,
}: {
  titre: string;
  eyebrow: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/50 p-3 sm:p-8">
      <div className="crm-card w-full max-w-lg space-y-4 p-5 shadow-xl sm:p-6">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
          <div className="min-w-0">
            <p className="crm-eyebrow">{eyebrow}</p>
            <h2 className="truncate text-base font-semibold text-ink">{titre}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 text-sm text-ink-muted hover:underline"
          >
            Fermer
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Sélecteur de client par recherche (nom, prénom, référence, e-mail, téléphone). */
function ClientPicker({
  onPick,
  actif,
}: {
  onPick: (c: ClientLeger) => void;
  actif?: ClientLeger | null;
}) {
  const [terme, setTerme] = useState("");
  const [liste, setListe] = useState<ClientLeger[]>([]);

  useEffect(() => {
    const q = terme.trim();
    if (q.length < 2) {
      setListe([]);
      return;
    }
    let annule = false;
    const timer = setTimeout(async () => {
      const motif = `%${q}%`;
      const { data } = await supabase
        .from("clients")
        .select("id, nom, prenom, reference, email, telephone")
        .or(
          `nom.ilike.${motif},prenom.ilike.${motif},reference.ilike.${motif},email.ilike.${motif}`,
        )
        .limit(8);
      if (annule) return;
      setListe(
        (data ?? []).map((c) => ({
          id: c.id,
          nom: [c.prenom, c.nom].filter(Boolean).join(" ") || c.nom,
          reference: c.reference ?? null,
          email: c.email ?? null,
          telephone: c.telephone ?? null,
        })),
      );
    }, 250);
    return () => {
      annule = true;
      clearTimeout(timer);
    };
  }, [terme]);

  return (
    <div className="space-y-2">
      <input
        value={terme}
        onChange={(e) => setTerme(e.target.value)}
        placeholder="Rechercher un client…"
        aria-label="Rechercher un client"
        className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
      />
      {actif && (
        <p className="text-xs text-ink-muted">
          Client sélectionné : <span className="font-semibold text-ink">{actif.nom}</span>
          {actif.reference ? ` · ${actif.reference}` : ""}
        </p>
      )}
      {liste.length > 0 && (
        <ul className="max-h-52 divide-y divide-line overflow-y-auto rounded-md border border-line">
          {liste.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onPick(c)}
                className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-surface"
              >
                <span className="truncate text-sm text-ink">{c.nom}</span>
                <span className="truncate text-xs text-ink-muted">
                  {[c.reference, c.email, c.telephone].filter(Boolean).join(" · ") ||
                    "Coordonnées à compléter"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Modale d'envoi d'e-mail : sélection du client puis envoi rapide. */
function ModaleEmail({ onClose }: { onClose: () => void }) {
  const [client, setClient] = useState<ClientLeger | null>(null);
  if (client) {
    return <EnvoiRapideEmailDialog type="client" id={client.id} open onClose={onClose} />;
  }
  return (
    <Modale eyebrow="Envoi rapide" titre="À quel client écrivez-vous ?" onClose={onClose}>
      <ClientPicker onPick={setClient} />
      <p className="text-xs text-ink-muted">
        L'envoi part de la boîte du cabinet et reste tracé dans l'historique du client.
      </p>
    </Modale>
  );
}

/** Modale de création de tâche. */
function ModaleTache({ onClose }: { onClose: () => void }) {
  const creer = useServerFn(creerTache);
  const navigate = useNavigate();
  const [client, setClient] = useState<ClientLeger | null>(null);
  const [titre, setTitre] = useState("");
  const [description, setDescription] = useState("");
  const [echeance, setEcheance] = useState("");
  const [priorite, setPriorite] = useState<(typeof PRIORITES_TACHE)[number]>("normale");
  const [busy, setBusy] = useState(false);

  const soumettre = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await creer({
        data: {
          titre: titre.trim(),
          description: description.trim() || null,
          client_id: client?.id ?? null,
          echeance: echeance || null,
          priorite,
        },
      });
      toast.success("Tâche créée.");
      onClose();
      navigate({ to: "/espace/taches" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Création impossible.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modale eyebrow="Nouvelle tâche" titre="Créer une tâche" onClose={onClose}>
      <form onSubmit={soumettre} className="space-y-3">
        <input
          required
          minLength={2}
          value={titre}
          onChange={(e) => setTitre(e.target.value)}
          placeholder="Intitulé de la tâche *"
          className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
        />
        <textarea
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Détail, contexte…"
          className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="crm-eyebrow">Échéance</span>
            <input
              type="date"
              value={echeance}
              onChange={(e) => setEcheance(e.target.value)}
              className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
            />
          </label>
          <label className="space-y-1">
            <span className="crm-eyebrow">Priorité</span>
            <select
              value={priorite}
              onChange={(e) => setPriorite(e.target.value as (typeof PRIORITES_TACHE)[number])}
              className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
            >
              {PRIORITES_TACHE.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
        </div>
        <ClientPicker onPick={setClient} actif={client} />
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-line px-4 py-1.5 text-sm"
          >
            Annuler
          </button>
          <button
            type="submit"
            disabled={busy || titre.trim().length < 2}
            className="rounded-full bg-[color:var(--crm-navy)] px-5 py-1.5 text-sm text-white disabled:opacity-60"
          >
            {busy ? "Création…" : "Créer la tâche"}
          </button>
        </div>
      </form>
    </Modale>
  );
}

/** Modale d'appel : numéro cliquable et compte rendu enregistré dans l'historique. */
function ModaleAppel({ onClose }: { onClose: () => void }) {
  const [client, setClient] = useState<ClientLeger | null>(null);
  const [compte, setCompte] = useState("");
  const [busy, setBusy] = useState(false);

  const enregistrer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!client) return;
    setBusy(true);
    const { error } = await supabase.from("activites").insert({
      client_id: client.id,
      type: "appel",
      titre: "Appel téléphonique",
      contenu: compte.trim() || "Appel passé depuis le CRM.",
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Appel enregistré dans l'historique du client.");
    onClose();
  };

  return (
    <Modale eyebrow="Appel" titre="Appeler un client" onClose={onClose}>
      <form onSubmit={enregistrer} className="space-y-3">
        <ClientPicker onPick={setClient} actif={client} />
        {client && (
          <div className="rounded-md bg-surface px-3 py-2 text-sm">
            {client.telephone ? (
              <a
                href={`tel:${client.telephone.replace(/\s+/g, "")}`}
                className="inline-flex items-center gap-2 font-semibold text-ink hover:underline"
              >
                <IconPhone className="h-4 w-4" aria-hidden="true" />
                {client.telephone}
              </a>
            ) : (
              <span className="text-ink-muted">Aucun téléphone renseigné sur cette fiche.</span>
            )}
          </div>
        )}
        <textarea
          rows={4}
          value={compte}
          onChange={(e) => setCompte(e.target.value)}
          placeholder="Compte rendu de l'appel…"
          className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
        />
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-line px-4 py-1.5 text-sm"
          >
            Annuler
          </button>
          <button
            type="submit"
            disabled={busy || !client}
            className="rounded-full bg-[color:var(--crm-navy)] px-5 py-1.5 text-sm text-white disabled:opacity-60"
          >
            {busy ? "Enregistrement…" : "Enregistrer l'appel"}
          </button>
        </div>
      </form>
    </Modale>
  );
}

const AJOUTS = [
  { label: "Nouveau client", to: "/espace/clients", icon: IconUserPlus },
  { label: "Pré-qualification rapide", to: "/espace/prequalification", icon: IconMail },
  { label: "Nouveau sinistre", to: "/espace/sinistres", icon: IconShieldExclamation },
  { label: "Nouveau contrat suivi", to: "/espace/clients", icon: IconFileText },
] as const;

type ActionModale = "email" | "tache" | "appel";

/** Menu d'ajout rapide. */
function MenuAjout({
  onClose,
  onOpenModal,
}: {
  onClose: () => void;
  onOpenModal?: (action: ActionModale) => void;
}) {
  const boite = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boite.current && !boite.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [onClose]);

  return (
    <div ref={boite} className="crm-card absolute right-0 top-full z-40 mt-2 w-64 p-1 shadow-lg">
      {onOpenModal && (
        <>
          {[
            { label: "Écrire un e-mail", icon: IconMail, action: "email" as const },
            { label: "Créer une tâche", icon: IconChecklist, action: "tache" as const },
            { label: "Appeler un client", icon: IconPhone, action: "appel" as const },
          ].map((item) => (
            <button
              key={item.action}
              type="button"
              onClick={() => {
                onOpenModal(item.action);
                onClose();
              }}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-ink-soft hover:bg-surface hover:text-ink"
            >
              <item.icon size={16} aria-hidden="true" />
              {item.label}
            </button>
          ))}
          <div className="my-1 border-t border-line" />
        </>
      )}
      {AJOUTS.map((a) => (
        <Link
          key={a.label}
          to={a.to}
          onClick={onClose}
          className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-ink-soft hover:bg-surface hover:text-ink"
        >
          <a.icon size={16} aria-hidden="true" />
          {a.label}
        </Link>
      ))}
    </div>
  );
}

/** Groupe des quatre boutons ronds d'action rapide. */
export function QuickActions({ compact = false }: { compact?: boolean }) {
  const [modale, setModale] = useState<ActionModale | null>(null);
  const [ajout, setAjout] = useState(false);

  return (
    <>
      <div className={`${compact ? "hidden md:flex" : "flex"} items-center gap-2`}>
        <IconAction label="Écrire un e-mail" onClick={() => setModale("email")}>
          <IconMail size={17} aria-hidden="true" />
        </IconAction>
        <IconAction label="Créer une tâche" onClick={() => setModale("tache")}>
          <IconChecklist size={17} aria-hidden="true" />
        </IconAction>
        <div className="relative">
          <IconAction label="Ajouter" onClick={() => setAjout((v) => !v)}>
            <IconPlus size={17} aria-hidden="true" />
          </IconAction>
          {ajout && <MenuAjout onClose={() => setAjout(false)} />}
        </div>
        <IconAction label="Appeler un client" onClick={() => setModale("appel")}>
          <IconPhone size={17} aria-hidden="true" />
        </IconAction>
      </div>

      {compact && (
        <div className="relative md:hidden">
          <IconAction label="Actions rapides" onClick={() => setAjout((value) => !value)}>
            <IconPlus size={17} aria-hidden="true" />
          </IconAction>
          {ajout && (
            <MenuAjout
              onClose={() => setAjout(false)}
              onOpenModal={(action) => setModale(action)}
            />
          )}
        </div>
      )}

      {modale === "email" && <ModaleEmail onClose={() => setModale(null)} />}
      {modale === "tache" && <ModaleTache onClose={() => setModale(null)} />}
      {modale === "appel" && <ModaleAppel onClose={() => setModale(null)} />}
    </>
  );
}
