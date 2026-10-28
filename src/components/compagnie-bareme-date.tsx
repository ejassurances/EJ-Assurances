import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { BRANCHES_COMMISSION, brancheContrat } from "@/lib/commissions-bareme";
import { withPendingSchema, type BaremeVersionneRow } from "@/lib/pending-schema-client";
import { calculerRemuneration, enregistrerRemuneration } from "@/lib/remuneration-previsionnelle";

type Form = {
  id?: string;
  branche: string;
  mode: "lineaire" | "precompte";
  taux_annee_1: string;
  taux_renouvellement: string;
  date_effet: string;
  date_fin: string;
  notes: string;
};

const vide = (): Form => ({
  branche: "emprunteur",
  mode: "lineaire",
  taux_annee_1: "",
  taux_renouvellement: "",
  date_effet: "",
  date_fin: "",
  notes: "",
});

const inp = "w-full rounded-md border border-line bg-background px-3 py-2 text-sm";
const labelBranche = (b: string) => BRANCHES_COMMISSION.find((x) => x.value === b)?.label ?? b;

/** Contrôle de saisie (pur) : aucun taux par défaut n'est inventé. */
export function validerBaremeForm(f: Form): string | null {
  if (!f.date_effet) return "Date d'effet obligatoire.";
  if (f.date_fin && f.date_fin < f.date_effet) return "La date de fin précède la date d'effet.";
  const t1 = Number(f.taux_annee_1);
  if (f.taux_annee_1 === "" || !Number.isFinite(t1) || t1 < 0 || t1 > 100)
    return f.mode === "lineaire" ? "Taux annuel obligatoire (0 à 100 %)." : "Taux année 1 obligatoire (0 à 100 %).";
  if (f.mode === "precompte") {
    const tn = Number(f.taux_renouvellement);
    if (f.taux_renouvellement === "" || !Number.isFinite(tn) || tn < 0 || tn > 100)
      return "Taux des années suivantes obligatoire (0 à 100 %).";
  }
  return null;
}

/** Barèmes de commission compagnie datés (linéaire / précompte), depuis la fiche compagnie. */
export function CompagnieBaremeDate({ compagnieId, canEdit }: { compagnieId: string; canEdit: boolean }) {
  const db = withPendingSchema(supabase);
  const [rows, setRows] = useState<BaremeVersionneRow[]>([]);
  const [indispo, setIndispo] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await db
      .from("commission_bareme")
      .select("id,compagnie_id,branche,produit_id,mode,taux_annee_1,taux_renouvellement,date_effet,date_fin,notes")
      .eq("compagnie_id", compagnieId)
      .not("mode", "is", null)
      .order("date_effet", { ascending: false });
    if (error) {
      setIndispo(true);
      return;
    }
    setIndispo(false);
    setRows((data ?? []) as BaremeVersionneRow[]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compagnieId]);

  useEffect(() => {
    load();
  }, [load]);

  const recalculerContrats = async () => {
    const { data: contrats } = await supabase
      .from("contrats")
      .select(
        "id,compagnie_id,produit_id,date_effet,prime_annuelle,duree_mois,is_emprunteur,economie_realisee,economie_cout_groupe,economie_cout_delegue,dossier:dossiers(type_assurance)",
      )
      .eq("compagnie_id", compagnieId);
    let n = 0;
    for (const c of contrats ?? []) {
      const d = (c as unknown as { dossier: { type_assurance: string | null } | null }).dossier;
      const branche = brancheContrat({ is_emprunteur: c.is_emprunteur, type_assurance: d?.type_assurance });
      const r = await calculerRemuneration(supabase, c, branche);
      const res = await enregistrerRemuneration(supabase, c.id, r);
      if (res.ok) n++;
    }
    return n;
  };

  const enregistrer = async () => {
    if (!form) return;
    setErr(null);
    setInfo(null);
    const v = validerBaremeForm(form);
    if (v) return setErr(v);
    setBusy(true);
    const t1 = Number(form.taux_annee_1);
    const payload = {
      niveau: "compagnie",
      compagnie_id: compagnieId,
      branche: form.branche,
      type: "pourcentage",
      base_calcul: "prime",
      taux_pourcentage: t1,
      montant_fixe: null,
      mode: form.mode,
      taux_annee_1: t1,
      taux_renouvellement: form.mode === "precompte" ? Number(form.taux_renouvellement) : null,
      date_effet: form.date_effet,
      date_fin: form.date_fin || null,
      notes: form.notes.trim() || null,
    };
    const q = form.id
      ? await db.from("commission_bareme").update(payload as never).eq("id", form.id)
      : await db.from("commission_bareme").insert(payload as never);
    if (q.error) {
      setBusy(false);
      return setErr(
        q.error.code === "23505"
          ? "Un barème existe déjà pour cette branche : plusieurs versions datées seront possibles après la migration de remplacement de la règle « un seul barème »."
          : q.error.code === "23P01"
            ? "Cette période chevauche un autre barème de la même branche."
            : q.error.message,
      );
    }
    setForm(null);
    await load();
    const n = await recalculerContrats();
    setInfo(`Barème enregistré. Prévisionnel recalculé pour ${n} contrat(s).`);
    setBusy(false);
  };

  const editer = (r: BaremeVersionneRow) =>
    setForm({
      id: r.id,
      branche: r.branche,
      mode: r.mode ?? "lineaire",
      taux_annee_1: r.taux_annee_1 != null ? String(r.taux_annee_1) : "",
      taux_renouvellement: r.taux_renouvellement != null ? String(r.taux_renouvellement) : "",
      date_effet: r.date_effet ?? "",
      date_fin: r.date_fin ?? "",
      notes: r.notes ?? "",
    });

  return (
    <section className="crm-card space-y-3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-serif text-lg">Barèmes de commission datés</h3>
          <p className="text-xs text-ink-muted">
            Base : prime annuelle du contrat, par année de prime. Linéaire = même taux chaque année ; précompte = taux
            année 1 distinct des renouvellements. Les frais de distribution ne sont pas une commission.
          </p>
        </div>
        {canEdit && !indispo && (
          <button
            onClick={() => setForm(vide())}
            className="rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
          >
            + Nouveau barème
          </button>
        )}
      </div>

      {indispo && (
        <p className="rounded-md border border-dashed border-line p-3 text-sm text-ink-muted">
          En attente d'activation : les barèmes datés seront disponibles dès que la base sera relancée et la mise à jour
          appliquée. Les commissions prévisionnelles restent « à configurer ».
        </p>
      )}
      {err && <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{err}</p>}
      {info && <p className="rounded-md bg-muted p-3 text-sm">{info}</p>}

      {!indispo && rows.length === 0 && (
        <p className="text-sm text-ink-muted">Aucun barème daté : commission prévisionnelle à configurer.</p>
      )}
      {rows.length > 0 && (
        <ul className="divide-y divide-line rounded-md border border-line">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <span>
                <strong>{labelBranche(r.branche)}</strong> —{" "}
                {r.mode === "precompte"
                  ? `Précompte : ${r.taux_annee_1} % année 1, ${r.taux_renouvellement} % ensuite`
                  : `Linéaire : ${r.taux_annee_1} % chaque année`}{" "}
                · du {r.date_effet}
                {r.date_fin ? ` au ${r.date_fin}` : " (sans fin)"}
              </span>
              {canEdit && (
                <button onClick={() => editer(r)} className="text-xs underline underline-offset-4">
                  Modifier
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {form && canEdit && (
        <div className="grid gap-3 rounded-md border border-accent bg-background p-4 md:grid-cols-3">
          <label className="text-xs text-ink-muted">
            Branche
            <select value={form.branche} onChange={(e) => setForm({ ...form, branche: e.target.value })} className={inp}>
              {BRANCHES_COMMISSION.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-ink-muted">
            Type de commissionnement
            <select
              value={form.mode}
              onChange={(e) => setForm({ ...form, mode: e.target.value as Form["mode"] })}
              className={inp}
            >
              <option value="lineaire">Linéaire</option>
              <option value="precompte">Précompte</option>
            </select>
          </label>
          <label className="text-xs text-ink-muted">
            {form.mode === "lineaire" ? "Taux annuel (% de la prime)" : "Taux année 1 (% de la prime)"}
            <input
              type="number"
              step="0.01"
              value={form.taux_annee_1}
              onChange={(e) => setForm({ ...form, taux_annee_1: e.target.value })}
              className={inp}
            />
          </label>
          {form.mode === "precompte" && (
            <label className="text-xs text-ink-muted">
              Taux années suivantes (%)
              <input
                type="number"
                step="0.01"
                value={form.taux_renouvellement}
                onChange={(e) => setForm({ ...form, taux_renouvellement: e.target.value })}
                className={inp}
              />
            </label>
          )}
          <label className="text-xs text-ink-muted">
            Date d'effet
            <input
              type="date"
              value={form.date_effet}
              onChange={(e) => setForm({ ...form, date_effet: e.target.value })}
              className={inp}
            />
          </label>
          <label className="text-xs text-ink-muted">
            Date de fin (facultative)
            <input
              type="date"
              value={form.date_fin}
              onChange={(e) => setForm({ ...form, date_fin: e.target.value })}
              className={inp}
            />
          </label>
          <p className="text-xs text-ink-muted md:col-span-3">
            Périodicité : calcul par année de prime (prorata sur la dernière année incomplète). Barème retenu selon la
            date d'effet du contrat.
          </p>
          <label className="text-xs text-ink-muted md:col-span-3">
            Note interne
            <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={inp} />
          </label>
          <div className="flex gap-3 md:col-span-3">
            <button
              disabled={busy}
              onClick={enregistrer}
              className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {busy ? "Enregistrement…" : "Enregistrer"}
            </button>
            <button onClick={() => setForm(null)} className="text-sm text-ink-muted underline underline-offset-4">
              Annuler
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
