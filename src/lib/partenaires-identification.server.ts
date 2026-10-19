import { geminiFetch } from "@/lib/gemini-gateway.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/**
 * Agent Service Partenaire — identification du client concerné par un email
 * partenaire (compagnie, plateforme, courtier grossiste). Un mail Kereis
 * « Demande n°56528882 SALEH Naguy » parle d'un dossier client précis : on
 * cherche donc à reconnaître ce client, à rattacher la ligne `crm_emails`
 * correspondante, et à laisser une note lisible sur la fiche client.
 *
 * Règle d'or : aucun rattachement approximatif. En cas de doute, on ne
 * rattache rien (le mail reste simplement routé Service Partenaire).
 */

type Admin = SupabaseClient<Database>;

const GATEWAY = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const MODELES = ["gemini-3.6-flash", "gemini-2.5-flash"];

export interface ReferencesEmailPartenaire {
  /** Noms de personnes citées (nom + prénom si possible). */
  personnes: string[];
  /** Numéros de dossier / adhésion / contrat / demande cités. */
  references: string[];
  /** Résumé court (2 phrases max) de l'objet de la communication. */
  resume: string;
}

function extraireJson(texte: string): unknown {
  const nettoye = texte.replace(/```json/gi, "").replace(/```/g, "").trim();
  try {
    return JSON.parse(nettoye);
  } catch {
    const debut = nettoye.indexOf("{");
    const fin = nettoye.lastIndexOf("}");
    if (debut === -1 || fin <= debut) return null;
    try {
      return JSON.parse(nettoye.slice(debut, fin + 1));
    } catch {
      return null;
    }
  }
}

/** Analyse IA légère : personnes, références et résumé du mail partenaire. */
export async function extraireReferencesPartenaire(email: {
  sujet: string | null;
  texte: string | null;
  compagnie: string;
}): Promise<ReferencesEmailPartenaire | null> {
  const cle = process.env["GEMINI_API_KEY"];
  if (!cle) return null;

  const prompt = [
    "Tu assistes un cabinet de courtage en assurances français.",
    `On te transmet un email reçu du partenaire « ${email.compagnie} ».`,
    "Extrais UNIQUEMENT ce qui est écrit, sans rien inventer :",
    "- personnes : noms de clients/assurés cités (format \"PRENOM NOM\" ou \"NOM PRENOM\" tel qu'écrit),",
    "- references : numéros de demande, dossier, adhésion, contrat ou devis cités (chiffres/lettres exacts),",
    "- resume : 2 phrases maximum décrivant l'objet de la communication.",
    "Réponds en JSON strict : {\"personnes\":[],\"references\":[],\"resume\":\"\"}",
    "",
    `Objet : ${email.sujet ?? "(sans objet)"}`,
    "Corps :",
    (email.texte ?? "").slice(0, 6000),
  ].join("\n");

  let contenu = "";
  for (const modele of MODELES) {
    try {
      const res = await geminiFetch(GATEWAY, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${cle}` },
        body: JSON.stringify({ model: modele, messages: [{ role: "user", content: prompt }] }),
      });
      if (!res.ok) {
        if (res.status === 400 || res.status === 404) continue;
        return null;
      }
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      contenu = json.choices?.[0]?.message?.content ?? "";
      break;
    } catch (e) {
      console.error("[partenaires] analyse IA impossible", e);
      return null;
    }
  }
  const brut = contenu ? (extraireJson(contenu) as Partial<ReferencesEmailPartenaire> | null) : null;
  if (!brut) return null;
  return {
    personnes: (brut.personnes ?? []).filter((p): p is string => typeof p === "string").slice(0, 10),
    references: (brut.references ?? []).filter((r): r is string => typeof r === "string").slice(0, 10),
    resume: typeof brut.resume === "string" ? brut.resume.slice(0, 600) : "",
  };
}

const normaliser = (v: string) =>
  v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const chiffres = (v: string) => v.replace(/[^a-z0-9]/gi, "").toLowerCase();

export interface CorrespondanceClient {
  client_id: string;
  dossier_id: string | null;
  contrat_id: string | null;
  motif: string;
}

export interface AbsenceCorrespondance {
  client_id: null;
  /** Clients dont le nom + prénom sont cités, sans preuve de dossier : à qualifier. */
  candidats: string[];
  /**
   * Dossier PROBABLE (jamais écrit en FK) : renseigné seulement si un unique
   * client candidat possède un unique dossier. Sert uniquement à rendre la
   * tâche de qualification visible sur la fiche du dossier.
   */
  dossier_probable?: string | null;
  raison: string;
}


/**
 * PREUVE DÉTERMINISTE EXIGÉE (règle DG) : seul un numéro de contrat, de dossier
 * ou d'adhésion cité dans le mail et retrouvé en base autorise un rattachement.
 *
 * Un nom + prénom cités NE SUFFISENT PAS : le mail reste à qualifier par un
 * humain et aucune FK n'est écrite. L'adresse email de l'expéditeur partenaire
 * n'est JAMAIS utilisée pour déduire un client.
 */
export async function trouverClientConcerne(
  admin: Admin,
  refs: ReferencesEmailPartenaire,
): Promise<CorrespondanceClient | AbsenceCorrespondance> {
  const references = refs.references.map(chiffres).filter((r) => r.length >= 5);

  if (references.length) {
    const [{ data: contrats }, { data: dossiers }] = await Promise.all([
      admin.from("contrats").select("id, client_id, dossier_id, numero").not("numero", "is", null).limit(5000),
      admin.from("dossiers").select("id, client_id, reference").limit(5000),
    ]);
    for (const c of contrats ?? []) {
      const num = chiffres(c.numero ?? "");
      if (num.length >= 5 && references.includes(num)) {
        return {
          client_id: c.client_id,
          dossier_id: c.dossier_id ?? null,
          contrat_id: c.id,
          motif: `numéro de contrat ${c.numero}`,
        };
      }
    }
    for (const d of dossiers ?? []) {
      const ref = chiffres(d.reference ?? "");
      if (ref.length >= 5 && references.includes(ref) && d.client_id) {
        return { client_id: d.client_id, dossier_id: d.id, contrat_id: null, motif: `dossier ${d.reference}` };
      }
    }
  }

  // Aucune preuve déterministe : on liste les candidats pour la qualification
  // humaine, sans jamais écrire de client_id / dossier_id.
  const personnes = refs.personnes.map(normaliser).filter((p) => p.split(" ").length >= 2);
  if (!personnes.length) {
    return { client_id: null, candidats: [], raison: "aucun nom complet ni référence exploitable dans le mail" };
  }

  const { data: clients } = await admin.from("clients").select("id, nom, prenom").limit(5000);
  const candidats: string[] = [];
  const candidatsIds: string[] = [];
  for (const c of clients ?? []) {
    const nom = normaliser(c.nom ?? "");
    const prenom = normaliser(c.prenom ?? "");
    if (!nom || !prenom) continue;
    const ok = personnes.some((p) => {
      const m = p.split(" ");
      return m.includes(nom) && m.includes(prenom);
    });
    if (ok) {
      candidats.push(`${c.prenom} ${c.nom}`);
      candidatsIds.push(c.id);
    }
  }

  // Dossier probable : uniquement si un seul client candidat n'a qu'un dossier.
  let dossierProbable: string | null = null;
  if (candidatsIds.length === 1) {
    const { data: dossiersClient } = await admin
      .from("dossiers")
      .select("id")
      .eq("client_id", candidatsIds[0]!)
      .limit(3);
    if ((dossiersClient ?? []).length === 1) dossierProbable = dossiersClient![0]!.id;
  }

  return {
    client_id: null,
    candidats,
    dossier_probable: dossierProbable,
    raison: candidats.length
      ? "nom et prénom cités mais aucun numéro de contrat / dossier ne confirme le rattachement"
      : "client cité non identifié dans le CRM",
  };
}



/** Note de suivi sur la fiche client (une seule par email partenaire). */
export async function noterCommunicationPartenaire(
  admin: Admin,
  params: {
    client_id: string;
    contrat_id?: string | null;
    compagnie: string;
    sujet: string | null;
    resume: string;
    gmail_message_id: string;
    userId: string;
  },
): Promise<boolean> {
  const titre = `Communication partenaire reçue — ${params.compagnie}`;
  const lien = `https://mail.ionos.fr/`;

  const { data: deja } = await admin
    .from("activites")
    .select("id, contenu")
    .eq("client_id", params.client_id)
    .eq("titre", titre)
    .limit(50);
  if ((deja ?? []).some((a) => (a.contenu ?? "").includes(params.gmail_message_id))) return false;

  const { error } = await admin.from("activites").insert({
    client_id: params.client_id,
    contrat_id: params.contrat_id ?? null,
    type: "email",
    titre,
    contenu: [
      `Objet : ${params.sujet ?? "(sans objet)"}`,
      params.resume ? `Résumé : ${params.resume}` : null,
      `Email : ${lien}`,
      `Identifiant Gmail : ${params.gmail_message_id}`,
    ]
      .filter(Boolean)
      .join("\n")
      .slice(0, 6000),
    created_by: params.userId,
  });
  if (error) {
    console.error("[partenaires] note fiche client impossible", error.message);
    return false;
  }
  return true;
}

/**
 * Identification + note pour un email partenaire déjà enregistré en base.
 * Utilisé par `routerEmailPartenaire` et par le rattrapage rétroactif.
 */
export async function identifierClientEmailPartenaire(
  admin: Admin,
  params: {
    gmail_message_id: string;
    sujet: string | null;
    texte?: string | null;
    compagnie: string;
    userId: string;
    client_id_existant?: string | null;
    contrat_id_existant?: string | null;
  },
): Promise<{
  client_id: string | null;
  note_creee: boolean;
  motif: string | null;
  a_qualifier?: boolean;
}> {
  let clientId = params.client_id_existant ?? null;
  let contratId = params.contrat_id_existant ?? null;
  let motif: string | null = clientId ? "rattachement préexistant" : null;
  let resume = "";

  let texte = params.texte ?? null;
  let sujet = params.sujet ?? null;
  if (!texte) {
    try {
      const { lireMessage } = await import("@/lib/gmail.server");
      const detail = await lireMessage(params.gmail_message_id);
      texte = detail.texte ?? detail.snippet ?? null;
      sujet = sujet ?? detail.sujet ?? null;
    } catch (e) {
      console.error("[partenaires] lecture du mail impossible", params.gmail_message_id, e);
    }
  }

  const refs = await extraireReferencesPartenaire({ sujet, texte, compagnie: params.compagnie });
  if (refs) resume = refs.resume;

  const { notifierActionAgent } = await import("@/lib/agent-notifications.server");

  if (!clientId) {
    const trouve = refs
      ? await trouverClientConcerne(admin, refs)
      : ({ client_id: null, candidats: [], raison: "mail illisible par l'analyse" } as AbsenceCorrespondance);

    if (trouve.client_id !== null) {
      clientId = trouve.client_id;
      contratId = contratId ?? trouve.contrat_id;
      motif = trouve.motif;
      await admin
        .from("crm_emails")
        .update({
          client_id: trouve.client_id,
          dossier_id: trouve.dossier_id,
          contrat_id: contratId,
          updated_at: new Date().toISOString(),
        })
        .eq("gmail_message_id", params.gmail_message_id);
    } else {
      // A_QUALIFIER : aucune FK écrite, une tâche de qualification humaine est
      // créée. L'adresse du partenaire n'est jamais prise pour celle d'un client.
      await admin
        .from("crm_emails")
        .update({
          notes: `Mail partenaire ${params.compagnie} — A_QUALIFIER : ${trouve.raison}`.slice(0, 2000),
          updated_at: new Date().toISOString(),
        })
        .eq("gmail_message_id", params.gmail_message_id);
      await notifierActionAgent(admin, {
        gmail_message_id: params.gmail_message_id,
        titre: `Mail partenaire à qualifier — ${params.compagnie}`,
        lignes: [
          `Objet : ${sujet ?? "(sans objet)"}`,
          resume ? `Résumé : ${resume}` : null,
          `Motif : ${trouve.raison}.`,
          trouve.candidats.length ? `Clients possibles : ${trouve.candidats.join(", ")}` : null,
          trouve.dossier_probable
            ? "Dossier probable identifié : cette demande est aussi visible sur sa fiche."
            : null,
          "Aucun client ni dossier n'a été rattaché : rattachement manuel requis.",
        ],
        // Tâche interne « à qualifier » : visible dans le module Demandes et,
        // si un dossier probable existe, sur la fiche de ce dossier (même ligne).
        dossier_id: trouve.dossier_probable ?? null,
        statut: "a_qualifier",
        type: "interne",
        priorite: "haute",
        created_by: params.userId,
      }).catch((e: unknown) => {
        console.error("[partenaires] notification de qualification impossible", e);
        return false;
      });

      return { client_id: null, note_creee: false, motif: null, a_qualifier: true };
    }
  }

  const note = await noterCommunicationPartenaire(admin, {
    client_id: clientId,
    contrat_id: contratId,
    compagnie: params.compagnie,
    sujet,
    resume,
    gmail_message_id: params.gmail_message_id,
    userId: params.userId,
  });

  // NOTIFICATION OBLIGATOIRE : le rattachement automatique est toujours signalé.
  await notifierActionAgent(admin, {
    gmail_message_id: params.gmail_message_id,
    titre: `Rattachement automatique d'un mail partenaire — ${params.compagnie}`,
    lignes: [
      `Objet : ${sujet ?? "(sans objet)"}`,
      resume ? `Résumé : ${resume}` : null,
      `Preuve du rattachement : ${motif ?? "rattachement préexistant"}.`,
      "Vérifier que le mail est bien rattaché au bon client / dossier.",
    ],
    client_id: clientId,
    created_by: params.userId,
  }).catch((e: unknown) => {
    console.error("[partenaires] notification de rattachement impossible", e);
    return false;
  });

  return { client_id: clientId, note_creee: note, motif };
}

