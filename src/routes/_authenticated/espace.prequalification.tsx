import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { creerPrequalificationEmprunteur } from "@/lib/prequalification.functions";

export const Route = createFileRoute("/_authenticated/espace/prequalification")({
  component: Prequalification,
});

function Prequalification() {
  const creer = useServerFn(creerPrequalificationEmprunteur);
  const [nom, setNom] = useState("");
  const [prenom, setPrenom] = useState("");
  const [email, setEmail] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [resultat, setResultat] = useState<{
    dossier_reference: string;
    client_reference: string;
    email_envoye: boolean;
  } | null>(null);

  const envoyer = async () => {
    if (!nom.trim() || !email.trim()) {
      setErreur("Le nom et l'email sont obligatoires.");
      return;
    }
    setEnvoi(true);
    setErreur(null);
    try {
      const res = await creer({
        data: { nom: nom.trim(), prenom: prenom.trim() || undefined, email: email.trim() },
      });
      setResultat(res);
      setNom("");
      setPrenom("");
      setEmail("");
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Erreur lors de l'envoi.");
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <Link to="/espace/clients" className="text-sm text-ink-muted hover:text-ink">
          ← Retour aux clients
        </Link>
        <h1 className="mt-2 font-serif text-2xl font-medium text-ink">Pré-qualification rapide</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Assurance emprunteur — pour un contact reçu par WhatsApp ou en direct. Crée
          automatiquement la fiche client et le dossier, puis envoie le mail de demande d'éléments,
          avec la référence du dossier dans l'objet pour un suivi optimal.
        </p>
      </div>

      <div className="crm-card space-y-4 p-6">
        <div>
          <label className="text-xs font-medium text-ink-muted">Nom *</label>
          <input
            value={nom}
            onChange={(e) => setNom(e.target.value)}
            className="mt-1 w-full rounded-lg border border-line bg-background px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-ink-muted">Prénom</label>
          <input
            value={prenom}
            onChange={(e) => setPrenom(e.target.value)}
            className="mt-1 w-full rounded-lg border border-line bg-background px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-ink-muted">Email *</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-lg border border-line bg-background px-3 py-2 text-sm"
          />
        </div>
        {erreur && <p className="text-sm text-destructive">{erreur}</p>}
        <button
          type="button"
          onClick={() => void envoyer()}
          disabled={envoi}
          className="w-full rounded-full bg-[#0A192F] px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {envoi ? "Envoi…" : "Créer le dossier et envoyer le mail"}
        </button>
      </div>

      {resultat && (
        <div className="crm-card space-y-2 p-6 text-sm">
          <p className="font-medium text-emerald-700">
            {resultat.email_envoye
              ? "Mail envoyé."
              : "Dossier créé, mais le mail n'a pas pu être envoyé."}
          </p>
          <p>
            Client : <span className="font-medium">{resultat.client_reference}</span>
          </p>
          <p>
            Dossier : <span className="font-medium">{resultat.dossier_reference}</span>
          </p>
          <Link to="/espace/dossiers" className="text-ink underline">
            Voir les dossiers →
          </Link>
        </div>
      )}
    </div>
  );
}
