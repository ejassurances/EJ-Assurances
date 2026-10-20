import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import {
  COUVERTURE_LABEL,
  grillePourFamille,
  libellesChamps,
  groupesGrille,
  valeurVide,
  type Couverture,
  type GarantieDef,
  type ValeurGarantie,
  type ValeursGrille,
} from "@/lib/garanties-grille";
import {
  analyserGarantiesAutomatiquement,
  analyserDocumentsGaranties,
  enregistrerGrilleBrouillon,
  rejeterPropositionGaranties,
  validerGrilleGaranties,
} from "@/lib/produit-garanties.functions";

type Grille = {
  id: string;
  produit_id: string;
  famille_code: string;
  grille_version: number;
  valeurs: ValeursGrille;
  statut: "brouillon" | "valide" | "a_revoir";
  document_source_id: string | null;
  valide_le: string | null;
  notes: string | null;
};

type Proposition = {
  id: string;
  document_id: string | null;
  grille_version: number;
  modele_ia: string | null;
  valeurs: ValeursGrille;
  avertissements: string | null;
  statut: "proposee" | "acceptee" | "rejetee";
  created_at: string;
  assureur_porteur_propose: string | null;
  reference_contrat_propose: string | null;
  assureur_porteur_extrait: string | null;
  assureur_porteur_confiance: number | null;
};

export type DocAnalysable = { id: string; nom: string; type: string };

const COUVERTURES: Couverture[] = ["oui", "non", "option", "inconnu"];

const DOC_LABEL: Record<string, string> = {
  conditions_generales: "CG",
  ipid: "IPID",
  fiche_produit: "Fiche produit",
  ccsf: "CCSF",
  tableau_garanties: "Tableau de garanties",
};

const badge = (couv: Couverture) =>
  couv === "oui"
    ? "bg-emerald-50 text-emerald-800 border-emerald-200"
    : couv === "non"
      ? "bg-rose-50 text-rose-800 border-rose-200"
      : couv === "option"
        ? "bg-amber-50 text-amber-800 border-amber-200"
        : "bg-neutral-100 text-neutral-600 border-neutral-200";

export function ProduitGarantiesTab({
  produitId,
  familleCode,
  familleNom,
  isAdmin,
  docs,
  refreshKey = 0,
  formuleId = null,
  titre,
}: {
  produitId: string;
  familleCode: string | null;
  familleNom?: string;
  isAdmin: boolean;
  docs: DocAnalysable[];
  /** Incrémenté quand l'extraction déclenchée depuis le dépôt d'un document se termine. */
  refreshKey?: number;
  /** Si renseigné, la grille est celle de la FORMULE (table formule_garanties). */
  formuleId?: string | null;
  titre?: string;
}) {
  const modeFormule = Boolean(formuleId);
  const grille = useMemo(() => grillePourFamille(familleCode), [familleCode]);
  const champs = libellesChamps(grille);
  const [valeurs, setValeurs] = useState<ValeursGrille>({});
  const [ligne, setLigne] = useState<Grille | null>(null);
  const [proposition, setProposition] = useState<Proposition | null>(null);
  /** Assureur porteur du risque : brouillon éditable, écrit sur le produit à la validation admin. */
  const [porteur, setPorteur] = useState({ nom: "", reference: "" });

  const [docId, setDocId] = useState<string>("");
  const [docIds, setDocIds] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const analyser = useServerFn(analyserDocumentsGaranties);
  const analyserAutomatiquement = useServerFn(analyserGarantiesAutomatiquement);
  const brouillon = useServerFn(enregistrerGrilleBrouillon);
  const valider = useServerFn(validerGrilleGaranties);
  const rejeter = useServerFn(rejeterPropositionGaranties);

  // En santé, un « tableau de garanties » couvre en général plusieurs formules :
  // il relève de l'extraction multi-formules (onglet Formules), pas de la grille produit unique.
  const estSante = familleCode === "sante";
  const typesAnalysables = estSante
    ? ["conditions_generales", "ipid", "fiche_produit", "ccsf"]
    : ["conditions_generales", "ipid", "fiche_produit", "ccsf", "tableau_garanties"];
  const analysables = docs.filter((d) => typesAnalysables.includes(d.type));
  const sourceAutomatique =
    analysables.find((d) => d.type === "fiche_produit") ??
    analysables.find((d) => d.type === "conditions_generales") ??
    null;
  const nbTableaux = docs.filter((d) => d.type === "tableau_garanties").length;

  const toggleDoc = (id: string) =>
    setDocIds((ids) =>
      ids.includes(id) ? ids.filter((x) => x !== id) : ids.length >= 4 ? ids : [...ids, id],
    );

  const load = useCallback(async () => {
    if (!grille) return;
    if (modeFormule) {
      const { data } = await supabase
        .from("formule_garanties")
        .select("*")
        .eq("formule_id", formuleId!)
        .maybeSingle();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fg = (data as any) ?? null;
      const gl: Grille | null = fg
        ? {
            id: fg.id,
            produit_id: produitId,
            famille_code: familleCode ?? "",
            grille_version: fg.grille_version,
            valeurs: (fg.valeurs ?? {}) as ValeursGrille,
            statut: fg.statut,
            document_source_id: null,
            valide_le: fg.valide_le ?? null,
            notes: null,
          }
        : null;
      setLigne(gl);
      setProposition(null);
      const base: ValeursGrille = {};
      for (const item of grille.garanties)
        base[item.code] = gl?.valeurs?.[item.code] ?? valeurVide();
      setValeurs(base);
      return;
    }
    const [g, p, prod] = await Promise.all([
      supabase.from("produit_garanties").select("*").eq("produit_id", produitId).maybeSingle(),
      supabase
        .from("produit_garanties_propositions")
        .select("*")
        .eq("produit_id", produitId)
        .eq("statut", "proposee")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("produits")
        .select("assureur_porteur,reference_contrat")
        .eq("id", produitId)
        .maybeSingle(),
    ]);
    const gl = (g.data as Grille | null) ?? null;
    setLigne(gl);
    setProposition((p.data as Proposition | null) ?? null);
    const pr = prod.data as {
      assureur_porteur: string | null;
      reference_contrat: string | null;
    } | null;
    setPorteur({ nom: pr?.assureur_porteur ?? "", reference: pr?.reference_contrat ?? "" });
    const base: ValeursGrille = {};
    for (const item of grille.garanties) base[item.code] = gl?.valeurs?.[item.code] ?? valeurVide();
    setValeurs(base);
    if (gl?.document_source_id) setDocId(gl.document_source_id);
  }, [grille, produitId, modeFormule, formuleId, familleCode]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  if (!familleCode || !grille) {
    return (
      <section className="crm-card p-5 text-sm text-ink-muted">
        Aucune grille de garanties n'est définie pour cette famille de produits.
      </section>
    );
  }

  const setVal = (code: string, patch: Partial<ValeurGarantie>) =>
    setValeurs((v) => ({ ...v, [code]: { ...(v[code] ?? valeurVide()), ...patch } }));

  const appliquerProposition = (code?: string) => {
    if (!proposition) return;
    setValeurs((v) => {
      const next = { ...v };
      for (const g of grille.garanties) {
        if (code && g.code !== code) continue;
        const prop = proposition.valeurs?.[g.code];
        if (prop) next[g.code] = { ...prop };
      }
      return next;
    });
  };

  async function run(key: string, fn: () => Promise<unknown>, okText: string) {
    setBusy(key);
    setMsg(null);
    try {
      await fn();
      setMsg({ type: "ok", text: okText });
      await load();
    } catch (e) {
      setMsg({ type: "err", text: e instanceof Error ? e.message : "Erreur" });
    } finally {
      setBusy(null);
    }
  }

  const payload = () => ({
    produit_id: produitId,
    famille_code: grille.familleCode,
    grille_version: grille.version,
    valeurs,
    document_source_id: docId || null,
    assureur_porteur: porteur.nom.trim() || null,
    reference_contrat: porteur.reference.trim() || null,
  });

  /** Écriture de la grille d'une formule (RLS + trigger imposent la validation admin). */
  const enregistrerFormule = async (statut: "brouillon" | "valide") => {
    const { data: session } = await supabase.auth.getUser();
    const { error } = await supabase.from("formule_garanties").upsert(
      {
        formule_id: formuleId!,
        grille_version: grille.version,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        valeurs: valeurs as any,
        statut,
        updated_by: session.user?.id ?? null,
      },
      { onConflict: "formule_id" },
    );
    if (error) throw new Error(error.message);
  };

  const validee = ligne?.statut === "valide" && ligne.grille_version === grille.version;

  return (
    <section className="crm-card space-y-5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-serif text-lg">
            {titre ?? `Garanties du produit — ${familleNom ?? grille.libelle}`}
          </h3>
          <p className="text-xs text-ink-muted">
            Caractéristiques de couverture du produit, renseignées à partir de ses documents
            contractuels (référentiel version {grille.version}).
          </p>
        </div>

        <span
          className={`rounded-full border px-3 py-1 text-xs font-medium ${validee ? badge("oui") : badge("non")}`}
        >
          {validee
            ? `Garanties validées${ligne?.valide_le ? ` le ${new Date(ligne.valide_le).toLocaleDateString("fr-FR")}` : ""}`
            : ligne?.statut === "a_revoir"
              ? "À revoir après mise à jour"
              : ligne
                ? "Garanties en brouillon"
                : "Garanties à renseigner"}
        </span>
      </div>

      {!validee && (
        <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          Les garanties ne sont pas validées. La génération du devoir de conseil reste bloquée pour
          ce produit jusqu'à leur validation humaine.
        </p>
      )}

      {/* Extraction assistée (grille produit uniquement) */}
      <div
        className={`space-y-2 rounded-md border border-line bg-background p-3 ${modeFormule ? "hidden" : ""}`}
      >
        <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
          Préremplir les garanties avec l'IA
        </p>
        {sourceAutomatique ? (
          <>
            <p className="text-xs text-ink-muted">
              Le CRM utilise automatiquement la fiche produit si elle existe. Sinon, il prend les
              conditions générales. La proposition reste à relire et à valider avant d'alimenter le
              produit.
            </p>
            <p className="text-xs font-medium text-ink">
              Source prévue :{" "}
              {sourceAutomatique.type === "fiche_produit"
                ? "fiche produit"
                : "conditions générales"}
              {sourceAutomatique.nom ? ` — ${sourceAutomatique.nom}` : ""}
            </p>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() =>
                run(
                  "analyse-auto",
                  () => analyserAutomatiquement({ data: { produit_id: produitId } }),
                  `Proposition générée depuis ${sourceAutomatique.type === "fiche_produit" ? "la fiche produit" : "les conditions générales"} — à vérifier.`,
                )
              }
              className="rounded-md bg-[#0A192F] px-3 py-2 text-sm text-white disabled:opacity-50"
            >
              {busy === "analyse-auto"
                ? "Analyse en cours…"
                : "Remplir automatiquement les garanties"}
            </button>
          </>
        ) : (
          <p className="text-xs text-ink-muted">
            Ajoutez une fiche produit ou, à défaut, les conditions générales dans les documents du
            produit.
          </p>
        )}
        {analysables.length > 0 && (
          <details className="rounded-md border border-line p-3">
            <summary className="cursor-pointer text-xs font-medium text-ink-muted">
              Analyse manuelle de plusieurs documents
            </summary>
            <div className="mt-3 space-y-2">
              <p className="text-xs text-ink-muted">
                Choisissez jusqu'à 4 documents à croiser. Les conditions générales font foi en cas
                de contradiction contractuelle.
              </p>
              <div className="flex flex-wrap gap-2">
                {analysables.map((d) => {
                  const actif = docIds.includes(d.id);
                  return (
                    <label
                      key={d.id}
                      className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-xs ${
                        actif ? "border-ink bg-ink/5" : "border-line"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={actif}
                        onChange={() => toggleDoc(d.id)}
                        className="accent-ink"
                      />
                      <span>
                        {DOC_LABEL[d.type] ?? d.type} — {d.nom}
                      </span>
                    </label>
                  );
                })}
              </div>
              <button
                type="button"
                disabled={docIds.length === 0 || busy !== null}
                onClick={() => {
                  setDocId(docIds[0] ?? "");
                  run(
                    "analyse",
                    () => analyser({ data: { document_ids: docIds } }),
                    "Proposition générée — à valider.",
                  );
                }}
                className="rounded-md border border-line px-3 py-2 text-sm disabled:opacity-50"
              >
                {busy === "analyse" ? "Analyse en cours…" : "Analyser la sélection"}
              </button>
            </div>
          </details>
        )}
        {estSante && nbTableaux > 0 && (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {nbTableaux === 1
              ? "Un tableau de garanties est présent"
              : `${nbTableaux} tableaux de garanties sont présents`}{" "}
            sur ce produit. En santé, ce document couvre plusieurs formules : utilisez l'onglet «
            Formules » → « Extraction assistée depuis un tableau de garanties », qui génère une
            proposition de grille par formule détectée (une validation par formule).
          </p>
        )}
      </div>

      {proposition && (
        <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-amber-900">
              Proposition du {new Date(proposition.created_at).toLocaleString("fr-FR")}
              {proposition.modele_ia ? ` — ${proposition.modele_ia}` : ""} — à confirmer ligne par
              ligne.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => appliquerProposition()}
                className="rounded-md border border-amber-300 bg-surface px-3 py-1.5 text-xs"
              >
                Reprendre toutes les propositions
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() =>
                  run(
                    "rejet",
                    () => rejeter({ data: { proposition_id: proposition.id } }),
                    "Proposition rejetée.",
                  )
                }
                className="rounded-md border border-amber-300 bg-surface px-3 py-1.5 text-xs"
              >
                Rejeter la proposition
              </button>
            </div>
          </div>
          {proposition.avertissements && (
            <p className="text-xs text-amber-900">
              Remarques de l'analyse : {proposition.avertissements}
            </p>
          )}
          {(proposition.assureur_porteur_propose || proposition.reference_contrat_propose) && (
            <div className="rounded-md border border-amber-300 bg-surface p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                Assureur porteur identifié dans les documents
              </p>
              <p className="mt-1 text-sm text-ink">
                {proposition.assureur_porteur_propose ?? "— non identifié —"}
                {proposition.reference_contrat_propose
                  ? ` · Référence contrat : ${proposition.reference_contrat_propose}`
                  : ""}
                {proposition.assureur_porteur_confiance != null
                  ? ` · confiance ${Math.round(proposition.assureur_porteur_confiance * 100)} %`
                  : ""}
              </p>
              {proposition.assureur_porteur_extrait && (
                <p className="mt-1 text-xs italic text-ink-soft">
                  « {proposition.assureur_porteur_extrait} »
                </p>
              )}
              <button
                type="button"
                onClick={() =>
                  setPorteur({
                    nom: proposition.assureur_porteur_propose ?? porteur.nom,
                    reference: proposition.reference_contrat_propose ?? porteur.reference,
                  })
                }
                className="mt-2 rounded-md border border-amber-300 bg-surface px-3 py-1.5 text-xs"
              >
                Reprendre dans les champs ci-dessous
              </button>
            </div>
          )}
        </div>
      )}

      {/* Assureur porteur du risque — écrit sur la fiche produit à la validation admin uniquement */}
      {!modeFormule && (
        <div className="grid gap-3 rounded-md border border-line p-3 md:grid-cols-2">
          <label className="block">
            <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">
              Assureur porteur du risque
            </span>
            <input
              value={porteur.nom}
              onChange={(e) => setPorteur((p) => ({ ...p, nom: e.target.value }))}
              placeholder="ex. CARDIF, MNCAP…"
              className="mt-1 w-full rounded-md border border-line bg-background px-2 py-1.5 text-sm"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">
              Référence du contrat / police
            </span>
            <input
              value={porteur.reference}
              onChange={(e) => setPorteur((p) => ({ ...p, reference: e.target.value }))}
              className="mt-1 w-full rounded-md border border-line bg-background px-2 py-1.5 text-sm"
            />
          </label>
          <p className="text-xs text-ink-muted md:col-span-2">
            Enregistré sur la fiche produit uniquement lors de la validation admin de la grille.
            Indiquez la compagnie qui porte le risque, pas le grossiste distributeur.
          </p>
        </div>
      )}

      {/* Grille standardisée, section par section */}
      <div className="space-y-5">
        {groupesGrille(grille).map((sec) => (
          <div key={sec.groupe ?? "_"} className="space-y-3">
            {sec.groupe && (
              <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                {sec.groupe}
              </h4>
            )}
            {sec.garanties.map((g: GarantieDef) => {
              const v = valeurs[g.code] ?? valeurVide();
              const prop = proposition?.valeurs?.[g.code];
              return (
                <div key={g.code} className="rounded-md border border-line p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium">
                      {g.libelle}
                      {g.obligatoire && (
                        <span className="ml-2 text-xs text-ink-muted">(attendue)</span>
                      )}
                    </p>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs ${badge(v.couverture)}`}
                    >
                      {COUVERTURE_LABEL[v.couverture]}
                    </span>
                  </div>

                  <div className="mt-2 grid gap-2 md:grid-cols-5">
                    <select
                      value={v.couverture}
                      disabled={!isAdmin && false}
                      onChange={(e) => setVal(g.code, { couverture: e.target.value as Couverture })}
                      className="rounded-md border border-line bg-background px-2 py-1.5 text-sm"
                    >
                      {COUVERTURES.map((c) => (
                        <option key={c} value={c}>
                          {COUVERTURE_LABEL[c]}
                        </option>
                      ))}
                    </select>
                    <input
                      placeholder={champs.plafond}
                      value={v.plafond ?? ""}
                      onChange={(e) => setVal(g.code, { plafond: e.target.value || null })}
                      className="rounded-md border border-line bg-background px-2 py-1.5 text-sm"
                    />
                    <input
                      placeholder={champs.franchise}
                      value={v.franchise ?? ""}
                      onChange={(e) => setVal(g.code, { franchise: e.target.value || null })}
                      className="rounded-md border border-line bg-background px-2 py-1.5 text-sm"
                    />
                    <input
                      placeholder={champs.delai_carence}
                      value={v.delai_carence ?? ""}
                      onChange={(e) => setVal(g.code, { delai_carence: e.target.value || null })}
                      className="rounded-md border border-line bg-background px-2 py-1.5 text-sm"
                    />
                    <input
                      placeholder={champs.conditions}
                      value={v.conditions ?? ""}
                      onChange={(e) => setVal(g.code, { conditions: e.target.value || null })}
                      className="rounded-md border border-line bg-background px-2 py-1.5 text-sm"
                    />
                  </div>

                  {v.extrait && (
                    <p className="mt-2 border-l-2 border-line pl-2 text-xs italic text-ink-muted">
                      « {v.extrait} »
                    </p>
                  )}

                  {prop && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-amber-50/60 px-2 py-1.5">
                      <span className="text-xs text-amber-900">
                        Proposé : <strong>{COUVERTURE_LABEL[prop.couverture]}</strong>
                        {prop.plafond ? ` — plafond ${prop.plafond}` : ""}
                        {prop.franchise ? ` — franchise ${prop.franchise}` : ""}
                        {prop.delai_carence ? ` — carence ${prop.delai_carence}` : ""}
                        {typeof prop.confiance === "number"
                          ? ` (confiance ${Math.round(prop.confiance * 100)} %)`
                          : ""}
                      </span>

                      {prop.extrait && (
                        <span className="text-xs italic text-amber-900">« {prop.extrait} »</span>
                      )}
                      <button
                        type="button"
                        onClick={() => appliquerProposition(g.code)}
                        className="rounded border border-amber-300 bg-surface px-2 py-0.5 text-xs"
                      >
                        Reprendre
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {msg && (
        <p className={`text-sm ${msg.type === "ok" ? "text-emerald-700" : "text-rose-700"}`}>
          {msg.text}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() =>
            run(
              "brouillon",
              () =>
                modeFormule ? enregistrerFormule("brouillon") : brouillon({ data: payload() }),
              "Brouillon enregistré.",
            )
          }
          className="rounded-md border border-line px-4 py-2 text-sm"
        >
          Enregistrer en brouillon
        </button>
        <button
          type="button"
          disabled={busy !== null || !isAdmin}
          title={isAdmin ? undefined : "Validation réservée à l'administrateur du cabinet"}
          onClick={() =>
            run(
              "valider",
              () =>
                modeFormule
                  ? enregistrerFormule("valide")
                  : valider({ data: { ...payload(), proposition_id: proposition?.id ?? null } }),
              modeFormule
                ? "Garanties de la formule validées — elles peuvent alimenter un devoir de conseil."
                : "Garanties validées — le produit peut alimenter un devoir de conseil.",
            )
          }
          className="rounded-md bg-ink px-4 py-2 text-sm text-surface disabled:opacity-50"
        >
          Valider les garanties
        </button>
      </div>
    </section>
  );
}
