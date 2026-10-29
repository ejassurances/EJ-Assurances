import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/page-header";
import { SectionNav } from "@/components/section-nav";
import { IconReportMoney } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  EcrituresTab,
  GrandLivreTab,
  BalanceTab,
  ResultatTab,
  PlanComptableTab,
  NotesDeFraisTab,
} from "@/components/comptabilite-ecritures";
import { FacturesAchatTab } from "@/components/factures-achat-tab";
import { LivreRecettesTab } from "@/components/livre-recettes-tab";
import { LivreAchatsTab } from "@/components/livre-achats-tab";
import { CommissionMoisCard } from "@/components/commission-mois-card";
import { TresoreriePrevisionnelle } from "@/components/tresorerie-previsionnelle";
import { PilotageFinancierCabinet } from "@/components/pilotage-financier-cabinet";

export const Route = createFileRoute("/_authenticated/espace/comptabilite")({
  component: ComptabilitePage,
});

type Echeance = {
  id: string;
  contrat_id: string;
  annee: number;
  date_debut_periode: string;
  date_fin_periode: string;
  prime_periode: number;
  commission_cabinet_periode: number;
  commission_mandataire_periode: number;
  commission_prescripteur_periode: number;
  mandataire_id: string | null;
  prescripteur_id: string | null;
  statut: "previsionnel" | "emise" | "payee" | "annulee";
  bordereau_id: string | null;
};
type Bordereau = {
  id: string;
  periode: string;
  assureur: string;
  montant_total: number;
  nb_lignes: number;
  statut: string;
  fichier_source: string | null;
  notes: string | null;
};
type Paiement = {
  id: string;
  beneficiaire_id: string;
  portee: "mandataire" | "prescripteur";
  periode: string;
  montant: number;
  moyen_paiement: string | null;
  reference: string | null;
  date_paiement: string | null;
  notes: string | null;
};
type Regle = {
  id: string;
  portee: "mandataire" | "prescripteur";
  beneficiaire_id: string | null;
  compagnie_id: string | null;
  produit_id: string | null;
  famille_id: string | null;
  taux: number;
  assiette: "commission_cabinet" | "prime_ht";
  date_effet: string;
  date_fin: string | null;
};
type Profile = { id: string; email: string | null; full_name: string | null };

const fmt = (n: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
const yearOf = (d: string) => new Date(d).getFullYear();

function ComptabilitePage() {
  const { role } = useAuth();

  if (role !== "admin" && role !== "mandataire" && role !== "prescripteur") {
    return <p className="text-sm text-ink-muted">Accès réservé.</p>;
  }

  return (
    <div>
      <PageHeader
        eyebrow="Finance"
        title="Comptabilité"
        description={
          role === "admin"
            ? "Pilotage global : prévisionnel, encaissements compagnies et rétrocessions partenaires."
            : "Votre commissionnement : commissions prévues, émises, encaissées et versements reçus."
        }
        icon={IconReportMoney}
      />

      {role === "admin" ? <AdminView /> : <PartnerView role={role as "mandataire" | "prescripteur"} />}
    </div>
  );
}

/* ---------- ADMIN ---------- */

type AdminSection =
  | "overview"
  | "previsionnel"
  | "encaissements"
  | "retrocessions"
  | "prescripteurs"
  | "regles"
  | "factures"
  | "livre-recettes"
  | "livre-achats"
  | "ecritures"
  | "grand-livre"
  | "balance"
  | "resultat"
  | "pcg";

const ADMIN_SECTIONS: { key: AdminSection; label: string }[] = [
  { key: "overview", label: "Vue d'ensemble" },
  { key: "previsionnel", label: "Prévisionnel" },
  { key: "encaissements", label: "Encaissements" },
  { key: "retrocessions", label: "Rétrocessions" },
  { key: "prescripteurs", label: "Prescripteurs" },
  { key: "regles", label: "Règles" },
  { key: "factures", label: "Factures d'achat" },
  { key: "livre-recettes", label: "Livre des recettes" },
  { key: "livre-achats", label: "Livre des achats" },
  { key: "ecritures", label: "Écritures" },
  { key: "grand-livre", label: "Grand livre" },
  { key: "balance", label: "Balance" },
  { key: "resultat", label: "Résultat" },
  { key: "pcg", label: "Plan comptable" },
];

function AdminView() {
  const [section, setSection] = useState<AdminSection>("overview");

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_18rem]">
      <div className="min-w-0">
        {section === "overview" && <Overview />}
        {section === "previsionnel" && (
          <div className="space-y-6">
            <TresoreriePrevisionnelle />
            <Previsionnel />
          </div>
        )}
        {section === "encaissements" && <Encaissements />}
        {section === "retrocessions" && <Retrocessions portee="mandataire" />}
        {section === "prescripteurs" && <Retrocessions portee="prescripteur" />}
        {section === "regles" && <ReglesCommission />}
        {section === "factures" && <FacturesAchatTab />}
        {section === "livre-recettes" && <LivreRecettesTab />}
        {section === "livre-achats" && <LivreAchatsTab />}
        {section === "ecritures" && <EcrituresTab />}
        {section === "grand-livre" && <GrandLivreTab />}
        {section === "balance" && <BalanceTab />}
        {section === "resultat" && <ResultatTab />}
        {section === "pcg" && <PlanComptableTab />}
      </div>
      <div className="order-first lg:order-last">
        <SectionNav title="Comptabilité" items={ADMIN_SECTIONS} active={section} onSelect={setSection} />
      </div>
    </div>
  );
}

function Card({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="crm-card p-5">
      <p className="crm-eyebrow">{label}</p>
      <p className="crm-figure mt-2 text-2xl">{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-muted">{hint}</p>}
    </div>
  );
}

function Overview() {
  const [ech, setEch] = useState<Echeance[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("contrat_echeances").select("*").order("date_debut_periode");
      setEch((data as Echeance[]) ?? []);
      setLoading(false);
    })();
  }, []);

  const now = new Date();
  const currentYear = now.getFullYear();

  const stats = useMemo(() => {
    let encaisse = 0,
      emis = 0,
      previsionnel = 0,
      previsionnelYear = 0;
    const yearly: Record<number, number> = {};
    for (const e of ech) {
      const y = yearOf(e.date_debut_periode);
      yearly[y] = (yearly[y] ?? 0) + Number(e.commission_cabinet_periode);
      if (e.statut === "payee") encaisse += Number(e.commission_cabinet_periode);
      else if (e.statut === "emise") emis += Number(e.commission_cabinet_periode);
      else if (e.statut === "previsionnel") {
        previsionnel += Number(e.commission_cabinet_periode);
        if (y === currentYear) previsionnelYear += Number(e.commission_cabinet_periode);
      }
    }
    return { encaisse, emis, previsionnel, previsionnelYear, yearly };
  }, [ech, currentYear]);

  if (loading) return <p className="text-sm text-ink-muted">Chargement…</p>;

  const nextYears = Array.from({ length: 5 }, (_, i) => currentYear + i);

  return (
    <div className="space-y-6">
      <PilotageFinancierCabinet />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card label="Encaissé" value={fmt(stats.encaisse)} hint="Commissions payées" />
        <Card label="Émis" value={fmt(stats.emis)} hint="En attente de paiement" />
        <Card label="Prévisionnel" value={fmt(stats.previsionnel)} hint="Toutes années" />
        <Card label={`Prévu ${currentYear}`} value={fmt(stats.previsionnelYear)} />
      </div>
      <div className="crm-card p-5">
        <h3 className="font-serif text-lg font-medium">Poste « Commissions de courtage »</h3>
        <p className="mt-1 text-xs text-ink-muted">
          Commissions calculées selon le barème cabinet (branche / compagnie) — poste de produit d'exploitation.
        </p>
        <CommissionMoisCard />
      </div>
      <div className="crm-card p-5">
        <h3 className="font-serif text-lg font-medium">Commissions cabinet par année</h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Année</TableHead>
              <TableHead className="text-right">Commission cabinet</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {nextYears.map((y) => (
              <TableRow key={y}>
                <TableCell>{y}</TableCell>
                <TableCell className="text-right">{fmt(stats.yearly[y] ?? 0)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function Previsionnel() {
  const [ech, setEch] = useState<(Echeance & { contrats: { numeric?: string; assureur: string; client_id: string } | null })[]>([]);
  const [year, setYear] = useState<string>(String(new Date().getFullYear()));
  const [statut, setStatut] = useState<string>("all");

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("contrat_echeances")
        .select("*, contrats(numero,assureur,client_id)")
        .order("date_debut_periode");
      setEch((data as any) ?? []);
    })();
  }, []);

  const rows = useMemo(
    () =>
      ech.filter((e) => {
        if (year !== "all" && String(yearOf(e.date_debut_periode)) !== year) return false;
        if (statut !== "all" && e.statut !== statut) return false;
        return true;
      }),
    [ech, year, statut],
  );

  const total = rows.reduce((s, r) => s + Number(r.commission_cabinet_periode), 0);
  const years = Array.from(new Set(ech.map((e) => yearOf(e.date_debut_periode)))).sort();

  const exportCsv = () => {
    const header = "Année;Contrat;Assureur;Début;Fin;Prime;Commission cabinet;Statut\n";
    const body = rows
      .map((r) =>
        [
          r.annee,
          (r as any).contrats?.numero ?? r.contrat_id.slice(0, 8),
          (r as any).contrats?.assureur ?? "",
          r.date_debut_periode,
          r.date_fin_periode,
          r.prime_periode,
          r.commission_cabinet_periode,
          r.statut,
        ].join(";"),
      )
      .join("\n");
    const blob = new Blob([header + body], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `previsionnel-${year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const markStatut = async (id: string, newStatut: Echeance["statut"]) => {
    await supabase.from("contrat_echeances").update({ statut: newStatut }).eq("id", id);
    setEch((prev) => prev.map((e) => (e.id === id ? { ...e, statut: newStatut } : e)));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs uppercase tracking-wide text-ink-muted">Année</label>
          <Select value={year} onValueChange={setYear}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes</SelectItem>
              {years.map((y) => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-xs uppercase tracking-wide text-ink-muted">Statut</label>
          <Select value={statut} onValueChange={setStatut}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous</SelectItem>
              <SelectItem value="previsionnel">Prévisionnel</SelectItem>
              <SelectItem value="emise">Émise</SelectItem>
              <SelectItem value="payee">Payée</SelectItem>
              <SelectItem value="annulee">Annulée</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="ml-auto text-right">
          <p className="text-xs uppercase tracking-wide text-ink-muted">Total filtré</p>
          <p className="font-serif text-xl">{fmt(total)}</p>
        </div>
        <Button variant="outline" onClick={exportCsv}>Export CSV</Button>
      </div>

      <div className="overflow-x-auto crm-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Année</TableHead>
              <TableHead>Contrat</TableHead>
              <TableHead>Période</TableHead>
              <TableHead className="text-right">Prime</TableHead>
              <TableHead className="text-right">Comm. cabinet</TableHead>
              <TableHead>Statut</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{r.annee}</TableCell>
                <TableCell className="max-w-[180px] truncate">
                  {(r as any).contrats?.numero ?? r.contrat_id.slice(0, 8)}
                  <span className="ml-1 text-ink-muted">· {(r as any).contrats?.assureur ?? ""}</span>
                </TableCell>
                <TableCell className="text-xs text-ink-soft">
                  {new Date(r.date_debut_periode).toLocaleDateString("fr-FR")} →{" "}
                  {new Date(r.date_fin_periode).toLocaleDateString("fr-FR")}
                </TableCell>
                <TableCell className="text-right">{fmt(Number(r.prime_periode))}</TableCell>
                <TableCell className="text-right">{fmt(Number(r.commission_cabinet_periode))}</TableCell>
                <TableCell>
                  <Select value={r.statut} onValueChange={(v) => markStatut(r.id, v as Echeance["statut"])}>
                    <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="previsionnel">Prévisionnel</SelectItem>
                      <SelectItem value="emise">Émise</SelectItem>
                      <SelectItem value="payee">Payée</SelectItem>
                      <SelectItem value="annulee">Annulée</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-ink-muted">Aucune échéance.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function Encaissements() {
  const [rows, setRows] = useState<Bordereau[]>([]);
  const [form, setForm] = useState({ periode: "", assureur: "", montant_total: "", nb_lignes: "", notes: "" });

  const load = async () => {
    const { data } = await supabase.from("bordereaux_commissions").select("*").order("created_at", { ascending: false });
    setRows((data as Bordereau[]) ?? []);
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!form.periode || !form.assureur) return;
    await supabase.from("bordereaux_commissions").insert({
      periode: form.periode,
      assureur: form.assureur,
      montant_total: Number(form.montant_total || 0),
      nb_lignes: Number(form.nb_lignes || 0),
      notes: form.notes || null,
    });
    setForm({ periode: "", assureur: "", montant_total: "", nb_lignes: "", notes: "" });
    load();
  };

  const setStatut = async (id: string, statut: string) => {
    await supabase.from("bordereaux_commissions").update({ statut }).eq("id", id);
    load();
  };

  return (
    <div className="space-y-6">
      <div className="crm-card p-5">
        <h3 className="font-serif text-lg font-medium">Saisir un bordereau compagnie</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-5">
          <Input placeholder="Période (2026-01)" value={form.periode} onChange={(e) => setForm({ ...form, periode: e.target.value })} />
          <Input placeholder="Assureur" value={form.assureur} onChange={(e) => setForm({ ...form, assureur: e.target.value })} />
          <Input placeholder="Montant total" type="number" value={form.montant_total} onChange={(e) => setForm({ ...form, montant_total: e.target.value })} />
          <Input placeholder="Nb lignes" type="number" value={form.nb_lignes} onChange={(e) => setForm({ ...form, nb_lignes: e.target.value })} />
          <Button onClick={create}>Ajouter</Button>
        </div>
        <Input className="mt-3" placeholder="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </div>

      <div className="overflow-x-auto crm-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Période</TableHead>
              <TableHead>Assureur</TableHead>
              <TableHead className="text-right">Montant</TableHead>
              <TableHead>Lignes</TableHead>
              <TableHead>Statut</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((b) => (
              <TableRow key={b.id}>
                <TableCell>{b.periode}</TableCell>
                <TableCell>{b.assureur}</TableCell>
                <TableCell className="text-right">{fmt(Number(b.montant_total))}</TableCell>
                <TableCell>{b.nb_lignes}</TableCell>
                <TableCell>
                  <Select value={b.statut} onValueChange={(v) => setStatut(b.id, v)}>
                    <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="importe">Importé</SelectItem>
                      <SelectItem value="rapproche">Rapproché</SelectItem>
                      <SelectItem value="clos">Clos</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow><TableCell colSpan={5} className="text-center text-ink-muted">Aucun bordereau.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function Retrocessions({ portee }: { portee: "mandataire" | "prescripteur" }) {
  const [ech, setEch] = useState<Echeance[]>([]);
  const [paiements, setPaiements] = useState<Paiement[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [form, setForm] = useState({ beneficiaire_id: "", periode: "", montant: "", moyen_paiement: "virement", reference: "", date_paiement: "", notes: "" });

  const idField = portee === "mandataire" ? "mandataire_id" : "prescripteur_id";
  const commField = portee === "mandataire" ? "commission_mandataire_periode" : "commission_prescripteur_periode";

  const load = async () => {
    const [{ data: e }, { data: p }, { data: pr }] = await Promise.all([
      supabase.from("contrat_echeances").select("*").not(idField, "is", null),
      supabase.from("paiements_partenaires").select("*").eq("portee", portee).order("created_at", { ascending: false }),
      supabase.from("profiles").select("id,email,full_name"),
    ]);
    setEch((e as Echeance[]) ?? []);
    setPaiements((p as Paiement[]) ?? []);
    setProfiles((pr as Profile[]) ?? []);
  };
  useEffect(() => { load(); }, [portee]);

  const nameOf = (id: string) => {
    const p = profiles.find((x) => x.id === id);
    return p?.full_name || p?.email || id.slice(0, 8);
  };

  const soldeParBenef = useMemo(() => {
    const map: Record<string, { du: number; verse: number }> = {};
    for (const e of ech) {
      const bid = (e as any)[idField] as string | null;
      if (!bid) continue;
      map[bid] = map[bid] ?? { du: 0, verse: 0 };
      map[bid].du += Number((e as any)[commField]);
    }
    for (const p of paiements) {
      map[p.beneficiaire_id] = map[p.beneficiaire_id] ?? { du: 0, verse: 0 };
      map[p.beneficiaire_id].verse += Number(p.montant);
    }
    return map;
  }, [ech, paiements, idField, commField]);

  const createPaiement = async () => {
    if (!form.beneficiaire_id || !form.periode) return;
    await supabase.from("paiements_partenaires").insert({
      beneficiaire_id: form.beneficiaire_id,
      portee,
      periode: form.periode,
      montant: Number(form.montant || 0),
      moyen_paiement: form.moyen_paiement || null,
      reference: form.reference || null,
      date_paiement: form.date_paiement || null,
      notes: form.notes || null,
    });
    setForm({ beneficiaire_id: "", periode: "", montant: "", moyen_paiement: "virement", reference: "", date_paiement: "", notes: "" });
    load();
  };

  return (
    <div className="space-y-6">
      <div className="overflow-x-auto crm-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{portee === "mandataire" ? "Mandataire" : "Prescripteur"}</TableHead>
              <TableHead className="text-right">Commissions dues</TableHead>
              <TableHead className="text-right">Versé</TableHead>
              <TableHead className="text-right">Solde</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Object.entries(soldeParBenef).map(([bid, s]) => (
              <TableRow key={bid}>
                <TableCell>{nameOf(bid)}</TableCell>
                <TableCell className="text-right">{fmt(s.du)}</TableCell>
                <TableCell className="text-right">{fmt(s.verse)}</TableCell>
                <TableCell className="text-right font-medium">{fmt(s.du - s.verse)}</TableCell>
              </TableRow>
            ))}
            {Object.keys(soldeParBenef).length === 0 && (
              <TableRow><TableCell colSpan={4} className="text-center text-ink-muted">Aucun partenaire.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="crm-card p-5">
        <h3 className="font-serif text-lg font-medium">Enregistrer un versement</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Select value={form.beneficiaire_id} onValueChange={(v) => setForm({ ...form, beneficiaire_id: v })}>
            <SelectTrigger><SelectValue placeholder="Bénéficiaire" /></SelectTrigger>
            <SelectContent>
              {profiles.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.full_name || p.email || p.id.slice(0, 8)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input placeholder="Période (2026-Q1)" value={form.periode} onChange={(e) => setForm({ ...form, periode: e.target.value })} />
          <Input placeholder="Montant" type="number" value={form.montant} onChange={(e) => setForm({ ...form, montant: e.target.value })} />
          <Input placeholder="Moyen (virement…)" value={form.moyen_paiement} onChange={(e) => setForm({ ...form, moyen_paiement: e.target.value })} />
          <Input placeholder="Référence" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
          <Input type="date" value={form.date_paiement} onChange={(e) => setForm({ ...form, date_paiement: e.target.value })} />
          <Input className="sm:col-span-2" placeholder="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          <Button onClick={createPaiement}>Enregistrer</Button>
        </div>
      </div>

      <div className="overflow-x-auto crm-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Bénéficiaire</TableHead>
              <TableHead>Période</TableHead>
              <TableHead className="text-right">Montant</TableHead>
              <TableHead>Moyen</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Référence</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paiements.map((p) => (
              <TableRow key={p.id}>
                <TableCell>{nameOf(p.beneficiaire_id)}</TableCell>
                <TableCell>{p.periode}</TableCell>
                <TableCell className="text-right">{fmt(Number(p.montant))}</TableCell>
                <TableCell>{p.moyen_paiement ?? "—"}</TableCell>
                <TableCell>{p.date_paiement ? new Date(p.date_paiement).toLocaleDateString("fr-FR") : "—"}</TableCell>
                <TableCell className="text-xs text-ink-muted">{p.reference ?? "—"}</TableCell>
              </TableRow>
            ))}
            {paiements.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center text-ink-muted">Aucun versement.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function ReglesCommission() {
  const [rows, setRows] = useState<Regle[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [form, setForm] = useState({
    portee: "mandataire" as "mandataire" | "prescripteur",
    beneficiaire_id: "",
    taux: "",
    assiette: "commission_cabinet" as "commission_cabinet" | "prime_ht",
    date_effet: new Date().toISOString().slice(0, 10),
  });

  const load = async () => {
    const [{ data: r }, { data: p }] = await Promise.all([
      supabase.from("commission_regles").select("*").order("date_effet", { ascending: false }),
      supabase.from("profiles").select("id,email,full_name"),
    ]);
    setRows((r as Regle[]) ?? []);
    setProfiles((p as Profile[]) ?? []);
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!form.beneficiaire_id || !form.taux) return;
    await supabase.from("commission_regles").insert({
      portee: form.portee,
      beneficiaire_id: form.beneficiaire_id,
      taux: Number(form.taux) / 100,
      assiette: form.assiette,
      date_effet: form.date_effet,
    });
    setForm({ ...form, beneficiaire_id: "", taux: "" });
    load();
  };

  const remove = async (id: string) => {
    await supabase.from("commission_regles").delete().eq("id", id);
    load();
  };

  const nameOf = (id: string | null) => {
    if (!id) return "—";
    const p = profiles.find((x) => x.id === id);
    return p?.full_name || p?.email || id.slice(0, 8);
  };

  return (
    <div className="space-y-6">
      <div className="crm-card p-5">
        <h3 className="font-serif text-lg font-medium">Nouvelle règle</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Select value={form.portee} onValueChange={(v) => setForm({ ...form, portee: v as any })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="mandataire">Mandataire</SelectItem>
              <SelectItem value="prescripteur">Prescripteur</SelectItem>
            </SelectContent>
          </Select>
          <Select value={form.beneficiaire_id} onValueChange={(v) => setForm({ ...form, beneficiaire_id: v })}>
            <SelectTrigger><SelectValue placeholder="Bénéficiaire" /></SelectTrigger>
            <SelectContent>
              {profiles.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.full_name || p.email || p.id.slice(0, 8)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input placeholder="Taux (%)" type="number" value={form.taux} onChange={(e) => setForm({ ...form, taux: e.target.value })} />
          <Select value={form.assiette} onValueChange={(v) => setForm({ ...form, assiette: v as any })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="commission_cabinet">% commission cabinet</SelectItem>
              <SelectItem value="prime_ht">% prime HT</SelectItem>
            </SelectContent>
          </Select>
          <Input type="date" value={form.date_effet} onChange={(e) => setForm({ ...form, date_effet: e.target.value })} />
          <Button onClick={create}>Ajouter la règle</Button>
        </div>
      </div>

      <div className="overflow-x-auto crm-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Portée</TableHead>
              <TableHead>Bénéficiaire</TableHead>
              <TableHead className="text-right">Taux</TableHead>
              <TableHead>Assiette</TableHead>
              <TableHead>Effet</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="capitalize">{r.portee}</TableCell>
                <TableCell>{nameOf(r.beneficiaire_id)}</TableCell>
                <TableCell className="text-right">{(Number(r.taux) * 100).toFixed(2)} %</TableCell>
                <TableCell>{r.assiette === "commission_cabinet" ? "Comm. cabinet" : "Prime HT"}</TableCell>
                <TableCell>{new Date(r.date_effet).toLocaleDateString("fr-FR")}</TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm" onClick={() => remove(r.id)}>Supprimer</Button>
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center text-ink-muted">Aucune règle configurée.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/* ---------- MANDATAIRE / PRESCRIPTEUR ---------- */

function PartnerView({ role }: { role: "mandataire" | "prescripteur" }) {
  const [ech, setEch] = useState<(Echeance & { contrats: { numero: string | null; assureur: string; client_id: string } | null })[]>([]);
  const [paiements, setPaiements] = useState<Paiement[]>([]);
  const [regles, setRegles] = useState<Regle[]>([]);
  const [loading, setLoading] = useState(true);

  const commField = role === "mandataire" ? "commission_mandataire_periode" : "commission_prescripteur_periode";
  const idField = role === "mandataire" ? "mandataire_id" : "prescripteur_id";

  useEffect(() => {
    (async () => {
      const [{ data: e }, { data: p }, { data: r }] = await Promise.all([
        supabase.from("contrat_echeances").select("*, contrats(numero,assureur,client_id)").order("date_debut_periode"),
        supabase.from("paiements_partenaires").select("*").order("date_paiement", { ascending: false }),
        supabase.from("commission_regles").select("*").order("date_effet", { ascending: false }),
      ]);
      setEch((e as any) ?? []);
      setPaiements((p as Paiement[]) ?? []);
      setRegles((r as Regle[]) ?? []);
      setLoading(false);
    })();
  }, []);

  const stats = useMemo(() => {
    let previsionnel = 0, emis = 0, encaisse = 0;
    for (const e of ech) {
      const v = Number((e as any)[commField]);
      if (e.statut === "previsionnel") previsionnel += v;
      else if (e.statut === "emise") emis += v;
      else if (e.statut === "payee") encaisse += v;
    }
    const verse = paiements.reduce((s, p) => s + Number(p.montant), 0);
    return { previsionnel, emis, encaisse, verse, solde: encaisse - verse };
  }, [ech, paiements, commField]);

  if (loading) return <p className="mt-6 text-sm text-ink-muted">Chargement…</p>;

  const kpis = (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card label="Prévisionnel" value={fmt(stats.previsionnel)} />
      <Card label="Émis" value={fmt(stats.emis)} />
      <Card label="Encaissé cabinet" value={fmt(stats.encaisse)} />
      <Card label="Reçu" value={fmt(stats.verse)} hint={`Solde à recevoir : ${fmt(stats.solde)}`} />
    </div>
  );

  if (role === "mandataire") {
    return <MandataireView kpis={kpis} ech={ech} paiements={paiements} regles={regles} commField={commField} />;
  }

  return (
    <div className="mt-6 space-y-6">
      {kpis}
      <PartnerCommissionsTables ech={ech} paiements={paiements} regles={regles} commField={commField} />
    </div>
  );
}

type MandataireSection = "commissions" | "ndf" | "resultat" | "grand-livre" | "pcg";
const MANDATAIRE_SECTIONS: { key: MandataireSection; label: string }[] = [
  { key: "commissions", label: "Mes commissions" },
  { key: "ndf", label: "Notes de frais" },
  { key: "resultat", label: "Mon résultat" },
  { key: "grand-livre", label: "Grand livre" },
  { key: "pcg", label: "Plan comptable" },
];

function MandataireView({
  kpis,
  ech,
  paiements,
  regles,
  commField,
}: {
  kpis: React.ReactNode;
  ech: any[];
  paiements: Paiement[];
  regles: Regle[];
  commField: string;
}) {
  const [section, setSection] = useState<MandataireSection>("commissions");

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_18rem]">
      <div className="min-w-0">
        {section === "commissions" && (
          <div className="space-y-6">
            {kpis}
            <PartnerCommissionsTables ech={ech} paiements={paiements} regles={regles} commField={commField} />
          </div>
        )}
        {section === "ndf" && <NotesDeFraisTab />}
        {section === "resultat" && <ResultatTab mandataireOnly />}
        {section === "grand-livre" && <GrandLivreTab mandataireOnly />}
        {section === "pcg" && <PlanComptableTab />}
      </div>
      <div className="order-first lg:order-last">
        <SectionNav title="Mon espace" items={MANDATAIRE_SECTIONS} active={section} onSelect={setSection} />
      </div>
    </div>
  );
}

function PartnerCommissionsTables({
  ech,
  paiements,
  regles,
  commField,
}: {
  ech: any[];
  paiements: Paiement[];
  regles: Regle[];
  commField: string;
}) {
  return (
    <>


      <div>
        <h3 className="mb-2 font-serif text-lg font-medium">Mes commissions par contrat</h3>
        <div className="overflow-x-auto crm-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Année</TableHead>
                <TableHead>Contrat</TableHead>
                <TableHead>Période</TableHead>
                <TableHead className="text-right">Ma commission</TableHead>
                <TableHead>Statut</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ech.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.annee}</TableCell>
                  <TableCell className="text-xs">
                    {(r as any).contrats?.numero ?? r.contrat_id.slice(0, 8)}
                    <span className="ml-1 text-ink-muted">· {(r as any).contrats?.assureur ?? ""}</span>
                  </TableCell>
                  <TableCell className="text-xs text-ink-soft">
                    {new Date(r.date_debut_periode).toLocaleDateString("fr-FR")} → {new Date(r.date_fin_periode).toLocaleDateString("fr-FR")}
                  </TableCell>
                  <TableCell className="text-right">{fmt(Number((r as any)[commField]))}</TableCell>
                  <TableCell><span className="text-xs capitalize text-ink-muted">{r.statut}</span></TableCell>
                </TableRow>
              ))}
              {ech.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-ink-muted">Aucune commission attribuée.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <div>
        <h3 className="mb-2 font-serif text-lg font-medium">Versements reçus</h3>
        <div className="overflow-x-auto crm-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Période</TableHead>
                <TableHead className="text-right">Montant</TableHead>
                <TableHead>Moyen</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Référence</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paiements.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{p.periode}</TableCell>
                  <TableCell className="text-right">{fmt(Number(p.montant))}</TableCell>
                  <TableCell>{p.moyen_paiement ?? "—"}</TableCell>
                  <TableCell>{p.date_paiement ? new Date(p.date_paiement).toLocaleDateString("fr-FR") : "—"}</TableCell>
                  <TableCell className="text-xs text-ink-muted">{p.reference ?? "—"}</TableCell>
                </TableRow>
              ))}
              {paiements.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-ink-muted">Aucun versement enregistré.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {regles.length > 0 && (
        <div>
          <h3 className="mb-2 font-serif text-lg font-medium">Mes règles de rétrocession</h3>
          <div className="overflow-x-auto crm-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Taux</TableHead>
                  <TableHead>Assiette</TableHead>
                  <TableHead>Effet</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {regles.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{(Number(r.taux) * 100).toFixed(2)} %</TableCell>
                    <TableCell>{r.assiette === "commission_cabinet" ? "Comm. cabinet" : "Prime HT"}</TableCell>
                    <TableCell>{new Date(r.date_effet).toLocaleDateString("fr-FR")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </>
  );
}

