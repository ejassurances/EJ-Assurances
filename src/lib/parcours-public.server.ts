import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Admin = SupabaseClient<Database>;

/**
 * Parcours « demande d'étude depuis le site public » (décision Erwan 07/11 :
 * le prospect passe par l'espace client du CRM).
 *
 * `submit_public_intake` (base) crée la fiche, le dossier EMP et met en file
 * l'e-mail `public-intake-recueil`. Au moment d'envoyer cet e-mail, le CRM :
 * 1. crée l'espace client (identifiants provisoires + DER réglementaire) ;
 * 2. lance le contrôle LCB-FT automatique (OpenSanctions). Sans date de
 *    naissance, une trace « en attente d'informations » est posée ; le contrôle
 *    complet est relancé quand le recueil est envoyé.
 * Ne lève jamais : retourne le motif d'échec pour que l'e-mail ne parte pas
 * vers un espace inexistant.
 */
export async function preparerEspaceParcoursPublic(
  admin: Admin,
  contexte: { client_id?: string | null },
): Promise<{ ok: boolean; erreur?: string }> {
  const clientId = contexte.client_id ?? null;
  if (!clientId) return { ok: false, erreur: "Demande sans fiche client rattachée" };

  const { data: client, error } = await admin
    .from("clients")
    .select("id, nom, prenom, email")
    .eq("id", clientId)
    .maybeSingle();
  if (error || !client) return { ok: false, erreur: "Fiche client introuvable" };
  if (!client.email) return { ok: false, erreur: "Fiche client sans e-mail" };

  const { creerEspaceClient, lancerLcbAutomatique } =
    await import("@/lib/dossier-automation.server");
  const { APP_URL } = await import("@/lib/app-url");

  const espace = await creerEspaceClient(admin, {
    client_id: client.id,
    email: client.email,
    nom: client.nom,
    prenom: client.prenom,
    origin: APP_URL,
  });
  // Compte déjà existant : l'accès est rattaché, le client utilise ses identifiants actuels.
  if (!espace.created && !espace.user_id) {
    return { ok: false, erreur: espace.email_error ?? "Espace client non créé" };
  }

  await lancerLcbAutomatique(admin, {
    client_id: client.id,
    nom: client.nom,
    prenom: client.prenom,
  });
  return { ok: true };
}
