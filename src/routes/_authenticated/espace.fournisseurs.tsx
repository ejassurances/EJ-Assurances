import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { dansExerciceComptable } from "@/lib/exercice";
import { IconTruckDelivery, IconFileInvoice, IconCash } from "@tabler/icons-react";

export const Route = createFileRoute("/_authenticated/espace/fournisseurs")({
  component: FournisseursPage,
  head: () => ({
    meta: [
      { title: "Fournisseurs — EJ Partners Assurances" },
      {
        name: "description",
        content:
          "Référentiel des fournisseurs du cabinet : plateformes, logiciels et prestataires, avec leurs factures d'achat rattachées.",
      },
    ],
  }),
});

const CATEGORIES = [
  "plateforme",
  "logiciel",
  "courtage",
  "comptabilite",
  "marketing",
  "telecom",
  "banque",
  "formation",
  "autre",
] as const;

type Fournisseur = {
  id: string;
  nom: string;
  slug: string;
  categorie: string;
  statut: "actif" | "inactif";
  siret: string | null;
  numero_tva: string | null;
  email: string | null;
  domaines_email: string[] | null;
  telephone: string | null;
  site_web: string | null;
  adresse: string | null;
  contact_nom: string | null;
  compte_charge_defaut: string | null;
  echeance_jours: number | null;
  moyen_paiement_habituel: string | null;
  contrat_reference: string | null;
  notes: string | null;
};

type Facture = {
  id: string;
  fournisseur: string;
  fournisseur_id: string | null;
  numero_facture: string | null;
  date_facture: string;
  montant_ttc: number;
  statut: string;
};

function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

const fmt = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });

function FournisseursPage() {
  const { role } = useAuth();
  const peutEcrire = role === "admin" || role === "mandataire";
  const [rows, setRows] = useState<Fournisseur[]>([]);
  const [factures, setFactures] = useState<Facture[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<string | null>(null);
  const [nom, setNom] = useState("");
  const [categorie, setCategorie] = useState<string>("plateforme");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const [f, fa] = await Promise.all([
      supabase.from("fournisseurs").select("*").order("nom"),
      supabase
        .from("factures_achat")
        .select("id,fournisseur,fournisseur_id,numero_facture,date_facture,montant_ttc,statut")
        .order("date_facture", { ascending: false }),
    ]);
    if (f.error) setError(f.error.message);
    setRows((f.data as Fournisseur[]) ?? []);
    setFactures((fa.data as Facture[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const parFournisseur = useMemo(() => {
    const map: Record<string, { nb: number; total: number }> = {};
    for (const f of factures) {
      if (!f.fournisseur_id) continue;
      // Cumuls comptables : premier exercice 2026, on ignore 2025 et avant.
      if (!dansExerciceComptable(f.date_facture)) continue;
      const e = (map[f.fournisseur_id] ??= { nb: 0, total: 0 });
      e.nb += 1;
      e.total += Number(f.montant_ttc);
    }
    return map;
  }, [factures]);

  const nonRattachees = factures.filter((f) => !f.fournisseur_id);
  const fiche = rows.find((r) => r.id === selection) ?? null;

  async function creer(e: React.FormEvent) {
    e.preventDefault();
    if (!nom.trim()) return;
    setSaving(true);
    setError(null);
    const { data, error } = await supabase
      .from("fournisseurs")
      .insert({ nom: nom.trim(), slug: slugify(nom), categorie })
      .select("id")
      .single();
    setSaving(false);
    if (error) return setError(error.message);
    setNom("");
    setSelection((data as { id: string }).id);
    load();
  }

  async function enregistrer(patch: Partial<Fournisseur>) {
    if (!fiche) return;
    setRows((rs) => rs.map((r) => (r.id === fiche.id ? { ...r, ...patch } : r)));
    const { error } = await supabase
      .from("fournisseurs")
      .update(patch as never)
      .eq("id", fiche.id);
    if (error) {
      setError(error.message);
      load();
    }
  }


  /** Rattache une facture existante à la fiche fournisseur ouverte. */
  async function rattacher(factureId: string) {
    if (!fiche) return;
    const { error } = await supabase
      .from("factures_achat")
      .update({ fournisseur_id: fiche.id, fournisseur: fiche.nom })
      .eq("id", factureId);
    if (error) return setError(error.message);
    load();
  }

  const totalAchats = factures
    .filter((f) => dansExerciceComptable(f.date_facture))
    .reduce((s, f) => s + Number(f.montant_ttc), 0);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Référentiel"
        title="Fournisseurs du cabinet"
        description="Fiches de nos fournisseurs et prestataires (plateformes, logiciels, services), avec leurs factures d'achat rattachées."
        icon={IconTruckDelivery}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Fournisseurs référencés" value={rows.length} icon={IconTruckDelivery} accent />
        <StatCard label="Factures d'achat" value={factures.length} icon={IconFileInvoice} />
        <StatCard label="Total achats (TTC)" value={fmt(totalAchats)} icon={IconCash} />
      </div>

      {peutEcrire && (
        <form onSubmit={creer} className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-4">
          <div className="min-w-[220px] flex-1">
            <label className="mb-1 block text-xs font-medium text-ink-muted">Nouveau fournisseur</label>
            <input
              value={nom}
              onChange={(e) => setNom(e.target.value)}
              placeholder="ex : +Simple, Allianz, Orias…"
              className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-muted">Catégorie</label>
            <select
              value={categorie}
              onChange={(e) => setCategorie(e.target.value)}
              className="rounded-md border border-line bg-background px-3 py-2 text-sm"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-[#0A192F] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {saving ? "Ajout…" : "Ajouter"}
          </button>
        </form>
      )}

      {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</p>}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="overflow-hidden rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead className="bg-surface text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-4 py-3 text-left">Fournisseur</th>
                <th className="px-4 py-3 text-left">Factures</th>
                <th className="px-4 py-3 text-right">Total TTC</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {loading ? (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-sm text-ink-muted">
                    Chargement…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-sm text-ink-muted">
                    Aucun fournisseur référencé.
                  </td>
                </tr>
              ) : (
                rows.map((f) => {
                  const agg = parFournisseur[f.id];
                  return (
                    <tr
                      key={f.id}
                      onClick={() => setSelection(f.id)}
                      className={
                        "cursor-pointer hover:bg-surface/50 " + (selection === f.id ? "bg-surface" : "")
                      }
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-ink">{f.nom}</div>
                        <div className="text-xs text-ink-muted">
                          {f.categorie}
                          {f.statut === "inactif" ? " — inactif" : ""}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-ink-soft">{agg?.nb ?? 0}</td>
                      <td className="px-4 py-3 text-right text-ink-soft">{fmt(agg?.total ?? 0)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="rounded-lg border border-line bg-surface p-5">
          {!fiche ? (
            <p className="text-sm text-ink-muted">
              Sélectionne un fournisseur pour ouvrir sa fiche (coordonnées, compte de charge, factures).
            </p>
          ) : (
            <div className="space-y-5">
              <div>
                <h3 className="font-serif text-lg font-medium text-ink">{fiche.nom}</h3>
                <p className="text-xs text-ink-muted">Fiche fournisseur — {fiche.categorie}</p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Champ label="Contact" value={fiche.contact_nom} onSave={(v) => enregistrer({ contact_nom: v })} disabled={!peutEcrire} />
                <Champ label="E-mail" value={fiche.email} onSave={(v) => enregistrer({ email: v })} disabled={!peutEcrire} />
                <Champ label="Téléphone" value={fiche.telephone} onSave={(v) => enregistrer({ telephone: v })} disabled={!peutEcrire} />
                <Champ label="Site web" value={fiche.site_web} onSave={(v) => enregistrer({ site_web: v })} disabled={!peutEcrire} />
                <Champ label="SIRET" value={fiche.siret} onSave={(v) => enregistrer({ siret: v })} disabled={!peutEcrire} />
                <Champ label="N° TVA" value={fiche.numero_tva} onSave={(v) => enregistrer({ numero_tva: v })} disabled={!peutEcrire} />
                <Champ
                  label="Compte de charge par défaut"
                  value={fiche.compte_charge_defaut}
                  onSave={(v) => enregistrer({ compte_charge_defaut: v })}
                  disabled={!peutEcrire}
                />
                <Champ
                  label="Référence contrat / abonnement"
                  value={fiche.contrat_reference}
                  onSave={(v) => enregistrer({ contrat_reference: v })}
                  disabled={!peutEcrire}
                />
                <Champ
                  label="Domaines e-mail (séparés par une virgule)"
                  value={(fiche.domaines_email ?? []).join(", ")}
                  onSave={(v) =>
                    enregistrer({
                      domaines_email: (v ?? "")
                        .split(",")
                        .map((d) => d.trim().toLowerCase())
                        .filter(Boolean),
                    })
                  }
                  disabled={!peutEcrire}
                />
                <div>
                  <label className="mb-1 block text-xs font-medium text-ink-muted">Statut</label>
                  <select
                    value={fiche.statut}
                    disabled={!peutEcrire}
                    onChange={(e) => enregistrer({ statut: e.target.value as "actif" | "inactif" })}
                    className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
                  >
                    <option value="actif">Actif</option>
                    <option value="inactif">Inactif</option>
                  </select>
                </div>
              </div>

              <Champ
                label="Notes"
                value={fiche.notes}
                onSave={(v) => enregistrer({ notes: v })}
                disabled={!peutEcrire}
                multiline
              />

              <div>
                <h4 className="mb-2 text-sm font-medium text-ink">Factures rattachées</h4>
                {factures.filter((f) => f.fournisseur_id === fiche.id).length === 0 ? (
                  <p className="text-sm text-ink-muted">Aucune facture rattachée pour l'instant.</p>
                ) : (
                  <ul className="divide-y divide-line rounded-md border border-line bg-background text-sm">
                    {factures
                      .filter((f) => f.fournisseur_id === fiche.id)
                      .map((f) => (
                        <li key={f.id} className="flex items-center justify-between px-3 py-2">
                          <span>
                            {new Date(f.date_facture).toLocaleDateString("fr-FR")}
                            {f.numero_facture ? ` — n°${f.numero_facture}` : ""}
                          </span>
                          <span className="text-ink-soft">
                            {fmt(Number(f.montant_ttc))} · {f.statut}
                          </span>
                        </li>
                      ))}
                  </ul>
                )}
              </div>

              {peutEcrire && nonRattachees.length > 0 && (
                <div>
                  <h4 className="mb-2 text-sm font-medium text-ink">Factures sans fournisseur ({nonRattachees.length})</h4>
                  <ul className="max-h-60 divide-y divide-line overflow-y-auto rounded-md border border-line bg-background text-sm">
                    {nonRattachees.map((f) => (
                      <li key={f.id} className="flex items-center justify-between gap-3 px-3 py-2">
                        <span className="truncate">
                          {f.fournisseur} — {fmt(Number(f.montant_ttc))}
                        </span>
                        <button
                          type="button"
                          onClick={() => rattacher(f.id)}
                          className="shrink-0 rounded-md border border-line px-2 py-1 text-xs font-medium text-ink"
                        >
                          Rattacher
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Champ({
  label,
  value,
  onSave,
  disabled,
  multiline,
}: {
  label: string;
  value: string | null;
  onSave: (v: string | null) => void;
  disabled?: boolean;
  multiline?: boolean;
}) {
  const [local, setLocal] = useState(value ?? "");
  useEffect(() => setLocal(value ?? ""), [value]);
  const commit = () => {
    const v = local.trim();
    if (v === (value ?? "")) return;
    onSave(v === "" ? null : v);
  };
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-ink-muted">{label}</label>
      {multiline ? (
        <textarea
          value={local}
          disabled={disabled}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={commit}
          rows={3}
          className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
        />
      ) : (
        <input
          value={local}
          disabled={disabled}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={commit}
          className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
        />
      )}
    </div>
  );
}
