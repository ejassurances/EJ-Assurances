import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { creerDemandeInfoVie } from "@/lib/demande-info-vie.functions";

export const Route = createFileRoute("/assurance-vie-information")({
  head: () => ({
    meta: [
      { title: "Assurance vie — être recontacté — EJ Partners Assurances" },
      { name: "description", content: "Demandez à être recontacté au sujet de l'assurance vie." },
    ],
  }),
  component: DemandeInfoVie,
});

type Champs = { nom: string; prenom: string; email: string; telephone: string; motif: string };
const VIDE: Champs = { nom: "", prenom: "", email: "", telephone: "", motif: "" };

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

function DemandeInfoVie() {
  const creer = useServerFn(creerDemandeInfoVie);
  const [c, setC] = useState<Champs>(VIDE);
  const set = (k: keyof Champs) => (v: string) => setC((p) => ({ ...p, [k]: v }));
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const envoyer = async () => {
    if (!c.nom.trim() || !c.email.trim()) {
      setErreur("Le nom et l'email sont obligatoires.");
      return;
    }
    setEnvoi(true);
    setErreur(null);
    try {
      await creer({ data: c });
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
            Votre demande a bien été transmise. Un conseiller EJ Partners Assurances reviendra vers
            vous prochainement.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="crm-theme min-h-screen bg-[#f7f5f0]">
      <div className="bg-[color:var(--crm-navy)] px-6 pb-16 pt-10">
        <div className="mx-auto max-w-xl">
          <img
            src="/logo-ej-partners.png"
            alt="EJ Partners Assurances"
            className="size-12 rounded-lg object-cover ring-2 ring-[color:var(--crm-gold)]/40"
          />
          <p className="mt-6 text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--crm-gold)]">
            EJ Partners Assurances
          </p>
          <h1 className="mt-2 font-serif text-3xl font-medium text-white sm:text-4xl">Assurance vie</h1>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-white/70">
            Vous vous renseignez sur l'assurance vie ? Laissez-nous vos coordonnées, un conseiller
            vous recontacte pour en discuter.
          </p>
        </div>
      </div>

      <div className="mx-auto -mt-8 max-w-xl space-y-5 px-6 pb-16">
        <div className="crm-card space-y-4 rounded-2xl p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <Champ label="Nom *" value={c.nom} onChange={set("nom")} />
            <Champ label="Prénom" value={c.prenom} onChange={set("prenom")} />
            <Champ label="Email *" type="email" value={c.email} onChange={set("email")} />
            <Champ label="Téléphone" value={c.telephone} onChange={set("telephone")} />
          </div>
          <div>
            <label className="text-xs font-medium text-ink-muted">Votre question (facultatif)</label>
            <textarea
              value={c.motif}
              onChange={(e) => setC((p) => ({ ...p, motif: e.target.value }))}
              rows={3}
              className="mt-1 w-full rounded-lg border border-line bg-background px-3 py-2 text-sm"
            />
          </div>
        </div>

        {erreur && <p className="text-sm text-destructive">{erreur}</p>}
        <button
          type="button"
          onClick={() => void envoyer()}
          disabled={envoi}
          className="w-full rounded-full bg-[color:var(--crm-gold)] px-5 py-3 text-sm font-semibold text-[color:var(--crm-navy)] shadow-sm transition hover:brightness-95 disabled:opacity-50"
        >
          {envoi ? "Envoi…" : "Être recontacté(e)"}
        </button>
      </div>
    </div>
  );
}
