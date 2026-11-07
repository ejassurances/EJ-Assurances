import type { SupabaseClient } from "@supabase/supabase-js";
import { STATUTS_DOSSIER_AVANT_LM } from "./referentiels";
import { createHash } from "node:crypto";
import { sendTemplateEmail } from "@/lib/email-templates/send-email";
import { SITE } from "@/lib/site";
import { appUrl } from "@/lib/app-url";
import { envoyerIntroEspaceClientSiReconstitue } from "@/lib/espace-client-intro.server";

/**
 * Création + envoi de la lettre de mission — logique partagée entre l'envoi
 * manuel (bouton dossier) et le déclenchement automatique post-recueil.
 */
export async function envoyerLettreMission(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  dossierId: string,
  userId: string,
  origin: string,
) {
  const { data: dossier, error: dErr } = await supabase
    .from("dossiers")
    .select("*")
    .eq("id", dossierId)
    .maybeSingle();
  if (dErr || !dossier) throw new Error("Dossier introuvable ou accès refusé");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = dossier as any;
  if (!d.client_email)
    throw new Error("Le dossier n'a pas d'email client — renseignez-le d'abord.");

  const contenu = {
    cabinet: {
      nom: SITE.name,
      shortName: SITE.shortName,
      siret: SITE.siret,
      orias: SITE.orias,
      adresse: SITE.address,
      telephone: SITE.phone,
      email: SITE.email,
    },
    client: {
      nom: d.client_nom,
      email: d.client_email,
      telephone: d.client_phone,
    },
    dossier: {
      reference: d.reference,
      type_assurance: d.type_assurance,
    },
    recueil_besoins: d.recueil_besoins ?? {},
    genere_le: new Date().toISOString(),
  };

  const hash = createHash("sha256").update(JSON.stringify(contenu)).digest("hex");

  // Une seule lettre « vivante » par dossier
  const { data: existing } = await supabase
    .from("lettres_mission")
    .select("id, statut")
    .eq("dossier_id", dossierId)
    .neq("statut", "annulee")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let lettreId: string;
  if (existing && existing.statut !== "signee") {
    const { error: upErr } = await supabase
      .from("lettres_mission")
      .update({
        contenu,
        document_hash: hash,
        type_assurance: d.type_assurance,
        client_id: d.client_id,
        email_destinataire: d.client_email,
        envoye_le: new Date().toISOString(),
        envoye_par: userId,
        statut: "envoyee",
      })
      .eq("id", existing.id);
    if (upErr) throw new Error(upErr.message);
    lettreId = existing.id;
  } else {
    const { data: inserted, error: insErr } = await supabase
      .from("lettres_mission")
      .insert({
        dossier_id: dossierId,
        client_id: d.client_id,
        type_assurance: d.type_assurance,
        contenu,
        document_hash: hash,
        statut: "envoyee",
        email_destinataire: d.client_email,
        envoye_le: new Date().toISOString(),
        envoye_par: userId,
        created_by: userId,
      })
      .select("id")
      .single();
    if (insErr || !inserted) throw new Error(insErr?.message ?? "Erreur création lettre");
    lettreId = inserted.id;
  }

  // Dossiers reconstitués a posteriori : e-mail d'introduction « mise en place
  // de l'espace client » juste avant l'envoi de la lettre de mission.
  await envoyerIntroEspaceClientSiReconstitue(supabase, d);

  const result = await sendTemplateEmail("lettre-mission-envoi", d.client_email, {
    templateData: {
      clientName: d.client_nom,
      cabinetName: SITE.shortName,
      reference: d.reference,
      link: appUrl("/espace/signer-lettre-mission"),
    },
    replyTo: SITE.email,
    liens: { client_id: d.client_id ?? null, dossier_id: dossierId },
  });
  if (!result.sent) throw new Error("Adresse en liste de suppression — envoi refusé");

  // Statut du dossier : lettre envoyée, en attente de signature
  await supabase.from("dossiers").update({ statut: "lettre_mission_envoyee" }).eq("id", dossierId);
  if (d.client_id) {
    await supabase
      .from("clients")
      .update({ dda_statut: "en_attente_signature" })
      .eq("id", d.client_id);
  }

  return { id: lettreId };
}

/**
 * Date de référence du DER pour le délai fixe de 8 h avant la lettre de
 * mission : signature du DER si elle existe, sinon date d'envoi.
 */
export async function dateReferenceDer(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  clientId: string | null,
): Promise<string | null> {
  if (!clientId) return null;
  const { data } = await supabase
    .from("client_der_envois")
    .select("signed_at, envoye_le, created_at")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = data as any;
  return d ? (d.signed_at ?? d.envoye_le ?? null) : null;
}

/**
 * Job planifié : envoie les lettres de mission dont le délai fixe de 8 h après
 * le DER est écoulé (dossiers encore en amont de la lettre de mission).
 */
export async function envoyerLettresMissionDues(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  limite = 30,
): Promise<{ envoyees: number; reportees: number; echecs: number }> {
  const { etatDelaiLettreMission } = await import("./lettre-mission-delai");
  const { identiteTechnique } = await import("./agent-taches.server");
  const { APP_URL } = await import("./app-url");

  const { data, error } = await supabase
    .from("dossiers")
    .select("id, client_id, client_email, reference, statut, recueil_besoins")
    .in("statut", [...STATUTS_DOSSIER_AVANT_LM])
    .not("client_email", "is", null)
    // Filtré en base : des dossiers sans recueil ne doivent pas occuper le lot.
    .not("recueil_besoins", "is", null)
    .order("created_at", { ascending: true })
    .limit(limite);
  if (error) throw new Error(error.message);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const identite = await identiteTechnique(supabase as any);
  let envoyees = 0;
  let reportees = 0;
  let echecs = 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const d of (data ?? []) as any[]) {
    try {
      // La lettre de mission reprend le recueil des besoins : pas d'envoi tant
      // qu'il n'a pas été transmis (client ou cabinet).
      const recueil = d.recueil_besoins as Record<string, unknown> | null;
      if (!recueil || Object.keys(recueil).length === 0) {
        reportees += 1;
        continue;
      }
      // Une lettre déjà vivante (envoyée ou signée) : rien à faire.
      const { data: lm } = await supabase
        .from("lettres_mission")
        .select("id")
        .eq("dossier_id", d.id)
        .neq("statut", "annulee")
        .limit(1)
        .maybeSingle();
      if (lm) continue;

      const derLe = await dateReferenceDer(supabase, d.client_id ?? null);
      const etat = etatDelaiLettreMission(derLe);
      if (!etat.autorise) {
        reportees += 1;
        continue;
      }
      await envoyerLettreMission(supabase, d.id, identite?.userId ?? d.created_by ?? "", APP_URL);
      envoyees += 1;
    } catch (e) {
      echecs += 1;
      console.error("[lettre-mission] envoi différé impossible", d.reference, e);
    }
  }

  return { envoyees, reportees, echecs };
}
