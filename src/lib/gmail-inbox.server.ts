/**
 * Réception et classement de la boîte de réception IONOS.
 *
 * Server-only. Chaîne de traitement, pour chaque message de l'onglet Principal
 * (lu ou non lu, hors Promotions / Réseaux sociaux / Notifications / Forums) :
 *
 *  1. enregistrement dans `crm_emails` (anti-doublon sur l'identifiant IONOS) ;
 *  2. attente stricte de 45 minutes après la réception ;
 *  3. vérification d'une réponse du cabinet déjà envoyée dans le fil ;
 *  4. rattachement à une fiche CRM (client, prospect, partenaire, fournisseur,
 *     prescripteur) — jamais deviné quand plusieurs correspondances existent ;
 *  5. classement dans l'un des trois états :
 *     01_Brouillon_IA_A_Relire / 02_Alerte_Humain_A_Traiter / 03_Archives_Traitees ;
 *  6. trace de la décision dans `email_decisions`.
 *
 * AUCUN ENVOI n'est réalisé ici. Le brouillon reste un brouillon IONOS.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { classerBesoinReponse } from "@/lib/besoin-reponse";
import {
  classerEmail,
  delaiEcoule,
  lienGmailMessage,
  LABEL_ALERTE,
  type ClassementEmail,
} from "@/lib/gmail-inbox";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, any, any>;

/** Sujets qui restent toujours en validation humaine. */
const SENSIBLE =
  /(sinistre|reclamation|réclamation|resiliation|résiliation|mise en demeure|deces|décès|avocat|huissier|litige|cnil|rgpd|arret de travail|arrêt de travail|invalidite|invalidité|incapacite|incapacité|mediateur|médiateur|acpr)/i;

export interface ResultatTraitementInbox {
  lus: number;
  enregistres: number;
  en_attente_delai: number;
  brouillons: number;
  alertes: number;
  archives: number;
  ignores_deja_traites: number;
  pieces_deposees: number;
  pieces_a_classer: number;
}

interface Rattachement {
  client_id: string | null;
  compagnie_id: string | null;
  certain: boolean;
  motif: string;
}

/**
 * Cherche la fiche CRM correspondant à l'expéditeur. Plusieurs correspondances
 * possibles ⇒ rattachement NON certain (le message part en alerte humaine).
 */
async function rattacher(admin: Admin, email: string | null): Promise<Rattachement> {
  const vide: Rattachement = { client_id: null, compagnie_id: null, certain: false, motif: "Expéditeur inconnu" };
  if (!email) return vide;

  const [clients, compagnies, fournisseurs, prescripteurs] = await Promise.all([
    admin.from("clients").select("id").eq("email", email).limit(3),
    admin
      .from("compagnies")
      .select("id")
      .or(`contact_email.eq.${email},email_reclamations.eq.${email}`)
      .limit(3),
    admin.from("fournisseurs").select("id").eq("email", email).limit(3),
    admin.from("prescripteurs").select("id").eq("email", email).limit(3),
  ]);

  const nbClients = clients.data?.length ?? 0;
  const nbCompagnies = compagnies.data?.length ?? 0;
  const nbFournisseurs = fournisseurs.data?.length ?? 0;
  const nbPrescripteurs = prescripteurs.data?.length ?? 0;
  const total = nbClients + nbCompagnies + nbFournisseurs + nbPrescripteurs;

  if (total === 0) return { ...vide, motif: "Aucune fiche CRM ne correspond à cet expéditeur" };
  if (total > 1) {
    return {
      client_id: null,
      compagnie_id: null,
      certain: false,
      motif: `Plusieurs fiches CRM possibles (${total}) : rattachement non automatique`,
    };
  }
  if (nbClients === 1) {
    return { client_id: clients.data![0]!.id as string, compagnie_id: null, certain: true, motif: "Fiche client" };
  }
  if (nbCompagnies === 1) {
    return {
      client_id: null,
      compagnie_id: compagnies.data![0]!.id as string,
      certain: true,
      motif: "Fiche partenaire assureur",
    };
  }
  // Fournisseur ou prescripteur : fiche identifiée, mais aucune colonne de
  // rattachement dédiée sur l'historique des emails — validation humaine.
  return {
    client_id: null,
    compagnie_id: null,
    certain: false,
    motif: nbFournisseurs === 1 ? "Fournisseur identifié : rattachement à confirmer" : "Prescripteur identifié : rattachement à confirmer",
  };
}

/** Trace la décision (historique de l'écran de contrôle). */
async function tracerDecision(
  admin: Admin,
  params: {
    crm_email_id: string;
    gmail_message_id: string;
    classement: ClassementEmail;
    confiance: number | null;
    par: string | null;
  },
): Promise<void> {
  const { error } = await admin.from("email_decisions").insert({
    crm_email_id: params.crm_email_id,
    gmail_message_id: params.gmail_message_id,
    decision: params.classement.decision,
    origine: "automatique",
    motif: params.classement.motif,
    confiance: params.confiance,
    label_gmail: params.classement.label,
    par: params.par,
  } as never);
  if (error) console.error("[gmail-inbox] décision non tracée", error.message);
}

/**
 * Passage complet sur la boîte de réception principale. Idempotent : un message
 * déjà traité (statut différent de « a_traiter ») est ignoré.
 */
export async function traiterInboxPrincipale(
  admin: Admin,
  userId: string | null,
  options?: { maxResults?: number; limite?: number; maintenant?: Date },
): Promise<ResultatTraitementInbox> {
  const maintenant = options?.maintenant ?? new Date();
  const res: ResultatTraitementInbox = {
    lus: 0,
    enregistres: 0,
    en_attente_delai: 0,
    brouillons: 0,
    alertes: 0,
    archives: 0,
    ignores_deja_traites: 0,
    pieces_deposees: 0,
    pieces_a_classer: 0,
  };

  const { listerInboxPrincipale, lireMessage, reponseCabinetPosterieure, classerInbox, creerBrouillon } =
    await import("@/lib/gmail.server");

  const { messages } = await listerInboxPrincipale({ maxResults: options?.maxResults ?? 25 });
  res.lus = messages.length;
  const limite = Math.max(1, Math.min(options?.limite ?? 10, 30));
  let traites = 0;

  for (const m of messages) {
    if (traites >= limite) break;

    // 1. Enregistrement (anti-doublon sur l'identifiant du message IONOS).
    const { data: existant } = await admin
      .from("crm_emails")
      .select("id, statut_traitement")
      .eq("gmail_message_id", m.id)
      .maybeSingle();

    let ligneId = (existant as { id?: string } | null)?.id ?? null;
    const statut = (existant as { statut_traitement?: string } | null)?.statut_traitement ?? null;
    if (ligneId && statut && statut !== "a_traiter") {
      res.ignores_deja_traites += 1;
      continue;
    }

    const recuLe = m.date ? new Date(m.date) : null;
    if (!ligneId) {
      const { data: cree, error } = await admin
        .from("crm_emails")
        .insert({
          gmail_message_id: m.id,
          gmail_thread_id: m.thread_id,
          recu_le: recuLe ? recuLe.toISOString() : null,
          expediteur_email: m.expediteur_email,
          expediteur_nom: m.expediteur_nom,
          sujet: m.sujet,
          lien_gmail: lienGmailMessage(m.id),
          statut_traitement: "a_traiter",
          created_by: userId,
        } as never)
        .select("id")
        .maybeSingle();
      if (error || !cree) {
        console.error("[gmail-inbox] enregistrement impossible", error?.message);
        continue;
      }
      ligneId = (cree as { id: string }).id;
      res.enregistres += 1;
    }

    // 2. Délai strict de 45 minutes après réception.
    if (!recuLe || !delaiEcoule(recuLe, maintenant)) {
      res.en_attente_delai += 1;
      continue;
    }

    traites += 1;

    // 3. Réponse du cabinet déjà envoyée dans le fil ?
    const dejaRepondu = await reponseCabinetPosterieure(m.thread_id, m.id);

    // 4. Analyse du contenu et rattachement CRM. Le message est toujours lu :
    // les pièces jointes doivent être traitées même si une réponse existe déjà.
    const detail = await lireMessage(m.id).catch(() => null);
    const besoin = classerBesoinReponse({
      sujet: m.sujet,
      texte: detail?.texte ?? m.snippet,
      expediteur_email: m.expediteur_email,
      pieces_jointes: detail?.pieces_jointes.length ?? 0,
    });
    const lien = await rattacher(admin, m.expediteur_email);
    const confiance = dejaRepondu ? 1 : besoin.categorie === "ambigu" ? 0.3 : lien.certain ? 0.9 : 0.5;

    let classement = classerEmail({
      reponseDejaEnvoyee: dejaRepondu,
      reponseNecessaire: besoin.categorie === "reponse_attendue",
      rattachementCertain: lien.certain,
      sensible: SENSIBLE.test(`${m.sujet ?? ""} ${detail?.texte ?? m.snippet ?? ""}`),
      comprehensible: besoin.categorie !== "ambigu",
      confiance,
    });

    // 4 bis. Pièces jointes : lecture, dépôt et rattachement au bon client /
    // dossier / contrat. Une pièce dont le titulaire n'est pas certain est
    // déposée « à classer » et le message part obligatoirement en alerte
    // humaine (jamais de rattachement deviné, jamais de doublon).
    const pieces = detail?.pieces_jointes.filter((p) => p.attachment_id) ?? [];
    if (pieces.length > 0 && userId) {
      try {
        const { traiterPiecesJointesPartenaire } = await import("@/lib/pieces-partenaire.server");
        const bilan = await traiterPiecesJointesPartenaire(admin, {
          gmail_message_id: m.id,
          sujet: m.sujet,
          texte: detail?.texte ?? m.snippet ?? null,
          compagnie: null,
          pieces_jointes: pieces,
          userId,
        });
        res.pieces_deposees += bilan.traitees;
        res.pieces_a_classer += bilan.a_classer;
        if (bilan.a_classer > 0) {
          classement = {
            decision: "alerte_humain",
            label: LABEL_ALERTE,
            motif: `${bilan.a_classer} pièce(s) jointe(s) sans rattachement certain : à qualifier par un humain.`,
          };
        }
      } catch (e) {
        console.error("[gmail-inbox] pièces jointes non traitées", e);
        classement = {
          decision: "alerte_humain",
          label: LABEL_ALERTE,
          motif: "Pièces jointes non traitées : vérification humaine nécessaire.",
        };
      }
    }


    // 5. Brouillon IONOS si une réponse est nécessaire (jamais d'envoi).
    let brouillonId: string | null = null;
    let lienBrouillon: string | null = null;
    if (classement.decision === "brouillon_a_relire" && m.expediteur_email) {
      try {
        const brouillon = await creerBrouillon({
          to: m.expediteur_email,
          sujet: m.sujet.startsWith("Re:") ? m.sujet : `Re: ${m.sujet}`,
          html:
            `<p>Bonjour,</p><p>Nous avons bien reçu votre message et revenons vers vous.</p>` +
            `<p>— EJ Partners Assurances</p>` +
            `<!-- brouillon préparé automatiquement, à relire et compléter avant envoi -->`,
          threadId: m.thread_id,
        });
        brouillonId = brouillon.id;
        lienBrouillon = brouillon.lien;
      } catch (e) {
        console.error("[gmail-inbox] brouillon non créé", e);
      }
    }

    // 6. Classement IMAP + trace CRM.
    try {
      await classerInbox(m.id, classement.label);
    } catch (e) {
      console.error(`[ionos-inbox] classement IONOS impossible sur ${m.id}`, e);
    }

    await admin
      .from("crm_emails")
      .update({
        client_id: lien.client_id,
        compagnie_id: lien.compagnie_id,
        decision: classement.decision,
        motif: `${classement.motif} ${lien.motif}`.trim(),
        confiance,
        label_gmail: classement.label,
        brouillon_id: brouillonId,
        lien_brouillon: lienBrouillon,
        statut_traitement: classement.decision === "brouillon_a_relire" ? "brouillon" : classement.decision === "alerte_humain" ? "alerte" : "archive",
        traite_le: new Date().toISOString(),
      } as never)
      .eq("id", ligneId);

    await tracerDecision(admin, {
      crm_email_id: ligneId,
      gmail_message_id: m.id,
      classement,
      confiance,
      par: userId,
    });

    if (classement.decision === "brouillon_a_relire") res.brouillons += 1;
    else if (classement.decision === "alerte_humain") res.alertes += 1;
    else res.archives += 1;
  }

  return res;
}
