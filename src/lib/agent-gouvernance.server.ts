/* eslint-disable @typescript-eslint/no-explicit-any */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  evaluerPermission,
  type DecisionGouvernance,
  type PermissionAction,
} from "@/lib/agent-gouvernance";

/**
 * Lot 7 — Couche serveur de gouvernance de l'Agent IA.
 *
 * S'appuie sur le socle déjà en base (versionné dans la migration
 * 0007_lot7_agent_gouvernance.sql) :
 *  - `agent_permissions` : permission PAR ACTION (niveau de gouvernance) ;
 *  - `agent_runs`        : session/contexte d'une exécution (couche mémoire) ;
 *  - `agent_actions`     : journal des actions/décisions (idempotent) ;
 *  - `agent_escalations` : demandes explicites de décision à Erwan.
 *
 * Écritures via `supabaseAdmin` (service_role, serveur uniquement) : les
 * secrets et droits ne transitent jamais par une conversation ou un journal
 * métier. La lecture RLS reste réservée au staff.
 */

// Les tables agent_* ne figurent pas (encore) dans les types générés ; on
// type l'admin de façon permissive, comme regles-agent.server.ts.
type Admin = SupabaseClient<any, any, any>;

/** Charge la permission d'une action (null si absente). */
export async function chargerPermission(
  admin: Admin,
  actionType: string,
): Promise<PermissionAction | null> {
  const { data } = await admin
    .from("agent_permissions")
    .select("action_type, niveau, actif")
    .eq("action_type", actionType)
    .maybeSingle();
  return (data as PermissionAction | null) ?? null;
}

/**
 * Évalue une action : lit sa permission puis applique les règles de
 * gouvernance (défaut conservateur `escalade` si absente/inactive/inconnue).
 */
export async function evaluerAction(
  admin: Admin,
  actionType: string,
  opts: { actionSensible?: boolean } = {},
): Promise<DecisionGouvernance> {
  const perm = await chargerPermission(admin, actionType);
  return evaluerPermission(perm, opts);
}

/** Démarre une session d'exécution (couche mémoire/contexte) et renvoie son id. */
export async function demarrerRun(
  admin: Admin,
  params: {
    agentName: string;
    triggerType: string;
    triggerRef?: string | null;
    ruleRef?: string | null;
    ruleVersion?: string | null;
    context?: Record<string, unknown>;
  },
): Promise<string | null> {
  const { data, error } = await admin
    .from("agent_runs")
    .insert({
      agent_name: params.agentName,
      trigger_type: params.triggerType,
      trigger_ref: params.triggerRef ?? null,
      rule_ref: params.ruleRef ?? null,
      rule_version: params.ruleVersion ?? null,
      context: params.context ?? {},
    })
    .select("id")
    .single();
  if (error) return null;
  return (data as { id: string }).id;
}

/** Clôt une session d'exécution. */
export async function terminerRun(
  admin: Admin,
  runId: string,
  params: {
    status: "completed" | "blocked" | "failed" | "cancelled";
    summary?: string;
    error?: string;
  },
): Promise<void> {
  await admin
    .from("agent_runs")
    .update({
      status: params.status,
      finished_at: new Date().toISOString(),
      summary: params.summary ?? null,
      error: params.error ?? null,
    })
    .eq("id", runId);
}

export type StatutActionJournal = "proposed" | "executed" | "skipped" | "blocked" | "failed";

/**
 * Journalise une action/décision significative. Idempotent : si une clé
 * d'idempotence est fournie et déjà présente, l'action existante est renvoyée
 * sans réinsertion (une relance ou un webhook répété ne crée pas de doublon).
 */
export async function journaliserAction(
  admin: Admin,
  params: {
    runId?: string | null;
    actionType: string;
    status: StatutActionJournal;
    targetType?: string | null;
    targetId?: string | null;
    idempotencyKey?: string | null;
    ruleRef?: string | null;
    ruleVersion?: string | null;
    inputSummary?: string | null;
    outputSummary?: string | null;
    error?: string | null;
  },
): Promise<{ id: string; deja: boolean } | null> {
  if (params.idempotencyKey) {
    const { data: existant } = await admin
      .from("agent_actions")
      .select("id")
      .eq("idempotency_key", params.idempotencyKey)
      .maybeSingle();
    if (existant) return { id: (existant as { id: string }).id, deja: true };
  }

  const { data, error } = await admin
    .from("agent_actions")
    .insert({
      run_id: params.runId ?? null,
      action_type: params.actionType,
      status: params.status,
      target_type: params.targetType ?? null,
      target_id: params.targetId ?? null,
      idempotency_key: params.idempotencyKey ?? null,
      rule_ref: params.ruleRef ?? null,
      rule_version: params.ruleVersion ?? null,
      input_summary: params.inputSummary ?? null,
      output_summary: params.outputSummary ?? null,
      error: params.error ?? null,
    })
    .select("id")
    .single();
  if (error) return null;
  return { id: (data as { id: string }).id, deja: false };
}

/**
 * Escalade un cas vers Erwan : contexte, information manquante, décision
 * attendue et action bloquée. À utiliser dès qu'une décision renvoie
 * `doitEscalader` ou qu'aucune règle applicable n'est trouvée.
 */
export async function escalader(
  admin: Admin,
  params: {
    motif: string;
    runId?: string | null;
    dossierId?: string | null;
    clientId?: string | null;
    taskId?: string | null;
    contexte?: string | null;
    informationManquante?: string | null;
    decisionAttendue?: string | null;
  },
): Promise<string | null> {
  const { data, error } = await admin
    .from("agent_escalations")
    .insert({
      motif: params.motif,
      run_id: params.runId ?? null,
      dossier_id: params.dossierId ?? null,
      client_id: params.clientId ?? null,
      task_id: params.taskId ?? null,
      contexte: params.contexte ?? null,
      information_manquante: params.informationManquante ?? null,
      decision_attendue: params.decisionAttendue ?? null,
    })
    .select("id")
    .single();
  if (error) return null;
  return (data as { id: string }).id;
}
