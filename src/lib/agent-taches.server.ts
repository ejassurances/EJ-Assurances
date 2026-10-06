import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/**
 * Agent commercial — création de tâches humaines de reprise en main.
 * Toute automatisation qui ne peut pas aller au bout (classification
 * incertaine, recueil incomplet, erreur technique) doit déposer une tâche
 * plutôt que d'échouer silencieusement.
 */

type Admin = SupabaseClient<Database>;

/** Premier administrateur du cabinet (destinataire par défaut des tâches). */
export async function adminParDefaut(admin: Admin): Promise<string | null> {
  const { data, error } = await admin
    .from("user_roles")
    .select("user_id")
    .eq("role", "admin")
    .limit(1)
    .maybeSingle();
  if (error) console.error("[agent-taches] lecture de user_roles impossible", error.message);
  return (data as { user_id: string } | null)?.user_id ?? null;
}

/**
 * Identité technique utilisée par les traitements automatiques (crons, agents).
 * Ordre de résolution, pour ne JAMAIS échouer sur « aucun administrateur » quand
 * un compte existe réellement :
 *  1. un rôle `admin` dans `user_roles` ;
 *  2. à défaut, un rôle `mandataire` (conseiller du cabinet) ;
 *  3. à défaut, le plus ancien compte d'authentification du projet.
 * Retourne aussi le motif, pour la journalisation.
 */
export async function identiteTechnique(
  admin: Admin,
): Promise<{ userId: string; source: "admin" | "mandataire" | "auth" } | null> {
  const adminId = await adminParDefaut(admin);
  if (adminId) return { userId: adminId, source: "admin" };

  const { data: mandataire } = await admin
    .from("user_roles")
    .select("user_id")
    .eq("role", "mandataire")
    .limit(1)
    .maybeSingle();
  const mandataireId = (mandataire as { user_id: string } | null)?.user_id;
  if (mandataireId) {
    console.warn("[agent-taches] aucun rôle admin — repli sur un mandataire du cabinet");
    return { userId: mandataireId, source: "mandataire" };
  }

  try {
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
    if (error) throw new Error(error.message);
    const premier = data.users[0]?.id;
    if (premier) {
      console.warn("[agent-taches] aucun rôle en base — repli sur le premier compte d'authentification");
      return { userId: premier, source: "auth" };
    }
  } catch (e) {
    console.error("[agent-taches] liste des comptes d'authentification illisible", e);
  }
  return null;
}

/** Sources explicitement humaines : pas d'avertissement sans clé d'idempotence. */
const SOURCES_MANUELLES = new Set(["manuel", "humain", "utilisateur"]);

export async function creerTacheAdmin(
  admin: Admin,
  params: {
    titre: string;
    description?: string | null;
    client_id?: string | null;
    /** Dossier concerné : la tâche devient visible sur la fiche du dossier. */
    dossier_id?: string | null;
    /** Type de demande (module Demandes) — « interne » par défaut. */
    type?: string;
    /** Statut initial — « a_qualifier » pour un rattachement ambigu. */
    statut?: Database["public"]["Enums"]["tache_statut"];
    priorite?: Database["public"]["Enums"]["tache_priorite"];
    assignee_id?: string | null;
    created_by?: string | null;
    /** Décalage de l'échéance en jours (0 = aujourd'hui, par défaut). */
    echeance_jours?: number;
    /** Clé métier unique empêchant la création de doublons. */
    idempotency_key?: string | null;
    /** Événement/règle ayant déclenché la tâche. */
    source?: string | null;
    source_event_id?: string | null;
    resultat_attendu?: string | null;
  },
): Promise<string | null> {
  try {
    const source = params.source ?? "agent";
    if (!params.idempotency_key && !SOURCES_MANUELLES.has(source)) {
      console.warn(
        `[agent-taches] tâche automatique sans idempotency_key (source « ${source} ») — risque de doublon : ${params.titre.slice(0, 120)}`,
      );
    }
    if (params.idempotency_key) {
      const { data: existing } = await (admin as any)
        .from("taches")
        .select("id")
        .eq("idempotency_key", params.idempotency_key)
        .maybeSingle();
      if (existing?.id) return existing.id as string;
    }

    const assignee = params.assignee_id ?? (await adminParDefaut(admin));
    const echeance = new Date();
    echeance.setDate(echeance.getDate() + Math.max(0, Math.min(180, params.echeance_jours ?? 0)));
    const { data, error } = await admin
      .from("taches")
      .insert({
        titre: params.titre.slice(0, 300),
        description: params.description?.slice(0, 4000) ?? null,
        client_id: params.client_id ?? null,
        dossier_id: params.dossier_id ?? null,
        type: params.type ?? "interne",
        priorite: params.priorite ?? "haute",
        statut: params.statut ?? "a_faire",
        assignee_id: assignee,
        created_by: params.created_by ?? assignee,
        echeance: echeance.toISOString().slice(0, 10),
        idempotency_key: params.idempotency_key ?? null,
        source: params.source ?? "agent",
        source_event_id: params.source_event_id ?? null,
        resultat_attendu: params.resultat_attendu ?? null,
        cree_par_agent: true,
        orchestration_version: 1,
      } as any)
      .select("id")
      .maybeSingle();

    if (error) {
      if (params.idempotency_key && error.code === "23505") {
        const { data: existing } = await (admin as any)
          .from("taches")
          .select("id")
          .eq("idempotency_key", params.idempotency_key)
          .maybeSingle();
        return (existing as { id: string } | null)?.id ?? null;
      }
      throw new Error(error.message);
    }
    return (data as { id: string } | null)?.id ?? null;
  } catch (e) {
    console.error("[agent-commercial] création de tâche impossible", e);
    return null;
  }
}

