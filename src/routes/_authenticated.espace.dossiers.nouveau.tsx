import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { creerClientDossierRapide } from "@/lib/creation-rapide-client-dossier.functions";
import { BRANCHES_CREATION } from "@/lib/recueil-besoins-schemas";
import type { ClientCandidatCreationRapide } from "@/lib/creation-rapide-client-dossier";

export const Route = createFileRoute("/_authenticated/espace/dossiers/nouveau")({
  component: NouveauClientDossier,
});

type ClientFormulaire = {
  civilite: string;
  prenom: string;
  nom: string;
  date_naissance: string;
  email: string;
  mobile: string;
  telephone: string;
  adresse: string;
  code_postal: string;
  ville: string;
};

type DossierFormulaire = {
  type_assurance: string;
  intitule: string;
  besoin: string;
  commentaire_initial: string;
};

const CLIENT_VIDE: ClientFormulaire = {
  civilite: "",
  prenom: "",
  nom: "",
  date_naissance: "",
  email: "",
  mobile: "",
  telephone: "",
  adresse: "",
  code_postal: "",
  ville: "",
};

const DOSSIER_VIDE: DossierFormulaire = {
  type_assurance: "",
  intitule: "",
  besoin: "",
  commentaire_initial: "",
};

function NouveauClientDossier() {
  const navigate = useNavigate();
  const creer = useServerFn(creerClientDossierRapide);
  const [client, setClient] = useState(CLIENT_VIDE);
  const [dossier, setDossier] = useState(DOSSIER_VIDE);
  const [candidat, setCandidat] = useState<ClientCandidatCreationRapide | null>(null);
  const [enregistrement, setEnregistrement] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const modifierClient = (champ: keyof ClientFormulaire, valeur: string) => {
    setClient((courant) => ({ ...courant, [champ]: valeur }));
    setCandidat(null);
  };
  const modifierDossier = (champ: keyof DossierFormulaire, valeur: string) => {
    setDossier((courant) => ({ ...courant, [champ]: valeur }));
    setCandidat(null);
  };

  const soumettre = async (clientConfirmeId: string | null = null) => {
    if (enregistrement) return;
    setEnregistrement(true);
    setErreur(null);

    try {
      const resultat = await creer({
        data: {
          client,
          dossier,
          confirmer_client_id: clientConfirmeId,
        },
      });

      if (resultat.status === "confirmation_required") {
        setCandidat(resultat.candidate);
        return;
      }
      if (resultat.status === "invalid_confirmation") {
        setCandidat(null);
        setErreur(
          "La correspondance a changé. Vérifiez les informations puis relancez la création.",
        );
        return;
      }

      toast.success(`Dossier créé avec succès pour ${client.prenom} ${client.nom}.`.trim());
      await navigate({ to: "/espace/dossiers/$id", params: { id: resultat.dossier_id } });
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "La création du client et du dossier a échoué.");
    } finally {
      setEnregistrement(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Dossiers"
        title="Nouveau client & dossier"
        description="Ouvrez un dossier rapidement. Le recueil des besoins pourra être complété ensuite sur sa fiche."
      >
        <Link
          to="/espace/dossiers"
          className="rounded-full border border-white/25 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/10"
        >
          Retour aux dossiers
        </Link>
      </PageHeader>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void soumettre();
        }}
        className="space-y-5"
      >
        <section className="rounded-2xl border border-line bg-surface-elevated p-5 sm:p-6">
          <div className="mb-4">
            <h2 className="font-serif text-xl font-medium text-ink">Client</h2>
            <p className="mt-1 text-sm text-ink-muted">
              Les champs déjà connus pourront être complétés plus tard.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <ChampTexte
              label="Civilité"
              value={client.civilite}
              onChange={(v) => modifierClient("civilite", v)}
              placeholder="M., Mme…"
            />
            <ChampTexte
              label="Prénom"
              value={client.prenom}
              onChange={(v) => modifierClient("prenom", v)}
            />
            <ChampTexte
              label="Nom *"
              value={client.nom}
              onChange={(v) => modifierClient("nom", v)}
              required
            />
            <ChampTexte
              label="Date de naissance"
              value={client.date_naissance}
              onChange={(v) => modifierClient("date_naissance", v)}
              type="date"
            />
            <ChampTexte
              label="Email"
              value={client.email}
              onChange={(v) => modifierClient("email", v)}
              type="email"
            />
            <ChampTexte
              label="Mobile"
              value={client.mobile}
              onChange={(v) => modifierClient("mobile", v)}
              type="tel"
            />
            <ChampTexte
              label="Téléphone"
              value={client.telephone}
              onChange={(v) => modifierClient("telephone", v)}
              type="tel"
            />
            <ChampTexte
              label="Adresse"
              value={client.adresse}
              onChange={(v) => modifierClient("adresse", v)}
            />
            <ChampTexte
              label="Code postal"
              value={client.code_postal}
              onChange={(v) => modifierClient("code_postal", v)}
            />
            <ChampTexte
              label="Ville"
              value={client.ville}
              onChange={(v) => modifierClient("ville", v)}
            />
          </div>
        </section>

        <section className="rounded-2xl border border-line bg-surface-elevated p-5 sm:p-6">
          <div className="mb-4">
            <h2 className="font-serif text-xl font-medium text-ink">Dossier</h2>
            <p className="mt-1 text-sm text-ink-muted">
              Le dossier sera créé avec son statut initial et sa liste de pièces attendues.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-medium text-ink">
              Type d’assurance *
              <select
                required
                value={dossier.type_assurance}
                onChange={(event) => modifierDossier("type_assurance", event.target.value)}
                className="rounded-lg border border-line bg-background px-3 py-2.5 text-sm font-normal"
              >
                <option value="">Choisir une branche</option>
                {BRANCHES_CREATION.map((branche) => (
                  <option key={branche.value} value={branche.value}>
                    {branche.label}
                  </option>
                ))}
              </select>
            </label>
            <ChampTexte
              label="Nom / intitulé du dossier *"
              value={dossier.intitule}
              onChange={(v) => modifierDossier("intitule", v)}
              required
            />
            <ChampTexte
              label="Objet / besoin"
              value={dossier.besoin}
              onChange={(v) => modifierDossier("besoin", v)}
              multiline
            />
            <ChampTexte
              label="Commentaire initial"
              value={dossier.commentaire_initial}
              onChange={(v) => modifierDossier("commentaire_initial", v)}
              multiline
            />
          </div>
        </section>

        {erreur && (
          <p
            role="alert"
            className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900"
          >
            {erreur}
          </p>
        )}

        {candidat && (
          <section
            role="alert"
            className="rounded-2xl border border-amber-300 bg-amber-50 p-5 text-amber-950"
          >
            <h2 className="font-semibold">Un client correspondant existe déjà</h2>
            <p className="mt-1 text-sm">
              {candidat.prenom ? `${candidat.prenom} ` : ""}
              {candidat.nom}
              {candidat.email ? ` · ${candidat.email}` : ""}
              {candidat.mobile || candidat.telephone
                ? ` · ${candidat.mobile ?? candidat.telephone}`
                : ""}
            </p>
            <p className="mt-2 text-sm">
              Le nouveau dossier sera rattaché à cette fiche, sans modifier ses coordonnées.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void soumettre(candidat.client_id)}
                disabled={enregistrement}
                className="rounded-full bg-[#0A192F] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {enregistrement ? "Création…" : "Confirmer et créer le dossier"}
              </button>
              <button
                type="button"
                onClick={() => setCandidat(null)}
                disabled={enregistrement}
                className="rounded-full border border-amber-700/30 px-4 py-2 text-sm font-medium disabled:opacity-60"
              >
                Vérifier les informations
              </button>
            </div>
          </section>
        )}

        {!candidat && (
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={enregistrement}
              className="rounded-full bg-[#D4AF37] px-5 py-2.5 text-sm font-semibold text-[#0A192F] transition hover:brightness-95 disabled:cursor-wait disabled:opacity-60"
            >
              {enregistrement ? "Création en cours…" : "Créer le client & le dossier"}
            </button>
          </div>
        )}
      </form>
    </div>
  );
}

function ChampTexte({
  label,
  value,
  onChange,
  type = "text",
  required = false,
  placeholder,
  multiline = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
  multiline?: boolean;
}) {
  const classe =
    "w-full rounded-lg border border-line bg-background px-3 py-2.5 text-sm font-normal outline-none focus:border-[#0A192F]";
  return (
    <label className="grid gap-1.5 text-sm font-medium text-ink">
      {label}
      {multiline ? (
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          rows={3}
          maxLength={3000}
          placeholder={placeholder}
          className={classe}
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          required={required}
          placeholder={placeholder}
          maxLength={type === "email" ? 255 : undefined}
          className={classe}
        />
      )}
    </label>
  );
}
