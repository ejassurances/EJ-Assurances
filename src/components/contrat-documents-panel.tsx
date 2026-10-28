import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ProduitDocumentsLink } from "@/components/produit-documents-link";

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
}: {
  contratId: string;
  /** Client titulaire : le fichier est rangé dans son dossier pour l'espace client. */
  clientId: string;
  userId: string;
  canEdit?: boolean;
  /** Produit rattaché : ses CG/IPID sont affichés directement ici. */
  produitId?: string | null;
  compagnieId?: string | null;
}) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [rattachables, setRattachables] = useState<Doc[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<string>("attestation_assurance");
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
    // Le 1er segment doit être l'identifiant du client : les règles d'accès du
    // stockage s'appuient sur lui (et le client retrouve la pièce dans son espace).
    const path = `${clientId}/contrats/${contratId}/${Date.now()}-${file.name}`;
    const { error: upErr } = await supabase.storage.from("dossier-documents").upload(path, file);
    if (upErr) {
      setError(upErr.message);
      setUploading(false);
      return;
    }
    const { error: dbErr } = await supabase.from("documents").insert({
      contrat_id: contratId,
      client_id: clientId,
      uploader_id: userId,
      storage_path: path,
      file_name: file.name,
      file_size: file.size,
      mime_type: file.type,
      type_document: type,
    });
    setUploading(false);
    if (dbErr) {
      setError(dbErr.message);
      return;
    }
    if (fileRef.current) fileRef.current.value = "";
    load();
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
          {error && <span className="text-xs text-destructive">{error}</span>}
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
