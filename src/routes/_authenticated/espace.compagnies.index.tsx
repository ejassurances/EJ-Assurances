import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { StoredImage } from "@/components/image-upload-field";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { IconBuildingBank, IconStar, IconPlugConnected } from "@tabler/icons-react";

export const Route = createFileRoute("/_authenticated/espace/compagnies/")({
  component: CompagniesIndex,
});

type TypePartenaire = "compagnie" | "courtier_grossiste";

type Compagnie = {
  id: string;
  nom: string;
  slug: string;
  logo_url: string | null;
  statut: "actif" | "prospect" | "inactif";
  type_partenaire: TypePartenaire;
  tier_favori: number | null;
  api_active: boolean;
  site_web: string | null;
  contact_nom: string | null;
  created_at: string;
};

export const TIER_LABEL: Record<number, string> = { 1: "Top 1", 2: "Top 2", 3: "Top 3" };

export const TYPE_PARTENAIRE_LABEL: Record<TypePartenaire, string> = {
  compagnie: "Compagnie d'assurance",
  courtier_grossiste: "Courtier grossiste",
};


function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function CompagniesIndex() {
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const [rows, setRows] = useState<Compagnie[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [nom, setNom] = useState("");
  const [statut, setStatut] = useState<"actif" | "prospect" | "inactif">("actif");
  const [typePartenaire, setTypePartenaire] = useState<TypePartenaire>("compagnie");
  const [filtreType, setFiltreType] = useState<"tous" | TypePartenaire>("tous");

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("compagnies")
      .select("id,nom,slug,logo_url,statut,type_partenaire,tier_favori,api_active,site_web,contact_nom,created_at")
      .order("nom");
    if (error) setError(error.message);
    setRows((data as Compagnie[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!nom.trim()) return;
    setCreating(true);
    setError(null);
    const slug = slugify(nom);
    const { error } = await supabase.from("compagnies").insert({ nom: nom.trim(), slug, statut, type_partenaire: typePartenaire });
    setCreating(false);
    if (error) {
      setError(error.message);
      return;
    }
    setNom("");
    load();
  }

  /** Type de partenaire : compagnie d'assurance (porteur du risque) ou courtier grossiste. */
  async function setType(id: string, type: TypePartenaire) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, type_partenaire: type } : r)));
    const { error } = await supabase.from("compagnies").update({ type_partenaire: type }).eq("id", id);
    if (error) {
      setError(error.message);
      load();
    }
  }

  /** Compagnie favorite du cabinet : priorise l'offre dans le classement IA des devis. */
  async function setTier(id: string, tier: number | null) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, tier_favori: tier } : r)));
    const { error } = await supabase.from("compagnies").update({ tier_favori: tier }).eq("id", id);
    if (error) {
      setError(error.message);
      load();
    }
  }


  const favorites = rows.filter((c) => c.tier_favori).length;
  const visibles = filtreType === "tous" ? rows : rows.filter((c) => c.type_partenaire === filtreType);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Référentiel"
        title="Partenaires"
        description="Référentiel des compagnies d'assurance et courtiers grossistes, de leurs produits et de leurs documents contractuels."
        icon={IconBuildingBank}
      />

      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard label="Partenaires référencés" value={rows.length} icon={IconBuildingBank} accent />
        <StatCard label="Compagnies d'assurance" value={rows.filter((c) => c.type_partenaire === "compagnie").length} icon={IconBuildingBank} />
        <StatCard label="Courtiers grossistes" value={rows.filter((c) => c.type_partenaire === "courtier_grossiste").length} icon={IconPlugConnected} />
        <StatCard label="Favorites (top)" value={favorites} icon={IconStar} />
      </div>

      {isAdmin && (
        <form onSubmit={create} className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-4">
          <div className="flex-1 min-w-[220px]">
            <label className="mb-1 block text-xs font-medium text-ink-muted">Nouveau partenaire</label>
            <input
              value={nom}
              onChange={(e) => setNom(e.target.value)}
              placeholder="ex : April, Generali, Metlife…"
              className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-muted">Type de partenaire</label>
            <select
              value={typePartenaire}
              onChange={(e) => setTypePartenaire(e.target.value as TypePartenaire)}
              className="rounded-md border border-line bg-background px-3 py-2 text-sm"
            >
              <option value="compagnie">Compagnie d'assurance</option>
              <option value="courtier_grossiste">Courtier grossiste</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-muted">Statut</label>
            <select
              value={statut}
              onChange={(e) => setStatut(e.target.value as "actif" | "prospect" | "inactif")}
              className="rounded-md border border-line bg-background px-3 py-2 text-sm"
            >
              <option value="actif">Actif</option>
              <option value="prospect">En cours</option>
              <option value="inactif">Inactif</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={creating}
            className="rounded-md bg-[#0A192F] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {creating ? "Ajout…" : "Ajouter"}
          </button>
        </form>
      )}

      {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</p>}

      {loading ? (
        <p className="text-sm text-ink-muted">Chargement…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-ink-muted">Aucune compagnie encore enregistrée.</p>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-xs font-medium text-ink-muted">Type :</span>
            {(["tous", "compagnie", "courtier_grossiste"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setFiltreType(t)}
                className={
                  "rounded-full border px-3 py-1 text-xs font-medium " +
                  (filtreType === t
                    ? "border-[#0A192F] bg-[#0A192F] text-white"
                    : "border-line bg-background text-ink-soft hover:bg-surface")
                }
              >
                {t === "tous" ? "Tous" : TYPE_PARTENAIRE_LABEL[t]}
              </button>
            ))}
          </div>
          <div className="overflow-hidden rounded-lg border border-line">
          <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-surface text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-4 py-3 text-left">Partenaire</th>
                <th className="px-4 py-3 text-left">Type</th>
                <th className="px-4 py-3 text-left">Contact</th>
                <th className="px-4 py-3 text-left">Statut</th>
                <th className="px-4 py-3 text-left">Favorite</th>
                <th className="px-4 py-3 text-left">API</th>
                <th className="px-4 py-3" />

              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {visibles.map((c) => (
                <tr key={c.id} className="hover:bg-surface/50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <StoredImage
                        bucket="compagnies-logos"
                        value={c.logo_url}
                        alt={c.nom}
                        className="size-8 rounded object-contain"
                        fallback={
                          <div className="flex size-8 items-center justify-center rounded bg-surface text-xs text-ink-muted">
                            {c.nom.slice(0, 2).toUpperCase()}
                          </div>
                        }
                      />

                      <div>
                        <div className="font-medium text-ink">{c.nom}</div>
                        <div className="text-xs text-ink-muted">{c.site_web ?? "—"}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {isAdmin ? (
                      <select
                        value={c.type_partenaire}
                        onChange={(e) => setType(c.id, e.target.value as TypePartenaire)}
                        className="rounded-md border border-line bg-background px-2 py-1 text-xs"
                        title="Compagnie d'assurance (porteur du risque) ou courtier grossiste (plateforme de distribution)"
                      >
                        <option value="compagnie">Compagnie d'assurance</option>
                        <option value="courtier_grossiste">Courtier grossiste</option>
                      </select>
                    ) : (
                      <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-ink-soft">
                        {TYPE_PARTENAIRE_LABEL[c.type_partenaire]}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-ink-soft">{c.contact_nom ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        "rounded-full px-2 py-0.5 text-xs font-medium " +
                        (c.statut === "actif"
                          ? "bg-emerald-50 text-emerald-800"
                          : c.statut === "prospect"
                            ? "bg-amber-50 text-amber-800"
                            : "bg-zinc-100 text-zinc-600")
                      }
                    >
                      {c.statut}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {isAdmin ? (
                      <select
                        value={c.tier_favori ?? ""}
                        onChange={(e) => setTier(c.id, e.target.value ? Number(e.target.value) : null)}
                        className="rounded-md border border-line bg-background px-2 py-1 text-xs"
                        title="Compagnie favorite du cabinet — priorisée dans le classement IA des devis"
                      >
                        <option value="">Aucun</option>
                        <option value="1">Top 1</option>
                        <option value="2">Top 2</option>
                        <option value="3">Top 3</option>
                      </select>
                    ) : c.tier_favori ? (
                      <span className="rounded-full bg-[color:var(--crm-gold)]/15 px-2 py-0.5 text-xs font-medium text-ink">
                        {TIER_LABEL[c.tier_favori]}
                      </span>
                    ) : (
                      <span className="text-xs text-ink-muted">—</span>
                    )}
                  </td>

                  <td className="px-4 py-3 text-xs">
                    {c.api_active ? (
                      <span className="rounded-full bg-blue-50 px-2 py-0.5 text-blue-800">Connectée</span>
                    ) : (
                      <span className="text-ink-muted">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      to="/espace/compagnies/$id"
                      params={{ id: c.id }}
                      className="text-sm font-medium text-ink underline underline-offset-4"
                    >
                      Ouvrir →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          </div>
        </div>
      )}
    </div>
  );
}
