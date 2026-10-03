import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { CommissionBaremeConfig } from "@/components/commission-bareme-config";
import { BulletinCommissionsPanel } from "@/components/bulletin-commissions-panel";
import { BordereauxPanel } from "@/components/bordereaux-panel";
import { CommissionRapprochementPanel } from "@/components/commission-rapprochement-panel";
import { getSyntheseAnneeCommissions } from "@/lib/dashboard.functions";
import type { SyntheseAnnee } from "@/lib/commission-previsions";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { IconCoins } from "@tabler/icons-react";
import { ExportFecCard } from "@/components/export-fec-card";
import { PrecompteLancerCard } from "@/components/precompte-lancer-card";

export const Route = createFileRoute("/_authenticated/espace/commissions")({
  component: CommissionsPage,
});

type EtatEncaissement = "en_attente_bordereau" | "valide_bordereau" | "encaisse_banque";

type Row = {
  id: string;
  montant: number;
  statut: "prevue" | "versee" | "annulee";
  date_versement: string | null;
  notes: string | null;
  dossier_id: string | null;
  contrat_id: string | null;
  beneficiaire_id: string;
  ecriture_id: string | null;
  compte_produit: string | null;
  precomptee: boolean;
  provision_reprise: number;
  etat_encaissement: EtatEncaissement;
  dossiers: { reference: string; client_nom: string } | null;
};

type Compte = { numero: string; libelle: string };
type Exercice = { id: string; date_debut: string; date_fin: string };

const COMPTE_BANQUE = "512000";

const ETATS: { value: EtatEncaissement; label: string }[] = [
  { value: "en_attente_bordereau", label: "En attente bordereau" },
  { value: "valide_bordereau", label: "Validé bordereau" },
  { value: "encaisse_banque", label: "Encaissé banque" },
];

const ETAT_STYLE: Record<EtatEncaissement, string> = {
  en_attente_bordereau: "bg-amber-100 text-amber-900",
  valide_bordereau: "bg-sky-100 text-sky-900",
  encaisse_banque: "bg-emerald-100 text-emerald-900",
};

function CommissionsPage() {
  const { role } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [comptes, setComptes] = useState<Compte[]>([]);
  const [exercices, setExercices] = useState<Exercice[]>([]);
  const [loading, setLoading] = useState(true);
  const [synthese, setSynthese] = useState<SyntheseAnnee | null>(null);
  const fetchSynthese = useServerFn(getSyntheseAnneeCommissions);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("commissions")
      .select(
        "id,montant,statut,date_versement,notes,dossier_id,contrat_id,beneficiaire_id,ecriture_id,compte_produit,precomptee,provision_reprise,etat_encaissement,dossiers(reference,client_nom)",
      )
      .order("created_at", { ascending: false });
    setRows((data as unknown as Row[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    (async () => {
      const [c, e] = await Promise.all([
        supabase.from("plan_comptable").select("numero,libelle").like("numero", "7%").order("numero"),
        supabase.from("exercices").select("id,date_debut,date_fin").order("date_debut", { ascending: false }),
      ]);
      setComptes((c.data as Compte[]) ?? []);
      setExercices((e.data as Exercice[]) ?? []);
    })();
    fetchSynthese().then(setSynthese).catch(() => setSynthese(null));
  }, [fetchSynthese]);

  const total = rows.reduce((s, r) => s + Number(r.montant), 0);
  const verse = rows.filter((r) => r.statut === "versee").reduce((s, r) => s + Number(r.montant), 0);
  const attente = rows.filter((r) => r.statut === "prevue").reduce((s, r) => s + Number(r.montant), 0);
  const aComptabiliser = rows.filter((r) => r.statut === "versee" && !r.ecriture_id).length;
  const provisions = rows
    .filter((r) => r.statut !== "annulee")
    .reduce((s, r) => s + Number(r.provision_reprise ?? 0), 0);
  const caNet = verse - provisions;

  const majCompte = async (r: Row, compte: string) => {
    await supabase.from("commissions").update({ compte_produit: compte }).eq("id", r.id);
    setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, compte_produit: compte } : x)));
  };

  const majLigne = async (r: Row, champs: Partial<Row>) => {
    setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, ...champs } : x)));
    const { error } = await supabase.from("commissions").update(champs as never).eq("id", r.id);
    if (error) {
      toast.error(error.message);
      load();
    }
  };

  /*
   * Règle Lot 5 : « encaissé » = virement bancaire confirmé. L'état
   * d'encaissement pilote donc le statut : seul « encaissé banque » rend la
   * commission « versée » (avec sa date de versement) ; revenir en amont la
   * repasse « prévue » et efface la date. Une commission annulée n'est pas
   * réactivée par ce contrôle.
   */
  const majEtatEncaissement = (r: Row, etat: EtatEncaissement) => {
    if (r.statut === "annulee") {
      majLigne(r, { etat_encaissement: etat });
      return;
    }
    if (etat === "encaisse_banque") {
      majLigne(r, {
        etat_encaissement: etat,
        statut: "versee",
        date_versement: r.date_versement ?? new Date().toISOString().slice(0, 10),
      });
    } else {
      majLigne(r, { etat_encaissement: etat, statut: "prevue", date_versement: null });
    }
  };

  /* Comptabilisation d'une commission encaissée : journal Ventes, banque au débit. */
  const comptabiliser = async (r: Row) => {
    if (r.ecriture_id) return;
    const date = r.date_versement ?? new Date().toISOString().slice(0, 10);
    const exercice = exercices.find((e) => date >= e.date_debut && date <= e.date_fin) ?? exercices[0];
    if (!exercice) return toast.error("Aucun exercice comptable disponible pour cette date.");
    const libelle = `Commission ${r.dossiers ? `${r.dossiers.reference} — ${r.dossiers.client_nom}` : (r.notes ?? "").slice(0, 80) || "encaissée"}`;
    const { data: ec, error: eErr } = await supabase
      .from("ecritures")
      .insert({
        exercice_id: exercice.id,
        journal_code: "VE",
        date_ecriture: date,
        libelle: libelle.slice(0, 200),
        statut: "brouillon",
        source: "commission",
      })
      .select("id")
      .single();
    if (eErr || !ec) return toast.error(eErr?.message ?? "Création de l'écriture impossible.");

    const montant = Number(r.montant);
    const { error: lErr } = await supabase.from("ecritures_lignes").insert([
      { ecriture_id: ec.id, numero_ligne: 1, compte_numero: COMPTE_BANQUE, libelle: "Encaissement commission", debit: montant, credit: 0 },
      {
        ecriture_id: ec.id,
        numero_ligne: 2,
        compte_numero: r.compte_produit ?? "706100",
        libelle: libelle.slice(0, 200),
        debit: 0,
        credit: montant,
      },
    ]);
    if (lErr) return toast.error(lErr.message);
    const { error: vErr } = await supabase.from("ecritures").update({ statut: "valide" }).eq("id", ec.id);
    if (vErr) return toast.error(vErr.message);
    await supabase.from("commissions").update({ ecriture_id: ec.id }).eq("id", r.id);
    toast.success("Commission comptabilisée (journal Ventes).");
    load();
  };

  const comptabiliserTout = async () => {
    const cibles = rows.filter((r) => r.statut === "versee" && !r.ecriture_id);
    for (const r of cibles) await comptabiliser(r);
  };

  return (
    <div>
      <PageHeader
        eyebrow="Rémunération"
        title="Commissions"
        description="Suivi des commissions du cabinet, encaissements et comptabilisation."
        icon={IconCoins}
      />

      {synthese && (
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <StatCard label={`Encaissé ${synthese.annee}`} value={`${synthese.encaisse.toLocaleString("fr-FR")} €`} accent />
          <StatCard label={`Reste à encaisser ${synthese.annee}`} value={`${synthese.previsionnelRestant.toLocaleString("fr-FR")} €`} />
          <StatCard label={`Total attendu ${synthese.annee}`} value={`${synthese.totalAttendu.toLocaleString("fr-FR")} €`} />
        </div>
      )}

      <p className="mt-6 crm-eyebrow">Toutes périodes confondues</p>
      <div className="mt-2 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Total enregistré" value={`${total.toLocaleString("fr-FR")} €`} />
        <StatCard label="Versées" value={`${verse.toLocaleString("fr-FR")} €`} accent />
        <StatCard label="À venir (bordereaux)" value={`${attente.toLocaleString("fr-FR")} €`} />
        <StatCard label="Provisions pour reprise" value={`${provisions.toLocaleString("fr-FR")} €`} />
        <StatCard label="CA réel net de reprises" value={`${caNet.toLocaleString("fr-FR")} €`} accent />
      </div>

      {role === "admin" && <ExportFecCard exercices={exercices} />}
      {role === "admin" && <PrecompteLancerCard />}

      {role === "admin" && aComptabiliser > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 crm-card p-4">
          <p className="text-sm text-ink-muted">
            {aComptabiliser} commission(s) versée(s) ne sont pas encore passées en comptabilité.
          </p>
          <button
            type="button"
            onClick={comptabiliserTout}
            className="rounded-full bg-[#0A192F] px-4 py-2 text-sm font-medium text-white"
          >
            Tout comptabiliser
          </button>
        </div>
      )}

      <div className="mt-8 overflow-hidden crm-card">
        {loading ? (
          <p className="p-6 text-sm text-ink-muted">Chargement…</p>
        ) : rows.length === 0 ? (
          <p className="p-6 text-sm text-ink-muted">
            {role === "admin"
              ? "Aucune commission enregistrée. Créez-en depuis un dossier."
              : "Aucune commission attribuée pour l'instant."}
          </p>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full min-w-[1120px] text-sm">
            <thead className="border-b border-line bg-background/50 text-left text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-4 py-3">Origine</th>
                <th className="px-4 py-3">Montant</th>
                <th className="px-4 py-3">Statut</th>
                <th className="px-4 py-3">État d'encaissement</th>
                <th className="px-4 py-3">Précomptée</th>
                <th className="px-4 py-3">Provision reprise</th>
                <th className="px-4 py-3">Versement</th>
                {role === "admin" && <th className="px-4 py-3">Comptabilité</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3">
                    {r.dossiers
                      ? `${r.dossiers.reference} — ${r.dossiers.client_nom}`
                      : (r.notes ?? "").trim() || (r.contrat_id ? `Contrat ${r.contrat_id.slice(0, 8)}` : "Bulletin de commissions")}
                  </td>
                  <td className="px-4 py-3">{Number(r.montant).toLocaleString("fr-FR")} €</td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        "inline-flex rounded-full px-2 py-0.5 text-xs font-medium " +
                        (r.statut === "versee"
                          ? "bg-emerald-100 text-emerald-900"
                          : r.statut === "annulee"
                            ? "bg-red-100 text-red-900"
                            : "bg-amber-100 text-amber-900")
                      }
                    >
                      {r.statut}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {role === "admin" ? (
                      <select
                        value={r.etat_encaissement ?? "en_attente_bordereau"}
                        onChange={(e) => majEtatEncaissement(r, e.target.value as EtatEncaissement)}
                        className="rounded-md border border-line bg-background px-2 py-1 text-xs"
                      >
                        {ETATS.map((e) => (
                          <option key={e.value} value={e.value}>
                            {e.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span
                        className={
                          "inline-flex rounded-full px-2 py-0.5 text-xs font-medium " +
                          ETAT_STYLE[r.etat_encaissement ?? "en_attente_bordereau"]
                        }
                      >
                        {ETATS.find((e) => e.value === r.etat_encaissement)?.label ?? "En attente bordereau"}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {role === "admin" ? (
                      <input
                        type="checkbox"
                        checked={Boolean(r.precomptee)}
                        onChange={(e) => majLigne(r, { precomptee: e.target.checked })}
                        className="h-4 w-4 accent-[#D4AF37]"
                        aria-label="Commission précomptée"
                      />
                    ) : (
                      <span className="text-xs text-ink-muted">{r.precomptee ? "Oui" : "Non"}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {role === "admin" && r.precomptee ? (
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={Number(r.provision_reprise ?? 0)}
                        onChange={(e) => majLigne(r, { provision_reprise: Number(e.target.value) })}
                        className="w-24 rounded-md border border-line bg-background px-2 py-1 text-xs"
                        aria-label="Provision pour reprise"
                      />
                    ) : (
                      <span className="text-xs text-ink-muted">
                        {Number(r.provision_reprise ?? 0) > 0
                          ? `${Number(r.provision_reprise).toLocaleString("fr-FR")} €`
                          : "—"}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {r.date_versement ? new Date(r.date_versement).toLocaleDateString("fr-FR") : "—"}
                  </td>
                  {role === "admin" && (
                    <td className="px-4 py-3">
                      {r.ecriture_id ? (
                        <span className="text-xs text-emerald-700">Comptabilisée</span>
                      ) : r.statut !== "versee" ? (
                        <span className="text-xs text-ink-muted">À encaisser</span>
                      ) : (
                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            value={r.compte_produit ?? "706100"}
                            onChange={(e) => majCompte(r, e.target.value)}
                            className="rounded-md border border-line bg-background px-2 py-1 text-xs"
                          >
                            {comptes.map((c) => (
                              <option key={c.numero} value={c.numero}>
                                {c.numero} — {c.libelle}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => comptabiliser(r)}
                            className="rounded-md border border-line px-3 py-1 text-xs"
                          >
                            Comptabiliser
                          </button>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {role !== "client" && <CommissionRapprochementPanel />}

      {role !== "client" && <BordereauxPanel />}

      {role === "admin" && <BulletinCommissionsPanel onCommissionsCreees={load} />}
      {role === "admin" && <AddCommissionForm onCreated={load} />}
      {role === "admin" && <CommissionBaremeConfig />}
    </div>
  );
}



function AddCommissionForm({ onCreated }: { onCreated: () => void }) {
  const [dossiers, setDossiers] = useState<{ id: string; reference: string; client_nom: string }[]>([]);
  const [profiles, setProfiles] = useState<{ id: string; full_name: string | null; email: string | null }[]>([]);
  const [dossier, setDossier] = useState("");
  const [beneficiaire, setBeneficiaire] = useState("");
  const [montant, setMontant] = useState("");
  const [statut, setStatut] = useState<"prevue" | "versee">("prevue");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [d, p] = await Promise.all([
        supabase.from("dossiers").select("id,reference,client_nom"),
        supabase.from("profiles").select("id,full_name,email"),
      ]);
      setDossiers(d.data ?? []);
      setProfiles(p.data ?? []);
    })();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    // Cohérence règle Lot 5 : créer directement « versée » signifie un
    // encaissement bancaire réel (état « encaissé banque » + date du jour).
    const payload: Record<string, unknown> = {
      dossier_id: dossier,
      beneficiaire_id: beneficiaire,
      montant: Number(montant),
      statut,
    };
    if (statut === "versee") {
      payload["etat_encaissement"] = "encaisse_banque";
      payload["date_versement"] = new Date().toISOString().slice(0, 10);
    }
    const { error } = await supabase.from("commissions").insert(payload as never);
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    setMontant("");
    onCreated();
  };

  return (
    <form
      onSubmit={submit}
      className="mt-8 grid gap-3 crm-card p-6 sm:grid-cols-4"
    >
      <select
        required
        value={dossier}
        onChange={(e) => setDossier(e.target.value)}
        className="rounded-md border border-line bg-background px-3 py-2 text-sm"
      >
        <option value="">Dossier…</option>
        {dossiers.map((d) => (
          <option key={d.id} value={d.id}>
            {d.reference} — {d.client_nom}
          </option>
        ))}
      </select>
      <select
        required
        value={beneficiaire}
        onChange={(e) => setBeneficiaire(e.target.value)}
        className="rounded-md border border-line bg-background px-3 py-2 text-sm"
      >
        <option value="">Bénéficiaire…</option>
        {profiles.map((p) => (
          <option key={p.id} value={p.id}>
            {p.full_name ?? p.email ?? p.id.slice(0, 8)}
          </option>
        ))}
      </select>
      <input
        required
        type="number"
        min="0"
        step="0.01"
        placeholder="Montant"
        value={montant}
        onChange={(e) => setMontant(e.target.value)}
        className="rounded-md border border-line bg-background px-3 py-2 text-sm"
      />
      <select
        value={statut}
        onChange={(e) => setStatut(e.target.value as "prevue" | "versee")}
        className="rounded-md border border-line bg-background px-3 py-2 text-sm"
      >
        <option value="prevue">Prévue</option>
        <option value="versee">Versée</option>
      </select>
      <div className="sm:col-span-4">
        <button
          type="submit"
          disabled={saving}
          className="rounded-full bg-[#0A192F] px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? "Ajout…" : "Ajouter la commission"}
        </button>
        {error && <span className="ml-3 text-sm text-destructive">{error}</span>}
      </div>
    </form>
  );
}
