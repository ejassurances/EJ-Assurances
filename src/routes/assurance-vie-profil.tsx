import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { creerProfilAssuranceVie } from "@/lib/assurance-vie-profil.functions";

export const Route = createFileRoute("/assurance-vie-profil")({
  head: () => ({
    meta: [
      { title: "Votre profil épargne — EJ Partners Assurances" },
      {
        name: "description",
        content: "Renseignez votre profil épargne avant notre rendez-vous assurance vie.",
      },
    ],
  }),
  component: ProfilAssuranceVie,
});

type Champs = {
  nom: string;
  prenom: string;
  email: string;
  telephone: string;
  situation_familiale: string;
  situation_professionnelle: string;
  revenus_mensuels: string;
  charges_mensuelles: string;
  epargne_disponible: string;
  experience_placements: string;
  objectif_principal: string;
  horizon_placement: string;
  tolerance_risque: string;
  origine_fonds: string;
  commentaire: string;
};

const VIDE: Champs = {
  nom: "",
  prenom: "",
  email: "",
  telephone: "",
  situation_familiale: "",
  situation_professionnelle: "",
  revenus_mensuels: "",
  charges_mensuelles: "",
  epargne_disponible: "",
  experience_placements: "",
  objectif_principal: "",
  horizon_placement: "",
  tolerance_risque: "",
  origine_fonds: "",
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

function ChampChoix({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="text-xs font-medium text-ink-muted">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-line bg-background px-3 py-2 text-sm"
      >
        <option value="">—</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}

function ProfilAssuranceVie() {
  const creer = useServerFn(creerProfilAssuranceVie);
  const [c, setC] = useState<Champs>(VIDE);
  const set = (k: keyof Champs) => (v: string) => setC((p) => ({ ...p, [k]: v }));
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const dossierId =
    typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("dossier_id") : null;

  const envoyer = async () => {
    if (!dossierId && (!c.nom.trim() || !c.email.trim())) {
      setErreur("Le nom et l'email sont obligatoires.");
      return;
    }
    setEnvoi(true);
    setErreur(null);
    try {
      await creer({ data: { ...c, dossier_id: dossierId ?? undefined } });
      setOk(true);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Erreur lors de l'envoi.");
    } finally {
      setEnvoi(false);
    }
  };

  if (ok) {
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
            Votre profil a bien été transmis. Un conseiller EJ Partners Assurances reviendra vers
            vous prochainement pour organiser votre rendez-vous.
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
            Votre profil épargne
          </h1>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-white/70">
            En le remplissant avant notre rendez-vous, celui-ci pourra se concentrer directement
            sur la mise en place de votre contrat, plutôt que sur la découverte de votre situation.
          </p>
        </div>
      </div>

      <div className="mx-auto -mt-8 max-w-2xl space-y-5 px-6 pb-16">
        <div className="rounded-2xl border border-[color:var(--crm-gold)]/30 bg-white p-4 text-xs leading-relaxed text-ink-muted shadow-sm">
          Version de travail (brouillon) — ce questionnaire sera complété avant mise en production
          pour respecter les exigences réglementaires DDA (connaissance client, objectifs,
          horizon, tolérance au risque).
        </div>

      <div className="crm-card space-y-4 rounded-2xl p-6">
        <p className="crm-eyebrow">Vous</p>
        {dossierId ? (
          <p className="text-sm text-ink-soft">Vos coordonnées sont déjà connues de votre dossier.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Champ label="Nom *" value={c.nom} onChange={set("nom")} />
            <Champ label="Prénom" value={c.prenom} onChange={set("prenom")} />
            <Champ label="Email *" type="email" value={c.email} onChange={set("email")} />
            <Champ label="Téléphone" value={c.telephone} onChange={set("telephone")} />
          </div>
        )}
        <ChampChoix
          label="Situation familiale"
          value={c.situation_familiale}
          onChange={set("situation_familiale")}
          options={["Célibataire", "En couple / pacsé(e)", "Marié(e)", "Divorcé(e)", "Veuf(ve)"]}
        />
        <ChampChoix
          label="Situation professionnelle"
          value={c.situation_professionnelle}
          onChange={set("situation_professionnelle")}
          options={["Salarié(e)", "Indépendant(e) / profession libérale", "Fonctionnaire", "Retraité(e)", "Sans emploi", "Étudiant(e)"]}
        />
      </div>

      <div className="crm-card space-y-4 rounded-2xl p-6">
        <p className="crm-eyebrow">Votre situation financière</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Champ label="Revenus mensuels du foyer (€, approximatif)" type="number" value={c.revenus_mensuels} onChange={set("revenus_mensuels")} />
          <Champ label="Charges mensuelles du foyer (€, approximatif)" type="number" value={c.charges_mensuelles} onChange={set("charges_mensuelles")} />
          <Champ label="Épargne déjà disponible (€, approximatif)" type="number" value={c.epargne_disponible} onChange={set("epargne_disponible")} />
        </div>
        <ChampChoix
          label="Origine des fonds à placer"
          value={c.origine_fonds}
          onChange={set("origine_fonds")}
          options={["Épargne salariale progressive", "Économies d'assurance emprunteur", "Vente d'un bien", "Héritage / donation", "Autre"]}
        />
      </div>

      <div className="crm-card space-y-4 rounded-2xl p-6">
        <p className="crm-eyebrow">Votre profil d'investisseur</p>
        <ChampChoix
          label="Avez-vous déjà investi dans des produits financiers (assurance vie, bourse, immobilier locatif...) ?"
          value={c.experience_placements}
          onChange={set("experience_placements")}
          options={["Jamais", "Un peu, occasionnellement", "Oui, régulièrement"]}
        />
        <ChampChoix
          label="Objectif principal de ce placement"
          value={c.objectif_principal}
          onChange={set("objectif_principal")}
          options={[
            "Faire fructifier une épargne de précaution",
            "Préparer ma retraite",
            "Transmettre un capital à mes proches",
            "Financer un projet à moyen terme",
            "Autre",
          ]}
        />
        <ChampChoix
          label="Horizon de placement envisagé"
          value={c.horizon_placement}
          onChange={set("horizon_placement")}
          options={["Moins de 4 ans", "4 à 8 ans", "Plus de 8 ans"]}
        />
        <ChampChoix
          label="Face aux fluctuations des marchés, vous préférez..."
          value={c.tolerance_risque}
          onChange={set("tolerance_risque")}
          options={[
            "Aucun risque, même avec un rendement faible",
            "Un peu de risque pour un meilleur rendement",
            "Un risque assumé pour viser une performance plus élevée",
          ]}
        />
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
        {envoi ? "Envoi…" : "Envoyer mon profil"}
      </button>
      <p className="text-center text-xs text-ink-muted">
        <Link to="/" className="underline">
          EJ Partners Assurances
        </Link>
      </p>
      </div>
    </div>

  );
}
