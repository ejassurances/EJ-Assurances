/**
 * Étape 0 du parcours emprunteur — Import des documents du prêt.
 *
 * Une étape = une vue : cette étape se limite au dépôt des pièces du prêt et à
 * la confirmation du statut d'extraction. Les valeurs lues pré-remplissent les
 * étapes « Prêts » et « Informations personnelles » : elles ne sont pas
 * réaffichées ici. Charte marine / doré conservée.
 */
import { useServerFn } from "@tanstack/react-start";
import { ImportPretVerifie } from "@/components/import-pret-verifie";
import { confirmerPretDossier } from "@/lib/archiver-pret-verifie.functions";
import { supabase } from "@/integrations/supabase/client";
import { normaliserNomFichierPourStockage } from "@/lib/storage-key";
import { Link } from "@tanstack/react-router";
import { DocumentsPretPanel } from "@/components/documents-pret-panel";

function Bloc({
  numero,
  titre,
  sousTitre,
  children,
}: {
  numero?: string;
  titre: string;
  sousTitre?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-line bg-surface-elevated">
      <header className="flex flex-nowrap items-start gap-3 border-b border-line px-5 py-3">
        {numero && (
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-accent bg-accent/10 text-[11px] font-medium text-ink">
            {numero}
          </span>
        )}
        <div className="min-w-0">
          <h3 className="font-serif text-base font-medium text-ink">{titre}</h3>
          {sousTitre && <p className="text-xs text-ink-muted">{sousTitre}</p>}
        </div>
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

export function ImportDocumentsEmprunteur({
  dossierId,
  client,
  onChanged,
}: {
  dossierId: string;
  recueil?: Record<string, unknown> | null;
  client: {
    id: string | null;
    nom: string;
    email: string | null;
    telephone: string | null;
    reference?: string | null;
  };
  onChanged: () => void;
}) {
  const confirmer = useServerFn(confirmerPretDossier);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-5">
        <Bloc
          numero="1"
          titre="Dépôt des pièces du prêt"
          sousTitre="Offre de prêt et / ou tableau d'amortissement — PDF, image ou tableur"
        >
          <ImportPretVerifie onConfirm={async (_appliquer, pieces, lectures, valeurs) => {
            // Human confirmation is the only business-data write boundary.
            await confirmer({ data: { dossierId, valeurs, lectures } });
            const { data: auth } = await supabase.auth.getUser();
            if (!auth.user) throw new Error("Session expirée.");
            const erreurs: string[] = [];
            for (const p of pieces) {
              const path = `${dossierId}/pret/${crypto.randomUUID()}-${normaliserNomFichierPourStockage(p.file.name)}`;
              const upload = await supabase.storage.from("dossier-documents").upload(path, p.file, { upsert: false });
              if (upload.error) { erreurs.push(p.file.name); continue; }
              const { data: doc, error } = await supabase.from("documents").insert({ dossier_id: dossierId, client_id: client.id, uploader_id: auth.user.id, storage_path: path, file_name: p.file.name, file_size: p.file.size, mime_type: p.file.type, categorie: "dossier", type_document: p.nature }).select("id").single();
              if (error || !doc) {
                const cleanup = await supabase.storage.from("dossier-documents").remove([path]);
                erreurs.push(`${p.file.name}${cleanup.error ? " (nettoyage à vérifier)" : ""}`); continue;
              }
              const piece = await supabase.from("dossier_pieces_requises").update({ statut: "recue", document_id: doc.id, recue_le: new Date().toISOString() }).eq("dossier_id", dossierId).eq("code", p.nature);
              if (piece.error) erreurs.push(`${p.file.name} (checklist à vérifier)`);
            }
            onChanged();
            if (erreurs.length) throw new Error(`Données confirmées, archivage partiel : ${erreurs.join(", ")}`);
          }} />
          <DocumentsPretPanel dossierId={dossierId} filtre="pret" analyseAutorisee={false} />
        </Bloc>
      </div>

      <aside className="space-y-5 lg:sticky lg:top-4 lg:self-start">
        <Bloc titre="Client du dossier">
          <p className="font-serif text-base text-ink">{client.nom}</p>
          <dl className="mt-2 space-y-1 text-xs">
            {client.reference && (
              <div className="flex justify-between gap-2">
                <dt className="text-ink-muted">Dossier</dt>
                <dd className="text-ink">{client.reference}</dd>
              </div>
            )}
            <div className="flex justify-between gap-2">
              <dt className="text-ink-muted">Email</dt>
              <dd className="truncate text-ink">{client.email ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-ink-muted">Téléphone</dt>
              <dd className="text-ink">{client.telephone ?? "—"}</dd>
            </div>
          </dl>
          {client.id && (
            <Link
              to="/espace/clients/$id"
              params={{ id: client.id }}
              className="mt-3 inline-block text-xs text-ink underline underline-offset-4"
            >
              Ouvrir la fiche client →
            </Link>
          )}
        </Bloc>

        <Bloc titre="Rappel de méthode">
          <ul className="space-y-2 text-xs text-ink-soft">
            <li>• Les valeurs déjà saisies sont conservées.</li>
            <li>• Les valeurs sont vérifiées avant confirmation.</li>
            <li>• Aucune étape réglementaire n'est franchie automatiquement.</li>
          </ul>
        </Bloc>
      </aside>
    </div>
  );
}
