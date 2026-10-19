/**
 * AGENT DE RÉPONSE AUTONOME (gestion commerciale, administrative, financière).
 *
 * Rédige et programme la réponse aux emails de gestion courante — clients,
 * partenaires, fournisseurs, demandes de partenariat — SANS validation humaine,
 * dans le strict respect de deux garde-fous :
 *
 *  1. barrière réglementaire ACPR / DDA (`actes-reglementaires.ts`) : tout acte
 *     de distribution, de conseil, d'engagement, de résiliation, de sinistre ou
 *     de réclamation reste en validation humaine ;
 *  2. heures d'ouverture centralisées + délai métier persistant de 45 minutes
 *     (`heures-ouverture.ts`), la sortie étant programmée dans
 *     `emails_planifies` et donc annulable si un humain reprend la main.
 *
 * L'envoi effectif est réalisé par le job existant `/api/public/envois-planifies`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { IntentionEmail } from "@/lib/email-intention-types";
import { geminiFetch } from "@/lib/gemini-gateway.server";
import { autorisationReponseAutonome, type CanalReponse } from "@/lib/actes-reglementaires";
import { prochaineSortieAutorisee } from "@/lib/heures-ouverture";
import { classerBesoinReponse } from "@/lib/besoin-reponse";


type Admin = SupabaseClient<Database>;

const CABINET = "EJ Partners Assurances";
const MODELE = "gemini-3.6-flash";

export interface DemandeReponseAutonome {
  canal: CanalReponse;
  gmail_message_id: string;
  /** Fil Gmail : sert à vérifier qu'aucune réponse du cabinet n'existe déjà. */
  gmail_thread_id?: string | null;
  destinataire: string | null;
  /** Nom affiché du correspondant (client, partenaire, fournisseur). */
  correspondant: string;
  sujet: string | null;
  texte: string | null;
  intention?: IntentionEmail | null;
  confiance?: number | null;
  recu_le?: string | null;
  /** Nombre de pièces jointes reçues (entre dans le besoin de réponse). */
  pieces_jointes?: number;
  /** Éléments factuels vérifiés du CRM que la réponse peut citer. */
  faits?: { libelle: string; valeur: string }[];
  liens?: { client_id?: string | null; dossier_id?: string | null; contrat_id?: string | null; compagnie_id?: string | null };
}

export interface ResultatReponseAutonome {
  planifiee: boolean;
  /** Brouillon en attente de validation humaine (aucun envoi programmé). */
  brouillon?: boolean;
  motif: string;
  envoyer_le?: string;
  titre?: string;
}


/** Rédaction du corps de la réponse par l'IA, à partir des seuls faits fournis. */
async function redigerReponse(d: DemandeReponseAutonome): Promise<{ titre: string; paragraphes: string[] } | null> {
  const cle = process.env["GEMINI_API_KEY"];
  if (!cle) return null;

  const consignes = [
    `Tu rédiges, au nom du cabinet de courtage ${CABINET}, la réponse à un email de gestion courante.`,
    "Style : français professionnel, vouvoiement, concis, factuel, aucune formule commerciale excessive.",
    "INTERDICTIONS ABSOLUES : aucun conseil personnalisé, aucun tarif, aucun devis, aucune garantie chiffrée,",
    "aucun engagement contractuel, aucune promesse de délai ferme, aucune donnée de santé.",
    "Tu n'affirmes JAMAIS un fait qui ne figure pas dans les éléments vérifiés fournis.",
    "Si une information manque, tu indiques simplement qu'elle est en cours de traitement par le cabinet.",
    "Format de sortie : la première ligne est l'objet court (sans préfixe), puis une ligne vide,",
    "puis 1 à 3 paragraphes séparés par une ligne vide. Aucune signature, aucune salutation finale.",
  ].join(" ");

  const contexte = [
    `Canal : ${d.canal}`,
    `Correspondant : ${d.correspondant}`,
    `Objet reçu : ${d.sujet ?? "(sans objet)"}`,
    `Message reçu :\n${(d.texte ?? "").slice(0, 6000)}`,
    d.faits?.length
      ? `Éléments vérifiés du CRM :\n${d.faits.map((f) => `- ${f.libelle} : ${f.valeur}`).join("\n")}`
      : "Éléments vérifiés du CRM : aucun.",
  ].join("\n\n");

  const res = await geminiFetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cle}`,
    },
    body: JSON.stringify({
      model: MODELE,
      messages: [
        { role: "system", content: consignes },
        { role: "user", content: contexte },
      ],
    }),
  });
  if (!res.ok) {
    console.error("[reponse-autonome] rédaction impossible", res.status, await res.text().catch(() => ""));
    return null;
  }

  const completion = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const texte = completion.choices?.[0]?.message?.content ?? "";

  const blocs = texte
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);
  if (blocs.length === 0) return null;
  const titre = (blocs.shift() ?? "Votre demande").replace(/^objet\s*:\s*/i, "").slice(0, 160);
  const paragraphes = blocs.length ? blocs : ["Nous avons bien reçu votre message et le traitons."];
  return { titre, paragraphes };
}

/**
 * Programme la réponse autonome si — et seulement si — la barrière
 * réglementaire l'autorise. Ne lève jamais : retourne le motif du refus.
 */
export async function planifierReponseAutonome(
  admin: Admin,
  d: DemandeReponseAutonome,
): Promise<ResultatReponseAutonome> {
  try {
    if (!d.destinataire) return { planifiee: false, motif: "Adresse du correspondant inconnue" };

    const autorisation = autorisationReponseAutonome({
      canal: d.canal,
      intention: d.intention ?? null,
      confiance: d.confiance ?? null,
      sujet: d.sujet,
      texte: d.texte,
    });
    if (!autorisation.autorise) return { planifiee: false, motif: autorisation.motif };

    // 1. AUCUN MAIL SI LE CABINET A DÉJÀ RÉPONDU DANS LE FIL (règle DG).
    //    En cas de fil illisible, la fonction renvoie `true` : on n'envoie pas.
    if (d.gmail_thread_id) {
      const { reponseCabinetPosterieure } = await import("@/lib/gmail.server");
      const dejaRepondu = await reponseCabinetPosterieure(d.gmail_thread_id, d.gmail_message_id);
      if (dejaRepondu) {
        return { planifiee: false, motif: "Le cabinet a déjà répondu dans ce fil — aucun envoi" };
      }
    }

    // 2. BESOIN DE RÉPONSE : un message informationnel ne reçoit jamais de
    //    réponse automatique ; un cas ambigu part en brouillon à valider.
    const besoin = classerBesoinReponse({
      sujet: d.sujet,
      texte: d.texte,
      expediteur_email: d.destinataire,
      pieces_jointes: d.pieces_jointes ?? 0,
    });
    if (besoin.categorie === "informationnel") {
      return { planifiee: false, motif: `Email informationnel — ${besoin.motif}` };
    }

    // Idempotence : une seule réponse autonome par message Gmail.
    const cle = `reponse-autonome-${d.gmail_message_id}`;
    const { data: deja } = await admin
      .from("emails_planifies")
      .select("id, statut, envoyer_le")
      .eq("idempotency_key", cle)
      .maybeSingle();
    if (deja) {
      return { planifiee: false, motif: `Réponse autonome déjà programmée (${deja.statut})`, envoyer_le: deja.envoyer_le };
    }

    const redige = await redigerReponse(d);
    if (!redige) return { planifiee: false, motif: "Rédaction IA indisponible — validation humaine" };

    const recu = d.recu_le ? new Date(d.recu_le) : new Date();
    const envoyerLe = prochaineSortieAutorisee(Number.isNaN(recu.getTime()) ? new Date() : recu);
    // Un brouillon n'est jamais repris par le job d'envoi (qui ne lit que
    // `en_attente`) : il attend la validation humaine dans Relation client.
    const brouillon = besoin.categorie === "ambigu";

    const { error } = await admin.from("emails_planifies").insert({
      lot: `reponse-autonome-${d.canal}`,
      template: "relation-client-reponse",
      destinataire: d.destinataire,
      idempotency_key: cle,
      envoyer_le: envoyerLe.toISOString(),
      statut: brouillon ? "brouillon" : "en_attente",
      donnees: JSON.parse(
        JSON.stringify({
          clientName: d.correspondant,
          cabinetName: CABINET,
          titre: redige.titre,
          paragraphes: redige.paragraphes,
          ...(d.faits?.length ? { lignes: d.faits } : {}),
        }),
      ),
      contexte: JSON.parse(
        JSON.stringify({
          agent: "reponse_autonome",
          canal: d.canal,
          gmail_message_id: d.gmail_message_id,
          gmail_thread_id: d.gmail_thread_id ?? null,
          besoin_reponse: besoin.categorie,
          besoin_motif: besoin.motif,
          sujet_recu: d.sujet ?? null,
          modele: MODELE,
          liens: d.liens ?? {},
        }),
      ),
    } as never);
    if (error) return { planifiee: false, motif: `Programmation impossible : ${error.message}` };

    if (brouillon) {
      if (d.liens?.client_id) {
        await admin
          .from("activites")
          .insert({
            client_id: d.liens.client_id,
            type: "systeme",
            titre: "Brouillon de réponse à valider",
            contenu: [
              `Canal : ${d.canal}`,
              `Objet proposé : ${redige.titre}`,
              `Motif : ${besoin.motif}`,
              "Aucun envoi : le brouillon attend une validation humaine (Relation client).",
              "",
              redige.paragraphes.join("\n\n"),
            ].join("\n"),
          })
          .then(
            () => undefined,
            (e: unknown) => console.error("[reponse-autonome] activité non enregistrée", e),
          );
      }
      return { planifiee: false, brouillon: true, motif: `Cas ambigu — ${besoin.motif}`, titre: redige.titre };
    }


    if (d.liens?.client_id) {
      await admin
        .from("activites")
        .insert({
          client_id: d.liens.client_id,
          type: "systeme",
          titre: "Réponse autonome programmée",
          contenu: [
            `Canal : ${d.canal}`,
            `Objet : ${redige.titre}`,
            `Envoi prévu : ${envoyerLe.toISOString()}`,
            "Délai métier de 45 min : la réponse peut être annulée par un gestionnaire avant l'envoi.",
            "",
            redige.paragraphes.join("\n\n"),
          ].join("\n"),
        })
        .then(
          () => undefined,
          (e: unknown) => console.error("[reponse-autonome] activité non enregistrée", e),
        );
    }

    return { planifiee: true, motif: autorisation.motif, envoyer_le: envoyerLe.toISOString(), titre: redige.titre };
  } catch (e) {
    console.error("[reponse-autonome] échec", d.gmail_message_id, e);
    return { planifiee: false, motif: e instanceof Error ? e.message : "erreur inconnue" };
  }
}

/**
 * Annule les réponses autonomes encore en attente dès qu'un humain reprend la
 * main (message repris en validation, tâche traitée, réponse manuelle envoyée).
 */
export async function annulerReponsesAutonomes(
  admin: Admin,
  params: { gmail_message_id?: string; client_id?: string; motif: string },
): Promise<number> {
  try {
    let requete = admin
      .from("emails_planifies")
      .update({ statut: "annule", erreur: params.motif.slice(0, 300) })
      .eq("statut", "en_attente")
      .like("lot", "reponse-autonome-%");
    if (params.gmail_message_id) {
      requete = requete.eq("idempotency_key", `reponse-autonome-${params.gmail_message_id}`);
    } else if (params.client_id) {
      requete = requete.contains("contexte", { liens: { client_id: params.client_id } } as never);
    } else {
      return 0;
    }
    const { data } = await requete.select("id");
    return (data ?? []).length;
  } catch (e) {
    console.error("[reponse-autonome] annulation impossible", e);
    return 0;
  }
}
