/**
 * Lot G — moteur de séquences/relances webinaire (serveur).
 *   Alimente la file d'envoi existante (public.emails_planifies, traitée par
 *   envoyerEmailsDus via le cron) à partir des séquences CONFIGURÉES sur chaque
 *   webinaire (webinaires.emails_config.sequences). Aucun contenu de séquence
 *   n'est inventé : si la config est vide, rien n'est planifié.
 *
 *   Idempotent : idempotency_key = webinaire-seq:<participant>:<step> (la file
 *   ignore les doublons). Les participants ayant atteint l'objectif (arretSi) ou
 *   désinscrits (événement Brevo) sont exclus.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { type FunnelEtape, doitPlanifierStep, lireSequences } from "./webinaires";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, any, any>;

const COLONNE_AT: Record<FunnelEtape, string> = {
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

const SELECT_PARTICIPANT =
  "id,email,etape_courante,inscription_at,presence_at,clic_at,formulaire_debut_at," +
  "formulaire_fin_at,etude_at,fic_at,signature_at,contrat_at,ca_at," +
  "webinaire_sessions:session_id(id, webinaires:webinaire_id(emails_config))";

export async function planifierSequencesWebinaire(
  admin: Admin,
  maintenant: Date = new Date(),
): Promise<{ examines: number; planifies: number }> {
  const { data: participants } = await admin
    .from("webinaire_participants")
    .select(SELECT_PARTICIPANT)
    .limit(2000);

  // Emails désinscrits (exclus des relances).
  const { data: desabo } = await admin
    .from("brevo_evenements")
    .select("email")
    .ilike("type", "%unsub%");
  const desabonnes = new Set<string>(((desabo as { email: string | null }[]) ?? []).map((d) => d.email ?? "").filter(Boolean));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lignes: any[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const p of ((participants as any[]) ?? [])) {
    if (!p.email || desabonnes.has(p.email)) continue;
    const emailsConfig = p.webinaire_sessions?.webinaires?.emails_config;
    const steps = lireSequences(emailsConfig);
    for (const step of steps) {
      if (!doitPlanifierStep(p.etape_courante, step)) continue;
      const declencheurAt = p[COLONNE_AT[step.declencheur]] as string | null;
      if (!declencheurAt) continue; // pas d'horodatage du déclencheur → on ne planifie pas
      const envoyerLe = new Date(new Date(declencheurAt).getTime() + step.delaiHeures * 3_600_000);
      // On ne (re)planifie pas dans le passé lointain : si déjà dû, envoyer au prochain passage.
      const envoyerLeIso = (envoyerLe.getTime() < maintenant.getTime() ? maintenant : envoyerLe).toISOString();
      lignes.push({
        lot: "webinaire-sequences",
        template: step.template,
        destinataire: p.email,
        donnees: { participant_id: p.id, etape_declencheur: step.declencheur, step: step.cle },
        contexte: { source: "webinaire-sequences", session_id: p.webinaire_sessions?.id ?? null },
        idempotency_key: `webinaire-seq:${p.id}:${step.cle}`,
        envoyer_le: envoyerLeIso,
        statut: "en_attente",
      });
    }
  }

  if (lignes.length > 0) {
    const { error } = await admin
      .from("emails_planifies")
      .upsert(lignes as never, { onConflict: "idempotency_key", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  }

  return { examines: (participants as unknown[])?.length ?? 0, planifies: lignes.length };
}
