import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { withPendingSchema, type BaremeVersionneRow } from "./pending-schema-client";
import {
  calculerCommissionPrevisionnelle,
  calculerFraisDistribution,
  choisirBareme,
  type BaremeCompagnie,
  type ResultatCommission,
  type ResultatFrais,
} from "./remuneration-contrat";

export type ContratRemuneration = {
  id: string;
  compagnie_id: string | null;
  produit_id: string | null;
  date_effet: string | null;
  prime_annuelle: number | null;
  prime_nette_annuelle?: number | null;
  duree_mois: number | null;
  is_emprunteur: boolean | null;
  economie_realisee: number | null;
  economie_cout_groupe: number | null;
  economie_cout_delegue: number | null;
};

export type LignePrev = {
  cle: string;
  contrat_id: string;
  type: "frais_distribution" | "commission";
  annee: number;
  statut: "calcule" | "a_verifier" | "non_calculable";
  base: number | null;
  taux: number | null;
  montant: number | null;
  motif: string | null;
  bareme_id: string | null;
  bareme_snapshot: BaremeCompagnie | null;
};

/** Lignes à enregistrer (pur, testable) : clé stable par contrat/type/année. */
export function lignesAPersister(
  contratId: string,
  frais: ResultatFrais,
  commission: ResultatCommission,
  bareme: BaremeCompagnie | null,
): LignePrev[] {
  const rows: LignePrev[] = [
    {
      cle: `${contratId}:frais_distribution:1`,
      contrat_id: contratId,
      type: "frais_distribution",
      annee: 1,
      statut: frais.statut,
      base: frais.statut === "calcule" ? frais.assiette : null,
      taux: null,
      montant: frais.montant,
      motif: frais.statut === "calcule" ? frais.detail : frais.motif,
      bareme_id: null,
      bareme_snapshot: null,
    },
  ];
  if (commission.statut === "calcule") {
    for (const l of commission.lignes)
      rows.push({
        cle: l.cle,
        contrat_id: contratId,
        type: "commission",
        annee: l.annee,
        statut: "calcule",
        base: l.base,
        taux: l.taux,
        montant: l.montant,
        motif:
          commission.mode === "precompte"
            ? l.annee === 1
              ? "Précompte année 1"
              : "Renouvellement"
            : "Linéaire",
        bareme_id: commission.baremeId,
        bareme_snapshot: bareme,
      });
  } else {
    rows.push({
      cle: `${contratId}:commission:1`,
      contrat_id: contratId,
      type: "commission",
      annee: 1,
      statut: "non_calculable",
      base: null,
      taux: null,
      montant: null,
      motif: commission.motif,
      bareme_id: null,
      bareme_snapshot: null,
    });
  }
  return rows;
}

function versBareme(r: BaremeVersionneRow): BaremeCompagnie {
  return {
    id: r.id,
    compagnie_id: r.compagnie_id ?? "",
    branche: r.branche,
    produit_id: r.produit_id,
    mode: r.mode,
    base_calcul: r.base_calcul === "economie_realisee" ? r.base_calcul : r.base_previsionnelle ?? r.base_calcul,
    periodicite: r.periodicite,
    taux_annee_1: r.taux_annee_1 != null ? Number(r.taux_annee_1) : null,
    taux_renouvellement: r.taux_renouvellement != null ? Number(r.taux_renouvellement) : null,
    date_effet: r.date_effet,
    date_fin: r.date_fin,
  };
}

/** Calcule à partir des barèmes datés de la compagnie (lecture seule). */
export async function calculerRemuneration(
  client: SupabaseClient<Database>,
  contrat: ContratRemuneration,
  branche: string,
) {
  const db = withPendingSchema(client);
  const frais = calculerFraisDistribution({
    isEmprunteur: contrat.is_emprunteur,
    branche,
    dureeMois: contrat.duree_mois,
    economieRealisee: contrat.economie_realisee,
    coutGroupeTotal: contrat.economie_cout_groupe,
    coutDelegueTotal: contrat.economie_cout_delegue,
  });
  let schemaDisponible = true;
  let baremes: BaremeCompagnie[] = [];
  if (contrat.compagnie_id) {
    const { data, error } = await db
      .from("commission_bareme")
      .select(
        "id,compagnie_id,branche,produit_id,mode,taux_annee_1,taux_renouvellement,date_effet,date_fin,notes,base_calcul,base_previsionnelle,periodicite",
      )
      .eq("compagnie_id", contrat.compagnie_id);
    if (error) schemaDisponible = false;
    else baremes = (data ?? []).map((r) => versBareme(r as BaremeVersionneRow));
  }
  const bareme = choisirBareme(baremes, {
    compagnieId: contrat.compagnie_id,
    branche,
    produitId: contrat.produit_id,
    date: contrat.date_effet,
  });
  const commission = schemaDisponible
    ? calculerCommissionPrevisionnelle({
        contratId: contrat.id,
        bareme,
        primeAnnuelle: contrat.prime_annuelle,
        primeNetteAnnuelle: contrat.prime_nette_annuelle,
        dureeMois: contrat.duree_mois,
      })
    : ({
        statut: "non_calculable",
        motif: "Barèmes datés pas encore activés en base",
        lignes: [],
      } satisfies ResultatCommission as ResultatCommission);
  return { frais, commission, bareme, schemaDisponible };
}

/**
 * Enregistre le prévisionnel de façon idempotente (upsert sur `cle`).
 * Les années devenues hors durée passent en « remplace » : rien n'est supprimé.
 * Ne touche jamais aux paiements réels (finance_revenus).
 */
export async function enregistrerRemuneration(
  client: SupabaseClient<Database>,
  contratId: string,
  r: Awaited<ReturnType<typeof calculerRemuneration>>,
): Promise<{ ok: boolean; erreur?: string }> {
  if (!r.schemaDisponible)
    return { ok: false, erreur: "Table de prévisions pas encore créée en base" };
  const db = withPendingSchema(client);
  const rows = lignesAPersister(contratId, r.frais, r.commission, r.bareme).map((x) => ({
    ...x,
    calcule_le: new Date().toISOString(),
  }));
  const up = await db
    .from("contrat_remuneration_previsionnelle")
    .upsert(rows as never, { onConflict: "cle" });
  if (up.error) return { ok: false, erreur: up.error.message };
  const maxAnnee = rows.filter((x) => x.type === "commission").length;
  const old = await db
    .from("contrat_remuneration_previsionnelle")
    .update({ statut: "remplace" })
    .eq("contrat_id", contratId)
    .eq("type", "commission")
    .gt("annee", maxAnnee);
  if (old.error) return { ok: false, erreur: old.error.message };
  return { ok: true };
}
