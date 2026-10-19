/**
 * Règles évolutives des agents IA, stockées sur le Drive du cabinet.
 *
 * Arborescence : `06_Regles_Agent/`
 *  - `Direction_Commerciale/Regles_De_Ton.txt`
 *  - `Direction_Financiere/Regles_De_Ton.txt`
 *  - `Direction_Juridique_Conformite/Regles_De_Ton.txt`
 *    → un document de ton par DIRECTION. Chaque agent lit uniquement le
 *      document de sa direction (jamais un mélange), relu à chaque réponse
 *      (cache mémoire de 5 minutes). Le cabinet les remplit lui-même.
 *  - `Regles_Non_Couvertes/Journal_Regles_Non_Couvertes.txt` : journal des cas
 *    rencontrés sans règle applicable. Chaque cas y est ajouté ET signalé par
 *    email à l'administrateur, pour décider ensemble s'il faut créer une règle
 *    (document Drive pour une nuance de ton, code pour une action structurée).
 *
 * Jamais bloquant : si le Drive est indisponible, les agents continuent avec un
 * comportement par défaut neutre.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { SupabaseClient } from "@supabase/supabase-js";

type Admin = SupabaseClient<any, any, any>;

export const DRIVE_RACINE_REGLES = "06_Regles_Agent";
export const DRIVE_DOSSIER_NON_COUVERTES = "Regles_Non_Couvertes";
export const FICHIER_TON = "Regles_De_Ton.txt";
export const FICHIER_NON_COUVERTES = "Journal_Regles_Non_Couvertes.txt";

/** Directions du cabinet et dossier Drive correspondant. */
export const DOSSIERS_TON_PAR_DIRECTION = {
  commerciale: "Direction_Commerciale",
  financiere: "Direction_Financiere",
  conformite: "Direction_Juridique_Conformite",
} as const;

export type DirectionAgent = keyof typeof DOSSIERS_TON_PAR_DIRECTION;

/**
 * Noms de documents recherchés (dans l'ordre) sous le dossier de la direction,
 * y compris ses sous-dossiers. Le cabinet peut utiliser un Google Doc natif
 * (ex. « Direction_Commerciale_Gestion_des_mails ») ou un fichier texte.
 */
export const NOMS_TON_PAR_DIRECTION: Record<DirectionAgent, string[]> = {
  commerciale: ["Direction_Commerciale_Gestion_des_mails", FICHIER_TON],
  financiere: ["Direction_Financiere_Gestion_des_mails", FICHIER_TON],
  conformite: ["Direction_Juridique_Conformite_Gestion_des_mails", FICHIER_TON],
};


const ADMIN_FALLBACK = "contact@ej-assurances.fr";
const CACHE_MS = 5 * 60 * 1000;

/** Contenu de départ minimal : le cabinet le complète lui-même ensuite. */
export const REGLES_DE_TON_INITIALES =
  "Aucune règle spécifique définie pour l'instant — vouvoiement par défaut, ton neutre et factuel.";

type Cache = { texte: string; expire: number };
const cacheTon = new Map<DirectionAgent, Cache>();

async function drive() {
  return await import("@/lib/google-drive.server");
}

/**
 * Localise le document de ton d'une direction : recherche récursive dans
 * `06_Regles_Agent/<Direction>/` (sous-dossiers inclus) des noms attendus,
 * Google Doc natif ou fichier texte. Créé en .txt seulement si rien n'existe.
 */
export async function localiserDocumentTon(
  direction: DirectionAgent,
): Promise<{ id: string; mimeType?: string }> {
  const { assurerDossier, assurerFichierTexte, trouverFichierRecursif, trouverFichierParNomGlobal } =
    await drive();
  const racine = await assurerDossier(DRIVE_RACINE_REGLES);
  const dossier = await assurerDossier(DOSSIERS_TON_PAR_DIRECTION[direction], racine);

  for (const nom of NOMS_TON_PAR_DIRECTION[direction]) {
    const dansDossier = await trouverFichierRecursif(nom, dossier);
    if (dansDossier) return { id: dansDossier.id, mimeType: dansDossier.mimeType };
    // Le document a pu être recréé/déplacé ailleurs par le cabinet.
    const global = await trouverFichierParNomGlobal(nom);
    if (global) return { id: global.id, mimeType: global.mimeType };
  }


  const fichier = await assurerFichierTexte({
    nom: FICHIER_TON,
    parentId: dossier,
    contenuInitial: REGLES_DE_TON_INITIALES,
  });
  return { id: fichier.id, mimeType: "text/plain" };
}

/** Crée si besoin le document de ton d'une direction et renvoie son ID. */
export async function assurerDocumentTon(direction: DirectionAgent): Promise<string> {
  return (await localiserDocumentTon(direction)).id;
}


/** Crée si besoin les 3 documents de ton + le journal, et renvoie les IDs. */
export async function assurerDocumentsRegles(): Promise<{
  ton_file_ids: Record<DirectionAgent, string>;
  journal_file_id: string;
  racine_url: string;
}> {
  const { assurerDossier, assurerFichierTexte, urlDossierDrive } = await drive();
  const racine = await assurerDossier(DRIVE_RACINE_REGLES);

  const ton_file_ids = {} as Record<DirectionAgent, string>;
  for (const direction of Object.keys(DOSSIERS_TON_PAR_DIRECTION) as DirectionAgent[]) {
    ton_file_ids[direction] = await assurerDocumentTon(direction);
  }

  const dossierJournal = await assurerDossier(DRIVE_DOSSIER_NON_COUVERTES, racine);
  const journal = await assurerFichierTexte({
    nom: FICHIER_NON_COUVERTES,
    parentId: dossierJournal,
    contenuInitial: [
      "JOURNAL DES CAS SANS REGLE APPLICABLE",
      "Chaque entrée = un mail traité par l'IA sans règle connue. À arbitrer avec le cabinet.",
      "",
    ].join("\n"),
  });

  return { ton_file_ids, journal_file_id: journal.id, racine_url: urlDossierDrive(racine) };
}

/** ID du journal des cas non couverts (créé si besoin). */
async function assurerJournal(): Promise<string> {
  const { assurerDossier, assurerFichierTexte } = await drive();
  const racine = await assurerDossier(DRIVE_RACINE_REGLES);
  const dossier = await assurerDossier(DRIVE_DOSSIER_NON_COUVERTES, racine);
  const fichier = await assurerFichierTexte({
    nom: FICHIER_NON_COUVERTES,
    parentId: dossier,
    contenuInitial: [
      "JOURNAL DES CAS SANS REGLE APPLICABLE",
      "Chaque entrée = un mail traité par l'IA sans règle connue. À arbitrer avec le cabinet.",
      "",
    ].join("\n"),
  });
  return fichier.id;
}

/**
 * Règles de ton en vigueur pour UNE direction (texte brut), cache 5 minutes.
 * Repli neutre si le Drive est indisponible : jamais bloquant.
 */
export async function chargerReglesDeTon(direction: DirectionAgent): Promise<string> {
  const enCache = cacheTon.get(direction);
  if (enCache && enCache.expire > Date.now()) return enCache.texte;
  try {
    const { id, mimeType } = await localiserDocumentTon(direction);
    const { lireTexteFichier } = await drive();
    const texte = (await lireTexteFichier(id, mimeType)).trim() || REGLES_DE_TON_INITIALES;

    cacheTon.set(direction, { texte, expire: Date.now() + CACHE_MS });
    return texte;
  } catch (e) {
    console.error(
      `[regles-agent] règles de ton (${direction}) illisibles sur le Drive — repli neutre`,
      e,
    );
    cacheTon.set(direction, { texte: REGLES_DE_TON_INITIALES, expire: Date.now() + 60_000 });
    return REGLES_DE_TON_INITIALES;
  }
}

/** Vide le cache (utile après une modification volontaire d'un document). */
export function invaliderCacheRegles(direction?: DirectionAgent) {
  if (direction) cacheTon.delete(direction);
  else cacheTon.clear();
}


/** Adresse email de l'administrateur du cabinet (repli : boîte du cabinet). */
export async function emailAdminCabinet(admin: Admin): Promise<string> {
  try {
    const { adminParDefaut } = await import("@/lib/agent-taches.server");
    const adminId = await adminParDefaut(admin as never);
    if (!adminId) return ADMIN_FALLBACK;
    const { data } = await admin.from("profiles").select("email").eq("id", adminId).maybeSingle();
    const email = (data as { email: string | null } | null)?.email;
    return email && email.includes("@") ? email : ADMIN_FALLBACK;
  } catch {
    return ADMIN_FALLBACK;
  }
}

/** Email interne d'information à l'administrateur (jamais au client). */
export async function informerAdmin(
  admin: Admin,
  params: { titre: string; paragraphes: string[]; lignes?: { libelle: string; valeur: string }[] },
): Promise<void> {
  try {
    const destinataire = await emailAdminCabinet(admin);
    const { sendTemplateEmail } = await import("@/lib/email-templates/send-email");
    await sendTemplateEmail("relation-client-reponse", destinataire, {
      templateData: {
        clientName: "Administrateur",
        cabinetName: "EJ Partners Assurances",
        titre: params.titre,
        paragraphes: params.paragraphes,
        ...(params.lignes ? { lignes: params.lignes } : {}),
      },
    });
  } catch (e) {
    console.error("[regles-agent] information admin non envoyée", e);
  }
}

/**
 * Cas significatif sans règle applicable : consigné au journal Drive, signalé
 * par email à l'admin. La réponse au client reste, elle, en « A valider ».
 */
export async function journaliserCasNonCouvert(
  admin: Admin,
  params: {
    client?: string | null;
    sujet?: string | null;
    gmail_message_id?: string | null;
    situation: string;
    pourquoi_non_couvert: string;
  },
): Promise<void> {
  const horodatage = new Date().toISOString();
  const entree = [
    `--- ${horodatage}`,
    `Client : ${params.client ?? "inconnu"}`,
    `Objet du mail : ${params.sujet ?? "(sans objet)"}`,
    params.gmail_message_id
      ? `Mail : https://mail.ionos.fr/`
      : "Mail : (référence absente)",
    `Situation : ${params.situation}`,
    `Aucune règle applicable car : ${params.pourquoi_non_couvert}`,
    "Décision du cabinet : [à compléter — règle de ton (document Drive) ou règle d'action (code) ?]",
    "",
  ].join("\n");

  try {
    const journal_file_id = await assurerJournal();
    const { lireTexteFichier, remplacerTexteFichier } = await drive();
    const actuel = await lireTexteFichier(journal_file_id);
    await remplacerTexteFichier(journal_file_id, `${actuel.trimEnd()}\n\n${entree}`);
  } catch (e) {
    console.error("[regles-agent] journal des cas non couverts non mis à jour", e);
  }

  await informerAdmin(admin, {
    titre: "Cas sans règle applicable — arbitrage demandé",
    paragraphes: [
      "L'agent IA a rencontré une situation pour laquelle aucune règle connue ne s'appliquait (ni dans le code, ni dans le document Drive des règles de ton).",
      "La réponse au client a été laissée en « A valider » : rien n'a été envoyé automatiquement.",
      "Le cas est également consigné dans le journal Drive « 06_Regles_Agent/Regles_Non_Couvertes ».",
    ],
    lignes: [
      { libelle: "Client", valeur: params.client ?? "inconnu" },
      { libelle: "Objet du mail", valeur: params.sujet ?? "(sans objet)" },
      { libelle: "Situation", valeur: params.situation },
      { libelle: "Pourquoi aucune règle", valeur: params.pourquoi_non_couvert },
      {
        libelle: "Mail",
        valeur: params.gmail_message_id
          ? `https://mail.ionos.fr/`
          : "—",
      },
    ],
  });
}
