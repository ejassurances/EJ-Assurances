import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ProduitDocumentsLink } from "@/components/produit-documents-link";
import { normaliserNomFichierPourStockage } from "@/lib/storage-key";
import { useServerFn } from "@tanstack/react-start";
import { extraireAttestationPortefeuille } from "@/lib/import-portefeuille.functions";

type Doc = {
  id: string;
  file_name: string;
  file_size: number | null;
  storage_path: string;
  created_at: string;
  type_document: string | null;
};

/** Typologie des pièces contractuelles archivées sur un contrat. */
const TYPES_DOCUMENT = [
  { code: "attestation_assurance", libelle: "Attestation d'assurance" },
  { code: "avis_echeance", libelle: "Avis d'échéance" },
  { code: "conditions_particulieres", libelle: "Conditions particulières" },
  { code: "autre", libelle: "Autre" },
] as const;

/** Pièces du client qui relèvent du contrat mais n'y sont pas encore rattachées. */
const TYPES_RATTACHABLES = ["attestation_assurance", "avis_echeance", "conditions_particulieres"];

function libelleType(code: string | null): string {
  return TYPES_DOCUMENT.find((t) => t.code === code)?.libelle ?? "Type non précisé";
}

/**
 * Archivage libre des documents d'un contrat (police, avis d'échéance,
 * conditions particulières…), indépendamment du parcours DDA. Affiche aussi les
 * pièces contractuelles du produit (CG, IPID) pour éviter toute navigation.
 */
export function ContratDocumentsPanel({
  contratId,
  clientId,
  userId,
  canEdit = true,
  produitId = null,
  compagnieId = null,
  onPrimeUpdated,
}: {
  contratId: string;
  /** Client titulaire : le fichier est rangé dans son dossier pour l'espace client. */
  clientId: string;
  userId: string;
  canEdit?: boolean;
  /** Produit rattaché : ses CG/IPID sont affichés directement ici. */
  produitId?: string | null;
  compagnieId?: string | null;
  onPrimeUpdated?: () => void | Promise<void>;
}) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [rattachables, setRattachables] = useState<Doc[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<string>("attestation_assurance");
  const [analyseId, setAnalyseId] = useState<string | null>(null);
  const [analyse, setAnalyse] = useState<{ docId: string; montant: number; periodicite: "mensuelle" | "annuelle" } | null>(null);
  const [savingPrime, setSavingPrime] = useState(false);
  const extraireAttestation = useServerFn(extraireAttestationPortefeuille);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    const cols = "id,file_name,file_size,storage_path,created_at,type_document";
    const [lies, duClient] = await Promise.all([
      supabase
        .from("documents")
        .select(cols)
        .eq("contrat_id", contratId)
        .is("archive_le", null)
        .order("created_at", { ascending: false }),
      supabase
        .from("documents")
        .select(cols)
        .eq("client_id", clientId)
        .is("contrat_id", null)
        .is("archive_le", null)
        .in("type_document", TYPES_RATTACHABLES)
        .order("created_at", { ascending: false }),
    ]);
    setDocs((lies.data ?? []) as Doc[]);
    setRattachables((duClient.data ?? []) as Doc[]);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contratId, clientId]);

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);

    // Garder l'identifiant client en premier segment pour les règles Storage.
    // Le nom d'origine reste en métadonnée, mais la clé utilise un nom sûr.
    const safeName = normaliserNomFichierPourStockage(file.name);
    const path = `${clientId}/contrats/${contratId}/${Date.now()}-${safeName}`;

    try {
      const { error: upErr } = await supabase
        .storage.from("dossier-documents")
        .upload(path, file);
      if (upErr) throw new Error(`Échec de l'envoi du fichier : ${upErr.message}`);

      const { error: dbErr } = await supabase.from("documents").insert({
        contrat_id: contratId,
        client_id: clientId,
        uploader_id: userId,
        storage_path: path,
        file_name: file.name,
        file_size: file.size,
        mime_type: file.type || null,
        type_document: type,
      });

      if (dbErr) {
        const { error: cleanupErr } = await supabase
          .storage.from("dossier-documents")
          .remove([path]);
        throw new Error(
          cleanupErr
            ? `L'archivage a échoué (${dbErr.message}) et le fichier n'a pas pu être nettoyé (${cleanupErr.message}).`
            : `L'archivage du document a échoué : ${dbErr.message}. Le fichier envoyé a été nettoyé.`,
        );
      }

      await load();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Une erreur inattendue est survenue pendant l'envoi.",
      );
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const analyserPrime = async (doc: Doc) => {
    setError(null);
    setAnalyse(null);
    setAnalyseId(doc.id);
    try {
      const { data: fichier, error: downloadError } = await supabase.storage
        .from("dossier-documents")
        .download(doc.storage_path);
      if (downloadError || !fichier) throw new Error(downloadError?.message ?? "Téléchargement du document impossible.");
      if (fichier.size > 8 * 1024 * 1024) throw new Error("Le document dépasse la limite de 8 Mo pour l'analyse.");
      const mime = fichier.type || (doc.file_name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "");
      if (!["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(mime)) {
        throw new Error("Format non pris en charge pour l'analyse automatique (PDF, JPG, PNG ou WEBP).");
      }
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("Lecture du document impossible."));
        reader.onload = () => {
          const raw = String(reader.result || "");
          const encoded = raw.includes(",") ? raw.slice(raw.indexOf(",") + 1) : "";
          encoded ? resolve(encoded) : reject(new Error("Le document est vide ou illisible."));
        };
        reader.readAsDataURL(fichier);
      });
      const resultat = await extraireAttestation({
        data: { file_name: doc.file_name, mime_type: mime as "application/pdf" | "image/jpeg" | "image/png" | "image/webp", base64 },
      });
      if (typeof resultat.prime_montant !== "number" || !Number.isFinite(resultat.prime_montant) || resultat.prime_montant <= 0) {
        throw new Error("Aucun montant de prime positif n'a été extrait avec certitude. Aucun montant n'a été modifié.");
      }
      if (resultat.prime_periodicite !== "mensuelle" && resultat.prime_periodicite !== "annuelle") {
        throw new Error("Le montant a été lu, mais sa périodicité n'est pas certaine. Aucun montant n'a été modifié.");
      }
      setAnalyse({ docId: doc.id, montant: resultat.prime_montant, periodicite: resultat.prime_periodicite });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analyse de l'attestation impossible.");
    } finally {
      setAnalyseId(null);
    }
  };

  const confirmerPrime = async () => {
    if (!analyse) return;
    setSavingPrime(true);
    setError(null);
    try {
      const { data: contrat, error: contratError } = await supabase
        .from("contrats")
        .select("prime_annuelle,statut")
        .eq("id", contratId)
        .maybeSingle();
      if (contratError || !contrat) throw new Error(contratError?.message ?? "Contrat introuvable.");
      if (contrat.prime_annuelle !== null) {
        throw new Error("La prime annuelle est déjà renseignée. Pour préserver la saisie existante, aucune valeur n'a été écrasée.");
      }
      const montantAnnuel = Math.round((analyse.periodicite === "mensuelle" ? analyse.montant * 12 : analyse.montant) * 100) / 100;
      const verrouille = ["actif", "contrat_actif", "contrat_valide"].includes(contrat.statut ?? "");
      const result = verrouille
        ? await supabase.rpc("corriger_contrat_actif", {
            _contrat_id: contratId,
            _motif: "Montant annuel extrait de l'attestation du contrat et confirmé par le conseiller",
            _champs: { prime_annuelle: montantAnnuel },
          })
        : await supabase.from("contrats").update({ prime_annuelle: montantAnnuel }).eq("id", contratId);
      if (result.error) throw new Error(result.error.message);
      setAnalyse(null);
      await load();
      await onPrimeUpdated?.();
      setError(null);
      // Le déclencheur SQL du contrat recalcule les échéances et la fiscalité à partir de la prime enregistrée.
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enregistrement de la prime impossible.");
    } finally {
      setSavingPrime(false);
    }
  };

  const download = async (path: string, name: string) => {
    const { data, error: sErr } = await supabase.storage.from("dossier-documents").createSignedUrl(path, 60);
    if (sErr || !data) return;
    const a = document.createElement("a");
    a.href = data.signedUrl;
    a.download = name;
    a.target = "_blank";
    a.rel = "noopener";
    a.click();
  };

  /** Traçabilité ACPR : le document est archivé (masqué), jamais supprimé. */
  const remove = async (doc: Doc) => {
    await supabase.from("documents").update({ archive_le: new Date().toISOString() }).eq("id", doc.id);
    load();
  };

  /** Rattache au contrat une pièce déjà déposée au niveau du client. */
  const rattacher = async (doc: Doc) => {
    const { error: e } = await supabase.from("documents").update({ contrat_id: contratId }).eq("id", doc.id);
    if (e) return setError(e.message);
    load();
  };

  return (
    <section className="crm-card min-w-0 space-y-3 p-5">
      <div>
        <h3 className="font-serif text-lg">Documents du contrat</h3>
        <p className="text-xs text-ink-muted">
          Conditions générales et IPID du produit, puis pièces contractuelles archivées (police d'assurance, avis
          d'échéance, conditions particulières…), indépendamment du parcours DDA.
        </p>
      </div>

      {produitId && <ProduitDocumentsLink produitId={produitId} compagnieId={compagnieId} />}

      {canEdit && (
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="rounded-md border border-line bg-background px-3 py-2 text-sm"
          >
            {TYPES_DOCUMENT.map((t) => (
              <option key={t.code} value={t.code}>
                {t.libelle}
              </option>
            ))}
          </select>
          <label className="cursor-pointer rounded-full bg-[#D4AF37] px-4 py-2 text-sm font-semibold text-[#0A192F] hover:brightness-95">
            {uploading ? "Envoi…" : "Ajouter un document"}
            <input ref={fileRef} type="file" onChange={onUpload} className="hidden" disabled={uploading} />
          </label>
          {error && <span role="alert" className="text-xs text-destructive">{error}</span>}
        </div>
      )}

      <ul className="space-y-2">
        {docs.length === 0 && <li className="text-sm text-ink-muted">Aucun document rattaché à ce contrat.</li>}
        {docs.map((d) => (
          <li
            key={d.id}
            className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-line bg-background px-3 py-2"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink">{d.file_name}</p>
              <p className="text-xs text-ink-muted">
                {libelleType(d.type_document)}{" · "}
                {d.file_size ? `${(d.file_size / 1024).toFixed(0)} Ko · ` : ""}
                {new Date(d.created_at).toLocaleDateString("fr-FR")}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              {canEdit && ["attestation_assurance", "avis_echeance", "conditions_particulieres"].includes(d.type_document ?? "") && (
                <button
                  onClick={() => analyserPrime(d)}
                  disabled={analyseId !== null || savingPrime}
                  className="rounded-full border border-line px-3 py-1 text-xs hover:bg-surface disabled:opacity-50"
                >
                  {analyseId === d.id ? "Analyse…" : "Lire la prime"}
                </button>
              )}
              <button
                onClick={() => download(d.storage_path, d.file_name)}
                className="rounded-full border border-line px-3 py-1 text-xs hover:bg-surface"
              >
                Télécharger
              </button>
              {canEdit && (
                <button
                  onClick={() => remove(d)}
                  className="rounded-full border border-line px-3 py-1 text-xs text-destructive hover:bg-surface"
                >
                  Supprimer
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {analyse && (
        <div className="rounded-lg border border-line bg-background p-4 space-y-3">
          <div>
            <p className="text-sm font-medium">Prime extraite de l'attestation</p>
            <p className="text-sm text-ink-muted">
              Montant lu : {new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(analyse.montant)}
              {" · "}{analyse.periodicite === "mensuelle" ? "par mois" : "par an"}
            </p>
            <p className="text-xs text-ink-muted">
              Prime annuelle proposée : {new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(analyse.periodicite === "mensuelle" ? analyse.montant * 12 : analyse.montant)}.
              Vérifiez ce montant sur le document avant confirmation. Une prime annuelle déjà renseignée ne sera jamais remplacée.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={confirmerPrime} disabled={savingPrime} className="rounded-full bg-[#0A192F] px-4 py-2 text-xs font-medium text-white disabled:opacity-50">
              {savingPrime ? "Enregistrement et recalcul…" : "Confirmer la prime et recalculer"}
            </button>
            <button onClick={() => setAnalyse(null)} disabled={savingPrime} className="rounded-full border border-line px-4 py-2 text-xs">
              Annuler
            </button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}

      {rattachables.length > 0 && (
        <div className="rounded-lg border border-dashed border-line p-3">
          <p className="text-xs font-medium text-ink-muted">
            Pièces contractuelles du client non rattachées à un contrat
          </p>
          <ul className="mt-2 space-y-2">
            {rattachables.map((d) => (
              <li key={d.id} className="flex min-w-0 items-center justify-between gap-3 text-sm">
                <span className="min-w-0">
                  <span className="truncate font-medium text-ink">{d.file_name}</span>
                  <span className="text-xs text-ink-muted"> · {libelleType(d.type_document)}</span>
                </span>
                <span className="flex shrink-0 gap-2">
                  <button
                    onClick={() => download(d.storage_path, d.file_name)}
                    className="rounded-full border border-line px-3 py-1 text-xs hover:bg-surface"
                  >
                    Ouvrir
                  </button>
                  {canEdit && (
                    <button
                      onClick={() => rattacher(d)}
                      className="rounded-full border border-line px-3 py-1 text-xs hover:bg-surface"
                    >
                      Rattacher à ce contrat
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
