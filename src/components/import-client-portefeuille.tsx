import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { creerClientDossierRapide } from "@/lib/creation-rapide-client-dossier.functions";
import {
  archiverPieceImportPortefeuille,
  extraireAttestationPortefeuille,
} from "@/lib/import-portefeuille.functions";
import { BRANCHES_CREATION } from "@/lib/recueil-besoins-schemas";
import { piecesRequisesPour } from "@/lib/pieces-requises";

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

export function ImportClientPortefeuille({ onCreated, onCancel }: Props) {
  const creerDossier = useServerFn(creerClientDossierRapide);
  const extraire = useServerFn(extraireAttestationPortefeuille);
  const archiverPiece = useServerFn(archiverPieceImportPortefeuille);
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
      setDonnees((current) => {
        const next = { ...current };
        for (const [key, value] of Object.entries(resultat)) {
          if (key in next && typeof value === "string" && value)
            (next as Record<string, string>)[key] = value;
        }
        return next;
      });
      setMessage("Lecture terminée. Vérifiez et corrigez les informations avant la création.");
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
  const archiverDocuments = async (clientId: string, dossierId: string) => {
    const fichiers = [
      { file: attestation!, code: "attestation_assurance" as const, libelle: "Attestation" },
      { file: kyc.cni!, code: "cni" as const, libelle: "Pièce d'identité" },
      {
        file: kyc.justificatif_domicile!,
        code: "justificatif_domicile" as const,
        libelle: "Justificatif de domicile",
      },
      { file: kyc.rib!, code: "rib" as const, libelle: "RIB" },
    ];
    const echecs: string[] = [];
    for (const piece of fichiers) {
      try {
        await archiverPiece({
          data: {
            client_id: clientId,
            dossier_id: dossierId,
            code: piece.code,
            file_name: piece.file.name,
            mime_type: piece.file.type as (typeof FORMATS)[number],
            base64: await lireBase64(piece.file),
          },
        });
      } catch (e) {
        echecs.push(
          piece.libelle + " (" + (e instanceof Error ? e.message : "erreur inconnue") + ")",
        );
      }
    }
    return echecs;
  };

  const fichierValide = (file: File | null, libelle: string): string | null => {
    if (!file) return libelle + " manquant(e).";
    if (file.size > TAILLE_MAX) return libelle + " : 8 Mo maximum.";
    if (!(FORMATS as readonly string[]).includes(file.type))
      return libelle + " : format PDF, JPG, PNG ou WEBP.";
    return null;
  };

  const lancerCreation = async (confirmerClientId: string | null = null) => {
    if (envoi) return;
    if (
      !attestation ||
      !donnees.nom.trim() ||
      !typeAssurance ||
      !kyc.cni ||
      !kyc.justificatif_domicile ||
      !kyc.rib
    ) {
      setErreur(
        "L'attestation, le nom, le type d'assurance et les trois documents KYC sont obligatoires.",
      );
      return;
    }
    const invalide = [
      fichierValide(attestation, "Attestation"),
      fichierValide(kyc.cni, "Pièce d'identité"),
      fichierValide(kyc.justificatif_domicile, "Justificatif de domicile"),
      fichierValide(kyc.rib, "RIB"),
    ].filter(Boolean);
    if (invalide.length) {
      setErreur(invalide.join(" "));
      return;
    }
    setEnvoi(true);
    setErreur("");
    setMessage("");
    try {
      const resultat = await creerDossier({
        data: {
          client: {
            civilite: donnees.civilite || null,
            prenom: donnees.prenom || null,
            nom: donnees.nom,
            date_naissance: donnees.date_naissance || null,
            email: donnees.email || null,
            mobile: donnees.mobile || null,
            telephone: donnees.telephone || null,
            adresse: donnees.adresse || null,
            code_postal: donnees.code_postal || null,
            ville: donnees.ville || null,
          },
          dossier: {
            type_assurance: typeAssurance,
            intitule: [donnees.type_couverture || "Contrat existant", donnees.assureur]
              .filter(Boolean)
              .join(" — ")
              .slice(0, 160),
            besoin:
              "Reprise d'un contrat déjà en portefeuille. Vérifier les garanties et les échéances.",
            commentaire_initial: [
              "Import depuis le portefeuille existant.",
              donnees.assureur ? "Assureur : " + donnees.assureur : null,
              donnees.numero_contrat ? "N° contrat : " + donnees.numero_contrat : null,
              donnees.date_effet ? "Date d'effet : " + donnees.date_effet : null,
              donnees.date_echeance ? "Échéance : " + donnees.date_echeance : null,
            ]
              .filter(Boolean)
              .join("\n"),
          },
          confirmer_client_id: confirmerClientId,
        },
      });
      if (resultat.status === "confirmation_required") {
        setDoublon(resultat.candidate);
        return;
      }
      if (resultat.status === "invalid_confirmation") {
        setDoublon(null);
        setErreur("La fiche existante a changé. Vérifiez les informations et recommencez.");
        return;
      }
      const echecs = await archiverDocuments(resultat.client_id, resultat.dossier_id);
      if (echecs.length) {
        setDoublon(null);
        setErreur(
          "Dossier " +
            resultat.dossier_reference +
            " créé, mais archivage partiel. Pièces non archivées : " +
            echecs.join(" ; "),
        );
        setMessage(
          "Ne relancez pas l'import : ouvrez la fiche client et déposez les pièces manquantes depuis le dossier.",
        );
        setDossierCree(resultat.client_id);
        return;
      }
      toast.success("Client, dossier et documents créés.");
      onCreated(resultat.client_id);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Création du client impossible.");
    } finally {
      setEnvoi(false);
    }
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
          <h2 className="text-lg font-semibold text-ink">
            Importer un client déjà en portefeuille
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            L'IA préremplit les champs visibles. Rien n'est enregistré avant votre validation.
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
      <div className="grid gap-3 rounded-xl border border-line p-4 sm:grid-cols-2">
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
      <div className="rounded-xl border border-line p-4">
        <h3 className="font-semibold text-ink">Documents KYC obligatoires</h3>
        <p className="mt-1 text-sm text-ink-muted">
          Les trois documents seront archivés dans la fiche client et reliés à la checklist du
          dossier.
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
              <span className="mb-1 block">{label} *</span>
              <input
                required
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.webp"
                onChange={(e) =>
                  setKyc((current) => ({ ...current, [key]: e.target.files?.[0] ?? null }))
                }
                className="block w-full text-xs"
              />
              {kyc[key] && (
                <span className="mt-1 block truncate text-xs text-ink-muted">{kyc[key]?.name}</span>
              )}
            </label>
          ))}
        </div>
      </div>
      {typeAssurance && (
        <div className="rounded-xl bg-background p-4">
          <h3 className="text-sm font-semibold text-ink">Checklist documentaire du dossier</h3>
          <ul className="mt-2 space-y-1 text-sm text-ink-muted">
            {piecesRequisesPour(typeAssurance).map((p) => (
              <li key={p.code}>
                • {p.libelle} {p.obligatoire ? "(obligatoire)" : "(facultatif)"}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-ink-muted">
            Les pièces spécifiques non fournies resteront manquantes dans le dossier.
          </p>
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
          onClick={() => void lancerCreation()}
          className="rounded-full bg-[#0A192F] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {envoi
            ? "Création et archivage…"
            : "Créer le client, le dossier et archiver les documents"}
        </button>
      )}
    </section>
  );
}
