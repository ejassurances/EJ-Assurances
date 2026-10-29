import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

type Echeance = { contrat_id: string; date_debut_periode: string; commission_cabinet_periode: number; statut: string };
type Commission = { contrat_id: string | null; montant: number; statut: string; date_versement: string | null; created_at: string };
type Facture = { montant_ttc: number; statut: string; date_facture: string; date_echeance: string | null; date_paiement: string | null; abonnement_sans_fin?: boolean };
type Charge = { montant: number; statut: string; periode: string | null; date_echeance: string | null; date_paiement: string | null; categorie: string };

type MoisFinance = {
  mois: string;
  commissionsEncaissees: number;
  commissionsPrevues: number;
  charges: number;
  urssaf: number;
  solde: number;
  apport: number;
};

const moisLabel = (key: string) => {
  const [year, month] = key.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
};
const euros = (n: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
const moisCle = (date: string | null | undefined) => date ? date.slice(0, 7) : null;

function genererMois(debut: Date, nombre: number): string[] {
  return Array.from({ length: nombre }, (_, i) => {
    const d = new Date(debut.getFullYear(), debut.getMonth() + i, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
}

/**
 * Pilotage de trésorerie interne. Les chiffres futurs sont des projections
 * construites à partir des échéances et charges saisies dans le CRM, pas une
 * comptabilité certifiée. Le taux URSSAF doit être configuré par le cabinet.
 */
export function PilotageFinancierCabinet() {
  const { user } = useAuth();
  const [echeances, setEcheances] = useState<Echeance[]>([]);
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [factures, setFactures] = useState<Facture[]>([]);
  const [charges, setCharges] = useState<Charge[]>([]);
  const [taux, setTaux] = useState("");
  const [tauxConfigure, setTauxConfigure] = useState(false);
  const [anneeOuverte, setAnneeOuverte] = useState(String(new Date().getFullYear()));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let annule = false;
    (async () => {
      const [e, c, f, ch, p] = await Promise.all([
        supabase.from("contrat_echeances").select("contrat_id,date_debut_periode,commission_cabinet_periode,statut"),
        supabase.from("commissions").select("contrat_id,montant,statut,date_versement,created_at"),
        (supabase as any).from("factures_achat").select("montant_ttc,statut,date_facture,date_echeance,date_paiement,abonnement_sans_fin"),
        supabase.from("finance_charges").select("montant,statut,periode,date_echeance,date_paiement,categorie"),
        (supabase as any).from("finance_parametres").select("valeur").eq("cle", "taux_urssaf").maybeSingle(),
      ]);
      if (annule) return;
      setEcheances((e.data as Echeance[]) ?? []);
      setCommissions((c.data as Commission[]) ?? []);
      setFactures((f.data as Facture[]) ?? []);
      setCharges((ch.data as Charge[]) ?? []);
      if (p.data?.valeur !== null && p.data?.valeur !== undefined) {
        setTaux(String(p.data.valeur));
        setTauxConfigure(true);
      }
      setLoading(false);
    })().catch((error) => {
      if (!annule) {
        toast.error(error instanceof Error ? error.message : "Chargement du pilotage financier impossible.");
        setLoading(false);
      }
    });
    return () => { annule = true; };
  }, []);

  const lignes = useMemo(() => {
    // Historique budgétaire conservé depuis le 1er janvier 2026, puis cinq ans de projection.
    const mois = genererMois(new Date(2026, 0, 1), 72);
    const tauxNumerique = tauxConfigure ? Math.max(0, Math.min(100, Number(taux) || 0)) / 100 : 0;
    const resultats = new Map<string, MoisFinance>();
    for (const key of mois) resultats.set(key, {
      mois: key, commissionsEncaissees: 0, commissionsPrevues: 0, charges: 0, urssaf: 0, solde: 0, apport: 0,
    });

    const encaisseParContratMois = new Set<string>();
    for (const c of commissions) {
      if (c.statut !== "versee") continue;
      const key = moisCle(c.date_versement) ?? moisCle(c.created_at);
      if (!key || !resultats.has(key)) continue;
      resultats.get(key)!.commissionsEncaissees += Number(c.montant) || 0;
      if (c.contrat_id) encaisseParContratMois.add(`${c.contrat_id}:${key}`);
    }

    for (const e of echeances) {
      const key = moisCle(e.date_debut_periode);
      if (!key || !resultats.has(key) || ["annulee", "payee"].includes(e.statut)) continue;
      if (encaisseParContratMois.has(`${e.contrat_id}:${key}`)) continue;
      resultats.get(key)!.commissionsPrevues += Number(e.commission_cabinet_periode) || 0;
    }

    for (const e of echeances) {
      if (e.statut !== "payee") continue;
      const key = moisCle(e.date_debut_periode);
      if (!key || !resultats.has(key) || encaisseParContratMois.has(`${e.contrat_id}:${key}`)) continue;
      resultats.get(key)!.commissionsEncaissees += Number(e.commission_cabinet_periode) || 0;
      encaisseParContratMois.add(`${e.contrat_id}:${key}`);
    }

    for (const f of factures) {
      if (f.statut === "annulee") continue;
      if (f.abonnement_sans_fin) {
        const debut = moisCle(f.date_facture);
        if (!debut) continue;
        for (const [key, row] of resultats) {
          if (key >= debut) row.charges += Number(f.montant_ttc) || 0;
        }
        continue;
      }
      const date = f.statut === "payee" ? f.date_paiement || f.date_facture : f.date_echeance || f.date_facture;
      const key = moisCle(date);
      if (key && resultats.has(key)) resultats.get(key)!.charges += Number(f.montant_ttc) || 0;
    }
    for (const c of charges) {
      if (c.statut === "annulee") continue;
      const date = c.statut === "payee" ? c.date_paiement || c.periode || c.date_echeance : c.date_echeance || c.periode;
      const key = moisCle(date);
      if (key && resultats.has(key)) resultats.get(key)!.charges += Number(c.montant) || 0;
    }

    let cumul = 0;
    return mois.map((key) => {
      const row = resultats.get(key)!;
      const ca = row.commissionsEncaissees + row.commissionsPrevues;
      row.urssaf = ca * tauxNumerique;
      row.solde = ca - row.charges - row.urssaf;
      cumul += row.solde;
      row.apport = Math.max(0, -cumul);
      return row;
    });
  }, [echeances, commissions, factures, charges, taux, tauxConfigure]);

  const annees = useMemo(() => {
    const result: Record<string, MoisFinance[]> = {};
    for (const ligne of lignes) {
      const annee = ligne.mois.slice(0, 4);
      (result[annee] ??= []).push(ligne);
    }
    return result;
  }, [lignes]);

  const anneeCourante = String(new Date().getFullYear());
  const resume = annees[anneeCourante] ?? [];
  const total = (rows: MoisFinance[], champ: keyof MoisFinance) => rows.reduce((sum, row) => sum + Number(row[champ] || 0), 0);

  const enregistrerTaux = async () => {
    const value = Number(taux);
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      toast.error("Saisissez un taux compris entre 0 et 100 %.");
      return;
    }
    setSaving(true);
    const { error } = await (supabase as any).from("finance_parametres").upsert({
      cle: "taux_urssaf", valeur: value, updated_by: user?.id ?? null, updated_at: new Date().toISOString(),
    }, { onConflict: "cle" });
    setSaving(false);
    if (error) return toast.error(`Enregistrement du taux impossible : ${error.message}`);
    setTauxConfigure(true);
    toast.success("Taux URSSAF estimatif enregistré.");
  };

  if (loading) return <section className="crm-card p-5 text-sm text-ink-muted">Chargement du pilotage financier…</section>;

  return (
    <section className="crm-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="font-serif text-xl font-medium text-ink">Rentabilité et trésorerie du cabinet</h3>
          <p className="mt-1 max-w-3xl text-sm text-ink-muted">
            Vue mensuelle depuis le 1er janvier 2026, avec historique prévisionnel, commissions encaissées, factures et charges saisies, estimation URSSAF et besoin de financement. Les projections dépendent des données enregistrées.
          </p>
        </div>
        <div className="min-w-[240px] rounded-lg border border-line p-3">
          <label className="mb-1 block text-xs font-medium text-ink-muted">Taux URSSAF estimatif sur le CA (%)</label>
          <div className="flex gap-2">
            <Input type="number" min="0" max="100" step="0.1" value={taux} onChange={(e) => setTaux(e.target.value)} placeholder="À configurer" />
            <Button onClick={enregistrerTaux} disabled={saving}>{saving ? "..." : "Enregistrer"}</Button>
          </div>
          {!tauxConfigure && <p className="mt-2 text-xs text-amber-800">Taux non configuré : l’URSSAF est affichée à 0 € jusqu’à la saisie du taux applicable à votre situation.</p>}
          {tauxConfigure && <p className="mt-2 text-xs text-ink-muted">Estimation indicative uniquement, à vérifier selon votre régime et votre situation.</p>}
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <div className="rounded-lg border border-line p-3"><p className="text-xs text-ink-muted">CA attendu / encaissé · {anneeCourante}</p><p className="mt-1 text-lg font-semibold">{euros(total(resume, "commissionsEncaissees") + total(resume, "commissionsPrevues"))}</p></div>
        <div className="rounded-lg border border-line p-3"><p className="text-xs text-ink-muted">Charges prévues · {anneeCourante}</p><p className="mt-1 text-lg font-semibold">{euros(total(resume, "charges"))}</p></div>
        <div className="rounded-lg border border-line p-3"><p className="text-xs text-ink-muted">URSSAF estimée · {anneeCourante}</p><p className="mt-1 text-lg font-semibold">{euros(total(resume, "urssaf"))}</p></div>
        <div className="rounded-lg border border-line p-3"><p className="text-xs text-ink-muted">Solde prévisionnel · {anneeCourante}</p><p className="mt-1 text-lg font-semibold">{euros(total(resume, "solde"))}</p></div>
        <div className="rounded-lg border border-line p-3"><p className="text-xs text-ink-muted">Besoin de financement maximal cumulé</p><p className="mt-1 text-lg font-semibold">{euros(Math.max(0, ...lignes.map((l) => l.apport)))}</p></div>
      </div>

      <div className="mt-6 space-y-3">
        {Object.entries(annees).map(([annee, rows]) => (
          <div key={annee} className="rounded-lg border border-line">
            <button type="button" onClick={() => setAnneeOuverte(anneeOuverte === annee ? "" : annee)} className="flex w-full flex-wrap items-center justify-between gap-3 p-4 text-left">
              <span className="font-medium">{annee} <span className="text-xs font-normal text-ink-muted">({rows.length} mois projetés)</span></span>
              <span className="text-sm">CA {euros(total(rows, "commissionsEncaissees") + total(rows, "commissionsPrevues"))} · Charges {euros(total(rows, "charges"))} · Solde {euros(total(rows, "solde"))}</span>
            </button>
            {anneeOuverte === annee && (
              <div className="overflow-x-auto border-t border-line">
                <table className="w-full min-w-[850px] text-sm">
                  <thead className="bg-surface text-left text-xs uppercase tracking-wide text-ink-muted">
                    <tr><th className="px-3 py-2">Mois</th><th className="px-3 py-2 text-right">Encaissé</th><th className="px-3 py-2 text-right">Prévisionnel non encaissé</th><th className="px-3 py-2 text-right">Charges</th><th className="px-3 py-2 text-right">URSSAF estimée</th><th className="px-3 py-2 text-right">Solde</th><th className="px-3 py-2 text-right">Apport cumulé requis</th></tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.mois} className="border-t border-line">
                        <td className="px-3 py-2 capitalize">{moisLabel(r.mois)}</td>
                        <td className="px-3 py-2 text-right">{euros(r.commissionsEncaissees)}</td>
                        <td className="px-3 py-2 text-right">{euros(r.commissionsPrevues)}</td>
                        <td className="px-3 py-2 text-right">{euros(r.charges)}</td>
                        <td className="px-3 py-2 text-right">{euros(r.urssaf)}</td>
                        <td className={`px-3 py-2 text-right font-medium ${r.solde < 0 ? "text-red-700" : "text-ink"}`}>{euros(r.solde)}</td>
                        <td className="px-3 py-2 text-right">{euros(r.apport)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs text-ink-muted">
        Le besoin de financement cumulé est calculé à partir d’un solde supposé nul au 1er janvier 2026. Il ne tient pas compte d’un solde bancaire réel, d’impôts hors URSSAF, de TVA à reverser ni de charges qui ne sont pas encore saisies. Ce tableau est un outil de pilotage interne, pas un bilan comptable ou un calcul fiscal officiel.
      </p>
    </section>
  );
}
