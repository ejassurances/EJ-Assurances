import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCommissionBareme } from "@/hooks/use-commission-bareme";
import { BRANCHES_COMMISSION, decrireRegle, fmtEuros, LIBELLE_SOURCE } from "@/lib/commissions-bareme";

/** Commission cabinet calculée pour un contrat — visible staff uniquement. */
export function CommissionContratCard({
  dossierId,
  isEmprunteur,
  compagnieId,
  primeAnnuelle,
  primeNetteAnnuelle,
  economieRealisee,
}: {
  dossierId: string | null;
  isEmprunteur: boolean;
  compagnieId: string | null;
  primeAnnuelle: number | null;
  primeNetteAnnuelle: number | null;
  economieRealisee: number | null;
}) {
  const { staff, loading, commissionContrat } = useCommissionBareme();
  const [typeAssurance, setTypeAssurance] = useState<string | null>(null);
  const [economieDossier, setEconomieDossier] = useState<number | null>(null);
  const [devisControle, setDevisControle] = useState<{
    id: string;
    est_retenu: boolean;
    document_id: string | null;
    prime_ttc_annuelle: number | null;
    prime_ht_annuelle: number | null;
    assiette_commission_annuelle: number | null;
    regime_fiscal: string;
  } | null>(null);
  const [nbDevis, setNbDevis] = useState(0);

  useEffect(() => {
    if (!staff || !dossierId) return;
    (async () => {
      const [{ data: dossier }, { data: devis }] = await Promise.all([
        supabase
          .from("dossiers")
          .select("type_assurance, economie_estimee")
          .eq("id", dossierId)
          .maybeSingle(),
        supabase
          .from("dossier_devis")
          .select("id,est_retenu,document_id,prime_ttc_annuelle,prime_ht_annuelle,assiette_commission_annuelle,regime_fiscal")
          .eq("dossier_id", dossierId)
          .is("archive_le", null)
          .order("created_at", { ascending: false }),
      ]);
      setTypeAssurance((dossier?.type_assurance as string | null) ?? null);
      setEconomieDossier(dossier?.economie_estimee != null ? Number(dossier.economie_estimee) : null);
      const rows = devis ?? [];
      setNbDevis(rows.length);
      setDevisControle(
        rows.find((d) => d.est_retenu) ?? rows[0] ?? null,
      );
    })();
  }, [staff, dossierId]);

  if (!staff || loading) return null;

  const { branche, regle, source, montant } = commissionContrat({
    is_emprunteur: isEmprunteur,
    type_assurance: typeAssurance,
    compagnie_id: compagnieId,
    prime_annuelle: primeAnnuelle,
    prime_nette_annuelle: primeNetteAnnuelle,
    economie_realisee: economieRealisee,
    economie_estimee: economieDossier,
  });
  const labelBranche = BRANCHES_COMMISSION.find((b) => b.value === branche)?.label ?? branche;
  const primeTtc = primeAnnuelle != null ? Number(primeAnnuelle) : null;
  const primeHt = primeNetteAnnuelle != null ? Number(primeNetteAnnuelle) : null;
  const taxes = primeTtc != null && primeHt != null ? Math.max(0, primeTtc - primeHt) : null;

  return (
    <section className="rounded-lg border border-line bg-surface p-5 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-serif text-lg text-ink">Commission cabinet</h2>
          <p className="mt-1 text-xs text-ink-muted">
            {labelBranche} · {decrireRegle(regle)} ·{" "}
            <span className="rounded-full bg-background px-2 py-0.5">{LIBELLE_SOURCE[source]}</span>
          </p>
          {regle.notes && <p className="mt-1 text-xs text-ink-muted">{regle.notes}</p>}
          {regle.base_calcul === "prime" && (
            <p className="mt-1 text-[11px] text-ink-muted">
              Assiette : prime nette annuelle {primeNetteAnnuelle != null ? fmtEuros(primeNetteAnnuelle) : "non renseignée"}
              {regle.assiette_mensuelle ? " (soit la prime nette mensuelle pour une règle mensuelle)" : ""}.
            </p>
          )}
        </div>
        <p className="font-serif text-2xl font-medium text-ink">{fmtEuros(montant)}</p>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-line bg-background p-3">
          <p className="text-[11px] text-ink-muted">Prime TTC client</p>
          <p className="mt-1 font-medium text-ink">{primeTtc != null ? fmtEuros(primeTtc) : "—"}</p>
        </div>
        <div className="rounded-lg border border-line bg-background p-3">
          <p className="text-[11px] text-ink-muted">Prime hors taxes</p>
          <p className="mt-1 font-medium text-ink">{primeHt != null ? fmtEuros(primeHt) : "À calculer"}</p>
        </div>
        <div className="rounded-lg border border-line bg-background p-3">
          <p className="text-[11px] text-ink-muted">Taxes / contributions</p>
          <p className="mt-1 font-medium text-ink">{taxes != null ? fmtEuros(taxes) : "À confirmer"}</p>
        </div>
        <div className="rounded-lg border border-line bg-background p-3">
          <p className="text-[11px] text-ink-muted">Assiette commission</p>
          <p className="mt-1 font-medium text-ink">{primeHt != null ? fmtEuros(primeHt) : "À confirmer"}</p>
        </div>
      </div>

      <div className="rounded-lg border border-line bg-background p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-ink">Contrôle du devis source</p>
            <p className="text-[11px] text-ink-muted">
              Le devis retenu constitue la source commerciale de la prime TTC et de l'assiette de commission.
            </p>
          </div>
          {devisControle?.est_retenu ? (
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">Devis retenu</span>
          ) : devisControle ? (
            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700">Devis à confirmer</span>
          ) : (
            <span className="rounded-full bg-red-50 px-2.5 py-1 text-[11px] font-medium text-red-700">Aucun devis</span>
          )}
        </div>
        <div className="mt-3 grid gap-2 text-xs md:grid-cols-3">
          <p>Devis actifs : <strong>{nbDevis}</strong></p>
          <p>Document devis : <strong>{devisControle?.document_id ? "présent" : "manquant"}</strong></p>
          <p>Fiscalité : <strong>{devisControle?.regime_fiscal ?? "manuel / à confirmer"}</strong></p>
        </div>
        {devisControle && devisControle.prime_ttc_annuelle != null && primeTtc != null && Math.abs(Number(devisControle.prime_ttc_annuelle) - primeTtc) > 0.02 && (
          <p className="mt-3 rounded-md bg-red-50 p-2 text-[11px] text-red-800">
            Écart détecté entre la prime TTC du devis ({fmtEuros(Number(devisControle.prime_ttc_annuelle))}) et celle du contrat ({fmtEuros(primeTtc)}).
          </p>
        )}
      </div>

      <p className="text-[11px] text-ink-muted">Information interne — jamais visible par le client.</p>
    </section>
  );
}
