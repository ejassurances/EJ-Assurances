/**
 * Documents de prêt du dossier emprunteur (offre de prêt, tableau
 * d'amortissement, échéancier).
 *
 * Affiché dans le devoir de conseil emprunteur : le conseiller doit pouvoir
 * consulter et télécharger l'offre de prêt et le tableau d'amortissement au
 * moment où il rédige sa recommandation, et les déposer s'ils manquent.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { monFichierUrl } from "@/lib/espace-client.functions";
import { analyserDocumentRecueil } from "@/lib/recueil-documents.functions";

type Doc = {
  id: string;
  file_name: string;
  type_document: string | null;
  categorie: string | null;
  created_at: string;
};

/** Motifs reconnus : offre de prêt, tableau d'amortissement, échéancier. */
const MOTIF = /(offre[-_ ]?de[-_ ]?pret|offre[-_ ]?pret|amortissement|amort|echeancier|échéancier|pret[-_ ]?immo)/i;

/** Motifs de l'étape « Devoir de conseil » : devis et devoir de conseil. */
const MOTIF_DEVIS = /(devis|proposition|tarification|devoir[-_ ]?de[-_ ]?conseil|devoir_conseil|recommandation)/i;

/** Motifs de l'étape « Analyse et décision » : documents reçus de l'assureur. */
const MOTIF_ASSUREUR =
  /(document_assureur|assureur|certificat|attestation|adhesion|adhésion|lettre[-_ ]?de[-_ ]?mission|lettre_mission|devis|devoir[-_ ]?de[-_ ]?conseil|devoir_conseil)/i;

function correspond(d: Doc, motif: RegExp): boolean {
  return motif.test(d.type_document ?? "") || motif.test(d.categorie ?? "") || motif.test(d.file_name ?? "");
}

function estDocumentPret(d: Doc): boolean {
  return correspond(d, MOTIF);
}


/** Natures de document proposées par étape du parcours emprunteur. */
export const TYPES_DOCUMENT: Record<string, { value: string; label: string }[]> = {
  pret: [
    { value: "offre_pret", label: "Offre de prêt" },
    { value: "tableau_amortissement", label: "Tableau d'amortissement" },
    { value: "echeancier_pret", label: "Échéancier de prêt" },
    { value: "contrat_pret", label: "Contrat / acte de prêt" },
    { value: "attestation_assurance_pret", label: "Attestation d'assurance actuelle" },
  ],
  devis_conseil: [
    { value: "devis", label: "Devis d'assurance" },
    { value: "proposition_tarification", label: "Proposition tarifaire" },
    { value: "devoir_conseil", label: "Devoir de conseil" },
    { value: "recommandation", label: "Recommandation" },
  ],
  assureur: [
    { value: "devis_final", label: "Devis final retenu" },
    { value: "lettre_mission_signee", label: "Lettre de mission signée" },
    { value: "devoir_conseil_signe", label: "Devoir de conseil signé" },
    { value: "certificat_adhesion", label: "Certificat d'adhésion" },
    { value: "attestation_assureur", label: "Attestation de l'assureur" },
    { value: "document_assureur", label: "Autre document de l'assureur" },
  ],
};

export function DocumentsPretPanel({
  dossierId,
  titre = "Offre de prêt et tableau d'amortissement",
  filtre = "pret",
  typeDocument = "offre_pret",
  onAnalyse,
  analyseAutorisee = true,
}: {
  dossierId: string;
  analyseAutorisee?: boolean;
  /** Intitulé du bloc. */
  titre?: string;
  /**
   * « pret » : offre de prêt et tableau d'amortissement ; « devis_conseil » :
   * devis et devoir de conseil ; « assureur » : documents reçus de la
   * compagnie ; « tous » : toutes les pièces (vue globale de traçabilité).
   */
  filtre?: "pret" | "devis_conseil" | "assureur" | "tous";
  /** Type enregistré lors du dépôt. */
  typeDocument?: string;
  /**
   * Appelé après l'analyse IA du document déposé : permet au recueil des
   * besoins de récupérer les données reportées (aucune valeur humaine écrasée).
   */
  onAnalyse?: (resultat: {
    recueil: Record<string, unknown> | null;
    ajouts: string[];
    manquants: string[];
  }) => void;
}) {
  const fichierUrl = useServerFn(monFichierUrl);
  const analyser = useServerFn(analyserDocumentRecueil);
  const [analyse, setAnalyse] = useState<string | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [clientId, setClientId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  /** Natures proposées pour cette étape (liste déroulante propre à l'étape). */
  const natures = TYPES_DOCUMENT[filtre] ?? [];
  const [nature, setNature] = useState<string>(natures[0]?.value ?? typeDocument);


  const load = useCallback(async () => {
    const [{ data: rows }, { data: dossier }] = await Promise.all([
      supabase
        .from("documents")
        .select("id, file_name, type_document, categorie, created_at")
        .eq("dossier_id", dossierId)
        .order("created_at", { ascending: false }),
      supabase.from("dossiers").select("client_id").eq("id", dossierId).maybeSingle(),
    ]);
    const tous = (rows ?? []) as Doc[];
    // Une nature explicitement choisie dans la liste de l'étape suffit à
    // rattacher la pièce à cette étape, même si le nom du fichier ne dit rien.
    const codes = new Set((TYPES_DOCUMENT[filtre] ?? []).map((n) => n.value));
    const retenu = (d: Doc, motif: RegExp) =>
      (d.type_document != null && codes.has(d.type_document)) || correspond(d, motif);
    setDocs(
      filtre === "tous"
        ? tous
        : filtre === "devis_conseil"
          ? tous.filter((d) => retenu(d, MOTIF_DEVIS))
          : filtre === "assureur"
            ? tous.filter((d) => retenu(d, MOTIF_ASSUREUR))
            : tous.filter((d) => retenu(d, MOTIF)),
    );
    setClientId(((dossier as { client_id: string | null } | null)?.client_id) ?? null);
  }, [dossierId, filtre]);


  useEffect(() => {
    void load();
  }, [load]);

  async function telecharger(doc: Doc) {
    setError(null);
    try {
      const res = await fichierUrl({ data: { source: "document", id: doc.id } });
      window.open(res.url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Téléchargement impossible");
    }
  }

  async function deposer(file: File) {
    setBusy(true);
    setError(null);
    try {
      const safeName = file.name.replace(/[^\w.\-]+/g, "_").slice(0, 120);
      // Ce document appartient au dossier : la RLS Storage attend dossierId en premier segment.
      const path = `${dossierId}/${Date.now()}-${safeName}`;
      const { error: upErr } = await supabase.storage
        .from("dossier-documents")
        .upload(path, file, { upsert: false });
      if (upErr) throw upErr;

      const { data: auth } = await supabase.auth.getUser();
      const uploaderId = auth.user?.id;
      if (!uploaderId) throw new Error("Session expirée — reconnectez-vous.");

      const { data: inserted, error: insErr } = await supabase
        .from("documents")
        .insert({
          dossier_id: dossierId,
          uploader_id: uploaderId,
          client_id: clientId,
          storage_path: path,
          file_name: file.name.slice(0, 200),
          file_size: file.size,
          mime_type: file.type || null,
          categorie: "dossier",
          type_document: nature || typeDocument,
        })
        .select("id")
        .maybeSingle();
      if (insErr) {
        const cleanup = await supabase.storage.from("dossier-documents").remove([path]);
        if (cleanup.error) throw new Error("Insertion échouée ; nettoyage du fichier à vérifier.");
        throw insErr;
      }

      // Marque la pièce requise « Offre de prêt / tableau d'amortissement ».
      const docId = (inserted as { id: string } | null)?.id ?? null;
      if (docId && (nature === "offre_pret" || nature === "tableau_amortissement")) {
        await supabase
          .from("dossier_pieces_requises")
          .update({ statut: "recue", recue_le: new Date().toISOString(), document_id: docId })
          .eq("dossier_id", dossierId)
          .eq("code", nature);
      }

      // Analyse IA du document : les données du prêt sont reportées dans le
      // recueil pour renseigner les étapes suivantes.
      if (docId && analyseAutorisee) {
        try {
          setAnalyse("Analyse du document par l'IA…");
          const res = await analyser({ data: { dossier_id: dossierId, document_id: docId } });
          const recueil = res.recueil_json
            ? (JSON.parse(res.recueil_json) as Record<string, unknown>)
            : null;
          onAnalyse?.({ recueil, ajouts: res.ajouts, manquants: res.manquants });
          setAnalyse(
            res.ajouts.length > 0
              ? `Données reportées au recueil : ${res.ajouts.join(", ")}.${res.manquants.length ? ` À compléter : ${res.manquants.join(", ")}.` : ""}`
              : "Aucune donnée exploitable détectée : saisie manuelle nécessaire.",
          );
        } catch (e) {
          setAnalyse(
            `Analyse IA indisponible : ${e instanceof Error ? e.message : "erreur"} — saisie manuelle.`,
          );
        }
      }

      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Dépôt impossible");
    }
    setBusy(false);
  }

  /** (Ré)analyse tous les documents de prêt déjà déposés sur le dossier. */
  async function analyserExistants() {
    setBusy(true);
    setError(null);
    setAnalyse("Analyse des documents par l'IA…");
    try {
      const res = await analyser({ data: { dossier_id: dossierId } });
      const recueil = res.recueil_json
        ? (JSON.parse(res.recueil_json) as Record<string, unknown>)
        : null;
      onAnalyse?.({ recueil, ajouts: res.ajouts, manquants: res.manquants });
      setAnalyse(
        res.ajouts.length > 0
          ? `Données reportées au recueil : ${res.ajouts.join(", ")}.${res.manquants.length ? ` À compléter : ${res.manquants.join(", ")}.` : ""}`
          : "Aucune donnée nouvelle exploitable : les champs sont déjà renseignés ou la saisie manuelle est nécessaire.",
      );
    } catch (e) {
      setAnalyse(`Analyse IA indisponible : ${e instanceof Error ? e.message : "erreur"}.`);
    }
    setBusy(false);
  }

  /** Reclassement d'une pièce déjà déposée (liste déroulante de l'étape). */
  async function changerNature(doc: Doc, valeur: string) {
    if (!valeur) return;
    setError(null);
    setDocs((prev) => prev.map((d) => (d.id === doc.id ? { ...d, type_document: valeur } : d)));
    const { error: err } = await supabase
      .from("documents")
      .update({ type_document: valeur })
      .eq("id", doc.id);
    if (err) setError(err.message);
    await load();
  }

  return (
    <div className="rounded-xl border border-line p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs uppercase tracking-wide text-ink-muted">{titre}</p>
        <div className="flex flex-wrap items-center gap-2">
          {natures.length > 0 && (
            <label className="flex items-center gap-1 text-xs text-ink-muted">
              Nature
              <select
                value={nature}
                onChange={(e) => setNature(e.target.value)}
                className="rounded-full border border-line bg-surface px-2 py-1 text-xs text-ink"
              >
                {natures.map((n) => (
                  <option key={n.value} value={n.value}>
                    {n.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {docs.length > 0 && analyseAutorisee && (
            <button
              type="button"
              onClick={() => void analyserExistants()}
              disabled={busy}
              className="rounded-full border border-line px-3 py-1 text-xs hover:bg-surface disabled:opacity-50"
            >
              Analyser et pré-remplir
            </button>
          )}
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={busy}
            className="rounded-full border border-line px-3 py-1 text-xs hover:bg-surface disabled:opacity-50"
          >
            {busy ? "Traitement…" : "Déposer un document"}
          </button>
        </div>
        <input
          ref={input}
          type="file"
          multiple
          accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls,.csv"
          className="hidden"
          onChange={(e) => {
            const fichiers = Array.from(e.target.files ?? []);
            e.target.value = "";
            void (async () => {
              for (const f of fichiers) await deposer(f);
            })();
          }}
        />
      </div>


      {docs.length === 0 ? (
        <p className="mt-2 text-xs text-ink-muted">
          {filtre === "pret"
            ? "Aucune offre de prêt ni tableau d'amortissement rattaché à ce dossier."
            : filtre === "devis_conseil"
              ? "Aucun devis ni devoir de conseil rattaché à ce dossier."
              : "Aucun document rattaché à ce dossier."}
        </p>

      ) : (
        <ul className="mt-2 space-y-1 text-sm">
          {docs.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 flex-1 truncate">{d.file_name}</span>
              {natures.length > 0 && (
                <select
                  value={
                    natures.some((n) => n.value === d.type_document)
                      ? (d.type_document as string)
                      : ""
                  }
                  onChange={(e) => void changerNature(d, e.target.value)}
                  className="shrink-0 rounded-full border border-line bg-surface px-2 py-1 text-xs text-ink"
                >
                  <option value="">Nature à préciser…</option>
                  {natures.map((n) => (
                    <option key={n.value} value={n.value}>
                      {n.label}
                    </option>
                  ))}
                </select>
              )}
              <button
                type="button"
                onClick={() => void telecharger(d)}
                className="shrink-0 text-xs underline underline-offset-4"
              >
                Télécharger
              </button>
            </li>
          ))}
        </ul>
      )}
      {analyse && <p className="mt-2 text-xs text-ink-muted">{analyse}</p>}
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  );
}
