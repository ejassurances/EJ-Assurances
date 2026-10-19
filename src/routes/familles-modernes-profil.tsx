import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { creerProfilFamillesModernes } from "@/lib/profil-familles-modernes.functions";

export const Route = createFileRoute("/familles-modernes-profil")({
  head: () => ({
    meta: [
      { title: "Protéger mon enfant social — EJ Partners Assurances" },
      {
        name: "description",
        content: "Assurance vie pour transmettre à votre enfant social — EJ Partners Assurances.",
      },
    ],
  }),
  component: FamillesModernes,
});

type Champs = {
  nom: string;
  prenom: string;
  email: string;
  telephone: string;
  lien_avec_enfant: string;
  prenom_enfant: string;
  objectif: string;
  commentaire: string;
};

const VIDE: Champs = {
  nom: "",
  prenom: "",
  email: "",
  telephone: "",
  lien_avec_enfant: "",
  prenom_enfant: "",
  objectif: "",
  commentaire: "",
};

function Champ({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div>
      <label className="text-xs font-medium text-ink-muted">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-line bg-background px-3 py-2 text-sm"
      />
    </div>
  );
}

function FamillesModernes() {
  const creer = useServerFn(creerProfilFamillesModernes);
  const [c, setC] = useState<Champs>(VIDE);
  const set = (k: keyof Champs) => (v: string) => setC((p) => ({ ...p, [k]: v }));
  const [proprietaireRecent, setProprietaireRecent] = useState(false);
  const [souhaiteEmprunteur, setSouhaiteEmprunteur] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [resultat, setResultat] = useState<{ dossier_emprunteur_reference: string | null } | null>(null);

  const origine =
    typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("origine") : null;

  const envoyer = async () => {
    if (!c.nom.trim() || !c.email.trim()) {
      setErreur("Le nom et l'email sont obligatoires.");
      return;
    }
    setEnvoi(true);
    setErreur(null);
    try {
      const res = await creer({
        data: {
          ...c,
          proprietaire_credit_moins_5_ans: proprietaireRecent,
          souhaite_etude_emprunteur: proprietaireRecent && souhaiteEmprunteur,
          origine: origine ?? "site_vitrine",
        },
      });
      setResultat(res);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Erreur lors de l'envoi.");
    } finally {
      setEnvoi(false);
    }
  };

  if (resultat) {
    return (
      <div className="crm-theme min-h-screen bg-[color:var(--crm-navy)]">
        <div className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center px-6 text-center">
          <img
            src="/logo-ej-partners.png"
            alt="EJ Partners Assurances"
            className="size-16 rounded-lg object-cover ring-2 ring-[color:var(--crm-gold)]/40"
          />
          <p className="mt-8 font-serif text-3xl font-medium text-white">Merci !</p>
          <p className="mt-4 text-sm leading-relaxed text-white/70">
            Votre demande a bien été transmise. Un conseiller EJ Partners Assurances reviendra vers
            vous prochainement.
            {resultat.dossier_emprunteur_reference &&
              " Nous vous avons également envoyé un mail pour l'étude de votre assurance emprunteur."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="crm-theme min-h-screen bg-[#f7f5f0]">
      <div className="bg-[color:var(--crm-navy)] px-6 pb-16 pt-10">
        <div className="mx-auto max-w-2xl">
          <img
            src="/logo-ej-partners.png"
            alt="EJ Partners Assurances"
            className="size-12 rounded-lg object-cover ring-2 ring-[color:var(--crm-gold)]/40"
          />
          <p className="mt-6 text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--crm-gold)]">
            EJ Partners Assurances
          </p>
          <h1 className="mt-2 font-serif text-3xl font-medium text-white sm:text-4xl">
            Protéger mon enfant social
          </h1>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-white/70">
            En tant que parent social, vous souhaitez transmettre un patrimoine à votre enfant
            social — l'accompagner dans le paiement des frais de succession, lui transmettre un
            capital. Parlons-en.
          </p>
        </div>
      </div>

      <div className="mx-auto -mt-8 max-w-2xl space-y-5 px-6 pb-16">
        <div className="rounded-2xl border border-[color:var(--crm-gold)]/30 bg-white p-4 text-xs leading-relaxed text-ink-muted shadow-sm">
          Version de travail (brouillon) — la lettre de mission et le devoir de conseil dédiés à ce
          parcours seront finalisés avant mise en production.
        </div>

        <div className="crm-card space-y-4 rounded-2xl p-6">
          <p className="crm-eyebrow">Vous</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Champ label="Nom *" value={c.nom} onChange={set("nom")} />
            <Champ label="Prénom" value={c.prenom} onChange={set("prenom")} />
            <Champ label="Email *" type="email" value={c.email} onChange={set("email")} />
            <Champ label="Téléphone" value={c.telephone} onChange={set("telephone")} />
          </div>
        </div>

        <div className="crm-card space-y-4 rounded-2xl p-6">
          <p className="crm-eyebrow">Votre enfant social</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Champ label="Prénom de l'enfant" value={c.prenom_enfant} onChange={set("prenom_enfant")} />
            <Champ
              label="Votre lien avec l'enfant"
              value={c.lien_avec_enfant}
              onChange={set("lien_avec_enfant")}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-ink-muted">Votre objectif principal</label>
            <textarea
              value={c.objectif}
              onChange={(e) => setC((p) => ({ ...p, objectif: e.target.value }))}
              rows={2}
              placeholder="Ex. transmettre un capital, accompagner le paiement des frais de succession..."
              className="mt-1 w-full rounded-lg border border-line bg-background px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="crm-card space-y-4 rounded-2xl p-6">
          <p className="crm-eyebrow">Votre logement</p>
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={proprietaireRecent}
              onChange={(e) => {
                setProprietaireRecent(e.target.checked);
                if (!e.target.checked) setSouhaiteEmprunteur(false);
              }}
              className="mt-1"
            />
            <span>Êtes-vous propriétaire avec un crédit en cours depuis moins de 5 ans ?</span>
          </label>
          {proprietaireRecent && (
            <label className="ml-6 flex items-start gap-3 rounded-lg border border-[color:var(--crm-gold)]/30 bg-[color:var(--crm-gold)]/5 p-3 text-sm">
              <input
                type="checkbox"
                checked={souhaiteEmprunteur}
                onChange={(e) => setSouhaiteEmprunteur(e.target.checked)}
                className="mt-1"
              />
              <span>Je souhaite également faire l'étude de mon assurance emprunteur.</span>
            </label>
          )}
        </div>

        <div className="crm-card space-y-3 rounded-2xl p-6">
          <label className="text-xs font-medium text-ink-muted">
            Toute autre information que vous jugez utile (facultatif)
          </label>
          <textarea
            value={c.commentaire}
            onChange={(e) => setC((p) => ({ ...p, commentaire: e.target.value }))}
            rows={3}
            className="w-full rounded-lg border border-line bg-background px-3 py-2 text-sm"
          />
        </div>

        {erreur && <p className="text-sm text-destructive">{erreur}</p>}
        <button
          type="button"
          onClick={() => void envoyer()}
          disabled={envoi}
          className="w-full rounded-full bg-[color:var(--crm-gold)] px-5 py-3 text-sm font-semibold text-[color:var(--crm-navy)] shadow-sm transition hover:brightness-95 disabled:opacity-50"
        >
          {envoi ? "Envoi…" : "Envoyer ma demande"}
        </button>
      </div>
    </div>
  );
}
