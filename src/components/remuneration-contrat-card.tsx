import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
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
  const [modeFrais, setModeFrais] = useState<"automatique" | "offert" | "montant_fixe">(((contrat as any).frais_distribution_mode ?? "automatique") as "automatique" | "offert" | "montant_fixe");
  const [montantFrais, setMontantFrais] = useState(String((contrat as any).frais_distribution_montant ?? ""));
  const [savingFrais, setSavingFrais] = useState(false);
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

  const enregistrerFrais = async () => {
    const montant = Number(montantFrais);
    if (modeFrais === "montant_fixe" && (!montantFrais.trim() || !Number.isFinite(montant) || montant < 0)) {
      toast.error("Saisissez un montant de frais valide, supérieur ou égal à 0 €.");
      return;
    }
    setSavingFrais(true);
    const { error } = await (supabase as any).from("contrats").update({
      frais_distribution_mode: modeFrais,
      frais_distribution_montant: modeFrais === "montant_fixe" ? montant : null,
    }).eq("id", contrat.id);
    if (!error) {
      const { error: recalcError } = await (supabase as any).rpc("recalculer_remuneration_contrat", { p_contrat_id: contrat.id });
      if (recalcError) toast.error("Frais enregistrés, mais recalcul impossible : " + recalcError.message);
      else toast.success("Frais de distribution mis à jour.");
      const r = await calculerRemuneration(supabase, contrat, brancheContrat({ is_emprunteur: contrat.is_emprunteur, type_assurance: null }));
      setEtat(r);
    } else toast.error("Enregistrement impossible : " + error.message);
    setSavingFrais(false);
  };

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <section className="crm-card space-y-1 p-5">
        <p className="crm-eyebrow">Frais de distribution (distincts de la commission)</p>
        <label className="block text-xs text-muted-foreground">Mode de calcul
          <Select value={modeFrais} onValueChange={(v) => setModeFrais(v as typeof modeFrais)}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="automatique">Calcul automatique</SelectItem>
              <SelectItem value="offert">Offerts (0 €)</SelectItem>
              <SelectItem value="montant_fixe">Montant personnalisé</SelectItem>
            </SelectContent>
          </Select>
        </label>
        {modeFrais === "montant_fixe" && <label className="block text-xs text-muted-foreground">Montant des frais (€)
          <Input className="mt-1" type="number" min="0" step="0.01" value={montantFrais} onChange={(e) => setMontantFrais(e.target.value)} placeholder="Ex. 150" />
        </label>}
        <Button size="sm" variant="outline" onClick={enregistrerFrais} disabled={savingFrais}>{savingFrais ? "Enregistrement…" : "Enregistrer les frais"}</Button>
        {modeFrais === "offert" ? <><p className="text-lg font-medium text-ink">{fmtEuros(0)}</p><p className="text-sm text-muted-foreground">Frais offerts</p></> : modeFrais === "montant_fixe" ? <><p className="text-lg font-medium text-ink">{fmtEuros(Number(montantFrais) || 0)}</p><p className="text-sm text-muted-foreground">Montant personnalisé</p></> : frais.statut === "calcule" ? (
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
