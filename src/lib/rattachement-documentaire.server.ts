/**
 * LOT 2B — RATTACHEMENT DOCUMENTAIRE (CD-SI-002-B)
 *
 * Décision INDÉPENDANTE de la classification (Lot 2A) : à qui et à quel
 * dossier / contrat appartient un document déjà déposé dans `documents` ?
 *
 * Principe directeur : CERTITUDE > AUTOMATISATION.
 *  - aucun client, prospect, dossier, contrat ou référence n'est créé ;
 *  - aucun choix arbitraire entre plusieurs dossiers ou plusieurs contrats ;
 *  - en cas de doute : dossier_id / contrat_id restent NULL et une
 *    qualification humaine est demandée (tâche admin).
 *
 * Réutilisation stricte de l'existant : `documents.client_id`,
 * `documents.dossier_id`, `documents.contrat_id`, tables `clients`,
 * `dossiers`, `contrats`, journalisation `activites`, tâches `taches`.
 * Aucune migration : la trace de rattachement est journalisée dans `activites`.
 *
 * La confiance de CLASSIFICATION (`documents.classification_ia.confidence`)
 * n'est jamais utilisée ici : la confiance de rattachement est calculée
 * uniquement à partir des preuves CRM (hiérarchie des preuves, §13).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { SupabaseClient } from "@supabase/supabase-js";

type Admin = SupabaseClient<any, any, any>;

/** Statuts de dossier considérés comme « non actifs » (hors du champ du rattachement). */
const DOSSIER_STATUTS_INACTIFS = ["cloture", "perdu"] as const;
/** Statuts de contrat considérés comme actifs. */
const CONTRAT_STATUTS_ACTIFS = ["actif", "contrat_actif", "contrat_valide"] as const;

/** Niveaux de preuve de CD-SI-002-B §13. */
export type NiveauPreuve =
  | "niveau_1_reference_explicite"
  | "niveau_2_contexte_crm_direct"
  | "niveau_3_dossier_unique_actif"
  | "niveau_4_indices_contextuels"
  | "aucune";

/** Seuils cibles du Lot 2B : rattachement automatique à partir de 0.90. */
export const SEUIL_RATTACHEMENT_AUTO = 0.9;

const CONFIANCE: Record<NiveauPreuve, number> = {
  niveau_1_reference_explicite: 0.99,
  niveau_2_contexte_crm_direct: 0.95,
  niveau_3_dossier_unique_actif: 0.9,
  niveau_4_indices_contextuels: 0.5,
  aucune: 0,
};

export interface DecisionRattachement {
  document_id: string;
  /** Client identifié (peut être un prospect : `clients.statut = 'prospect'`). */
  client_id: string | null;
  /** Contexte prospect conservé sans conversion (aucune colonne dédiée n'existe). */
  prospect: boolean;
  dossier_id: string | null;
  dossier_reference: string | null;
  contrat_id: string | null;
  contrat_numero: string | null;
  niveau_preuve: NiveauPreuve;
  confiance_rattachement: number;
  source: string;
  ambiguite: string | null;
  qualification_humaine: boolean;
  origine: "automatique";
  date: string;
}

/** Références de dossier reconnues : nomenclature réelle du CRM (EJ-AAAA-RIS-NNNN). */
const RE_REFERENCE_CRM = /\bEJ-\d{4}-[A-Z]{2,4}-\d{2,6}\b/gi;
/** Alias historique cité par la spécification : [DOS-XXXXXX]. */
const RE_REFERENCE_DOS = /\bDOS-\d{4,8}\b/gi;

export function referencesDossierDetectees(...textes: (string | null | undefined)[]): string[] {
  const source = textes.filter(Boolean).join("\n");
  const trouvees = [
    ...(source.match(RE_REFERENCE_CRM) ?? []),
    ...(source.match(RE_REFERENCE_DOS) ?? []),
  ].map((r) => r.toUpperCase());
  return Array.from(new Set(trouvees));
}

/** Numéros de contrat détectés : uniquement ceux qui existent réellement en base. */
async function contratParNumero(
  admin: Admin,
  clientId: string,
  textes: (string | null | undefined)[],
): Promise<{ id: string; numero: string | null } | null> {
  const source = textes.filter(Boolean).join("\n");
  if (!source.trim()) return null;
  const { data } = await admin
    .from("contrats")
    .select("id, numero, dossier_id")
    .eq("client_id", clientId)
    .not("numero", "is", null);
  const contrats = (data ?? []) as { id: string; numero: string | null }[];
  const hay = source.toUpperCase().replace(/\s+/g, " ");
  const trouves = contrats.filter((c) => {
    const n = (c.numero ?? "").trim().toUpperCase();
    return n.length >= 5 && hay.includes(n);
  });
  // Une seule correspondance exacte = preuve. Plusieurs = ambiguïté.
  return trouves.length === 1 ? trouves[0]! : null;
}

async function dossierParReference(
  admin: Admin,
  clientId: string,
  references: string[],
): Promise<{ id: string; reference: string | null; client_id: string | null } | null> {
  if (references.length === 0) return null;
  const { data } = await admin.from("dossiers").select("id, reference, client_id").in("reference", references);
  const rows = (data ?? []) as { id: string; reference: string | null; client_id: string | null }[];
  // La référence doit appartenir au bon contexte client (§8) et être unique.
  const duClient = rows.filter((d) => d.client_id === clientId);
  return duClient.length === 1 ? duClient[0]! : null;
}

async function dossiersActifs(
  admin: Admin,
  clientId: string,
): Promise<{ id: string; reference: string | null; statut: string; type_assurance: string | null }[]> {
  const { data } = await admin
    .from("dossiers")
    .select("id, reference, statut, type_assurance")
    .eq("client_id", clientId)
    .not("statut", "in", `(${DOSSIER_STATUTS_INACTIFS.join(",")})`);
  return (data ?? []) as { id: string; reference: string | null; statut: string; type_assurance: string | null }[];
}

async function contratsActifs(
  admin: Admin,
  clientId: string,
  dossierId: string | null,
): Promise<{ id: string; numero: string | null; dossier_id: string | null }[]> {
  let req = admin
    .from("contrats")
    .select("id, numero, dossier_id")
    .eq("client_id", clientId)
    .in("statut", CONTRAT_STATUTS_ACTIFS as unknown as string[]);
  if (dossierId) req = req.eq("dossier_id", dossierId);
  const { data } = await req;
  return (data ?? []) as { id: string; numero: string | null; dossier_id: string | null }[];
}

/**
 * Évalue le rattachement d'un document déjà enregistré, puis l'applique
 * uniquement si la preuve est suffisante. Ne crée jamais rien.
 */
export async function rattacherDocument(
  admin: Admin,
  params: {
    documentId: string;
    /** Client (ou prospect) identifié en amont par correspondance email exacte. */
    clientId: string | null;
    sujet?: string | null;
    texte?: string | null;
    /** Lien Gmail, pour la trace. */
    lienEmail?: string | null;
    userId?: string | null;
    /** Empêche toute écriture : simple évaluation (recette). */
    simulation?: boolean;
  },
): Promise<DecisionRattachement> {
  const date = new Date().toISOString();
  const decision: DecisionRattachement = {
    document_id: params.documentId,
    client_id: params.clientId ?? null,
    prospect: false,
    dossier_id: null,
    dossier_reference: null,
    contrat_id: null,
    contrat_numero: null,
    niveau_preuve: "aucune",
    confiance_rattachement: 0,
    source: "aucune preuve exploitable",
    ambiguite: null,
    qualification_humaine: true,
    origine: "automatique",
    date,
  };

  if (!params.clientId) {
    decision.source = "expéditeur non rattaché à un client ou prospect existant";
    decision.ambiguite = "client non identifié";
    return decision;
  }

  // Contexte prospect conservé tel quel : aucune conversion, aucune création.
  const { data: cli } = await admin
    .from("clients")
    .select("id, statut")
    .eq("id", params.clientId)
    .maybeSingle();
  const client = cli as { id: string; statut: string | null } | null;
  if (!client) {
    decision.client_id = null;
    decision.source = "client introuvable en base";
    decision.ambiguite = "client non identifié";
    return decision;
  }
  decision.prospect = client.statut === "prospect";

  // ---- NIVEAU 1 : référence explicite de dossier ----------------------------
  const references = referencesDossierDetectees(params.sujet, params.texte);
  const parReference = await dossierParReference(admin, client.id, references);
  if (parReference) {
    decision.dossier_id = parReference.id;
    decision.dossier_reference = parReference.reference;
    decision.niveau_preuve = "niveau_1_reference_explicite";
    decision.source = `référence dossier explicite ${parReference.reference} appartenant au client identifié`;
  } else {
    if (references.length > 0) {
      decision.ambiguite = `référence(s) ${references.join(", ")} détectée(s) mais non rattachable(s) au client identifié`;
    }
    // ---- NIVEAU 3 : dossier unique actif -----------------------------------
    const actifs = await dossiersActifs(admin, client.id);
    if (actifs.length === 1) {
      decision.dossier_id = actifs[0]!.id;
      decision.dossier_reference = actifs[0]!.reference;
      decision.niveau_preuve = "niveau_3_dossier_unique_actif";
      decision.source = `dossier unique actif du client (${actifs[0]!.reference ?? actifs[0]!.id})`;
    } else if (actifs.length > 1) {
      decision.niveau_preuve = "niveau_4_indices_contextuels";
      decision.source = "client identifié, plusieurs dossiers actifs, aucune référence explicite";
      decision.ambiguite = `${actifs.length} dossiers actifs : ${actifs
        .map((d) => d.reference ?? d.id)
        .join(", ")}`;
    } else {
      decision.niveau_preuve = "niveau_2_contexte_crm_direct";
      decision.source = "client identifié, aucun dossier actif (aucun dossier créé)";
    }
  }

  // ---- CONTRAT : uniquement sur preuve explicite ou unicité stricte --------
  const parNumero = await contratParNumero(admin, client.id, [params.sujet, params.texte]);
  if (parNumero) {
    decision.contrat_id = parNumero.id;
    decision.contrat_numero = parNumero.numero;
    decision.source += ` ; numéro de contrat reconnu ${parNumero.numero}`;
  } else if (decision.dossier_id) {
    const contrats = await contratsActifs(admin, client.id, decision.dossier_id);
    if (contrats.length === 1) {
      decision.contrat_id = contrats[0]!.id;
      decision.contrat_numero = contrats[0]!.numero;
      decision.source += " ; contrat unique actif rattaché à ce dossier";
    } else if (contrats.length > 1) {
      decision.ambiguite = [decision.ambiguite, `${contrats.length} contrats actifs sur le dossier`]
        .filter(Boolean)
        .join(" ; ");
    }
  } else {
    const contrats = await contratsActifs(admin, client.id, null);
    if (contrats.length > 1) {
      decision.ambiguite = [decision.ambiguite, `${contrats.length} contrats actifs sur le client`]
        .filter(Boolean)
        .join(" ; ");
    }
  }

  decision.confiance_rattachement = decision.dossier_id ? CONFIANCE[decision.niveau_preuve] : 0;
  decision.qualification_humaine =
    !decision.dossier_id || decision.confiance_rattachement < SEUIL_RATTACHEMENT_AUTO;

  if (params.simulation) return decision;

  // ---- APPLICATION : uniquement les identifiants réellement établis --------
  const maj: Record<string, unknown> = {};
  if (decision.dossier_id && !decision.qualification_humaine) maj["dossier_id"] = decision.dossier_id;
  if (decision.contrat_id) maj["contrat_id"] = decision.contrat_id;
  if (Object.keys(maj).length > 0) {
    const { error } = await admin.from("documents").update(maj).eq("id", decision.document_id);
    if (error) console.error("[Lot2B] rattachement non appliqué", error.message);
  }

  // ---- TRACE (structures existantes : activites + taches) ------------------
  const trace = [
    `Document : ${decision.document_id}`,
    `Client identifié : ${client.id}${decision.prospect ? " (prospect — aucune conversion)" : ""}`,
    `Dossier : ${decision.dossier_reference ?? decision.dossier_id ?? "non déterminé"}`,
    `Contrat : ${decision.contrat_numero ?? decision.contrat_id ?? "non déterminé"}`,
    `Preuve : ${decision.niveau_preuve}`,
    `Confiance de rattachement : ${decision.confiance_rattachement.toFixed(2)} (seuil ${SEUIL_RATTACHEMENT_AUTO})`,
    `Source : ${decision.source}`,
    decision.ambiguite ? `Ambiguïté : ${decision.ambiguite}` : null,
    `Origine : automatique — ${date}`,
    params.lienEmail ? `Email : ${params.lienEmail}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    await admin.from("activites").insert({
      client_id: client.id,
      type: "systeme",
      titre: decision.qualification_humaine
        ? "Rattachement documentaire — qualification humaine requise"
        : "Rattachement documentaire automatique",
      contenu: trace.slice(0, 6000),
    });
  } catch (e) {
    console.error("[Lot2B] trace non enregistrée", e);
  }

  if (decision.qualification_humaine) {
    try {
      const { creerTacheAdmin } = await import("@/lib/agent-taches.server");
      await creerTacheAdmin(admin as never, {
        idempotency_key: `rattachement_documentaire:qualification:${params.documentId}`,
        source: "rattachement-documentaire",
        source_event_id: params.documentId,
        titre: "Document à rattacher — qualification humaine".slice(0, 200),
        description: [
          "Le moteur de rattachement documentaire n'a pas pu déterminer le dossier avec certitude.",
          "",
          trace,
          "",
          "Action : ouvrir le document et le rattacher manuellement au bon dossier.",
        ].join("\n"),
        client_id: client.id,
        created_by: params.userId ?? null,
      } as never);
    } catch (e) {
      console.error("[Lot2B] tâche de qualification non créée", e);
    }
  }

  return decision;
}
