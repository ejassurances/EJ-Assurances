import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/**
 * NOTIFICATION OBLIGATOIRE DES ACTIONS DE L'AGENT (règle DG, CD-SI-001-B).
 *
 * Toute action de l'agent sur un dossier ou une fiche client existante
 * (rattachement, ajout de pièce, mise à jour de statut) DOIT produire une
 * notification visible : aucune modification silencieuse n'est acceptée, même
 * lorsque l'agent est certain de son rattachement.
 *
 * La notification prend la forme d'une tâche (file de travail du cabinet).
 * Idempotence : une seule tâche par (action, message Gmail).
 */

type Admin = SupabaseClient<Database>;

export async function notifierActionAgent(
  admin: Admin,
  params: {
    /** Message Gmail à l'origine de l'action (clé d'idempotence). */
    gmail_message_id: string;
    titre: string;
    lignes: (string | null | undefined)[];
    client_id?: string | null;
    /** Dossier probable : la notification apparaît aussi sur sa fiche. */
    dossier_id?: string | null;
    /** Statut initial : « a_qualifier » pour un rattachement ambigu. */
    statut?: Database["public"]["Enums"]["tache_statut"];
    type?: string;
    priorite?: Database["public"]["Enums"]["tache_priorite"];
    created_by: string;
  },
): Promise<boolean> {
  const titre = params.titre.slice(0, 200);
  const { data: deja } = await admin
    .from("taches")
    .select("id, description")
    .eq("titre", titre)
    .limit(50);
  if ((deja ?? []).some((t) => (t.description ?? "").includes(params.gmail_message_id))) return false;

  const { creerTacheAdmin } = await import("@/lib/agent-taches.server");
  const cree = await creerTacheAdmin(admin, {
    titre,
    description: [
      ...params.lignes.filter((l): l is string => !!l),
      `Email : https://mail.ionos.fr/`,
      `Identifiant Gmail : ${params.gmail_message_id}`,
    ].join("\n"),
    client_id: params.client_id ?? null,
    dossier_id: params.dossier_id ?? null,
    statut: params.statut,
    type: params.type ?? "interne",
    priorite: params.priorite ?? "normale",
    created_by: params.created_by,
  });
  return !!cree;
}

