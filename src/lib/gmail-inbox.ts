/**
 * Règles de traitement de la boîte de réception IONOS.
 *
 * Module PUR (client-safe, testable) : aucune dépendance fournisseur ni base de
 * données. Il décide uniquement (a) si un message est mûr pour traitement et
 * (b) dans quel état de classement il doit aller.
 *
 * Trois états de classement, posés EN PLUS du libellé de direction existant :
 *  - 📥 01_Brouillon_IA_A_Relire : un brouillon a été préparé, jamais envoyé ;
 *  - ⚠️ 02_Alerte_Humain_A_Traiter : doute, sujet sensible ou rattachement incertain ;
 *  - 📦 03_Archives_Traitees : rien à répondre, ou une réponse existe déjà.
 *
 * Libellés métier conservés à l'identique pendant la migration depuis Gmail.
 */

export const LABEL_BROUILLON = "📥 01_Brouillon_IA_A_Relire";
export const LABEL_ALERTE = "⚠️ 02_Alerte_Humain_A_Traiter";
export const LABEL_ARCHIVE_TRAITEE = "📦 03_Archives_Traitees";

/** Les trois états de classement du nouveau traitement d'inbox. */
export const LABELS_TRIAGE_INBOX = [LABEL_BROUILLON, LABEL_ALERTE, LABEL_ARCHIVE_TRAITEE] as const;

/** Délai métier obligatoire entre la réception et le traitement. */
export const DELAI_TRAITEMENT_MINUTES = 45;

/** Seuil de confiance en dessous duquel le message part en alerte humaine. */
export const CONFIANCE_MINIMALE = 0.7;

export type DecisionEmail =
  | "brouillon_a_relire"
  | "alerte_humain"
  | "archive_reponse_existante"
  | "archive_sans_reponse";

export interface ClassementEmail {
  decision: DecisionEmail;
  label: string;
  motif: string;
}

/** Instant à partir duquel un message reçu peut être traité. */
export function traitableAPartirDe(recuLe: Date): Date {
  return new Date(recuLe.getTime() + DELAI_TRAITEMENT_MINUTES * 60000);
}

/** Le délai de 45 minutes est-il écoulé ? */
export function delaiEcoule(recuLe: Date, maintenant: Date = new Date()): boolean {
  return maintenant.getTime() >= traitableAPartirDe(recuLe).getTime();
}

export interface EntreeClassement {
  reponseDejaEnvoyee: boolean;
  reponseNecessaire: boolean;
  rattachementCertain: boolean;
  sensible?: boolean;
  comprehensible?: boolean;
  confiance?: number | null;
}

/** Décision de classement. */
export function classerEmail(e: EntreeClassement): ClassementEmail {
  if (e.reponseDejaEnvoyee) {
    return {
      decision: "archive_reponse_existante",
      label: LABEL_ARCHIVE_TRAITEE,
      motif: "Une réponse a déjà été envoyée dans ce fil : aucun nouvel envoi.",
    };
  }

  const comprehensible = e.comprehensible !== false;
  const confiance = e.confiance ?? 0;

  if (!comprehensible) {
    return { decision: "alerte_humain", label: LABEL_ALERTE, motif: "Message incompréhensible : traitement humain requis." };
  }
  if (e.sensible) {
    return { decision: "alerte_humain", label: LABEL_ALERTE, motif: "Sujet sensible ou réglementé : traitement humain requis." };
  }
  if (!e.rattachementCertain) {
    return { decision: "alerte_humain", label: LABEL_ALERTE, motif: "Rattachement à une fiche CRM incertain : traitement humain requis." };
  }
  if (confiance < CONFIANCE_MINIMALE) {
    return {
      decision: "alerte_humain",
      label: LABEL_ALERTE,
      motif: `Confiance insuffisante (${Math.round(confiance * 100)} %) : traitement humain requis.`,
    };
  }
  if (!e.reponseNecessaire) {
    return { decision: "archive_sans_reponse", label: LABEL_ARCHIVE_TRAITEE, motif: "Aucune réponse nécessaire." };
  }
  return {
    decision: "brouillon_a_relire",
    label: LABEL_BROUILLON,
    motif: "Brouillon préparé, en attente de relecture humaine (aucun envoi).",
  };
}

export function lienGmailMessage(messageId: string): string {
  void messageId;
  return "https://mail.ionos.fr/";
}

export function lienGmailBrouillon(draftId: string): string {
  void draftId;
  return "https://mail.ionos.fr/";
}
