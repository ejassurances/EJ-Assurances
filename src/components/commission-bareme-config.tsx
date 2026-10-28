import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  BRANCHES_COMMISSION,
  decrireRegle,
  regleParDefaut,
  type BaseCalcul,
  type RegleCommission,
  type TypeCommission,
} from "@/lib/commissions-bareme";

type Compagnie = { id: string; nom: string };

/** Configuration du barème de commissions — admin uniquement. */
export function CommissionBaremeConfig() {
  const [regles, setRegles] = useState<RegleCommission[]>([]);
  const [compagnies, setCompagnies] = useState<Compagnie[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [edition, setEdition] = useState<Partial<RegleCommission> | null>(null);

  async function load() {
    setLoading(true);
    const [r, c] = await Promise.all([
      supabase
        .from("commission_bareme")
        .select("id,niveau,branche,compagnie_id,type,montant_fixe,taux_pourcentage,base_calcul,notes,periodicite"),
      supabase.from("compagnies").select("id,nom").order("nom"),
    ]);
    setRegles((r.data ?? []) as unknown as RegleCommission[]);
    setCompagnies((c.data ?? []) as Compagnie[]);
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  const nomCie = useMemo(
    () => new Map(compagnies.map((c) => [c.id, c.nom] as const)),
    [compagnies],
  );

  async function enregistrer(r: Partial<RegleCommission>) {
    setErr(null);
    if (!r.branche || r.base_calcul === "economie_realisee") return setErr("Les économies relèvent des frais de distribution, pas des commissions compagnie.");
    const valeur = r.type === "fixe" ? r.montant_fixe : r.taux_pourcentage;
    if (valeur == null || !Number.isFinite(Number(valeur)) || Number(valeur) < 0) return setErr("Montant ou taux explicite obligatoire.");
    const payload = {
      niveau: r.niveau ?? "branche",
      branche: r.branche,
      compagnie_id: r.niveau === "compagnie" ? (r.compagnie_id ?? null) : null,
      type: (r.type ?? "fixe") as TypeCommission,
      montant_fixe: r.type === "fixe" ? Number(r.montant_fixe ?? 0) : null,
      taux_pourcentage: r.type === "pourcentage" ? Number(r.taux_pourcentage ?? 0) : null,
      base_calcul: (r.base_calcul ?? "prime") as BaseCalcul,
      periodicite: r.periodicite === "annuelle" ? "annuelle" : "mensuelle",
      notes: r.notes?.trim() ? r.notes.trim() : null,
    };
    const q = r.id
      ? await supabase.from("commission_bareme").update(payload).eq("id", r.id)
      : await supabase.from("commission_bareme").insert(payload);
    if (q.error) return setErr(q.error.message);
    setEdition(null);
    await load();
  }

  if (loading) return <p className="mt-8 text-sm text-ink-muted">Chargement du barème…</p>;

  return (
    <section className="mt-10 crm-card p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-serif text-xl font-medium text-ink">Barème de commissions</h2>
          <p className="mt-1 text-xs text-ink-muted">
            Règles historiques : sans barème explicite, commission non calculable. Les frais de distribution sont suivis séparément. Configurez les modes et dates depuis la fiche compagnie.
          </p>
        </div>
        <button
          onClick={() =>
            setEdition({ niveau: "compagnie", branche: "emprunteur", type: "fixe", base_calcul: "prime" })
          }
          className="rounded-md bg-[color:var(--crm-navy,#0A192F)] px-3 py-1.5 text-xs font-medium text-white"
        >
          + Règle compagnie
        </button>
      </div>

      {err && <p className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-800">{err}</p>}

      <div className="mt-5 space-y-6">
        {BRANCHES_COMMISSION.map((b) => {
          const regleBranche = regles.find((r) => r.niveau === "branche" && r.branche === b.value);
          const effective = regleBranche ?? regleParDefaut(b.value);
          const spec = regles.filter((r) => r.niveau === "compagnie" && r.branche === b.value);
          return (
            <div key={b.value} className="rounded-xl border border-line p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-ink">{b.label}</p>
                  <p className="text-xs text-ink-muted">
                    {decrireRegle(effective)}
                    {!regleBranche && (
                      <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-900">
                        À configurer
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex gap-3 text-xs">
                  <button
                    onClick={() => setEdition({ ...effective, niveau: "branche", compagnie_id: null })}
                    className="underline underline-offset-4"
                  >
                    {regleBranche ? "Modifier" : "Définir la règle"}
                  </button>

                </div>
              </div>

              {spec.length > 0 && (
                <ul className="mt-3 space-y-2 border-t border-line pt-3">
                  {spec.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="text-ink">
                        <strong>{nomCie.get(r.compagnie_id ?? "") ?? "Compagnie"}</strong> — {decrireRegle(r)}
                        {r.notes ? <span className="text-ink-muted"> · {r.notes}</span> : null}
                      </span>
                      <span className="flex gap-3">
                        <button onClick={() => setEdition(r)} className="underline underline-offset-4">
                          Modifier
                        </button>

                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {edition && (
        <FormulaireRegle
          valeur={edition}
          compagnies={compagnies}
          onCancel={() => setEdition(null)}
          onSubmit={enregistrer}
        />
      )}
    </section>
  );
}

function FormulaireRegle({
  valeur,
  compagnies,
  onCancel,
  onSubmit,
}: {
  valeur: Partial<RegleCommission>;
  compagnies: Compagnie[];
  onCancel: () => void;
  onSubmit: (r: Partial<RegleCommission>) => void;
}) {
  const [f, setF] = useState<Partial<RegleCommission>>(valeur);
  const inp = "w-full rounded-md border border-line bg-background px-3 py-2 text-sm";

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(f);
      }}
      className="mt-6 grid gap-4 rounded-xl border border-[color:var(--crm-gold,#D4AF37)] bg-background p-5 md:grid-cols-3"
    >
      <p className="md:col-span-3 font-serif text-lg text-ink">
        {f.niveau === "compagnie" ? "Règle spécifique à une compagnie" : "Règle de branche"}
      </p>

      <label className="text-xs text-ink-muted">
        Branche
        <select
          value={f.branche ?? ""}
          onChange={(e) => setF({ ...f, branche: e.target.value })}
          className={inp}
          required
        >
          {BRANCHES_COMMISSION.map((b) => (
            <option key={b.value} value={b.value}>
              {b.label}
            </option>
          ))}
        </select>
      </label>

      {f.niveau === "compagnie" && (
        <label className="text-xs text-ink-muted">
          Compagnie
          <select
            value={f.compagnie_id ?? ""}
            onChange={(e) => setF({ ...f, compagnie_id: e.target.value })}
            className={inp}
            required
          >
            <option value="">Choisir…</option>
            {compagnies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nom}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="text-xs text-ink-muted">
        Cycle de cotisation
        <select
          value={f.periodicite ?? "mensuelle"}
          onChange={(e) => setF({ ...f, periodicite: e.target.value as "mensuelle" | "annuelle" })}
          className={inp}
        >
          <option value="mensuelle">Mensuelle</option>
          <option value="annuelle">Annuelle (commission une fois par an)</option>
        </select>
      </label>

      <label className="text-xs text-ink-muted">
        Type
        <select
          value={f.type ?? "fixe"}
          onChange={(e) => setF({ ...f, type: e.target.value as TypeCommission })}
          className={inp}
        >
          <option value="fixe">Montant fixe</option>
          <option value="pourcentage">Pourcentage</option>
        </select>
      </label>

      {f.type === "pourcentage" ? (
        <>
          <label className="text-xs text-ink-muted">
            Taux (%)
            <input
              type="number"
              step="0.01"
              value={f.taux_pourcentage ?? ""}
              onChange={(e) => setF({ ...f, taux_pourcentage: e.target.value ? Number(e.target.value) : null })}
              className={inp}
              required
            />
          </label>
          <label className="text-xs text-ink-muted">
            Base de calcul
            <select
              value={f.base_calcul ?? "prime"}
              onChange={(e) => setF({ ...f, base_calcul: e.target.value as BaseCalcul })}
              className={inp}
            >
              <option value="prime">Prime</option>
              {f.base_calcul === "economie_realisee" && <option value="economie_realisee" disabled>Économies — à revoir (frais)</option>}
            </select>
          </label>
        </>
      ) : (
        <label className="text-xs text-ink-muted">
          Montant fixe (€)
          <input
            type="number"
            step="0.01"
            value={f.montant_fixe ?? ""}
            onChange={(e) => setF({ ...f, montant_fixe: e.target.value ? Number(e.target.value) : null })}
            className={inp}
            required
          />
        </label>
      )}

      <label className="text-xs text-ink-muted md:col-span-3">
        Note interne (ex. moment de prélèvement)
        <input
          value={f.notes ?? ""}
          onChange={(e) => setF({ ...f, notes: e.target.value })}
          className={inp}
          placeholder="Prélevée sur la première mensualité"
        />
      </label>

      <div className="md:col-span-3 flex gap-3">
        <button
          type="submit"
          className="rounded-md bg-[color:var(--crm-navy,#0A192F)] px-4 py-2 text-sm font-medium text-white"
        >
          Enregistrer
        </button>
        <button type="button" onClick={onCancel} className="text-sm text-ink-muted underline underline-offset-4">
          Annuler
        </button>
      </div>
    </form>
  );
}
