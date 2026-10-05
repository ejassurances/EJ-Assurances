/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { EcheanceCA } from "./ca-paliers";

/**
 * Lot 5 — CA prévisionnel par paliers (vert sécurisé / orange probabilisé).
 * Lecture seule. Reconstruit les échéances depuis `contrat_echeances`, enrichies
 * de la famille produit et du flag emprunteur, puis applique la règle des
 * paliers (emprunteur + AV/épargne à 8 ans, tacite reconduction base 1 an).
 */
export const caPaliersFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { paliersCaParAnnee, totauxPaliers } = await import("./ca-paliers");
    const db = supabaseAdmin as any;

    const [{ data: echs }, { data: contrats }, { data: produits }, { data: familles }] =
      await Promise.all([
        db
          .from("contrat_echeances")
          .select("contrat_id, annee, date_debut_periode, commission_cabinet_periode"),
        db.from("contrats").select("id, is_emprunteur, produit_id"),
        db.from("produits").select("id, famille_id"),
        db.from("produit_familles").select("id, code"),
      ]);

    const codeParFamille = new Map<string, string>(
      (familles ?? []).map((f: any) => [f.id, f.code]),
    );
    const familleParProduit = new Map<string, string | null>(
      (produits ?? []).map((p: any) => [
        p.id,
        p.famille_id ? (codeParFamille.get(p.famille_id) ?? null) : null,
      ]),
    );
    const contratInfo = new Map<string, { estEmprunteur: boolean; familleCode: string | null }>(
      (contrats ?? []).map((c: any) => [
        c.id,
        {
          estEmprunteur: Boolean(c.is_emprunteur),
          familleCode: c.produit_id ? (familleParProduit.get(c.produit_id) ?? null) : null,
        },
      ]),
    );

    const echeances: EcheanceCA[] = (echs ?? [])
      .filter((e: any) => e.contrat_id && e.date_debut_periode)
      .map((e: any) => {
        const info = contratInfo.get(e.contrat_id) ?? { estEmprunteur: false, familleCode: null };
        return {
          contratId: e.contrat_id,
          familleCode: info.familleCode,
          estEmprunteur: info.estEmprunteur,
          anneeContrat: Number(e.annee ?? 0),
          anneeCalendaire: Number(String(e.date_debut_periode).slice(0, 4)),
          commissionCabinet:
            e.commission_cabinet_periode == null ? null : Number(e.commission_cabinet_periode),
        };
      });

    const res = paliersCaParAnnee(echeances);
    return {
      lignes: res.lignes,
      totaux: totauxPaliers(res.lignes),
      nbContratsReconductionBase: res.contratsReconductionBase.length,
    };
  });
