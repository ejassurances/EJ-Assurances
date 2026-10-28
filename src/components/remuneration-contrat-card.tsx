import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { brancheContrat, fmtEuros } from "@/lib/commissions-bareme";
import {
  calculerRemuneration,
  enregistrerRemuneration,
  type ContratRemuneration,
} from "@/lib/remuneration-previsionnelle";

type Etat = Awaited<ReturnType<typeof calculerRemuneration>>;

/**
 * Prévisionnel du contrat : frais de distribution et commission compagnie en blocs séparés.
 * Recalcul automatique (idempotent) à chaque changement du contrat. Les paiements réels ne sont pas touchés.
 */
export function RemunerationContratCard({
  contrat,
  dossierId,
}: {
  contrat: ContratRemuneration;
  dossierId: string | null;
}) {
  const [etat, setEtat] = useState<Etat | null>(null);
  const [sauvegarde, setSauvegarde] = useState<string | null>(null);
  const deps = JSON.stringify(contrat);

  useEffect(() => {
    let annule = false;
    (async () => {
      let type: string | null = null;
      if (dossierId) {
        const { data } = await supabase
          .from("dossiers")
          .select("type_assurance")
          .eq("id", dossierId)
          .maybeSingle();
        type = (data?.type_assurance as string | null) ?? null;
      }
      const branche = brancheContrat({
        is_emprunteur: contrat.is_emprunteur,
        type_assurance: type,
      });
      const r = await calculerRemuneration(supabase, contrat, branche);
      if (annule) return;
      setEtat(r);
      const s = await enregistrerRemuneration(supabase, contrat.id, r);
      if (!annule) setSauvegarde(s.ok ? "Prévisionnel enregistré" : `Non enregistré : ${s.erreur}`);
    })().catch(() => {
      if (!annule) setSauvegarde("Calcul indisponible — à vérifier.");
    });
    return () => {
      annule = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deps, dossierId]);

  if (!etat)
    return sauvegarde ? (
      <p role="status" className="text-sm text-destructive">
        {sauvegarde}
      </p>
    ) : null;
  const { frais, commission } = etat;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <section className="crm-card space-y-1 p-5">
        <p className="crm-eyebrow">Frais de distribution (distincts de la commission)</p>
        {frais.statut === "calcule" ? (
          <>
            <p className="text-lg font-medium text-ink">{fmtEuros(frais.montant)}</p>
            <p className="text-sm text-muted-foreground">{frais.detail}</p>
          </>
        ) : (
          <p className="text-sm font-medium text-destructive">À vérifier : {frais.motif}</p>
        )}
      </section>
      <section className="crm-card space-y-2 p-5">
        <p className="crm-eyebrow">Commission compagnie prévisionnelle</p>
        {commission.statut === "calcule" ? (
          <>
            <p className="text-lg font-medium text-ink">
              {fmtEuros(commission.total)}{" "}
              <span className="text-sm text-muted-foreground">
                ({commission.mode === "precompte" ? "précompte" : "linéaire"},{" "}
                {commission.lignes.length} an(s))
              </span>
            </p>
            <ul className="max-h-40 overflow-auto text-xs text-muted-foreground">
              {commission.lignes.map((l) => (
                <li key={l.cle}>
                  Année {l.annee} : {l.taux} % × {fmtEuros(l.base)} = {fmtEuros(l.montant)}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-sm font-medium text-destructive">
            Non calculable : {commission.motif}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Prévisionnel uniquement — la commission versée est suivie à part. {sauvegarde ?? ""}
        </p>
      </section>
    </div>
  );
}
