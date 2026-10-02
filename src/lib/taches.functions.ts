/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

import { PRIORITES_TACHE, STATUTS_TACHE } from "./referentiels";

/**
 * Mutations sur les tâches — point d'entrée unique côté cabinet.
 * Les écrans ne modifient plus la table `taches` directement : statut,
 * priorité et création passent ici (contrôle de rôle + champs autorisés).
 */

async function exigerStaff(supabase: any, userId: string) {
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  const roles = ((data ?? []) as { role: string }[]).map((r) => r.role);
  if (!roles.includes("admin") && !roles.includes("mandataire")) throw new Error("Accès réservé au cabinet.");
}

/** Changement de statut (et éventuellement de priorité) d'une tâche. */
export const majTache = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        statut: z.enum(STATUTS_TACHE).optional(),
        priorite: z.enum(PRIORITES_TACHE).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await exigerStaff(context.supabase, context.userId);
    const patch: Record<string, unknown> = {};
    if (data.statut) patch.statut = data.statut;
    if (data.priorite) patch.priorite = data.priorite;
    if (data.statut === "terminee" || data.statut === "annulee") {
      patch.terminee_le = new Date().toISOString();
    } else if (data.statut) {
      patch.terminee_le = null;
    }
    if (Object.keys(patch).length === 0) return { ok: true as const };
    const { error } = await (context.supabase as any).from("taches").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

/** Création manuelle d'une tâche par le cabinet. */
export const creerTache = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        titre: z.string().trim().min(2).max(300),
        description: z.string().trim().max(8000).optional().nullable(),
        client_id: z.string().uuid().optional().nullable(),
        echeance: z.string().min(1).optional().nullable(),
        priorite: z.enum(PRIORITES_TACHE).default("normale"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await exigerStaff(context.supabase, context.userId);
    const { data: row, error } = await (context.supabase as any)
      .from("taches")
      .insert({
        titre: data.titre,
        description: data.description || null,
        client_id: data.client_id || null,
        echeance: data.echeance || null,
        priorite: data.priorite,
        statut: "a_faire",
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { ok: true as const, id: (row as { id: string }).id };
  });
