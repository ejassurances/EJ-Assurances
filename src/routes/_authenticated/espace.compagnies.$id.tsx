import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { analyserGarantiesAutomatiquement } from "@/lib/produit-garanties.functions";
import { analyserCatalogueProduitsCompagnie, completerInfosProduitDepuisDocument } from "@/lib/produit-catalogue.functions";
import { CompagnieDocsTable, UploadCompagnieDocForm } from "./espace.conformite";
import { ProduitGarantiesTab } from "@/components/produit-garanties-tab";
import { ProduitFormulesTab } from "@/components/produit-formules-tab";
import { libelleVariante, varianteCapital } from "@/lib/variante-capital";

import { EmailsLiesPanel } from "@/components/emails-lies-panel";
import { ImageUploadField, StoredImage } from "@/components/image-upload-field";
import { CompagnieTauxCommission } from "@/components/compagnie-taux-commission";
import { CompagnieBaremeDate } from "@/components/compagnie-bareme-date";
import { PageHeader } from "@/components/page-header";
import { SectionNav, type SectionNavItem } from "@/components/section-nav";
import { telechargerPdfBlob } from "@/lib/telecharger-pdf";
import type {
  GrilleFormuleComparatif,
  GrilleProduitComparatif,
  FormuleComparatif,
  ProduitComparatif,
} from "@/lib/comparatif-compagnie-pdf";
import { IconBuildingBank } from "@tabler/icons-react";

type CompagnieDocRow = {
  id: string;
  compagnie_id: string;
  type:
    | "contrat_partenariat"
    | "avenant"
    | "protocole_commissions"
    | "conditions_apporteur"
    | "autre";
  nom: string;
  storage_path: string;
  date_signature: string | null;
  date_fin: string | null;
  reference: string | null;
  notes: string | null;
  created_at: string;
};

function PartenariatsTab({
  compagnieId,
  compagnieNom,
  isAdmin,
}: {
  compagnieId: string;
  compagnieNom: string;
  isAdmin: boolean;
}) {
  const [docs, setDocs] = useState<CompagnieDocRow[]>([]);
  const [loading, setLoading] = useState(true);
  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("compagnie_documents")
      .select("*")
      .eq("compagnie_id", compagnieId)
      .order("created_at", { ascending: false });
    setDocs((data as CompagnieDocRow[]) ?? []);
    setLoading(false);
  };
  useEffect(() => {
    load();
  }, [compagnieId]);
  return (
    <div className="space-y-4">
      {isAdmin && (
        <UploadCompagnieDocForm
          compagnies={[{ id: compagnieId, nom: compagnieNom }]}
          defaultCompagnieId={compagnieId}
          onUploaded={load}
        />
      )}
      <CompagnieDocsTable docs={docs} loading={loading} onChanged={load} canManage={isAdmin} />
    </div>
  );
}

export const Route = createFileRoute("/_authenticated/espace/compagnies/$id")({
  head: () => ({
    meta: [
      { title: "Compagnie et barèmes — EJ Assurances" },
      { name: "description", content: "Produits et barèmes datés de commission compagnie." },
      { property: "og:title", content: "Compagnie et barèmes — EJ Assurances" },
      { property: "og:description", content: "Produits et barèmes datés de commission compagnie." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CompagnieDetail,
});

type ApiAuthType = "none" | "api_key" | "bearer" | "oauth2" | "basic";
type TypePartenaire = "compagnie" | "courtier_grossiste";
type Compagnie = {
  id: string;
  nom: string;
  slug: string;
  logo_url: string | null;
  description: string | null;
  site_web: string | null;
  contact_nom: string | null;
  contact_email: string | null;
  contact_telephone: string | null;
  statut: "actif" | "prospect" | "inactif";
  type_partenaire: TypePartenaire;
  notes: string | null;
  api_active: boolean;
};

type CompagnieApiConfig = {
  compagnie_id: string;
  api_base_url: string | null;
  api_auth_type: ApiAuthType;
  api_secret_name: string | null;
  api_config: Record<string, unknown>;
};

type ChampStandard = {
  code: string;
  label: string;
  type: "text" | "textarea" | "number" | "boolean" | "select" | "multiselect";
  unit?: string;
  options?: string[];
};
type Famille = { id: string; code: string; nom: string; champs_standards: ChampStandard[] };
type Produit = {
  id: string;
  compagnie_id: string;
  famille_id: string;
  nom: string;
  code_produit: string | null;
  assureur_porteur: string | null;
  description: string | null;
  statut: "actif" | "en_test" | "retire";
  caracteristiques: Record<string, unknown>;
  points_forts: string | null;
  points_vigilance: string | null;
  cible: string | null;
  commission_taux: number | null;
  /** Frais épargne (assurance-vie / PER) : base des comparatifs et projections. */
  frais_versement_pct: number | null;
  frais_gestion_pct: number | null;
  frais_arbitrage_pct: number | null;
  produit_requis_id: string | null;
  famille_requise_id: string | null;
  image_url: string | null;
  /** Origine du tarif : API compagnie, saisie manuelle de devis, ou tarif fixe connu. */
  mode_tarification: "api" | "manuel" | "fixe";
};
type ProduitCatalogueBrouillon = {
  id: string;
  nom: string;
  code_produit: string | null;
  famille_code: string | null;
  description: string | null;
  /** Contrat ou document de référence facultatif fourni lors de l’import. */
  documentReference: File | null;
  existeDeja: boolean;
  inclure: boolean;
};

function normaliserNomProduit(nom: string): string {
  return nom
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleLowerCase("fr-FR")
    .replace(/\s+/g, " ");
}
type ProduitDoc = {
  id: string;
  produit_id: string;
  type:
    | "conditions_generales"
    | "ipid"
    | "tableau_garanties"
    | "fiche_produit"
    | "tarifs"
    | "ccsf"
    | "autre";
  nom: string;
  version: string | null;
  date_effet: string | null;
  storage_path: string | null;
  /** Les anciens documents Drive restent liés ici ; les nouveaux PDF sont stockés dans Supabase Storage. */
  drive_url: string | null;
  drive_chemin: string | null;
  interne: boolean;
  created_at: string;
};

const DOC_TYPE_LABEL: Record<ProduitDoc["type"], string> = {
  conditions_generales: "Conditions générales",
  ipid: "IPID",
  tableau_garanties: "Tableau de garanties",
  fiche_produit: "Fiche produit (interne)",
  tarifs: "Grille tarifaire",
  ccsf: "CCSF (équivalence bancaire)",
  autre: "Autre",
};

/**
 * Documents attendus par branche : la liste n'est pas identique partout
 * (ex. CCSF uniquement en emprunteur, tableau de garanties en santé/prévoyance).
 */
const DOC_TYPES_PAR_FAMILLE: Record<string, ProduitDoc["type"][]> = {
  emprunteur: ["conditions_generales", "ipid", "fiche_produit", "ccsf", "tarifs", "autre"],
  sante: ["conditions_generales", "ipid", "tableau_garanties", "fiche_produit", "tarifs", "autre"],
  prevoyance: [
    "conditions_generales",
    "ipid",
    "tableau_garanties",
    "fiche_produit",
    "tarifs",
    "autre",
  ],
};

const DOC_TYPES_DEFAUT: ProduitDoc["type"][] = [
  "conditions_generales",
  "ipid",
  "fiche_produit",
  "tarifs",
  "autre",
];

function docTypesPour(familleCode: string | null): ProduitDoc["type"][] {
  return (familleCode && DOC_TYPES_PAR_FAMILLE[familleCode]) || DOC_TYPES_DEFAUT;
}

type Tab = "infos" | "produits" | "partenariats" | "emails" | "api";

function CompagnieDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const { role } = useAuth();
  const isAdmin = role === "admin";

  const [tab, setTab] = useState<Tab>("infos");
  const [c, setC] = useState<Compagnie | null>(null);
  const [familles, setFamilles] = useState<Famille[]>([]);
  const [produits, setProduits] = useState<Produit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedProduit, setSelectedProduit] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const [comp, fam, prod] = await Promise.all([
      supabase.from("compagnies").select("*").eq("id", id).maybeSingle(),
      supabase.from("produit_familles").select("id,code,nom,champs_standards").order("ordre"),
      supabase.from("produits").select("*").eq("compagnie_id", id).order("nom"),
    ]);
    if (comp.error) setError(comp.error.message);
    setC((comp.data as Compagnie | null) ?? null);
    setFamilles((fam.data as Famille[]) ?? []);
    setProduits((prod.data as Produit[]) ?? []);
    setLoading(false);
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function saveInfos(patch: Partial<Compagnie>) {
    if (!c) return;
    setSaving(true);
    const { error } = await supabase
      .from("compagnies")
      .update(patch as never)
      .eq("id", c.id);
    setSaving(false);
    if (error) setError(error.message);
    else setC({ ...c, ...patch });
  }

  async function del() {
    if (!c) return;
    if (!confirm(`Supprimer définitivement ${c.nom} et tous ses produits ?`)) return;
    const { error } = await supabase.from("compagnies").delete().eq("id", c.id);
    if (error) setError(error.message);
    else navigate({ to: "/espace/compagnies" });
  }

  if (loading) return <p className="text-sm text-ink-muted">Chargement…</p>;
  if (!c) return <p className="text-sm text-ink-muted">Compagnie introuvable.</p>;

  const TAB_LABEL: Record<Tab, string> = {
    infos: "Identité",
    produits: "Produits",
    partenariats: "Partenariat",
    emails: "Emails",
    api: "API compagnie",
  };
  const navItems: SectionNavItem<Tab>[] = (
    ["infos", "produits", "partenariats", "emails", "api"] as Tab[]
  ).map((t) => ({
    key: t,
    label: TAB_LABEL[t],
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Partenaire"
        title={c.nom}
        description={`${produits.length} produit${produits.length > 1 ? "s" : ""} référencé${produits.length > 1 ? "s" : ""}`}
        icon={IconBuildingBank}
      >
        <Link
          to="/espace/compagnies"
          className="text-xs text-white/70 underline underline-offset-4 hover:text-white"
        >
          ← Toutes les compagnies
        </Link>
        {isAdmin && (
          <button
            onClick={del}
            className="text-xs text-red-300 underline underline-offset-4 hover:text-red-200"
          >
            Supprimer
          </button>
        )}
      </PageHeader>

      <div className="flex items-start gap-4">
        <StoredImage
          bucket="compagnies-logos"
          value={c.logo_url}
          alt={c.nom}
          className="size-16 rounded border border-line bg-background object-contain p-1"
        />
      </div>

      {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</p>}

      <div className="grid gap-6 lg:grid-cols-[1fr_16rem]">
        <div className="min-w-0">
          {tab === "infos" && (
            <InfosTab c={c} isAdmin={isAdmin} saving={saving} onSave={saveInfos} />
          )}
          {tab === "produits" && (
            <ProduitsTab
              compagnieId={c.id}
              compagnieNom={c.nom}
              produits={produits}
              familles={familles}
              isAdmin={isAdmin}
              selected={selectedProduit}
              onSelect={setSelectedProduit}
              onChange={load}
            />
          )}
          {tab === "partenariats" && (
            <div className="space-y-6">
              <PartenariatsTab compagnieId={c.id} compagnieNom={c.nom} isAdmin={isAdmin} />
              <CompagnieTauxCommission compagnieId={c.id} canEdit={isAdmin} />
              <CompagnieBaremeDate compagnieId={c.id} canEdit={isAdmin} />
            </div>
          )}
          {tab === "emails" && (
            <EmailsLiesPanel liens={{ compagnie_id: c.id }} titre="Historique des échanges" />
          )}
          {tab === "api" && (
            <ApiTab
              compagnieId={c.id}
              apiActive={c.api_active}
              isAdmin={isAdmin}
              onApiActiveChange={(v) => saveInfos({ api_active: v })}
            />
          )}
        </div>
        <SectionNav title="Sections" items={navItems} active={tab} onSelect={setTab} />
      </div>
    </div>
  );
}

// ============ Onglet Identité ============
function InfosTab({
  c,
  isAdmin,
  saving,
  onSave,
}: {
  c: Compagnie;
  isAdmin: boolean;
  saving: boolean;
  onSave: (p: Partial<Compagnie>) => void;
}) {
  const [form, setForm] = useState(c);
  useEffect(() => setForm(c), [c]);
  const readOnly = !isAdmin;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave(form);
      }}
      className="crm-card grid gap-4 p-6 md:grid-cols-2"
    >
      <Field
        label="Nom"
        value={form.nom}
        onChange={(v) => setForm({ ...form, nom: v })}
        readOnly={readOnly}
      />
      <Field
        label="Site web"
        value={form.site_web ?? ""}
        onChange={(v) => setForm({ ...form, site_web: v })}
        readOnly={readOnly}
      />
      <ImageUploadField
        bucket="compagnies-logos"
        prefix={c.id}
        value={form.logo_url}
        label="Logo de la compagnie"
        canEdit={!readOnly}
        onUploaded={async (path) => {
          setForm({ ...form, logo_url: path });
          onSave({ logo_url: path });
        }}
      />
      <div>
        <label className="mb-1 block text-xs font-medium text-ink-muted">Type de partenaire</label>
        <select
          value={form.type_partenaire}
          onChange={(e) => setForm({ ...form, type_partenaire: e.target.value as TypePartenaire })}
          disabled={readOnly}
          className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
        >
          <option value="compagnie">Compagnie d'assurance</option>
          <option value="courtier_grossiste">Courtier grossiste</option>
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-ink-muted">Statut</label>
        <select
          value={form.statut}
          onChange={(e) => setForm({ ...form, statut: e.target.value as Compagnie["statut"] })}
          disabled={readOnly}
          className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
        >
          <option value="actif">Actif</option>
          <option value="prospect">En cours</option>
          <option value="inactif">Inactif</option>
        </select>
      </div>
      <Field
        label="Contact — Nom"
        value={form.contact_nom ?? ""}
        onChange={(v) => setForm({ ...form, contact_nom: v })}
        readOnly={readOnly}
      />
      <Field
        label="Contact — Email"
        value={form.contact_email ?? ""}
        onChange={(v) => setForm({ ...form, contact_email: v })}
        readOnly={readOnly}
      />
      <Field
        label="Contact — Téléphone"
        value={form.contact_telephone ?? ""}
        onChange={(v) => setForm({ ...form, contact_telephone: v })}
        readOnly={readOnly}
      />
      <div className="md:col-span-2">
        <label className="mb-1 block text-xs font-medium text-ink-muted">Description</label>
        <textarea
          value={form.description ?? ""}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          readOnly={readOnly}
          rows={3}
          className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
        />
      </div>
      <div className="md:col-span-2">
        <label className="mb-1 block text-xs font-medium text-ink-muted">Notes internes</label>
        <textarea
          value={form.notes ?? ""}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          readOnly={readOnly}
          rows={3}
          className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
        />
      </div>
      {isAdmin && (
        <div className="md:col-span-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-[#0A192F] px-5 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {saving ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      )}
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  readOnly,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  readOnly?: boolean;
  type?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-ink-muted">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        readOnly={readOnly}
        className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
      />
    </div>
  );
}

// ============ Onglet Produits ============
type GrilleEtat = "validee" | "proposition" | "brouillon" | "absente";

const GRILLE_BADGE: Record<GrilleEtat, { label: string; className: string }> = {
  validee: {
    label: "Garanties validées",
    className: "border-emerald-300 bg-emerald-50 text-emerald-800",
  },
  proposition: {
    label: "Proposition IA à valider",
    className: "border-amber-300 bg-amber-50 text-amber-800",
  },
  brouillon: {
    label: "Garanties en brouillon",
    className: "border-amber-300 bg-amber-50 text-amber-800",
  },
  absente: { label: "Garanties à renseigner", className: "border-red-300 bg-red-50 text-red-800" },
};

function GrilleBadge({ etat }: { etat: GrilleEtat }) {
  const b = GRILLE_BADGE[etat];
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium ${b.className}`}
    >
      {b.label}
    </span>
  );
}

function ProduitsTab({
  compagnieId,
  compagnieNom,
  produits,
  familles,
  isAdmin,
  selected,
  onSelect,
  onChange,
}: {
  compagnieId: string;
  compagnieNom: string;
  produits: Produit[];
  familles: Famille[];
  isAdmin: boolean;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onChange: () => void;
}) {
  const analyserCatalogue = useServerFn(analyserCatalogueProduitsCompagnie);
  const completerInfosProduit = useServerFn(completerInfosProduitDepuisDocument);
  const analyserGaranties = useServerFn(analyserGarantiesAutomatiquement);
  const { user } = useAuth();
  const [nom, setNom] = useState("");
  const [familleId, setFamilleId] = useState(familles[0]?.id ?? "");
  const [creating, setCreating] = useState(false);
  const [generatingComparatif, setGeneratingComparatif] = useState(false);
  const [fichierCatalogue, setFichierCatalogue] = useState<File | null>(null);
  const [analyseCatalogueEnCours, setAnalyseCatalogueEnCours] = useState(false);
  const [importCatalogueEnCours, setImportCatalogueEnCours] = useState(false);
  const [produitsCatalogue, setProduitsCatalogue] = useState<ProduitCatalogueBrouillon[]>([]);
  const [grilles, setGrilles] = useState<Record<string, GrilleEtat>>({});
  useEffect(() => {
    if (!familleId && familles[0]) setFamilleId(familles[0].id);
  }, [familles, familleId]);

  const produitIds = useMemo(
    () =>
      produits
        .map((p) => p.id)
        .sort()
        .join(","),
    [produits],
  );
  useEffect(() => {
    const ids = produitIds ? produitIds.split(",") : [];
    if (ids.length === 0) {
      setGrilles({});
      return;
    }
    let annule = false;
    (async () => {
      const [gar, prop] = await Promise.all([
        supabase.from("produit_garanties").select("produit_id,statut").in("produit_id", ids),
        supabase
          .from("produit_garanties_propositions")
          .select("produit_id")
          .eq("statut", "proposee")
          .in("produit_id", ids),
      ]);
      if (annule) return;
      const map: Record<string, GrilleEtat> = {};
      for (const id of ids) map[id] = "absente";
      for (const g of (gar.data as { produit_id: string; statut: string }[] | null) ?? []) {
        if (g.statut === "valide") map[g.produit_id] = "validee";
        else if (map[g.produit_id] !== "validee") map[g.produit_id] = "brouillon";
      }
      for (const p of (prop.data as { produit_id: string }[] | null) ?? []) {
        if (map[p.produit_id] === "absente") map[p.produit_id] = "proposition";
      }
      setGrilles(map);
    })();
    return () => {
      annule = true;
    };
  }, [produitIds]);

  const produitsEnAttente = useMemo(() => {
    const nomsDejaVus = new Set(produits.map((produit) => normaliserNomProduit(produit.nom)));
    return produitsCatalogue.filter((produit) => {
      const nom = normaliserNomProduit(produit.nom);
      if (!produit.inclure || produit.existeDeja || !nom || nomsDejaVus.has(nom)) return false;
      nomsDejaVus.add(nom);
      return true;
    });
  }, [produits, produitsCatalogue]);
  const active = useMemo(() => produits.find((p) => p.id === selected), [produits, selected]);

  async function analyserFichierCatalogue() {
    if (!fichierCatalogue) return;
    if (!fichierCatalogue.name.toLowerCase().endsWith(".pdf")) {
      toast.error("Sélectionnez un catalogue au format PDF.");
      return;
    }
    if (fichierCatalogue.size > 12 * 1024 * 1024) {
      toast.error("Le PDF du catalogue ne doit pas dépasser 12 Mo.");
      return;
    }

    setAnalyseCatalogueEnCours(true);
    setProduitsCatalogue([]);
    let fichierTemporaire: string | null = null;
    try {
      const storagePath = `catalogue-imports/${compagnieId}/${crypto.randomUUID()}.pdf`;
      fichierTemporaire = storagePath;
      const { error: uploadError } = await supabase.storage
        .from("produits-documents")
        .upload(storagePath, fichierCatalogue, { contentType: "application/pdf", upsert: false });
      if (uploadError) throw new Error(uploadError.message);

      const resultat = (await analyserCatalogue({
        data: { compagnie_id: compagnieId, storage_path: storagePath },
      })) as {
        produits: {
          nom: string;
          code_produit: string | null;
          famille_code: string | null;
          description: string | null;
        }[];
      };
      fichierTemporaire = null;
      const dejaPresents = new Set(produits.map((produit) => normaliserNomProduit(produit.nom)));
      const vusDansLePdf = new Set<string>();
      const brouillons = resultat.produits.map((produit, index) => {
        const cle = normaliserNomProduit(produit.nom);
        const doublonDansPdf = vusDansLePdf.has(cle);
        const existeDeja = dejaPresents.has(cle) || doublonDansPdf;
        vusDansLePdf.add(cle);
        return {
          id: `${index}-${crypto.randomUUID()}`,
          nom: produit.nom,
          code_produit: produit.code_produit,
          famille_code: produit.famille_code,
          description: produit.description,
          documentReference: null,
          existeDeja,
          // Les produits déjà présents sont présélectionnés pour compléter leurs champs manquants.
          // Les doublons répétés dans le PDF restent décochés.
          inclure: dejaPresents.has(cle) && !doublonDansPdf,
        };
      });
      setProduitsCatalogue(brouillons);
      toast.success(
        `${brouillons.length} produit(s) détecté(s). Vérifiez la liste avant l’import.`,
      );
    } catch (cause) {
      if (fichierTemporaire) {
        try {
          await supabase.storage.from("produits-documents").remove([fichierTemporaire]);
        } catch {
          // Le serveur tente aussi de supprimer le PDF temporaire après l’analyse.
        }
      }
      toast.error(
        cause instanceof Error ? cause.message : "Impossible d’analyser le catalogue PDF.",
      );
    } finally {
      setAnalyseCatalogueEnCours(false);
    }
  }

  async function importerProduitsCatalogue() {
    const selection = produitsCatalogue.filter((produit) => produit.inclure);
    if (selection.length === 0) {
      toast.error("Sélectionnez un nouveau produit ou joignez un contrat à un produit existant.");
      return;
    }
    const nouveauxProduits = selection.filter((produit) => !produit.existeDeja);
    const nomVide = nouveauxProduits.find((produit) => !produit.nom.trim());
    if (nomVide) {
      toast.error("Le nom de chaque produit importé est obligatoire.");
      return;
    }
    const sansFamille = nouveauxProduits.find(
      (produit) => !familles.some((famille) => famille.code === produit.famille_code),
    );
    if (sansFamille) {
      toast.error(`Choisissez une famille pour « ${sansFamille.nom} ».`);
      return;
    }
    const nomsNouveaux = nouveauxProduits.map((produit) => normaliserNomProduit(produit.nom));
    if (
      nouveauxProduits.some(
        (produit, index) =>
          produits.some(
            (existant) => normaliserNomProduit(existant.nom) === nomsNouveaux[index],
          ) || nomsNouveaux.indexOf(nomsNouveaux[index]) !== index,
      )
    ) {
      toast.error("Un nouveau produit est déjà présent ou apparaît plusieurs fois dans la liste.");
      return;
    }

    const produitsAInserer = nouveauxProduits.map((produit) => {
      const famille = familles.find((item) => item.code === produit.famille_code)!;
      return {
        compagnie_id: compagnieId,
        famille_id: famille.id,
        nom: produit.nom.trim(),
        code_produit: produit.code_produit?.trim() || null,
        description: produit.description?.trim() || null,
        statut: "actif" as const,
      };
    });

    setImportCatalogueEnCours(true);
    try {
      const produitsTraites: { id: string; nom: string }[] = [];
      const nouveauxProduitsCrees: { id: string; nom: string }[] = [];
      let fichesExistantesCompletees = 0;
      for (const [index, produit] of nouveauxProduits.entries()) {
        const { data, error } = await supabase
          .from("produits")
          .insert(produitsAInserer[index])
          .select("id,nom")
          .single();
        if (error || !data) {
          throw new Error(error?.message ?? `Impossible de créer le produit « ${produit.nom} ».`);
        }
        const cree = data as { id: string; nom: string };
        nouveauxProduitsCrees.push(cree);
        produitsTraites.push(cree);
      }

      // Le catalogue PDF sert aussi de source pour compléter les fiches déjà existantes.
      // On ne remplace jamais une information déjà renseignée par une valeur absente ou incertaine.
      for (const produit of selection.filter((item) => item.existeDeja)) {
        const existant = produits.find(
          (item) => normaliserNomProduit(item.nom) === normaliserNomProduit(produit.nom),
        );
        if (!existant) continue; // doublon détecté dans le PDF, sans fiche CRM correspondante
        const patch: { code_produit?: string; description?: string } = {};
        if (!existant.code_produit?.trim() && produit.code_produit?.trim()) {
          patch.code_produit = produit.code_produit.trim();
        }
        if (!existant.description?.trim() && produit.description?.trim()) {
          patch.description = produit.description.trim();
        }
        if (Object.keys(patch).length === 0) continue;
        const { error } = await supabase.from("produits").update(patch).eq("id", existant.id);
        if (error) {
          throw new Error(
            `Impossible de compléter la fiche « ${existant.nom} » : ${error.message}`,
          );
        }
        fichesExistantesCompletees++;
        produitsTraites.push({ id: existant.id, nom: existant.nom });
      }

      let documentsAjoutes = 0;
      let analysesLancees = 0;
      const erreursDocuments: string[] = [];
      for (const produit of selection) {
        const fichier = produit.documentReference;
        if (!fichier) continue;
        const produitCible = produit.existeDeja
          ? produits.find(
              (existant) =>
                normaliserNomProduit(existant.nom) === normaliserNomProduit(produit.nom),
            )
          : nouveauxProduitsCrees.find(
              (cree) => normaliserNomProduit(cree.nom) === normaliserNomProduit(produit.nom),
            );
        if (!produitCible) {
          erreursDocuments.push(`${produit.nom}: impossible de retrouver la fiche produit à mettre à jour.`);
          continue;
        }
        let storagePath: string | null = null;
        try {
          if (!fichier.name.toLowerCase().endsWith(".pdf") || fichier.size > 25 * 1024 * 1024) {
            throw new Error("PDF uniquement, 25 Mo maximum.");
          }
          if ((await fichier.slice(0, 5).text()) !== "%PDF-") {
            throw new Error("Le fichier sélectionné n’est pas un PDF valide.");
          }
          const nomStockage = fichier.name.replace(/[^a-zA-Z0-9._-]+/g, "-");
          const { data: depot, error: depotError } = await supabase.storage
            .from("produits-documents")
            .upload(`${produitCible.id}/${crypto.randomUUID()}-${nomStockage}`, fichier, {
              contentType: "application/pdf",
              upsert: false,
            });
          if (depotError || !depot) throw new Error(depotError?.message ?? "Dépôt du PDF impossible.");
          storagePath = depot.path;
          const { data: documentCree, error: docError } = await supabase.from("produit_documents").insert({
            produit_id: produitCible.id,
            type: "conditions_generales",
            nom: fichier.name,
            mime_type: "application/pdf",
            taille_bytes: fichier.size,
            interne: false,
            storage_path: storagePath,
            uploaded_by: user?.id ?? null,
          }).select("id").single();
          if (docError || !documentCree) {
            await supabase.storage.from("produits-documents").remove([storagePath]);
            throw new Error(docError.message);
          }
          documentsAjoutes++;
          try {
            const resultatInfos = await completerInfosProduit({ data: { document_id: documentCree.id } });
            if (resultatInfos.champs_completes.length > 0) {
              toast.success(`${produitCible.nom} : ${resultatInfos.champs_completes.length} champ(s) complété(s) depuis le contrat PDF.`);
            }
          } catch (infosError) {
            erreursDocuments.push(
              `${produit.nom}: document conservé, extraction des informations non terminée (${infosError instanceof Error ? infosError.message : "erreur inconnue"}).`,
            );
          }
          try {
            await analyserGaranties({ data: { produit_id: produitCible.id } });
            analysesLancees++;
          } catch (analyseError) {
            erreursDocuments.push(
              `${produit.nom}: document conservé, analyse à relancer dans l’onglet Garanties (${analyseError instanceof Error ? analyseError.message : "erreur inconnue"}).`,
            );
          }
        } catch (documentError) {
          erreursDocuments.push(
            `${produit.nom}: ${documentError instanceof Error ? documentError.message : "document non ajouté"}`,
          );
        }
      }

      toast.success(
        `${nouveauxProduitsCrees.length} nouveau(x) produit(s) créé(s), ${fichesExistantesCompletees} fiche(s) existante(s) complétée(s) depuis le PDF du catalogue.` +
          (documentsAjoutes
            ? ` ${documentsAjoutes} document(s) enregistré(s), ${analysesLancees} analyse(s) des garanties lancée(s).`
            : ""),
      );
      if (erreursDocuments.length > 0) {
        toast.error(
          `Import produits terminé avec des documents à vérifier : ${erreursDocuments.join(" · ")}`,
        );
      }
      setProduitsCatalogue([]);
      setFichierCatalogue(null);
      onChange();
      if (produitsTraites[0]) onSelect(produitsTraites[0].id);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Impossible d’importer les produits.");
    } finally {
      setImportCatalogueEnCours(false);
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!nom.trim() || !familleId) return;
    setCreating(true);
    const { data, error } = await supabase
      .from("produits")
      .insert({ compagnie_id: compagnieId, famille_id: familleId, nom: nom.trim() })
      .select("id")
      .single();
    setCreating(false);
    if (error) return alert(error.message);
    setNom("");
    onChange();
    if (data) onSelect(data.id);
  }

  async function telechargerComparatif() {
    if (produits.length === 0 && produitsEnAttente.length === 0) {
      toast.error(
        "Importez le PDF contenant la liste complète des produits puis analysez-le pour préparer le comparatif.",
      );
      return;
    }

    setGeneratingComparatif(true);
    try {
      const ids = produits.map((produit) => produit.id);
      let grillesProduit: GrilleProduitComparatif[] = [];
      let formules: FormuleComparatif[] = [];
      if (ids.length > 0) {
        const [grillesResult, formulesResult] = await Promise.all([
          supabase
            .from("produit_garanties")
            .select("produit_id,famille_code,grille_version,statut,valide_le,valeurs")
            .in("produit_id", ids),
          supabase
            .from("produit_formules")
            .select("id,produit_id,nom,ordre,base_calcul,tarif_fixe")
            .eq("actif", true)
            .in("produit_id", ids)
            .order("ordre"),
        ]);
        if (grillesResult.error) throw new Error(grillesResult.error.message);
        if (formulesResult.error) throw new Error(formulesResult.error.message);
        grillesProduit = (grillesResult.data ?? []) as unknown as GrilleProduitComparatif[];
        formules = (formulesResult.data ?? []) as FormuleComparatif[];
      }
      const idsFormules = formules.map((formule) => formule.id);
      let grillesFormule: {
        formule_id: string;
        grille_version: number;
        statut: string;
        valeurs: Record<string, unknown>;
      }[] = [];
      if (idsFormules.length > 0) {
        const result = await supabase
          .from("formule_garanties")
          .select("formule_id,grille_version,statut,valeurs")
          .in("formule_id", idsFormules);
        if (result.error) throw new Error(result.error.message);
        grillesFormule = (result.data ?? []) as typeof grillesFormule;
      }

      const { genererComparatifCompagniePdf } = await import("@/lib/comparatif-compagnie-pdf");
      const produitsComparatifs: ProduitComparatif[] = [
        ...produits.map((produit) => {
          const famille = familles.find((item) => item.id === produit.famille_id);
          return {
            id: produit.id,
            familleCode: famille?.code ?? null,
            familleNom: famille?.nom ?? "Famille non définie",
            champsStandards: famille?.champs_standards ?? [],
            nom: produit.nom,
            code_produit: produit.code_produit,
            assureur_porteur: produit.assureur_porteur,
            description: produit.description,
            statut: produit.statut,
            caracteristiques: produit.caracteristiques ?? {},
            points_forts: produit.points_forts,
            points_vigilance: produit.points_vigilance,
            cible: produit.cible,
          };
        }),
        ...produitsEnAttente.map((produit) => {
          const famille = familles.find((item) => item.code === produit.famille_code);
          return {
            id: produit.id,
            familleCode: famille?.code ?? null,
            familleNom: famille?.nom ?? "Famille à définir",
            champsStandards: famille?.champs_standards ?? [],
            nom: produit.nom,
            code_produit: produit.code_produit,
            assureur_porteur: null,
            description: produit.description,
            statut: "en_test",
            caracteristiques: {},
            points_forts: null,
            points_vigilance: null,
            cible: null,
          };
        }),
      ];
      const pdf = await genererComparatifCompagniePdf({
        compagnieNom,
        produits: produitsComparatifs,
        grillesProduit,
        formules,
        grillesFormule: grillesFormule as unknown as GrilleFormuleComparatif[],
      });
      const slug =
        compagnieNom
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, "") || "compagnie";
      telechargerPdfBlob(pdf, `comparatif-${slug}-${new Date().toISOString().slice(0, 10)}.pdf`);
      toast.success("Le comparatif PDF a été téléchargé.");
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Impossible de générer le comparatif PDF.",
      );
    } finally {
      setGeneratingComparatif(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-background p-4">
        <div>
          <p className="text-sm font-medium">Catalogue de {compagnieNom}</p>
          <p className="text-xs text-ink-muted">
            Importez la liste complète de la compagnie pour créer les fiches en une seule fois.
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            Le comparatif reprend tous les produits du catalogue, quel que soit leur statut, ainsi
            que les produits détectés dans le PDF en cours d’import. Pour les produits en attente,
            les garanties apparaissent comme non renseignées jusqu’à leur analyse.
          </p>
        </div>
        <button
          type="button"
          onClick={telechargerComparatif}
          disabled={generatingComparatif}
          className="rounded-md bg-[#0A192F] px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {generatingComparatif ? "Préparation du PDF…" : "Télécharger le comparatif PDF"}
        </button>
      </div>
      {isAdmin && (
        <section className="crm-card space-y-4 p-4">
          <div>
            <h3 className="text-sm font-semibold">Importer la liste des produits</h3>
            <p className="mt-1 text-xs text-ink-muted">
              Déposez le PDF catalogue de la compagnie. L’IA en extrait les produits ; vous vérifiez
              et complétez les familles avant leur création groupée.
            </p>
            <p className="mt-1 text-xs text-ink-muted">
              Le PDF est supprimé du stockage temporaire après l’analyse.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-64 flex-1 text-xs font-medium text-ink-muted">
              Catalogue PDF (12 Mo maximum)
              <input
                type="file"
                accept=".pdf,application/pdf"
                onChange={(event) => {
                  setFichierCatalogue(event.target.files?.[0] ?? null);
                  setProduitsCatalogue([]);
                }}
                className="mt-1 block w-full rounded-md border border-line bg-background px-3 py-2 text-sm text-ink"
              />
            </label>
            <button
              type="button"
              onClick={analyserFichierCatalogue}
              disabled={analyseCatalogueEnCours || !fichierCatalogue}
              className="rounded-md bg-[#0A192F] px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {analyseCatalogueEnCours ? "Analyse du catalogue…" : "Analyser la liste"}
            </button>
          </div>

          {produitsCatalogue.length > 0 && (
            <div className="space-y-3 border-t border-line pt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">
                  {produitsCatalogue.length} produit(s) détecté(s) ·{" "}
                  {produitsCatalogue.filter((produit) => produit.existeDeja).length} déjà présent(s)
                </p>
                <button
                  type="button"
                  onClick={importerProduitsCatalogue}
                  disabled={
                    importCatalogueEnCours ||
                    !produitsCatalogue.some(
                      (produit) =>
                        produit.inclure &&
                        (!produit.existeDeja || Boolean(produit.documentReference)),
                    ) ||
                    produitsCatalogue.some(
                      (produit) =>
                        produit.inclure &&
                        !produit.existeDeja &&
                        !familles.some((famille) => famille.code === produit.famille_code),
                    )
                  }
                  className="rounded-md bg-[#0A192F] px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {importCatalogueEnCours
                    ? "Import et mise à jour en cours…"
                    : "Créer les produits et compléter les fiches"}
                </button>
              </div>
              <div className="space-y-2">
                {produitsCatalogue.map((produit) => (
                  <div
                    key={produit.id}
                    className="grid gap-2 rounded-md border border-line bg-background p-3 md:grid-cols-[auto_minmax(0,1fr)_200px_170px]"
                  >
                    <input
                      type="checkbox"
                      checked={produit.inclure}
                      disabled={false}
                      aria-label={`Importer ${produit.nom}`}
                      onChange={(event) =>
                        setProduitsCatalogue((actuels) =>
                          actuels.map((item) =>
                            item.id === produit.id
                              ? { ...item, inclure: event.target.checked }
                              : item,
                          ),
                        )
                      }
                      className="mt-2"
                    />
                    <div className="space-y-1">
                      <input
                        value={produit.nom}
                        onChange={(event) =>
                          setProduitsCatalogue((actuels) =>
                            actuels.map((item) =>
                              item.id === produit.id ? { ...item, nom: event.target.value } : item,
                            ),
                          )
                        }
                        aria-label="Nom du produit"
                        className="w-full rounded-md border border-line bg-background px-2 py-1.5 text-sm"
                      />
                      <input
                        value={produit.description ?? ""}
                        onChange={(event) =>
                          setProduitsCatalogue((actuels) =>
                            actuels.map((item) =>
                              item.id === produit.id
                                ? { ...item, description: event.target.value || null }
                                : item,
                            ),
                          )
                        }
                        placeholder="Description (facultatif)"
                        aria-label="Description du produit"
                        className="w-full rounded-md border border-line bg-background px-2 py-1.5 text-xs"
                      />
                      <label className="block text-xs text-ink-muted">
                        Contrat / conditions générales (facultatif)
                        <input
                          type="file"
                          accept=".pdf,application/pdf"
                          onChange={(event) => {
                            const documentReference = event.target.files?.[0] ?? null;
                            setProduitsCatalogue((actuels) =>
                              actuels.map((item) =>
                                item.id === produit.id ? { ...item, documentReference } : item,
                              ),
                            );
                          }}
                          className="mt-1 block w-full text-xs"
                        />
                      </label>
                      {produit.documentReference && (
                        <p className="text-xs text-ink-muted">
                          Sera conservé dans la fiche produit et proposé à l’analyse des garanties
                          après import ou rattachement.
                        </p>
                      )}
                      {produit.existeDeja && (
                        <p className="text-xs text-amber-700">
                          Produit déjà présent : les informations extraites du catalogue complèteront
                          les champs vides de cette fiche, sans créer de doublon. Le PDF individuel
                          est facultatif et sert à lancer l’analyse des garanties.
                        </p>
                      )}
                    </div>
                    <select
                      value={produit.famille_code ?? ""}
                      onChange={(event) =>
                        setProduitsCatalogue((actuels) =>
                          actuels.map((item) =>
                            item.id === produit.id
                              ? { ...item, famille_code: event.target.value || null }
                              : item,
                          ),
                        )
                      }
                      aria-label={`Famille de ${produit.nom}`}
                      className="h-9 rounded-md border border-line bg-background px-2 text-sm"
                    >
                      <option value="">Choisir une famille</option>
                      {familles.map((famille) => (
                        <option key={famille.id} value={famille.code}>
                          {famille.nom}
                        </option>
                      ))}
                    </select>
                    <input
                      value={produit.code_produit ?? ""}
                      onChange={(event) =>
                        setProduitsCatalogue((actuels) =>
                          actuels.map((item) =>
                            item.id === produit.id
                              ? { ...item, code_produit: event.target.value || null }
                              : item,
                          ),
                        )
                      }
                      placeholder="Code produit"
                      aria-label={`Code du produit ${produit.nom}`}
                      className="h-9 rounded-md border border-line bg-background px-2 text-sm"
                    />
                  </div>
                ))}
              </div>
              <p className="text-xs text-ink-muted">
                Vérifiez les informations extraites du PDF. Les nouveaux produits seront créés avec
                les données détectées. Pour les produits déjà présents, le code produit et la
                description extraits rempliront uniquement les champs encore vides. Vous pouvez
                aussi joindre un PDF individuel pour l’ajouter à la fiche et lancer l’analyse des garanties.
              </p>
            </div>
          )}
        </section>
      )}
      <div className="grid gap-6 md:grid-cols-[280px_1fr]">
        <aside className="space-y-3">
          {isAdmin && (
            <form onSubmit={create} className="crm-card space-y-2 p-3">
              <p className="crm-eyebrow">Nouveau produit</p>
              <p className="text-[11px] text-ink-muted">
                Il sera rattaché automatiquement à {compagnieNom}.
              </p>
              <input
                value={nom}
                onChange={(e) => setNom(e.target.value)}
                placeholder="Nom du produit"
                className="w-full rounded-md border border-line bg-background px-2 py-1.5 text-sm"
                required
              />
              <select
                value={familleId}
                onChange={(e) => setFamilleId(e.target.value)}
                className="w-full rounded-md border border-line bg-background px-2 py-1.5 text-sm"
              >
                {familles.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.nom}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={creating || familles.length === 0}
                className="w-full rounded-md bg-[#0A192F] py-1.5 text-xs font-medium text-white disabled:opacity-60"
              >
                {creating ? "Création…" : "Créer le produit"}
              </button>
            </form>
          )}

          <div className="space-y-1">
            {produits.length === 0 && <p className="text-sm text-ink-muted">Aucun produit.</p>}
            {produits.map((p) => {
              const f = familles.find((x) => x.id === p.famille_id);
              const isActive = p.id === selected;
              const etat = grilles[p.id] ?? "absente";
              return (
                <button
                  key={p.id}
                  onClick={() => onSelect(p.id)}
                  className={
                    "w-full rounded-md px-3 py-2 text-left text-sm transition-colors " +
                    (isActive ? "bg-[#D4AF37]/25 font-semibold text-[#0A192F]" : "hover:bg-surface")
                  }
                >
                  <div className="flex items-center gap-2">
                    <StoredImage
                      bucket="produits-images"
                      value={p.image_url}
                      alt={p.nom}
                      className="size-7 shrink-0 rounded bg-background object-contain"
                    />
                    <span className="font-medium">{p.nom}</span>
                    {varianteCapital(p.nom) && (
                      <span
                        className="shrink-0 rounded border border-[#B99B3F]/50 bg-[#B99B3F]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#8a7226]"
                        title={libelleVariante(varianteCapital(p.nom)!)}
                      >
                        {varianteCapital(p.nom)}
                      </span>
                    )}
                  </div>
                  <div
                    className={
                      "text-xs " + (isActive ? "text-primary-foreground/70" : "text-ink-muted")
                    }
                  >
                    {f?.nom ?? "—"} · {p.statut}
                    {varianteCapital(p.nom) ? ` · ${libelleVariante(varianteCapital(p.nom)!)}` : ""}
                  </div>
                  <div className="mt-1">
                    <GrilleBadge etat={etat} />
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        <div>
          {active ? (
            <ProduitEditor
              key={active.id}
              produit={active}
              famille={familles.find((f) => f.id === active.famille_id)}
              familles={familles}
              autresProduits={produits.filter((x) => x.id !== active.id)}
              isAdmin={isAdmin}
              onChange={onChange}
              onDelete={() => onSelect(null)}
            />
          ) : (
            <p className="rounded-lg border border-dashed border-line p-8 text-center text-sm text-ink-muted">
              Sélectionnez un produit à gauche pour éditer ses caractéristiques et ses documents.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function ProduitEditor({
  produit,
  famille,
  familles,
  autresProduits,
  isAdmin,
  onChange,
  onDelete,
}: {
  produit: Produit;
  famille: Famille | undefined;
  familles: Famille[];
  autresProduits: Produit[];
  isAdmin: boolean;
  onChange: () => void;
  onDelete: () => void;
}) {
  const [p, setP] = useState<Produit>(produit);
  const completerInfosProduit = useServerFn(completerInfosProduitDepuisDocument);
  const [saving, setSaving] = useState(false);
  const [docs, setDocs] = useState<ProduitDoc[]>([]);
  const [documentAnalyseEnCours, setDocumentAnalyseEnCours] = useState<string | null>(null);
  const [garantiesRefreshKey, setGarantiesRefreshKey] = useState(0);
  useEffect(() => setP(produit), [produit]);

  const readOnly = !isAdmin;

  async function loadDocs() {
    const { data } = await supabase
      .from("produit_documents")
      .select("*")
      .eq("produit_id", produit.id)
      .order("created_at", { ascending: false });
    setDocs((data as ProduitDoc[]) ?? []);
  }
  useEffect(() => {
    loadDocs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [produit.id]);

  async function remplirDepuisDocument(document: ProduitDoc) {
    if (!isAdmin) return;
    setDocumentAnalyseEnCours(document.id);
    try {
      const resultat = await completerInfosProduit({ data: { document_id: document.id } });
      if (resultat.champs_completes.length === 0) {
        toast.info("Aucun champ vide n’a pu être complété à partir de ce PDF. Vérifiez son contenu ou les informations déjà renseignées.");
      } else {
        toast.success("Fiche complétée depuis le PDF : " + resultat.champs_completes.join(", ") + ".");
        const { data, error } = await supabase.from("produits").select("*").eq("id", produit.id).single();
        if (error) throw new Error(error.message);
        setP(data as Produit);
        onChange();
      }
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Impossible d’extraire les informations du PDF.");
    } finally {
      setDocumentAnalyseEnCours(null);
    }
  }

  async function save() {
    setSaving(true);
    const { error } = await supabase
      .from("produits")
      .update({
        nom: p.nom,
        code_produit: p.code_produit,
        assureur_porteur: p.assureur_porteur,
        description: p.description,
        statut: p.statut,
        caracteristiques: p.caracteristiques as never,
        points_forts: p.points_forts,
        points_vigilance: p.points_vigilance,
        cible: p.cible,
        commission_taux: p.commission_taux,
        frais_versement_pct: p.frais_versement_pct,
        frais_gestion_pct: p.frais_gestion_pct,
        frais_arbitrage_pct: p.frais_arbitrage_pct,
        famille_id: p.famille_id,
        produit_requis_id: p.produit_requis_id,
        famille_requise_id: p.famille_requise_id,
        image_url: p.image_url,
        mode_tarification: p.mode_tarification,
      })
      .eq("id", p.id);
    setSaving(false);
    if (error) return alert(error.message);
    onChange();
  }

  async function del() {
    if (!confirm(`Supprimer le produit ${p.nom} ?`)) return;
    const { error } = await supabase.from("produits").delete().eq("id", p.id);
    if (error) return alert(error.message);
    onDelete();
    onChange();
  }

  function setCarac(code: string, value: unknown) {
    setP({ ...p, caracteristiques: { ...p.caracteristiques, [code]: value } });
  }

  return (
    <div className="space-y-6">
      <div className="crm-card grid gap-4 p-5 md:grid-cols-2">
        <Field
          label="Nom du produit"
          value={p.nom}
          onChange={(v) => setP({ ...p, nom: v })}
          readOnly={readOnly}
        />
        <Field
          label="Référence interne compagnie"
          value={p.code_produit ?? ""}
          onChange={(v) => setP({ ...p, code_produit: v })}
          readOnly={readOnly}
        />
        <Field
          label="Assureur porteur du risque (ex. CARDIF, MNCAP)"
          value={p.assureur_porteur ?? ""}
          onChange={(v) => setP({ ...p, assureur_porteur: v })}
          readOnly={readOnly}
        />
        <div className="md:col-span-2">
          <ImageUploadField
            bucket="produits-images"
            prefix={produit.id}
            value={p.image_url}
            label="Image du produit"
            canEdit={!readOnly}
            onUploaded={async (path) => {
              setP({ ...p, image_url: path });
              const { error } = await supabase
                .from("produits")
                .update({ image_url: path })
                .eq("id", p.id);
              if (error) return alert(error.message);
              onChange();
            }}
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-ink-muted">Statut</label>
          <select
            value={p.statut}
            onChange={(e) => setP({ ...p, statut: e.target.value as Produit["statut"] })}
            disabled={readOnly}
            className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
          >
            <option value="actif">Actif</option>
            <option value="en_test">En test</option>
            <option value="retire">Retiré</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-muted">
            Tarif moyen indicatif (€/mois)
          </label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={
              typeof p.caracteristiques?.tarif_moyen_mensuel === "number"
                ? p.caracteristiques.tarif_moyen_mensuel
                : ""
            }
            onChange={(e) =>
              setCarac("tarif_moyen_mensuel", e.target.value === "" ? null : Number(e.target.value))
            }
            readOnly={readOnly}
            className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
          />
          <p className="mt-1 text-[11px] text-ink-muted">
            Repère indicatif uniquement, pas un tarif garanti pour le client. Renseigner seulement
            si vous disposez d’une référence fiable.
          </p>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-muted">
            Mode de tarification
          </label>
          <select
            value={p.mode_tarification ?? "manuel"}
            onChange={(e) =>
              setP({ ...p, mode_tarification: e.target.value as Produit["mode_tarification"] })
            }
            disabled={readOnly}
            className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
          >
            <option value="manuel">Manuel — devis saisis dossier par dossier</option>
            <option value="api">API compagnie — tarification à la demande</option>
            <option value="fixe">Tarif fixe — cotisation connue par formule</option>
          </select>
          <p className="mt-1 text-[11px] text-ink-muted">
            En mode « tarif fixe », le devis du dossier est généré depuis la formule et les options
            renseignées ci-dessous, sans ressaisie ni classement IA.
          </p>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-muted">Commission (%)</label>
          <input
            type="number"
            step="0.01"
            value={p.commission_taux ?? ""}
            onChange={(e) =>
              setP({ ...p, commission_taux: e.target.value === "" ? null : Number(e.target.value) })
            }
            readOnly={readOnly}
            className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
          />
        </div>

        {(["frais_versement_pct", "frais_gestion_pct", "frais_arbitrage_pct"] as const).map(
          (cle) => (
            <div key={cle}>
              <label className="mb-1 block text-xs font-medium text-ink-muted">
                {cle === "frais_versement_pct"
                  ? "Frais sur versement (%)"
                  : cle === "frais_gestion_pct"
                    ? "Frais de gestion annuels (%)"
                    : "Frais d'arbitrage (%)"}
              </label>
              <input
                type="number"
                step="0.01"
                value={p[cle] ?? ""}
                onChange={(e) =>
                  setP({ ...p, [cle]: e.target.value === "" ? null : Number(e.target.value) })
                }
                readOnly={readOnly}
                className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
              />
              <p className="mt-1 text-[11px] text-ink-muted">
                Épargne / PER : sert au comparatif et aux projections 3 / 8 / 10 ans.
              </p>
            </div>
          ),
        )}

        <div className="md:col-span-2">
          <label className="mb-1 block text-xs font-medium text-ink-muted">Description</label>
          <textarea
            value={p.description ?? ""}
            onChange={(e) => setP({ ...p, description: e.target.value })}
            readOnly={readOnly}
            rows={2}
            className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
          />
        </div>
      </div>

      {/* Caractéristiques standardisées */}
      {famille && famille.champs_standards?.length > 0 && (
        <section className="crm-card space-y-3 p-5">
          <div>
            <h3 className="font-serif text-lg">Caractéristiques — {famille.nom}</h3>
            <p className="text-xs text-ink-muted">
              Champs standardisés pour comparer les produits de la même famille.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {famille.champs_standards.map((ch) => (
              <ChampInput
                key={ch.code}
                champ={ch}
                value={p.caracteristiques?.[ch.code]}
                onChange={(v) => setCarac(ch.code, v)}
                readOnly={readOnly}
              />
            ))}
          </div>
        </section>
      )}

      {/* Devoir de conseil */}
      <section className="crm-card grid gap-4 p-5 md:grid-cols-2">
        <div className="md:col-span-2">
          <h3 className="font-serif text-lg">Devoir de conseil</h3>
          <p className="text-xs text-ink-muted">
            Utilisé pour les devis, comparatifs et documents de conseil.
          </p>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-muted">Cible / profils</label>
          <textarea
            value={p.cible ?? ""}
            onChange={(e) => setP({ ...p, cible: e.target.value })}
            readOnly={readOnly}
            rows={3}
            className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-muted">Points forts</label>
          <textarea
            value={p.points_forts ?? ""}
            onChange={(e) => setP({ ...p, points_forts: e.target.value })}
            readOnly={readOnly}
            rows={3}
            className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
          />
        </div>
        <div className="md:col-span-2">
          <label className="mb-1 block text-xs font-medium text-ink-muted">
            Points de vigilance
          </label>
          <textarea
            value={p.points_vigilance ?? ""}
            onChange={(e) => setP({ ...p, points_vigilance: e.target.value })}
            readOnly={readOnly}
            rows={3}
            className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
          />
        </div>
      </section>

      {/* Vente couplée */}
      <section className="crm-card grid gap-4 p-5 md:grid-cols-2">
        <div className="md:col-span-2">
          <h3 className="font-serif text-lg">Contrainte de vente couplée</h3>
          <p className="text-xs text-ink-muted">
            Ce produit ne peut pas être souscrit seul : le CRM bloque la création du contrat si le
            prérequis n'est pas déjà présent sur le dossier ou le client.
          </p>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-muted">Produit requis</label>
          <select
            value={p.produit_requis_id ?? ""}
            onChange={(e) => setP({ ...p, produit_requis_id: e.target.value || null })}
            disabled={readOnly}
            className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
          >
            <option value="">— Aucun —</option>
            {autresProduits.map((ap) => (
              <option key={ap.id} value={ap.id}>
                {ap.nom}
                {ap.code_produit ? ` (${ap.code_produit})` : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-muted">
            Ou famille de produits requise (toutes compagnies)
          </label>
          <select
            value={p.famille_requise_id ?? ""}
            onChange={(e) => setP({ ...p, famille_requise_id: e.target.value || null })}
            disabled={readOnly}
            className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
          >
            <option value="">— Aucune —</option>
            {familles.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nom}
              </option>
            ))}
          </select>
        </div>
      </section>

      {isAdmin && (
        <div className="flex justify-between">
          <button onClick={del} className="text-xs text-red-700 underline underline-offset-4">
            Supprimer ce produit
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="rounded-md bg-[#0A192F] px-5 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {saving ? "Enregistrement…" : "Enregistrer le produit"}
          </button>
        </div>
      )}

      <DocumentsBlock
        produitId={p.id}
        familleCode={famille?.code ?? null}
        docs={docs}
        isAdmin={isAdmin}
        onChange={loadDocs}
        onAnalyseTerminee={() => setGarantiesRefreshKey((key) => key + 1)}
      />

      <ProduitGarantiesTab
        produitId={p.id}
        familleCode={famille?.code ?? null}
        familleNom={famille?.nom}
        isAdmin={isAdmin}
        docs={docs.map((d) => ({ id: d.id, nom: d.nom, type: d.type }))}
        refreshKey={garantiesRefreshKey}
        titre="Garanties, exclusions et options du produit"
      />

      {(famille?.code === "sante" ||
        famille?.code === "emprunteur" ||
        p.mode_tarification === "fixe") && (
        <ProduitFormulesTab
          produitId={p.id}
          familleCode={famille?.code ?? null}
          familleNom={famille?.nom}
          isAdmin={isAdmin}
          modeFixe={p.mode_tarification === "fixe"}
          docs={docs.map((d) => ({ id: d.id, nom: d.nom, type: d.type }))}
        />
      )}
    </div>
  );
}

function ChampInput({
  champ,
  value,
  onChange,
  readOnly,
}: {
  champ: ChampStandard;
  value: unknown;
  onChange: (v: unknown) => void;
  readOnly: boolean;
}) {
  const label = champ.label + (champ.unit ? ` (${champ.unit})` : "");
  const base = "w-full rounded-md border border-line bg-background px-3 py-2 text-sm";
  if (champ.type === "boolean") {
    return (
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          disabled={readOnly}
        />
        <span>{label}</span>
      </label>
    );
  }
  if (champ.type === "select") {
    return (
      <div>
        <label className="mb-1 block text-xs font-medium text-ink-muted">{label}</label>
        <select
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value || null)}
          disabled={readOnly}
          className={base}
        >
          <option value="">—</option>
          {champ.options?.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </div>
    );
  }
  if (champ.type === "multiselect") {
    const arr = Array.isArray(value) ? (value as string[]) : [];
    return (
      <div>
        <label className="mb-1 block text-xs font-medium text-ink-muted">{label}</label>
        <div className="flex flex-wrap gap-2">
          {champ.options?.map((o) => {
            const on = arr.includes(o);
            return (
              <button
                key={o}
                type="button"
                disabled={readOnly}
                onClick={() => onChange(on ? arr.filter((x) => x !== o) : [...arr, o])}
                className={
                  "rounded-full border px-3 py-1 text-xs " +
                  (on
                    ? "border-transparent bg-[#0A192F] text-white"
                    : "border-line bg-background text-ink-soft")
                }
              >
                {o}
              </button>
            );
          })}
        </div>
      </div>
    );
  }
  if (champ.type === "textarea") {
    return (
      <div className="md:col-span-2">
        <label className="mb-1 block text-xs font-medium text-ink-muted">{label}</label>
        <textarea
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value || null)}
          readOnly={readOnly}
          rows={2}
          className={base}
        />
      </div>
    );
  }
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-ink-muted">{label}</label>
      <input
        type={champ.type === "number" ? "number" : "text"}
        value={value === null || value === undefined ? "" : String(value)}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "") return onChange(null);
          onChange(champ.type === "number" ? Number(v) : v);
        }}
        readOnly={readOnly}
        className={base}
      />
    </div>
  );
}

// ============ Documents ============
function DocumentsBlock({
  produitId,
  familleCode,
  docs,
  isAdmin,
  onChange,
  onAnalyseTerminee,
}: {
  produitId: string;
  familleCode: string | null;
  docs: ProduitDoc[];
  isAdmin: boolean;
  onChange: () => void;
  onAnalyseTerminee: () => void;
}) {
  const analyserAutomatiquement = useServerFn(analyserGarantiesAutomatiquement);
  const typesDisponibles = docTypesPour(familleCode);
  const [type, setType] = useState<ProduitDoc["type"]>("conditions_generales");
  /** Type retenu : le choix courant s'il est valide pour la branche, sinon le premier proposé. */
  const typeEffectif = typesDisponibles.includes(type) ? type : typesDisponibles[0];

  const [version, setVersion] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const { user } = useAuth();

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    try {
      if (!file.name.toLowerCase().endsWith(".pdf")) {
        throw new Error("Le document doit être au format PDF.");
      }
      if (file.size > 25 * 1024 * 1024) {
        throw new Error("Le PDF ne peut pas dépasser 25 Mo.");
      }
      if ((await file.slice(0, 5).text()) !== "%PDF-") {
        throw new Error("Le fichier sélectionné n'est pas un PDF valide.");
      }

      const nomStockage = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-");
      const { data: depot, error: depotError } = await supabase.storage
        .from("produits-documents")
        .upload(`${produitId}/${crypto.randomUUID()}-${nomStockage}`, file, {
          contentType: "application/pdf",
          upsert: false,
        });
      if (depotError) throw depotError;

      const { error: insertionError } = await supabase.from("produit_documents").insert({
        produit_id: produitId,
        type: typeEffectif,
        nom: file.name,
        version: version || null,
        mime_type: "application/pdf",
        taille_bytes: file.size,
        interne: typeEffectif === "fiche_produit",
        storage_path: depot.path,
        uploaded_by: user?.id ?? null,
      });
      if (insertionError) {
        const { error: nettoyageError } = await supabase.storage
          .from("produits-documents")
          .remove([depot.path]);
        if (nettoyageError)
          console.error("[produit-documents] nettoyage après échec", nettoyageError);
        throw insertionError;
      }

      const analyserApresDepot =
        typeEffectif === "fiche_produit" ||
        (typeEffectif === "conditions_generales" &&
          !docs.some((document) => document.type === "fiche_produit"));

      setFile(null);
      setVersion("");
      onChange();
      if (analyserApresDepot) {
        void analyserAutomatiquement({ data: { produit_id: produitId } })
          .then((resultat) => {
            const source =
              resultat.document_source.type === "fiche_produit"
                ? "la fiche produit"
                : "les conditions générales";
            toast.success(
              `Proposition IA créée depuis ${source}. Relisez puis validez les garanties dans l'onglet Garanties.`,
            );
            onAnalyseTerminee();
          })
          .catch((erreurAnalyse) => {
            const detail =
              erreurAnalyse instanceof Error ? erreurAnalyse.message : "erreur inconnue";
            toast.error(
              `PDF enregistré, mais l'analyse IA n'a pas abouti : ${detail}. Vous pourrez la relancer dans l'onglet Garanties.`,
            );
            onAnalyseTerminee();
          });
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Dépôt du PDF impossible");
    } finally {
      setUploading(false);
    }
  }

  async function download(d: ProduitDoc) {
    if (d.drive_url) {
      window.open(d.drive_url, "_blank", "noopener");
      return;
    }
    if (!d.storage_path) return alert("Aucun fichier rattaché à ce document.");
    const { data, error } = await supabase.storage
      .from("produits-documents")
      .createSignedUrl(d.storage_path, 60);
    if (error || !data) return alert(error?.message ?? "Erreur");
    window.open(data.signedUrl, "_blank");
  }

  async function del(d: ProduitDoc) {
    if (
      !confirm(
        d.drive_url
          ? `Retirer ${d.nom} du catalogue CRM ? Le fichier reste conservé sur le Drive du cabinet.`
          : `Supprimer ${d.nom} ?`,
      )
    )
      return;
    if (d.storage_path) await supabase.storage.from("produits-documents").remove([d.storage_path]);
    await supabase.from("produit_documents").delete().eq("id", d.id);
    onChange();
  }

  return (
    <section className="crm-card space-y-3 p-5">
      <div>
        <h3 className="font-serif text-lg">Documents du produit</h3>
        <p className="text-xs text-ink-muted">
          Liste adaptée à la branche : {typesDisponibles.map((t) => DOC_TYPE_LABEL[t]).join(" · ")}.
          Les fiches produit sont marquées internes. Les PDF sont conservés dans l'espace privé du
          CRM.
        </p>
      </div>

      {isAdmin && (
        <form
          onSubmit={upload}
          className="flex flex-wrap items-end gap-2 rounded-md bg-background p-3"
        >
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-muted">Type</label>
            <select
              value={typeEffectif}
              onChange={(e) => setType(e.target.value as ProduitDoc["type"])}
              className="rounded-md border border-line bg-background px-2 py-1.5 text-sm"
            >
              {typesDisponibles.map((k) => (
                <option key={k} value={k}>
                  {DOC_TYPE_LABEL[k]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-muted">Version</label>
            <input
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="ex : 2025-01"
              className="rounded-md border border-line bg-background px-2 py-1.5 text-sm"
            />
          </div>
          <div className="flex-1 min-w-[180px]">
            <label className="mb-1 block text-xs font-medium text-ink-muted">Fichier</label>
            <input
              type="file"
              accept="application/pdf,.pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="w-full text-sm"
              required
            />
            <p className="mt-1 text-xs text-ink-muted">PDF uniquement, 25 Mo maximum.</p>
          </div>
          <button
            type="submit"
            disabled={uploading || !file}
            className="rounded-md bg-[#0A192F] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {uploading ? "Upload…" : "Ajouter"}
          </button>
        </form>
      )}

      {docs.length === 0 ? (
        <p className="text-sm text-ink-muted">Aucun document.</p>
      ) : (
        <ul className="divide-y divide-line rounded-md border border-line bg-background">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-surface px-2 py-0.5 text-xs uppercase tracking-wide text-ink-muted">
                    {DOC_TYPE_LABEL[d.type]}
                  </span>
                  {d.interne && (
                    <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900">
                      Interne
                    </span>
                  )}
                  <span className="truncate font-medium">{d.nom}</span>
                </div>
                <div className="text-xs text-ink-muted">
                  {d.version ? `v${d.version} · ` : ""}
                  {new Date(d.created_at).toLocaleDateString("fr-FR")}
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-3 text-xs">
                {isAdmin && d.storage_path && ["conditions_generales", "ipid", "fiche_produit", "tableau_garanties", "ccsf"].includes(d.type) && (
                  <button
                    type="button"
                    onClick={() => remplirDepuisDocument(d)}
                    disabled={documentAnalyseEnCours !== null}
                    className="font-medium text-[#0A192F] underline underline-offset-4 disabled:opacity-50"
                  >
                    {documentAnalyseEnCours === d.id ? "Lecture du PDF…" : "Remplir la fiche depuis ce PDF"}
                  </button>
                )}
                <button
                  onClick={() => download(d)}
                  className="text-ink underline underline-offset-4"
                >
                  Ouvrir
                </button>
                {isAdmin && (
                  <button
                    onClick={() => del(d)}
                    className="text-red-700 underline underline-offset-4"
                  >
                    Supprimer
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ============ Onglet API ============
function ApiTab({
  compagnieId,
  apiActive,
  isAdmin,
  onApiActiveChange,
}: {
  compagnieId: string;
  apiActive: boolean;
  isAdmin: boolean;
  onApiActiveChange: (v: boolean) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notAllowed, setNotAllowed] = useState(false);
  const [form, setForm] = useState({
    api_base_url: "",
    api_auth_type: "none" as ApiAuthType,
    api_secret_name: "",
    api_config: "{}",
  });
  const [jsonErr, setJsonErr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const readOnly = !isAdmin;

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("compagnies_api_config")
        .select("*")
        .eq("compagnie_id", compagnieId)
        .maybeSingle();
      if (error) {
        // RLS: non-admins get no rows / no access — hide the form
        setNotAllowed(true);
      } else if (data) {
        const cfg = data as CompagnieApiConfig;
        setForm({
          api_base_url: cfg.api_base_url ?? "",
          api_auth_type: cfg.api_auth_type,
          api_secret_name: cfg.api_secret_name ?? "",
          api_config: JSON.stringify(cfg.api_config ?? {}, null, 2),
        });
        // Audit: log admin SELECT on sensitive API config
        await supabase.rpc("log_audit", {
          _action: "SELECT",
          _target_type: "table:compagnies_api_config",
          _target_id: compagnieId,
          _metadata: null,
        });
      }
      setLoading(false);
    })();
  }, [compagnieId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = form.api_config.trim() ? JSON.parse(form.api_config) : {};
    } catch (err) {
      setJsonErr(err instanceof Error ? err.message : "JSON invalide");
      return;
    }
    setJsonErr(null);
    setSaving(true);
    const { error } = await supabase.from("compagnies_api_config").upsert({
      compagnie_id: compagnieId,
      api_base_url: form.api_base_url || null,
      api_auth_type: form.api_auth_type,
      api_secret_name: form.api_secret_name || null,
      api_config: parsed,
    } as never);
    setSaving(false);
    if (error) setError(error.message);
  }

  if (loading) return <p className="text-sm text-ink-muted">Chargement…</p>;
  if (notAllowed || !isAdmin) {
    return (
      <div className="crm-card p-6 text-sm text-ink-muted">
        La configuration API est réservée aux administrateurs.
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="crm-card space-y-5 p-6">
      <div className="rounded-md bg-amber-50 p-3 text-xs text-amber-900">
        Les identifiants API (clé, mot de passe, secret OAuth) ne sont jamais stockés en clair dans
        cette fiche. Créez-les dans les secrets du backend, puis renseignez ci-dessous le{" "}
        <strong>nom du secret</strong> (par exemple
        <code className="mx-1 rounded bg-amber-100 px-1">APRIL_API_KEY</code>). Le code serveur lit
        alors la valeur depuis l'environnement lors des appels.
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={apiActive}
          onChange={(e) => onApiActiveChange(e.target.checked)}
          disabled={readOnly}
        />
        <span>Activer l'API pour cette compagnie</span>
      </label>

      <div className="grid gap-4 md:grid-cols-2">
        <Field
          label="URL de base"
          value={form.api_base_url}
          onChange={(v) => setForm({ ...form, api_base_url: v })}
          readOnly={readOnly}
        />
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-muted">
            Type d'authentification
          </label>
          <select
            value={form.api_auth_type}
            onChange={(e) => setForm({ ...form, api_auth_type: e.target.value as ApiAuthType })}
            disabled={readOnly}
            className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
          >
            <option value="none">Aucune</option>
            <option value="api_key">Clé API (header)</option>
            <option value="bearer">Bearer token</option>
            <option value="oauth2">OAuth 2.0</option>
            <option value="basic">Basic (user:pass)</option>
          </select>
        </div>
        <Field
          label="Nom du secret backend"
          value={form.api_secret_name}
          onChange={(v) => setForm({ ...form, api_secret_name: v })}
          readOnly={readOnly}
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-ink-muted">
          Configuration JSON (endpoints, headers, mapping produits…)
        </label>
        <textarea
          value={form.api_config}
          onChange={(e) => setForm({ ...form, api_config: e.target.value })}
          readOnly={readOnly}
          rows={10}
          className="w-full rounded-md border border-line bg-background px-3 py-2 font-mono text-xs"
        />
        {jsonErr && <p className="mt-1 text-xs text-red-700">JSON invalide : {jsonErr}</p>}
      </div>

      {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</p>}

      {isAdmin && (
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-[#0A192F] px-5 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {saving ? "Enregistrement…" : "Enregistrer l'API"}
        </button>
      )}
    </form>
  );
}
