/* eslint-disable prettier/prettier -- legacy file formatting debt; keep other lint rules enabled */
/**
 * Lecture IA d'un devis déposé sur un dossier : les données lues sont
 * PROPOSÉES au conseiller (aucune écriture), avec un rapprochement au catalogue
 * du cabinet limité à la branche du dossier.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

const entree = (input: unknown) =>
  z
    .object({
      dossier_id: z.string().uuid(),
      document_id: z.string().uuid(),
    })
    .parse(input);

export const lireDevisImporte = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(entree)
  .handler(async ({ data, context }) => {
    const { data: acces } = await context.supabase.rpc("can_access_dossier", {
      _dossier_id: data.dossier_id,
    });
    if (acces !== true) throw new Error("Accès au dossier refusé.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { lireDevisDocument, rapprocherCatalogue } = await import("@/lib/devis-import.server");

    const lu = await lireDevisDocument(supabaseAdmin, data.document_id);

    // Rapprochement catalogue : compagnies actives et produits de la branche.
    const { data: dossier } = await supabaseAdmin
      .from("dossiers")
      .select("type_assurance")
      .eq("id", data.dossier_id)
      .maybeSingle();
    const branche = (dossier as { type_assurance: string | null } | null)?.type_assurance ?? null;

    const [{ data: compagnies }, { data: produits }] = await Promise.all([
      supabaseAdmin.from("compagnies").select("id, nom"),
      supabaseAdmin.from("produits").select("id, nom, compagnie_id, famille_id"),
    ]);

    let produitsBranche = (produits ?? []) as { id: string; nom: string; compagnie_id: string | null; famille_id: string | null }[];
    if (branche) {
      const { data: familles } = await supabaseAdmin.from("produit_familles").select("id, branches");
      const ids = new Set(
        ((familles ?? []) as { id: string; branches: string[] | null }[])
          .filter((f) => (f.branches ?? []).includes(branche))
          .map((f) => f.id),
      );
      if (ids.size > 0) produitsBranche = produitsBranche.filter((p) => p.famille_id && ids.has(p.famille_id));
    }

    const compagnieId = rapprocherCatalogue(lu.compagnie, (compagnies ?? []) as { id: string; nom: string }[]);
    let produitId = rapprocherCatalogue(lu.produit, produitsBranche);
    // Le produit doit rester cohérent avec la compagnie rapprochée.
    if (produitId && compagnieId) {
      const p = produitsBranche.find((x) => x.id === produitId);
      if (p && p.compagnie_id && p.compagnie_id !== compagnieId) produitId = null;
    }

    return { ...lu, compagnie_id: compagnieId, produit_id: produitId };
  });


/** Marque comme référence la lecture du document après validation humaine du devis. */
export const validerDevisImporte = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ dossier_id: z.string().uuid(), document_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: acces } = await context.supabase.rpc("can_access_dossier", {
      _dossier_id: data.dossier_id,
    });
    if (acces !== true) throw new Error("Accès au dossier refusé.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: lecture, error: lectureError } = await (supabaseAdmin as unknown as SupabaseClient)
      .from("devis_import_lectures")
      .select("id")
      .eq("dossier_id", data.dossier_id)
      .eq("document_id", data.document_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lectureError || !lecture) throw new Error("Lecture de référence introuvable pour ce document.");

    const { error } = await (supabaseAdmin as unknown as SupabaseClient)
      .from("devis_import_lectures")
      .update({
        statut: "validee",
        validee_le: new Date().toISOString(),
        validee_par: context.userId,
      })
      .eq("id", lecture.id);
    if (error) throw new Error("Impossible de valider la lecture de référence.");
    return { ok: true };
  });
