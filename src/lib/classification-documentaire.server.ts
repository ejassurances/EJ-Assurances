import { geminiFetch } from "@/lib/gemini-gateway.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { toutesPiecesConnues } from "@/lib/pieces-requises";

/**
 * LOT 2A — CLASSIFICATION DOCUMENTAIRE (CD-SI-002-A)
 *
 * Périmètre strict : déterminer la NATURE d'un document déjà déposé, rien de plus.
 * Aucune donnée métier n'est extraite (montant, taux, durée, identité…) : cela
 * relève du Lot 2C. Aucun rattachement n'est modifié (Lot 2B), aucune complétude
 * n'est calculée (Lot 2D), aucune décision assurantielle n'est prise.
 *
 * Le contenu réel du fichier est transmis à Gemini (multimodal, base64) : la
 * classification ne repose jamais sur le seul nom de fichier.
 *
 * Persistance — structures existantes uniquement :
 *  - documents.classification_ia (jsonb)  : résultat complet + traçabilité ;
 *  - documents.classification_le (timestamptz) : horodatage + marqueur d'idempotence ;
 *  - documents.type_document (text)       : code retenu, issu du référentiel réel.
 */

type Admin = SupabaseClient<Database>;

const GATEWAY = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const MODELES = ["gemini-3.6-flash", "gemini-2.5-flash"];
const BUCKETS = ["dossier-documents", "conformite-documents"];
const TAILLE_MAX = 12 * 1024 * 1024;

/** Seuils CD-SI-002-A §10. */
export const SEUIL_AUTO = 0.9;
export const SEUIL_SURVEILLANCE = 0.7;

/** Valeurs hors référentiel documentaire, prévues par la spécification (§9). */
export const TYPE_AUTRE = "autre";
export const TYPE_A_QUALIFIER = "a_qualifier";

/**
 * Vocabulaire autorisé = référentiel réellement présent dans le CRM
 * (src/lib/pieces-requises.ts) + `kbis` (valeur de l'enum client_kyc_type)
 * + les deux valeurs de repli de la spécification. Aucune nomenclature
 * parallèle n'est créée.
 *
 * Note d'écart : le référentiel réel ne distingue pas le tableau
 * d'amortissement de l'offre de prêt — le code `offre_pret` couvre
 * explicitement « Offre de prêt / tableau d'amortissement ».
 */
export function codesAutorises(): string[] {
  const codes = toutesPiecesConnues().map((p) => p.code);
  return [...new Set([...codes, "kbis", TYPE_AUTRE, TYPE_A_QUALIFIER])];
}

/** Pièces à caractère médical : classification seulement, aucune interprétation (§17). */
const CODES_MEDICAUX = new Set(["questionnaire_sante"]);

export type Anomalie =
  | "DOCUMENT_ILLISIBLE"
  | "CLASSIFICATION_AMBIGUE"
  | "DOCUMENT_MEDICAL"
  | "TYPE_HORS_REFERENTIEL"
  | null;

export interface ClassificationDocument {
  type_document: string;
  confidence: number;
  document_lisible: boolean;
  justification: string;
  anomalie: Anomalie;
  model: string;
  /** Niveau de traitement déduit des seuils (§10). */
  traitement: "automatique" | "surveillance" | "qualification_humaine";
  classifie_le: string;
}

export type ResultatClassification =
  | { statut: "classe"; classification: ClassificationDocument }
  | { statut: "deja_classe"; classification: ClassificationDocument | null }
  | { statut: "indisponible"; raison: string };

function libelles(): string {
  return toutesPiecesConnues()
    .map((p) => `- ${p.code} : ${p.libelle}`)
    .join("\n");
}

function prompt(): string {
  return [
    "Tu es un moteur de CLASSIFICATION documentaire pour un cabinet de courtage en assurances.",
    "Ta seule mission : déterminer la NATURE du document fourni.",
    "",
    "INTERDICTIONS ABSOLUES :",
    "- n'extrais AUCUNE donnée du document (montant, taux, durée, banque, nom, date de naissance, numéro) ;",
    "- n'interprète AUCUNE information médicale, ne pose aucun diagnostic, n'évalue aucun risque ;",
    "- ne juge ni la validité juridique ni la conformité du document ;",
    "- n'invente jamais une catégorie : si tu n'es pas sûr, dis-le.",
    "",
    "Catégories autorisées (utilise exactement le code) :",
    libelles(),
    "- kbis : Extrait Kbis",
    `- ${TYPE_AUTRE} : document lisible mais ne correspondant à aucune catégorie ci-dessus`,
    `- ${TYPE_A_QUALIFIER} : document illisible, vide, corrompu, ou trop ambigu pour être classé`,
    "",
    "Réponds STRICTEMENT en JSON, sans texte autour :",
    '{"type_document":"","confidence":0.00,"document_lisible":true,"justification":"","anomalie":null}',
    "",
    "Règles :",
    "- confidence entre 0.00 et 1.00, reflet honnête de ta certitude ;",
    `- document illisible/vide/corrompu → type_document "${TYPE_A_QUALIFIER}", confidence 0.0, document_lisible false, anomalie "DOCUMENT_ILLISIBLE" ;`,
    `- plusieurs catégories possibles → type_document "${TYPE_A_QUALIFIER}", anomalie "CLASSIFICATION_AMBIGUE" ;`,
    `- lisible mais hors catégories → type_document "${TYPE_AUTRE}", anomalie null ;`,
    "- justification en français, une phrase, sans citer de donnée personnelle du document.",
  ].join("\n");
}

function extraireJson(texte: string): Record<string, unknown> {
  const nettoye = texte.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(nettoye) as Record<string, unknown>;
  } catch {
    const debut = nettoye.indexOf("{");
    const fin = nettoye.lastIndexOf("}");
    if (debut === -1 || fin <= debut) throw new Error("Réponse IA illisible (JSON attendu)");
    return JSON.parse(nettoye.slice(debut, fin + 1)) as Record<string, unknown>;
  }
}

function estImage(mime: string): boolean {
  return mime.startsWith("image/");
}

/** Appel Gemini multimodal : le CONTENU du fichier est réellement transmis. */
async function appelerGemini(fichier: {
  nom: string;
  mime: string;
  base64: string;
}): Promise<{ brut: Record<string, unknown>; model: string }> {
  const cle = process.env["GEMINI_API_KEY"];
  if (!cle) throw new Error("Classification indisponible : clé IA absente du projet.");

  const dataUrl = `data:${fichier.mime};base64,${fichier.base64}`;
  const contenu = estImage(fichier.mime)
    ? [
        { type: "text", text: prompt() },
        { type: "image_url", image_url: { url: dataUrl } },
      ]
    : [
        { type: "text", text: prompt() },
        { type: "file", file: { filename: fichier.nom, file_data: dataUrl } },
      ];

  let derniere = "";
  for (const model of MODELES) {
    const res = await geminiFetch(GATEWAY, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cle}` },
      body: JSON.stringify({ model, messages: [{ role: "user", content: contenu }] }),
    });
    if (res.ok) {
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const texte = json.choices?.[0]?.message?.content ?? "";
      if (!texte) throw new Error("Réponse IA vide");
      return { brut: extraireJson(texte), model };
    }
    derniere = `${res.status} ${await res.text()}`;
    if (res.status === 429) throw new Error("Classification IA momentanément saturée.");
    if (res.status !== 400 && res.status !== 404) break;
  }
  throw new Error(`Classification IA impossible : ${derniere}`);
}

async function telecharger(admin: Admin, chemin: string): Promise<Blob | null> {
  for (const bucket of BUCKETS) {
    const { data } = await admin.storage.from(bucket).download(chemin);
    if (data) return data;
  }
  return null;
}

/** Normalise la réponse IA : le type doit appartenir au référentiel réel. */
function normaliser(brut: Record<string, unknown>, model: string): ClassificationDocument {
  const autorises = codesAutorises();
  const typeBrut = typeof brut["type_document"] === "string" ? (brut["type_document"] as string).trim().toLowerCase() : "";
  const lisible = brut["document_lisible"] !== false;
  const confianceBrute = Number(brut["confidence"]);
  let confidence = Number.isFinite(confianceBrute) ? Math.min(1, Math.max(0, confianceBrute)) : 0;
  let anomalie = (typeof brut["anomalie"] === "string" ? (brut["anomalie"] as string) : null) as Anomalie;
  let type = typeBrut;

  if (!autorises.includes(type)) {
    // Aucune invention de nomenclature : un type inconnu devient une qualification humaine.
    type = TYPE_A_QUALIFIER;
    confidence = Math.min(confidence, 0.5);
    anomalie = "TYPE_HORS_REFERENTIEL";
  }
  if (!lisible) {
    type = TYPE_A_QUALIFIER;
    confidence = 0;
    anomalie = anomalie ?? "DOCUMENT_ILLISIBLE";
  }
  if (type === TYPE_A_QUALIFIER) confidence = Math.min(confidence, SEUIL_SURVEILLANCE - 0.01);
  if (CODES_MEDICAUX.has(type)) anomalie = "DOCUMENT_MEDICAL";

  const traitement =
    confidence >= SEUIL_AUTO ? "automatique" : confidence >= SEUIL_SURVEILLANCE ? "surveillance" : "qualification_humaine";

  const justification =
    typeof brut["justification"] === "string" && brut["justification"].trim()
      ? (brut["justification"] as string).trim().slice(0, 500)
      : "Aucune justification fournie par le moteur.";

  return {
    type_document: type,
    confidence: Number(confidence.toFixed(2)),
    document_lisible: lisible,
    justification,
    anomalie: anomalie ?? null,
    model,
    traitement,
    classifie_le: new Date().toISOString(),
  };
}

/**
 * Classifie un document déjà déposé (table `documents`).
 *
 * Idempotence : si `classification_le` est déjà renseigné, aucun appel IA n'est
 * relancé, sauf `forcer: true` (échec, document remplacé, correction, demande
 * explicite, changement de modèle).
 *
 * Résilience : une indisponibilité de l'IA ne supprime rien et n'écrit aucune
 * classification — le document reste en attente de qualification humaine.
 */
export async function classifierDocument(
  admin: Admin,
  documentId: string,
  options?: { forcer?: boolean },
): Promise<ResultatClassification> {
  const { data: doc } = await admin
    .from("documents")
    .select("id, file_name, mime_type, storage_path, classification_ia, classification_le")
    .eq("id", documentId)
    .maybeSingle();
  if (!doc) return { statut: "indisponible", raison: "Document introuvable" };

  const d = doc as unknown as {
    file_name: string | null;
    mime_type: string | null;
    storage_path: string;
    classification_ia: ClassificationDocument | null;
    classification_le: string | null;
  };

  if (d.classification_le && !options?.forcer) {
    return { statut: "deja_classe", classification: d.classification_ia };
  }

  let classification: ClassificationDocument;
  try {
    const blob = await telecharger(admin, d.storage_path);
    if (!blob) throw new Error("Fichier indisponible dans le stockage");
    const octets = Buffer.from(await blob.arrayBuffer());
    if (octets.byteLength === 0) throw new Error("Fichier vide");
    if (octets.byteLength > TAILLE_MAX) throw new Error("Fichier trop volumineux (12 Mo maximum)");
    const { brut, model } = await appelerGemini({
      nom: d.file_name || "document",
      mime: blob.type || d.mime_type || "application/pdf",
      base64: octets.toString("base64"),
    });
    classification = normaliser(brut, model);
  } catch (e) {
    const raison = e instanceof Error ? e.message : "erreur inconnue";
    console.error(`[Lot2A] classification indisponible pour ${documentId} : ${raison}`);
    return { statut: "indisponible", raison };
  }

  // Le code documentaire n'est retenu que s'il est fiable (>= seuil de surveillance)
  // et réellement identifié : sinon le document reste à qualifier par un humain.
  const patch: Record<string, unknown> = {
    classification_ia: classification,
    classification_le: classification.classifie_le,
  };
  if (
    classification.confidence >= SEUIL_SURVEILLANCE &&
    classification.type_document !== TYPE_A_QUALIFIER &&
    classification.type_document !== TYPE_AUTRE
  ) {
    patch["type_document"] = classification.type_document;
  }

  const { error } = await admin.from("documents").update(patch as never).eq("id", documentId);
  if (error) {
    console.error(`[Lot2A] enregistrement de la classification impossible : ${error.message}`);
    return { statut: "indisponible", raison: error.message };
  }

  return { statut: "classe", classification };
}
