import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { rechercherSanctionsPPE, marquerVerificationLCB } from "@/lib/lcb-ft.functions";
import { traiterPieceIdentite } from "@/lib/cni-extraction.functions";
import { DerStatusCard } from "@/components/der-status-card";
import { RisqueLcbftCard } from "@/components/risque-lcbft-card";
import { GelAvoirsCard } from "@/components/gel-avoirs-card";
import { detailConformite, NIVEAU_BAR, SEUIL_BLOCAGE_CONTRAT, type NiveauConformite } from "@/lib/conformite-score";


/* Onglet Conformité client : KYC + LCB-FT + Score */

type KycDoc = {
  id: string;
  client_id: string;
  type: "cni" | "justificatif_domicile" | "rib" | "kbis";
  nom: string;
  storage_path: string;
  drive_url: string | null;
  date_emission: string | null;
  date_expiration: string | null;
  statut: string;
  notes: string | null;
  created_at: string;
};

type LCBVerif = {
  id: string;
  client_id: string;
  type: string;
  fournisseur: string;
  nb_correspondances: number;
  score_correspondance: number | null;
  statut: string;
  verifie_le: string;
  valide_jusqua: string | null;
  notes: string | null;
  resultats: unknown;
};

type ClientMini = {
  id: string;
  nom: string;
  prenom: string | null;
  date_naissance: string | null;
  conformite_score: number | null;
  conformite_niveau: string | null;
  conformite_derniere_verif: string | null;
  conformite_prochaine_verif: string | null;
};

const TYPES: { key: KycDoc["type"]; label: string }[] = [
  { key: "cni", label: "Carte d'identité / Passeport" },
  { key: "justificatif_domicile", label: "Justificatif de domicile (< 3 mois)" },
  { key: "rib", label: "RIB" },
  { key: "kbis", label: "KBIS / avis Sirene (client professionnel)" },
];

const NIVEAU_COLOR: Record<string, string> = {
  vert: "bg-emerald-100 text-emerald-900 border-emerald-300",
  orange: "bg-amber-100 text-amber-900 border-amber-300",
  rouge: "bg-red-100 text-red-900 border-red-300",
};

export function ConformiteClientTab({
  clientId,
  clientEmail,
  canEdit,
}: {
  clientId: string;
  clientEmail: string | null;
  canEdit: boolean;
}) {
  const [client, setClient] = useState<ClientMini | null>(null);
  const [docs, setDocs] = useState<KycDoc[]>([]);
  const [verifs, setVerifs] = useState<LCBVerif[]>([]);
  const [estPro, setEstPro] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lecture, setLecture] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<Awaited<ReturnType<typeof rechercherSanctionsPPE>> | null>(null);

  const rechercher = useServerFn(rechercherSanctionsPPE);
  const marquer = useServerFn(marquerVerificationLCB);
  const traiterPiece = useServerFn(traiterPieceIdentite);

  const load = async () => {
    const [c, d, v, e] = await Promise.all([
      supabase
        .from("clients")
        .select(
          "id,nom,prenom,date_naissance,conformite_score,conformite_niveau,conformite_derniere_verif,conformite_prochaine_verif",
        )
        .eq("id", clientId)
        .maybeSingle(),
      supabase
        .from("client_kyc_documents")
        .select("*")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false }),
      supabase
        .from("client_lcb_verifications")
        .select("*")
        .eq("client_id", clientId)
        .order("verifie_le", { ascending: false })
        .limit(10),
      supabase
        .from("client_entreprise")
        .select("siret,raison_sociale")
        .eq("client_id", clientId)
        .maybeSingle(),
    ]);
    setClient((c.data as ClientMini | null) ?? null);
    setDocs((d.data ?? []) as KycDoc[]);
    setVerifs((v.data ?? []) as LCBVerif[]);
    const ent = e.data as { siret: string | null; raison_sociale: string | null } | null;
    setEstPro(!!(ent && (ent.siret || ent.raison_sociale)));
    setLoading(false);
  };


  useEffect(() => {
    load();
  }, [clientId]);

  const upload = async (type: KycDoc["type"], file: File) => {
    // Supabase Storage rejects keys containing accents, spaces and punctuation from raw filenames.
    // Keep the original name in the database, but use a normalized ASCII key for storage.
    const safeName =
      file.name
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^A-Za-z0-9._-]+/g, "_")
        .replace(/_{2,}/g, "_")
        .replace(/^[_\-.]+|[_\-.]+$/g, "")
        .slice(0, 120) || "document";
    const path = `${clientId}/kyc/${type}-${Date.now()}-${safeName}`;
    const { error: upErr } = await supabase.storage.from("dossier-documents").upload(path, file);
    if (upErr) {
      alert("Upload : " + upErr.message);
      return;
    }
    const { data: insere, error: insErr } = await supabase
      .from("client_kyc_documents")
      .insert({
        client_id: clientId,
        type,
        nom: file.name,
        storage_path: path,
        statut: "a_valider",
        date_emission: type === "justificatif_domicile" ? new Date().toISOString().slice(0, 10) : null,
      })
      .select("id")
      .maybeSingle();
    if (insErr) alert(insErr.message);
    // Pièce d'identité (état civil) ou justificatif de domicile (adresse) : lecture IA immédiate.
    if (!insErr && (type === "cni" || type === "justificatif_domicile") && insere) {
      try {
        await traiterPiece({ data: { kyc_document_id: (insere as { id: string }).id } });
      } catch (e) {
        console.error("[CNI] lecture automatique impossible", e);
      }
    }
    await load();
  };


  const valider = async (id: string, statut: string) => {
    await supabase.from("client_kyc_documents").update({ statut }).eq("id", id);
    await load();
  };

  const setExpiration = async (id: string, valeur: string) => {
    await supabase
      .from("client_kyc_documents")
      .update({ date_expiration: valeur || null, rappel_expiration_envoye_le: null })
      .eq("id", id);
    await load();
  };


  const supprimer = async (doc: KycDoc) => {
    if (!confirm("Supprimer ce document ?")) return;
    await supabase.storage.from("dossier-documents").remove([doc.storage_path]);
    await supabase.from("client_kyc_documents").delete().eq("id", doc.id);
    await load();
  };

  const telecharger = async (path: string) => {
    const { data } = await supabase.storage.from("dossier-documents").createSignedUrl(path, 300);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  };

  /** Relecture IA d'une pièce d'identité déjà déposée : complète les champs vides de la fiche. */
  const relire = async (id: string) => {
    setLecture(id);
    try {
      const res = (await traiterPiece({ data: { kyc_document_id: id } })) as
        | { statut: "complete"; champs: string[] }
        | { statut: "ecart" | "ignore"; raison: string };
      if (res.statut === "complete") {
        alert(
          res.champs.length > 0
            ? "Informations complétées :\n- " + res.champs.join("\n- ")
            : "Lecture effectuée : aucune information manquante à compléter.",
        );
      } else {
        alert("Lecture non appliquée : " + res.raison);
      }
    } catch (e) {
      alert("Lecture impossible : " + (e instanceof Error ? e.message : "erreur inconnue"));
    } finally {
      setLecture(null);
      await load();
    }
  };

  const enregistrerDrive = async (doc: KycDoc) => {
    const url = prompt("Lien Google Drive du document", doc.drive_url ?? "https://drive.google.com/");
    if (url === null) return;
    await supabase
      .from("client_kyc_documents")
      .update({ drive_url: url.trim() || null })
      .eq("id", doc.id);
    await load();
  };


  const lancerRecherche = async () => {
    if (!client) return;
    setSearching(true);
    setSearchResult(null);
    try {
      const res = await rechercher({
        data: {
          client_id: clientId,
          nom: client.nom,
          prenom: client.prenom ?? undefined,
          date_naissance: client.date_naissance ?? undefined,
        },
      });
      setSearchResult(res);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSearching(false);
    }
  };

  const statuer = async (id: string, statut: "clair" | "faux_positif" | "confirme") => {
    const notes =
      statut === "confirme" || statut === "faux_positif" ? (prompt("Note (optionnel)") ?? undefined) : undefined;
    await marquer({ data: { verification_id: id, statut, notes } });
    setSearchResult(null);
    await load();
  };

  if (loading) return <p className="text-sm text-ink-muted">Chargement…</p>;
  if (!client) return <p className="text-sm text-ink-muted">Client introuvable.</p>;

  const detail = detailConformite(docs, verifs, estPro);
  const score = client.conformite_score ?? detail.score;
  const niveau = ((client.conformite_niveau as NiveauConformite | null) ?? detail.niveau) as NiveauConformite;

  return (
    <div className="space-y-6">
      {/* Pièces du dossier — la complétude alimente le score de risque LCB-FT
          (bloc ci-dessous), elle n'est plus affichée comme un score séparé. */}
      <div className="rounded-2xl border border-line bg-surface-elevated p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide opacity-70">Pièces du dossier</p>
            <p className="mt-1 text-xs opacity-80">
              {estPro ? "Barème professionnel" : "Barème particulier"} · la complétude est intégrée au score de risque
              LCB-FT
            </p>
          </div>
          <div className="text-right text-xs">
            <p>
              Dernière vérif :{" "}
              {client.conformite_derniere_verif
                ? new Date(client.conformite_derniere_verif).toLocaleDateString("fr-FR")
                : "—"}
            </p>
            <p>
              Prochaine vérif :{" "}
              {client.conformite_prochaine_verif
                ? new Date(client.conformite_prochaine_verif).toLocaleDateString("fr-FR")
                : "—"}
            </p>
          </div>
        </div>

        {/* Détail du barème */}
        <ul className="mt-4 space-y-2">
          {detail.criteres.map((c) => (
            <li
              key={c.code}
              className={`flex items-start justify-between gap-3 rounded-xl border border-current/20 bg-white/50 px-3 py-2 text-xs ${
                c.applicable ? "" : "opacity-50"
              }`}
            >
              <span className="flex items-start gap-2">
                <span aria-hidden className="mt-0.5">
                  {!c.applicable ? "—" : c.acquis ? "✅" : "⬜"}
                </span>
                <span>
                  <span className="font-semibold">{c.libelle}</span>
                  <span className="block opacity-80">{c.detail}</span>
                </span>
              </span>
              <span className="whitespace-nowrap font-semibold">
                {c.applicable && c.acquis ? c.points : 0}/{c.applicable ? c.points : 0} pts
              </span>
            </li>
          ))}
        </ul>

        <p className="mt-3 text-xs opacity-80">
          Un dossier incomplet interdit la vigilance simplifiée et pèse sur le score de risque LCB-FT. Sous{" "}
          {SEUIL_BLOCAGE_CONTRAT} % de complétude, la création de contrat reste bloquée par sécurité.
        </p>
      </div>

      <RisqueLcbftCard clientId={clientId} />

      <GelAvoirsCard clientId={clientId} />

      <DerStatusCard clientId={clientId} clientEmail={clientEmail} canEdit={canEdit} />

      {/* Documents KYC */}
      <div className="rounded-2xl border border-line bg-surface-elevated p-6">
        <h3 className="font-serif text-lg font-medium">Documents d'identification</h3>
        {!estPro && (
          <p className="mt-1 text-xs text-ink-muted">
            Client particulier : le KBIS / avis Sirene n'est pas demandé (réservé aux clients professionnels).
          </p>
        )}
        <div className="mt-4 space-y-4">
          {TYPES.filter(({ key }) => estPro || key !== "kbis").map(({ key, label }) => {
            const documents = docs.filter((d) => d.type === key);
            return (
              <div key={key} className="rounded-xl border border-line p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-ink">{label}</p>
                    <p className="text-xs text-ink-muted">
                      {documents.length === 0 ? "Aucun document" : `${documents.length} fichier(s)`}
                    </p>
                  </div>
                  {canEdit && (
                    <label className="cursor-pointer rounded-full bg-ink px-3 py-1.5 text-xs font-medium text-primary-foreground">
                      + Ajouter
                      <input
                        type="file"
                        className="hidden"
                        accept="application/pdf,image/*"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) upload(key, f);
                          e.target.value = "";
                        }}
                      />
                    </label>
                  )}
                </div>
                {documents.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {documents.map((doc) => (
                      <div
                        key={doc.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-surface px-3 py-2 text-sm"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{doc.nom}</p>
                          <p className="text-xs text-ink-muted">
                            Ajouté le {new Date(doc.created_at).toLocaleDateString("fr-FR")}
                            {doc.date_emission
                              ? ` · Émis le ${new Date(doc.date_emission).toLocaleDateString("fr-FR")}`
                              : ""}
                            {doc.date_expiration ? (
                              <span
                                className={new Date(doc.date_expiration) < new Date() ? "text-red-700" : ""}
                              >
                                {" · "}
                                {new Date(doc.date_expiration) < new Date() ? "Expiré le " : "Valide jusqu'au "}
                                {new Date(doc.date_expiration).toLocaleDateString("fr-FR")}
                              </span>
                            ) : (
                              ""
                            )}
                          </p>
                          {canEdit && (
                            <label className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                              Fin de validité
                              <input
                                type="date"
                                defaultValue={doc.date_expiration ?? ""}
                                onChange={(e) => setExpiration(doc.id, e.target.value)}
                                className="rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink"
                              />
                              <span>Rappel client automatique 30 jours avant l'échéance.</span>
                            </label>
                          )}
                        </div>

                        <span
                          className={
                            "rounded-full px-2 py-0.5 text-xs font-medium " +
                            (doc.statut === "valide"
                              ? "bg-emerald-100 text-emerald-900"
                              : doc.statut === "refuse"
                                ? "bg-red-100 text-red-900"
                                : "bg-amber-100 text-amber-900")
                          }
                        >
                          {doc.statut}
                        </span>
                        <div className="flex items-center gap-2">
                          <button onClick={() => telecharger(doc.storage_path)} className="text-xs underline">
                            Voir
                          </button>
                          {canEdit && (doc.type === "cni" || doc.type === "justificatif_domicile") && (
                            <button
                              onClick={() => relire(doc.id)}
                              disabled={lecture === doc.id}
                              className="text-xs font-medium text-[color:var(--crm-navy)] underline disabled:opacity-50"
                            >
                              {lecture === doc.id ? "Lecture…" : "Remplir la fiche"}
                            </button>
                          )}
                          {doc.drive_url && (
                            <a
                              href={doc.drive_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs font-medium text-[color:var(--crm-gold)] underline"
                            >
                              Drive
                            </a>
                          )}
                          {canEdit && (
                            <button onClick={() => enregistrerDrive(doc)} className="text-xs text-ink-muted underline">
                              {doc.drive_url ? "Modifier le lien" : "Lier à Drive"}
                            </button>
                          )}
                          {canEdit && doc.statut !== "valide" && (
                            <button
                              onClick={() => valider(doc.id, "valide")}
                              className="text-xs text-emerald-800 underline"
                            >
                              Valider
                            </button>
                          )}
                          {canEdit && doc.statut !== "refuse" && (
                            <button
                              onClick={() => valider(doc.id, "refuse")}
                              className="text-xs text-red-800 underline"
                            >
                              Refuser
                            </button>
                          )}
                          {canEdit && (
                            <button onClick={() => supprimer(doc)} className="text-xs text-ink-muted underline">
                              ×
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* LCB-FT */}
      <div className="rounded-2xl border border-line bg-surface-elevated p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-serif text-lg font-medium">Vérification sanctions & PPE</h3>
            <p className="text-xs text-ink-muted">
              Filtrage LCB-FT via OpenSanctions (bases officielles : UE, ONU, OFAC, gel des avoirs FR, listes PPE).
            </p>
          </div>
          {canEdit && (
            <button
              onClick={lancerRecherche}
              disabled={searching}
              className="rounded-full bg-ink px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-40"
            >
              {searching ? "Recherche…" : "Lancer une vérification"}
            </button>
          )}
        </div>

        {/* Résultat immédiat */}
        {searchResult && (
          <div className="mt-4 rounded-xl border border-line bg-surface p-4">
            {!searchResult.api_ok && (
              <p className="text-sm text-red-800">Service indisponible : {searchResult.api_error}</p>
            )}
            {searchResult.matches.length === 0 && searchResult.api_ok && (
              <p className="text-sm text-emerald-800">
                ✓ Aucune correspondance significative trouvée. Vérification enregistrée.
              </p>
            )}
            {searchResult.matches.length > 0 && (
              <>
                <div className="mb-3 flex flex-wrap gap-2 text-xs">
                  {searchResult.has_sanction && (
                    <span className="rounded-full bg-red-100 px-2 py-0.5 font-medium text-red-900">
                      Sanction potentielle
                    </span>
                  )}
                  {searchResult.has_ppe && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-900">
                      PPE potentiel
                    </span>
                  )}
                  <span className="rounded-full border border-line px-2 py-0.5">
                    Score : {(searchResult.best_score * 100).toFixed(0)}%
                  </span>
                </div>
                <ul className="space-y-2">
                  {searchResult.matches.map((m) => (
                    <li key={m.id} className="rounded-md border border-line bg-white p-3 text-sm">
                      <p className="font-medium">{m.caption}</p>
                      <p className="text-xs text-ink-muted">
                        Score {(m.score * 100).toFixed(0)}% · {m.datasets.slice(0, 3).join(", ")}
                        {m.pays.length > 0 ? ` · ${m.pays.join(", ")}` : ""}
                        {m.date_naissance.length > 0 ? ` · Né(e) ${m.date_naissance[0]}` : ""}
                      </p>
                      {m.fonction.length > 0 && (
                        <p className="mt-1 text-xs text-ink-soft">Fonction : {m.fonction.slice(0, 2).join(" — ")}</p>
                      )}
                    </li>
                  ))}
                </ul>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick={() => statuer(searchResult.verification_id, "faux_positif")}
                    className="rounded-full border border-line px-3 py-1 text-xs"
                  >
                    Marquer faux positif
                  </button>
                  <button
                    onClick={() => statuer(searchResult.verification_id, "confirme")}
                    className="rounded-full bg-red-900 px-3 py-1 text-xs text-white"
                  >
                    Confirmer la correspondance
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Historique */}
        <div className="mt-4">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">Historique</p>
          {verifs.length === 0 ? (
            <p className="mt-2 text-sm text-ink-muted">Aucune vérification enregistrée.</p>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-line text-left text-xs text-ink-muted">
                  <tr>
                    <th className="px-2 py-2">Date</th>
                    <th className="px-2 py-2">Correspondances</th>
                    <th className="px-2 py-2">Score</th>
                    <th className="px-2 py-2">Statut</th>
                    <th className="px-2 py-2">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {verifs.map((v) => (
                    <tr key={v.id} className="border-b border-line last:border-0">
                      <td className="px-2 py-2 text-xs">{new Date(v.verifie_le).toLocaleString("fr-FR")}</td>
                      <td className="px-2 py-2">{v.nb_correspondances}</td>
                      <td className="px-2 py-2">
                        {v.score_correspondance ? `${(Number(v.score_correspondance) * 100).toFixed(0)}%` : "—"}
                      </td>
                      <td className="px-2 py-2">
                        <span
                          className={
                            "rounded-full px-2 py-0.5 text-xs font-medium " +
                            (v.statut === "clair" || v.statut === "faux_positif"
                              ? "bg-emerald-100 text-emerald-900"
                              : v.statut === "a_verifier" || v.statut === "en_attente_infos"
                                ? "bg-amber-100 text-amber-900"
                                : "bg-red-100 text-red-900")
                          }
                        >
                          {v.statut === "en_attente_infos" ? "en attente d'informations" : v.statut}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-xs text-ink-muted">{v.notes ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
