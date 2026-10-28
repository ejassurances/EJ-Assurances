import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { enregistrerContratImportPortefeuille } from "@/lib/import-contrat-portefeuille.functions";
import {
  extraireAttestationPortefeuille,
  verifierContratImportPortefeuille,
} from "@/lib/import-portefeuille.functions";
import { BRANCHES_CREATION } from "@/lib/recueil-besoins-schemas";

type Props = { onCreated: (clientId: string) => void; onCancel: () => void };
type Donnees = {
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
  assureur: string;
  numero_contrat: string;
  date_effet: string;
  date_echeance: string;
  type_couverture: string;
};
const VIDE: Donnees = {
  civilite: "M.",
  prenom: "",
  nom: "",
  date_naissance: "",
  email: "",
  mobile: "",
  telephone: "",
  adresse: "",
  code_postal: "",
  ville: "",
  assureur: "",
  numero_contrat: "",
  date_effet: "",
  date_echeance: "",
  type_couverture: "",
};
const FORMATS = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;
const TAILLE_MAX = 8 * 1024 * 1024;
type FichiersKyc = { cni: File | null; justificatif_domicile: File | null; rib: File | null };
type ContratExistantImport = {
  contrat_id: string;
  client_id: string;
  client_nom: string;
  numero: string | null;
  assureur: string;
  produit: string;
  date_effet: string | null;
  date_echeance: string | null;
  differences: Array<{ key: string; label: string; imported: string; existing: string }>;
};

export function ImportClientPortefeuille({ onCreated, onCancel }: Props) {
  const enregistrerContrat = useServerFn(enregistrerContratImportPortefeuille);
  const extraire = useServerFn(extraireAttestationPortefeuille);
  const verifierContrat = useServerFn(verifierContratImportPortefeuille);
  const [attestation, setAttestation] = useState<File | null>(null);
  const [donnees, setDonnees] = useState<Donnees>(VIDE);
  const [typeAssurance, setTypeAssurance] = useState("");
  const [kyc, setKyc] = useState<FichiersKyc>({
    cni: null,
    justificatif_domicile: null,
    rib: null,
  });
  const [lecture, setLecture] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState("");
  const [message, setMessage] = useState("");
  const [dossierCree, setDossierCree] = useState<string | null>(null);
  const [contratsExistants, setContratsExistants] = useState<ContratExistantImport[] | null>(null);
  const [doublon, setDoublon] = useState<{
    client_id: string;
    nom: string;
    prenom: string | null;
    email: string | null;
    mobile: string | null;
    telephone: string | null;
  } | null>(null);

  const lireBase64 = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Lecture du fichier impossible."));
      reader.onload = () => {
        const raw = String(reader.result || "");
        const encoded = raw.includes(",") ? raw.slice(raw.indexOf(",") + 1) : "";
        if (encoded) resolve(encoded);
        else reject(new Error("Le fichier est vide ou illisible."));
      };
      reader.readAsDataURL(file);
    });

  const choisirAttestation = async (file: File | null) => {
    setAttestation(file);
    setErreur("");
    setMessage("");
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      setErreur("L'attestation doit faire 8 Mo maximum.");
      return;
    }
    if (!["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setErreur("Format accepté : PDF, JPG, PNG ou WEBP.");
      return;
    }
    setLecture(true);
    try {
      const resultat = await extraire({
        data: {
          file_name: file.name,
          mime_type: file.type as "application/pdf" | "image/jpeg" | "image/png" | "image/webp",
          base64: await lireBase64(file),
        },
      });
      const donneesExtraites = { ...VIDE };
      for (const [key, value] of Object.entries(resultat)) {
        if (key in donneesExtraites && typeof value === "string" && value)
          (donneesExtraites as Record<string, string>)[key] = value;
      }
      setDonnees(donneesExtraites);
      const brancheExtraite = resultat.type_assurance ?? "";
      setTypeAssurance(brancheExtraite);
      if (donneesExtraites.nom.trim() && brancheExtraite) {
        setMessage("Attestation lue. Vérification du contrat dans le CRM…");
        await preparerCreation(donneesExtraites, brancheExtraite, file);
      } else {
        setMessage(
          "Lecture terminée. Le logiciel n’a pas pu identifier avec certitude le nom ou le type d’assurance. Complétez uniquement les informations manquantes puis lancez la création.",
        );
      }
    } catch (e) {
      setErreur(
        e instanceof Error
          ? e.message
          : "Lecture automatique impossible. Vous pouvez saisir les champs manuellement.",
      );
    } finally {
      setLecture(false);
    }
  };

  /** Archive chaque pièce séparément ; retourne la liste des pièces en échec. */
  const fichierValide = (file: File | null, libelle: string): string | null => {
    if (!file) return libelle + " manquant(e).";
    if (file.size > TAILLE_MAX) return libelle + " : 8 Mo maximum.";
    if (!(FORMATS as readonly string[]).includes(file.type))
      return libelle + " : format PDF, JPG, PNG ou WEBP.";
    return null;
  };

  const preparerCreation = async (
    donneesSource: Donnees = donnees,
    typeSource: string = typeAssurance,
    attestationSource: File | null = attestation,
  ) => {
    if (envoi) return;
    if (!attestationSource || !donneesSource.nom.trim() || !typeSource) {
      setErreur("L'attestation, le nom et le type d'assurance sont obligatoires.");
      return;
    }
    setEnvoi(true);
    setErreur("");
    setContratsExistants(null);
    try {
      const verification = await verifierContrat({
        data: {
          nom: donneesSource.nom,
          prenom: donneesSource.prenom || null,
          date_naissance: donneesSource.date_naissance || null,
          email: donneesSource.email || null,
          mobile: donneesSource.mobile || null,
          telephone: donneesSource.telephone || null,
          assureur: donneesSource.assureur || null,
          numero_contrat: donneesSource.numero_contrat || null,
          date_effet: donneesSource.date_effet || null,
          date_echeance: donneesSource.date_echeance || null,
          type_couverture: donneesSource.type_couverture || null,
        },
      });
      if (verification.found) {
        setContratsExistants(verification.matches);
        setDoublon(null);
        setMessage(
          "Un contrat correspondant a été trouvé dans le CRM. Vérifiez les différences avant de continuer.",
        );
        return;
      }
      setMessage("Aucun contrat correspondant trouvé. Recherche de la fiche client existante ; aucun dossier ne sera créé.");
      await lancerCreation(null, donneesSource, typeSource, attestationSource);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Vérification du contrat impossible.");
    } finally {
      setEnvoi(false);
    }
  };
  const lancerCreation = async (
    contratId: string | null = null,
    donneesSource: Donnees = donnees,
    typeSource: string = typeAssurance,
    attestationSource: File | null = attestation,
  ) => {
    if (envoi) return;
    if (!attestationSource || !donneesSource.nom.trim() || !typeSource || !donneesSource.assureur.trim()) {
      setErreur("Nom, assureur, type de couverture et attestation sont nécessaires.");
      return;
    }
    const fichiersChoisis = [
      { file: attestationSource, code: "attestation_assurance" as const },
      ...(kyc.cni ? [{ file: kyc.cni, code: "cni" as const }] : []),
      ...(kyc.justificatif_domicile ? [{ file: kyc.justificatif_domicile, code: "justificatif_domicile" as const }] : []),
      ...(kyc.rib ? [{ file: kyc.rib, code: "rib" as const }] : []),
    ];
    const invalide = fichiersChoisis.map(({ file }) => fichierValide(file, file.name)).filter(Boolean);
    if (invalide.length) { setErreur(invalide.join(" ")); return; }
    setEnvoi(true); setErreur(""); setMessage("");
    try {
      const fichiers = await Promise.all(fichiersChoisis.map(async ({ file, code }) => ({
        code, file_name: file.name, mime_type: file.type as (typeof FORMATS)[number], base64: await lireBase64(file),
      })));
      const resultat = await enregistrerContrat({ data: {
        contrat_id: contratId,
        client: { nom: donneesSource.nom, prenom: donneesSource.prenom || null, date_naissance: donneesSource.date_naissance || null, email: donneesSource.email || null, mobile: donneesSource.mobile || null, telephone: donneesSource.telephone || null },
        contrat: { assureur: donneesSource.assureur, numero: donneesSource.numero_contrat || null, produit: donneesSource.type_couverture || typeSource, date_effet: donneesSource.date_effet || null, date_echeance: donneesSource.date_echeance || null },
        fichiers,
      } });
      toast.success(contratId ? "Contrat mis à jour et documents archivés." : "Contrat importé et documents archivés.");
      onCreated(resultat.client_id);
    } catch (e) { setErreur(e instanceof Error ? e.message : "Import du contrat impossible."); }
    finally { setEnvoi(false); }
  };

  const champ = (key: keyof Donnees, label: string, type = "text", required = false) => (
    <label key={key} className="block text-sm text-ink-soft">
      <span className="mb-1 block">
        {label}
        {required ? " *" : ""}
      </span>
      <input
        type={type}
        required={required}
        value={donnees[key]}
        onChange={(e) => setDonnees((current) => ({ ...current, [key]: e.target.value }))}
        className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm text-ink"
      />
    </label>
  );

  return (
    <section className="mt-6 space-y-4 rounded-2xl border border-line bg-surface-elevated p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-ink">Importer un contrat déjà en portefeuille</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Le logiciel recherche la fiche client existante et enregistre le contrat sans créer de dossier artificiel ni de nouvelle fiche client.
          </p>
        </div>
        <button type="button" onClick={onCancel} className="text-sm text-ink-muted underline">
          Retour au choix
        </button>
      </div>
      <label className="block rounded-xl border border-dashed border-line p-4">
        <span className="block text-sm font-semibold text-ink">
          Attestation d'assurance actuelle *
        </span>
        <span className="mt-1 block text-xs text-ink-muted">
          PDF, JPG, PNG ou WEBP · 8 Mo maximum.
        </span>
        <input
          required
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
          onChange={(e) => void choisirAttestation(e.target.files?.[0] ?? null)}
          className="mt-3 block w-full text-sm"
        />
        {attestation && (
          <span className="mt-2 block text-xs text-ink-soft">
            {attestation.name} · {Math.ceil(attestation.size / 1024)} Ko
          </span>
        )}
        {lecture && (
          <span className="mt-2 block text-sm text-ink-muted">
            Lecture de l'attestation en cours…
          </span>
        )}
      </label>
      <details className="rounded-xl border border-line p-4">
        <summary className="cursor-pointer text-sm font-semibold text-ink">
          Informations extraites (à consulter ou corriger si nécessaire)
        </summary>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm text-ink-soft sm:col-span-2">
            <span className="mb-1 block">Type d'assurance *</span>
            <select
              required
              value={typeAssurance}
              onChange={(e) => setTypeAssurance(e.target.value)}
              className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm text-ink"
            >
              <option value="">Choisir une branche</option>
              {BRANCHES_CREATION.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </select>
          </label>
          {champ("civilite", "Civilité")}
          {champ("prenom", "Prénom")}
          {champ("nom", "Nom", "text", true)}
          {champ("date_naissance", "Date de naissance", "date")}
          {champ("email", "E-mail", "email")}
          {champ("mobile", "Mobile")}
          {champ("telephone", "Téléphone fixe")}
          {champ("adresse", "Adresse")}
          {champ("code_postal", "Code postal")}
          {champ("ville", "Ville")}
          {champ("assureur", "Assureur")}
          {champ("numero_contrat", "Numéro de contrat")}
          {champ("date_effet", "Date d'effet", "date")}
          {champ("date_echeance", "Date d'échéance", "date")}
          {champ("type_couverture", "Type de couverture")}
        </div>
      </details>
      <details className="rounded-xl border border-line p-4">
        <summary className="cursor-pointer font-semibold text-ink">
          Documents complémentaires (facultatif)
        </summary>
        <div className="mt-3">
          <h3 className="font-semibold text-ink">Documents KYC (ajout possible plus tard)</h3>
          <p className="mt-1 text-sm text-ink-muted">
            Ajoutez uniquement les documents disponibles. Les pièces complémentaires restent facultatives à cette étape.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {(
              [
                ["cni", "Pièce d'identité (CNI ou passeport)"],
                ["justificatif_domicile", "Justificatif de domicile de moins de 3 mois"],
                ["rib", "RIB"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="block text-sm text-ink-soft">
                <span className="mb-1 block">{label}</span>
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.webp"
                  onChange={(e) =>
                    setKyc((current) => ({ ...current, [key]: e.target.files?.[0] ?? null }))
                  }
                  className="block w-full text-xs"
                />
                {kyc[key] && (
                  <span className="mt-1 block truncate text-xs text-ink-muted">
                    {kyc[key]?.name}
                  </span>
                )}
              </label>
            ))}
          </div>
        </div>
      </details>
      {typeAssurance && (
        <div className="rounded-xl bg-background p-4">
          <h3 className="text-sm font-semibold text-ink">Import au portefeuille</h3>
          <p className="mt-2 text-sm text-ink-muted">Cet import enregistre le contrat sur la fiche client existante. Il ne crée aucun dossier et ne réclame pas de pièces complémentaires absentes.</p>
        </div>
      )}
      {message && (
        <p
          role="status"
          className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
        >
          {message}
        </p>
      )}
      {erreur && (
        <p
          role="alert"
          className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900"
        >
          {erreur}
        </p>
      )}
      {contratsExistants && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
          <h3 className="font-semibold">Contrat déjà présent ou correspondance probable</h3>
          <p className="mt-1 text-sm">
            Le CRM a trouvé un ou plusieurs contrats correspondants. Aucun champ existant n’a été
            modifié. Comparez les valeurs avant de décider.
          </p>
          <div className="mt-3 space-y-3">
            {contratsExistants.map((contrat) => (
              <div
                key={contrat.contrat_id}
                className="rounded-lg border border-amber-800/20 bg-white/70 p-3"
              >
                <p className="font-medium">
                  {contrat.client_nom || "Client sans nom"} · {contrat.numero || "Sans numéro"}
                </p>
                <p className="mt-1 text-sm">
                  {contrat.assureur} · {contrat.produit}
                  {contrat.date_effet ? " · Effet : " + contrat.date_effet : ""}
                  {contrat.date_echeance ? " · Échéance : " + contrat.date_echeance : ""}
                </p>
                {contrat.differences.length ? (
                  <div className="mt-2">
                    <p className="text-sm font-semibold">Différences détectées</p>
                    <ul className="mt-1 space-y-1 text-sm">
                      {contrat.differences.map((difference) => (
                        <li key={difference.key}>
                          <span className="font-medium">{difference.label} :</span> CRM ={" "}
                          {difference.existing} · Attestation = {difference.imported}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="mt-2 text-sm">
                    Aucune différence sur les champs comparables renseignés.
                  </p>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" disabled={envoi} onClick={() => void lancerCreation(contrat.contrat_id)} className="rounded-full bg-[#0A192F] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
                    Importer / mettre à jour ce contrat
                  </button>
                  <button type="button" onClick={() => onCreated(contrat.client_id)} className="rounded-full border border-amber-800/30 px-3 py-1.5 text-sm font-medium">
                    Ouvrir la fiche client
                  </button>
                </div>
              </div>
            ))}
          </div>

        </div>
      )}
      {doublon && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
          <h3 className="font-semibold">Une fiche client correspond peut-être déjà</h3>
          <p className="mt-1 text-sm">
            Vous pouvez rattacher le nouveau dossier à cette fiche plutôt que créer un doublon.
          </p>
          <p className="mt-2 text-sm font-medium">
            {[doublon.prenom, doublon.nom].filter(Boolean).join(" ")}
            {doublon.email ? " · " + doublon.email : ""}
            {doublon.mobile || doublon.telephone
              ? " · " + (doublon.mobile || doublon.telephone)
              : ""}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={envoi}
              onClick={() => void lancerCreation(doublon.client_id)}
              className="rounded-full bg-[#0A192F] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {envoi ? "Création…" : "Rattacher le dossier à cette fiche"}
            </button>
            <button
              type="button"
              disabled={envoi}
              onClick={() => onCreated(doublon.client_id)}
              className="rounded-full border border-amber-800/30 px-4 py-2 text-sm font-medium"
            >
              Ouvrir la fiche sans créer le dossier
            </button>
          </div>
        </div>
      )}
      {dossierCree && (
        <button
          type="button"
          onClick={() => onCreated(dossierCree)}
          className="rounded-full border border-line px-4 py-2 text-sm font-semibold text-ink"
        >
          Ouvrir la fiche client
        </button>
      )}
      {!doublon && !dossierCree && (
        <button
          type="button"
          disabled={envoi || lecture}
          onClick={() => void preparerCreation()}
          className="rounded-full bg-[#0A192F] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {envoi ? "Import et archivage…" : "Importer le contrat et archiver les documents"}
        </button>
      )}
    </section>
  );
}
