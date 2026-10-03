/**
 * Lot G — alimentation du funnel webinaire (serveur, lecture/écriture).
 *   - Enregistrement idempotent des événements Brevo (public.brevo_evenements).
 *   - Avancement « vers l'avant uniquement » d'un participant dans le funnel.
 * Aucune règle métier inventée : les étapes viennent du référentiel validé
 * (src/lib/webinaires.ts) et un clic Brevo ne fait qu'avancer jusqu'à « clic ».
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { type FunnelEtape, peutAvancerVers } from "./webinaires";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, any, any>;

export type BrevoEvent = {
  event: string;
  email?: string | null;
  campagne?: string | null;
  messageId?: string | null;
  eventUid: string;
  payload: unknown;
};

const COLONNE_ETAPE: Record<FunnelEtape, string> = {
  inscription: "inscription_at",
  presence: "presence_at",
  clic: "clic_at",
  formulaire_debut: "formulaire_debut_at",
  formulaire_fin: "formulaire_fin_at",
  etude: "etude_at",
  fic: "fic_at",
  signature: "signature_at",
  contrat: "contrat_at",
  ca: "ca_at",
};

/**
 * Avance un participant jusqu'à `cible` (jamais en arrière). Pose l'horodatage
 * de l'étape et met à jour etape_courante si la cible est plus avancée.
 */
export async function avancerFunnel(
  admin: Admin,
  participantId: string,
  cible: FunnelEtape,
): Promise<void> {
  const { data } = await admin
    .from("webinaire_participants")
    .select("etape_courante")
    .eq("id", participantId)
    .maybeSingle();
  if (!data) return;

  const actuelle = data.etape_courante as FunnelEtape;
  const patch: Record<string, unknown> = {
    [COLONNE_ETAPE[cible]]: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (peutAvancerVers(actuelle, cible)) patch.etape_courante = cible;

  await admin.from("webinaire_participants").update(patch).eq("id", participantId);
}

/**
 * Enregistre un événement Brevo de façon idempotente (clé event_uid) et, pour un
 * clic, avance le participant correspondant (par email) jusqu'à l'étape « clic ».
 * Renvoie true si l'événement est nouveau, false s'il était déjà connu.
 */
export async function enregistrerEvenementBrevo(admin: Admin, ev: BrevoEvent): Promise<boolean> {
  // Idempotence : upsert sur event_uid, on détecte la nouveauté via le retour.
  const { data: deja } = await admin
    .from("brevo_evenements")
    .select("id")
    .eq("event_uid", ev.eventUid)
    .maybeSingle();
  if (deja) return false;

  // Rattachement best-effort à un participant par email (le plus récent).
  let participantId: string | null = null;
  if (ev.email) {
    const { data: part } = await admin
      .from("webinaire_participants")
      .select("id")
      .eq("email", ev.email)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    participantId = part?.id ?? null;
  }

  const { error } = await admin.from("brevo_evenements").insert({
    event_uid: ev.eventUid,
    type: ev.event,
    email: ev.email ?? null,
    campagne: ev.campagne ?? null,
    message_id: ev.messageId ?? null,
    participant_id: participantId,
    payload: ev.payload as never,
  });
  // Course possible entre le check et l'insert : on tolère la violation d'unicité.
  if (error && !/duplicate key|unique/i.test(error.message)) throw new Error(error.message);

  // Un clic Brevo fait avancer le participant jusqu'à l'étape « clic ».
  if (participantId && /click|clic/i.test(ev.event)) {
    await avancerFunnel(admin, participantId, "clic");
  }

  return !error;
}
