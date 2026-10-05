import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/** Automatismes communs exécutés après la création d'une nouvelle fiche client. */
export async function lancerAutomatisationsNouveauClient(
  admin: SupabaseClient<Database>,
  client: { id: string; nom: string; prenom?: string | null },
): Promise<void> {
  const { lancerLcbAutomatique } = await import("@/lib/dossier-automation.server");
  await lancerLcbAutomatique(admin, {
    client_id: client.id,
    nom: client.nom,
    prenom: client.prenom ?? null,
  });

  const { synchroniserContactBrevoSansEchec } = await import("@/lib/brevo-listes.server");
  await synchroniserContactBrevoSansEchec(admin as never, client.id);

  const { assurerArborescenceClientSansEchec } = await import("@/lib/drive-arborescence.server");
  await assurerArborescenceClientSansEchec(admin as never, client.id);
}
