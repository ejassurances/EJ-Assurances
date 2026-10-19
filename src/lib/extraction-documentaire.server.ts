import { geminiFetch } from "@/lib/gemini-gateway.server";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * LOT 2C — EXTRACTION DOCUMENTAIRE (CD-SI-002-C)
 *
 * Périmètre strict : lire le CONTENU réel d'un document déjà classé (Lot 2A) et
 * en extraire les données documentaires prévues par son type. Rien d'autre.
 *
 *  - aucune donnée métier n'est écrite dans clients / prospects / dossiers /
 *    contrats / données assurantielles : le résultat reste documentaire ;
 *  - aucune interprétation médicale, aucun scoring, aucune tarification ;
 *  - aucune donnée inventée : absente => null ;
 *  - aucune nomenclature nouvelle : le type utilisé est celui du référentiel CRM
 *    (src/lib/pieces-requises.ts + `kbis`) déjà retenu par le Lot 2A ;
 *  - la confiance d'extraction vit dans `doc_extractions.confidence_score` et
 *    n'écrase jamais la confiance de classification (Lot 2A) ni celle de
 *    rattachement (Lot 2B).
 *
 * Persistance : table `public.doc_extractions` uniquement
 * (document_id, type_document, extracted_data, raw_text, confidence_score,
 *  statut, erreur, model, created_at).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Admin = SupabaseClient<any, any, any>;

const GATEWAY = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const MODELES = ["gemini-3.6-flash", "gemini-2.5-flash"];
const BUCKETS = ["dossier-documents", "conformite-documents"];
const TAILLE_MAX = 12 * 1024 * 1024;

/** Seuil en dessous duquel l'extraction est conservée mais marquée à qualifier. */
export const SEUIL_EXTRACTION_FIABLE = 0.7;

/** Types documentaires à caractère médical : aucune extraction (§9). */
const CODES_MEDICAUX = new Set(["questionnaire_sante"]);

/** Types sans extraction spécialisée possible (§12). */
const SANS_EXTRACTION = new Set(["autre", "a_qualifier", "piece_client_email", ""]);

type Champ = { nom: string; description: string };

/** Schémas d'extraction par type documentaire du référentiel réel. */
const SCHEMAS: Record<string, { libelle: string; champs: Champ[] }> = {
  offre_pret: {
    libelle: "Offre de prêt ou tableau d'amortissement",
    champs: [
      { nom: "banque", description: "nom de la banque prêteuse" },
      { nom: "montant_capital", description: "capital emprunté en euros (nombre)" },
      { nom: "taux_nominal", description: "taux nominal annuel en % (nombre)" },
      { nom: "taeg", description: "TAEG en % (nombre)" },
      { nom: "duree_mois", description: "durée totale du prêt en mois (nombre entier)" },
      { nom: "mensualite", description: "mensualité hors assurance en euros (nombre)" },
      {
        nom: "taux_assurance",
        description:
          "taux annuel de l'assurance emprunteur de la banque en % (nombre), ex. 0.36 — jamais le taux nominal du prêt",
      },
      {
        nom: "cotisation_assurance_mensuelle",
        description:
          "première cotisation mensuelle d'assurance emprunteur en euros (nombre), telle qu'indiquée sur l'offre ou l'échéancier ; ne pas la présenter comme constante si elle diminue",
      },
      {
        nom: "cout_assurance_total",
        description:
          "coût total de l'assurance emprunteur en euros (nombre), écrit dans l'offre ou sur la ligne Total de la colonne COUT ASSURANCES du tableau d'amortissement",
      },
      { nom: "date_document", description: "date du document au format AAAA-MM-JJ" },
      { nom: "date_premiere_echeance", description: "date de la première échéance AAAA-MM-JJ" },
      { nom: "nombre_echeances", description: "nombre d'échéances listées (nombre entier)" },
      { nom: "reference", description: "référence du prêt ou du dossier bancaire" },
    ],
  },
  kbis: {
    libelle: "Extrait Kbis",
    champs: [
      { nom: "raison_sociale", description: "dénomination sociale" },
      { nom: "siren", description: "SIREN, 9 chiffres, sans espaces" },
      { nom: "siret", description: "SIRET, 14 chiffres, sans espaces, si présent" },
      { nom: "forme_juridique", description: "forme juridique" },
      { nom: "dirigeant", description: "nom du représentant légal" },
      { nom: "adresse", description: "adresse du siège" },
      { nom: "activite", description: "activité principale déclarée" },
      { nom: "date_immatriculation", description: "date d'immatriculation AAAA-MM-JJ" },
    ],
  },
  cni: {
    libelle: "Pièce d'identité (CNI, passeport, titre de séjour)",
    champs: [
      { nom: "nom", description: "nom de naissance" },
      { nom: "prenom", description: "premier prénom" },
      { nom: "date_naissance", description: "date de naissance AAAA-MM-JJ" },
      { nom: "lieu_naissance", description: "ville de naissance" },
      { nom: "numero_document", description: "numéro du document" },
      { nom: "date_expiration", description: "date d'expiration AAAA-MM-JJ" },
      { nom: "nature_document", description: "cni, passeport ou titre_sejour" },
    ],
  },
  rib: {
    libelle: "RIB / relevé d'identité bancaire",
    champs: [
      { nom: "titulaire", description: "nom du titulaire du compte" },
      { nom: "iban", description: "IBAN sans espaces" },
      { nom: "bic", description: "code BIC / SWIFT" },
      { nom: "banque", description: "nom de la banque" },
    ],
  },
  justificatif_domicile: {
    libelle: "Justificatif de domicile",
    champs: [
      { nom: "titulaire", description: "nom du titulaire du justificatif" },
      { nom: "adresse", description: "adresse complète mentionnée" },
      { nom: "date_document", description: "date du document AAAA-MM-JJ" },
      { nom: "nature_justificatif", description: "type de justificatif (facture énergie, quittance, avis…)" },
    ],
  },
  releves_placements: {
    libelle: "Relevé annuel de placement (assurance-vie, PER, capitalisation, PEA)",
    champs: [
      { nom: "assureur", description: "nom de l'assureur ou de l'établissement" },
      { nom: "nom_contrat", description: "nom commercial du contrat" },
      { nom: "nature_contrat", description: "assurance_vie, per, capitalisation ou pea" },
      { nom: "numero_contrat", description: "numéro du contrat" },
      { nom: "date_releve", description: "date d'arrêté du relevé AAAA-MM-JJ" },
      { nom: "valeur_acquise", description: "valeur atteinte / épargne acquise à la date du relevé, en euros (nombre)" },
      { nom: "valeur_debut_periode", description: "valeur du contrat au début de la période couverte, en euros (nombre)" },
      { nom: "versements_periode", description: "total des versements de la période, en euros (nombre)" },
      { nom: "rachats_periode", description: "total des rachats / retraits de la période, en euros (nombre)" },
      { nom: "performance_nette_pct", description: "performance NETTE de la période écrite au relevé, en % (nombre)" },
      { nom: "frais_gestion_pct", description: "frais de gestion annuels écrits au relevé, en % (nombre)" },
      { nom: "frais_versement_pct", description: "frais sur versement écrits au relevé, en % (nombre)" },
      { nom: "part_fonds_euros_pct", description: "part du fonds en euros dans l'encours, en % (nombre)" },
      { nom: "part_uc_pct", description: "part des unités de compte dans l'encours, en % (nombre)" },
      { nom: "annees_periode", description: "nombre d'années couvertes par le relevé (nombre)" },
    ],
  },
};

const NOMBRES = new Set([
  "montant_capital",
  "taux_nominal",
  "taeg",
  "duree_mois",
  "mensualite",
  "taux_assurance",
  "cotisation_assurance_mensuelle",
  "cout_assurance_total",
  "nombre_echeances",
  "valeur_acquise",
  "valeur_debut_periode",
  "versements_periode",
  "rachats_periode",
  "performance_nette_pct",
  "frais_gestion_pct",
  "frais_versement_pct",
  "part_fonds_euros_pct",
  "part_uc_pct",
  "annees_periode",
]);
const DATES = new Set(["date_document", "date_premiere_echeance", "date_expiration", "date_naissance", "date_immatriculation", "date_releve"]);

export type ResultatExtraction =
  | { statut: "extrait"; type_document: string; donnees: Record<string, unknown>; confidence: number; fiable: boolean }
  | { statut: "deja_extrait"; donnees: Record<string, unknown> | null }
  | { statut: "hors_perimetre"; raison: string }
  | { statut: "indisponible"; raison: string };

function prompt(type: string): string {
  const schema = SCHEMAS[type]!;
  return [
    `Tu es un moteur d'EXTRACTION documentaire. Le document fourni est de type : ${schema.libelle}.`,
    "Ta seule mission : relever les informations réellement écrites dans le document.",
    "",
    "INTERDICTIONS ABSOLUES :",
    "- n'invente JAMAIS une valeur absente ou illisible : mets null ;",
    "- ne calcule ni ne déduis aucune valeur qui n'est pas écrite ;",
    "- ne porte aucun jugement, aucune analyse de risque, aucune recommandation.",
    "",
    "Champs à relever :",
    ...schema.champs.map((c) => `- ${c.nom} : ${c.description}`),
    "",
    "Réponds STRICTEMENT en JSON, sans texte autour :",
    `{"donnees":{${schema.champs.map((c) => `"${c.nom}":null`).join(",")}},"confidence":0.00,"document_lisible":true,"champs_incertains":[],"resume_texte":""}`,
    "",
    "Règles :",
    "- confidence entre 0.00 et 1.00 : reflet honnête de ta certitude globale ;",
    "- champs_incertains : liste des noms de champs lus mais dont tu n'es pas certain ;",
    "- document illisible/vide/corrompu : document_lisible false, tous les champs null, confidence 0.0 ;",
    "- resume_texte : le texte brut lu utile (2000 caractères maximum), sans commentaire.",
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

async function telecharger(admin: Admin, chemin: string): Promise<Blob | null> {
  for (const bucket of BUCKETS) {
    const { data } = await admin.storage.from(bucket).download(chemin);
    if (data) return data;
  }
  return null;
}

async function appelerGemini(
  type: string,
  fichier: { nom: string; mime: string; base64: string },
): Promise<{ brut: Record<string, unknown>; model: string }> {
  const cle = process.env["GEMINI_API_KEY"];
  if (!cle) throw new Error("Extraction indisponible : clé IA absente du projet.");

  const dataUrl = `data:${fichier.mime};base64,${fichier.base64}`;
  const contenu = fichier.mime.startsWith("image/")
    ? [
        { type: "text", text: prompt(type) },
        { type: "image_url", image_url: { url: dataUrl } },
      ]
    : [
        { type: "text", text: prompt(type) },
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
    if (res.status === 429) throw new Error("Extraction IA momentanément saturée.");
    if (res.status !== 400 && res.status !== 404) break;
  }
  throw new Error(`Extraction IA impossible : ${derniere}`);
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Validation technique (§6) : structure, types, formats, valeurs incohérentes. */
function valider(
  type: string,
  brut: Record<string, unknown>,
): { donnees: Record<string, unknown>; confidence: number; lisible: boolean; raw: string | null; incertains: string[] } {
  const schema = SCHEMAS[type]!;
  if (typeof brut["donnees"] !== "object" || brut["donnees"] === null || Array.isArray(brut["donnees"])) {
    throw new Error("Structure attendue absente (objet `donnees`)");
  }
  const source = brut["donnees"] as Record<string, unknown>;
  const inconnus = Object.keys(source).filter((k) => !schema.champs.some((c) => c.nom === k));
  if (inconnus.length > 0 && inconnus.length === Object.keys(source).length) {
    throw new Error("Aucun champ attendu dans la réponse IA");
  }

  const lisible = brut["document_lisible"] !== false;
  const brutConf = Number(brut["confidence"]);
  let confidence = Number.isFinite(brutConf) ? Math.min(1, Math.max(0, brutConf)) : 0;
  if (!lisible) confidence = 0;

  const incertains = Array.isArray(brut["champs_incertains"])
    ? (brut["champs_incertains"] as unknown[]).filter((v): v is string => typeof v === "string")
    : [];

  const donnees: Record<string, unknown> = {};
  for (const champ of schema.champs) {
    const v = lisible ? source[champ.nom] : null;
    if (v === null || v === undefined || v === "" || (typeof v === "string" && /^(n\/?a|néant|non renseign)/i.test(v.trim()))) {
      donnees[champ.nom] = null;
      continue;
    }
    if (NOMBRES.has(champ.nom)) {
      const n = typeof v === "number" ? v : Number(String(v).replace(/\s/g, "").replace(/[^\d.,-]/g, "").replace(",", "."));
      donnees[champ.nom] = Number.isFinite(n) && n >= 0 ? n : null;
      continue;
    }
    if (DATES.has(champ.nom)) {
      const s = String(v).trim();
      donnees[champ.nom] = ISO.test(s) && !Number.isNaN(Date.parse(s)) ? s : null;
      continue;
    }
    if (champ.nom === "siren") {
      const s = String(v).replace(/\D/g, "");
      donnees[champ.nom] = s.length === 9 ? s : null;
      continue;
    }
    if (champ.nom === "siret") {
      const s = String(v).replace(/\D/g, "");
      donnees[champ.nom] = s.length === 14 ? s : null;
      continue;
    }
    if (champ.nom === "iban") {
      const s = String(v).replace(/\s/g, "").toUpperCase();
      donnees[champ.nom] = /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s) ? s : null;
      continue;
    }
    if (champ.nom === "bic") {
      const s = String(v).replace(/\s/g, "").toUpperCase();
      donnees[champ.nom] = /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(s) ? s : null;
      continue;
    }
    donnees[champ.nom] = typeof v === "string" ? v.trim().slice(0, 300) : v;
  }

  // Cohérence métier documentaire simple (aucune décision assurantielle).
  if (typeof donnees["duree_mois"] === "number" && (donnees["duree_mois"] as number) > 600) donnees["duree_mois"] = null;
  for (const t of ["taux_nominal", "taeg"]) {
    if (typeof donnees[t] === "number" && (donnees[t] as number) > 30) donnees[t] = null;
  }
  // Taux d'assurance emprunteur : au-delà de 3 %/an, il s'agit d'une confusion
  // avec le taux nominal du prêt — la valeur est écartée plutôt que déduite.
  if (typeof donnees["taux_assurance"] === "number" && (donnees["taux_assurance"] as number) > 3)
    donnees["taux_assurance"] = null;

  const raw = typeof brut["resume_texte"] === "string" && brut["resume_texte"].trim()
    ? (brut["resume_texte"] as string).trim().slice(0, 2000)
    : null;

  return { donnees, confidence: Number(confidence.toFixed(2)), lisible, raw, incertains };
}

async function tracerEchec(admin: Admin, documentId: string, type: string | null, raison: string): Promise<void> {
  const { error } = await admin
    .from("doc_extractions")
    .upsert(
      {
        document_id: documentId,
        type_document: type,
        extracted_data: null,
        raw_text: null,
        confidence_score: null,
        statut: "erreur",
        erreur: raison.slice(0, 500),
        model: null,
      } as never,
      { onConflict: "document_id" },
    );
  if (error) console.error(`[Lot2C] trace d'erreur non enregistrée pour ${documentId} : ${error.message}`);
}

/**
 * Extrait les données documentaires d'un document déjà classé (Lot 2A).
 *
 * Idempotence (§10) : si une extraction existe déjà pour ce `document_id`,
 * aucun appel IA n'est relancé, sauf `forcer: true`.
 */
export async function extraireDocument(
  admin: Admin,
  documentId: string,
  options?: { forcer?: boolean },
): Promise<ResultatExtraction> {
  const { data: doc } = await admin
    .from("documents")
    .select("id, file_name, mime_type, storage_path, type_document, classification_ia, classification_le")
    .eq("id", documentId)
    .maybeSingle();
  if (!doc) return { statut: "indisponible", raison: "Document introuvable" };

  const d = doc as unknown as {
    file_name: string | null;
    mime_type: string | null;
    storage_path: string;
    type_document: string | null;
    classification_ia: { type_document?: string; document_lisible?: boolean } | null;
    classification_le: string | null;
  };

  // §1 — conditions préalables issues du Lot 2A (lecture seule, jamais modifiées).
  if (!d.classification_le || !d.classification_ia) {
    return { statut: "hors_perimetre", raison: "Document non classé (Lot 2A) — aucune extraction" };
  }
  if (d.classification_ia.document_lisible === false) {
    return { statut: "hors_perimetre", raison: "Document illisible — qualification humaine" };
  }

  const type = (d.classification_ia.type_document || d.type_document || "").trim().toLowerCase();
  if (CODES_MEDICAUX.has(type)) {
    return { statut: "hors_perimetre", raison: "Document médical — aucune extraction, aucune interprétation" };
  }
  if (SANS_EXTRACTION.has(type) || !SCHEMAS[type]) {
    return { statut: "hors_perimetre", raison: `Type documentaire sans schéma d'extraction (${type || "inconnu"})` };
  }

  // §10 — idempotence.
  const { data: existante } = await admin
    .from("doc_extractions")
    .select("id, extracted_data, statut")
    .eq("document_id", documentId)
    .maybeSingle();
  const ex = existante as { extracted_data: Record<string, unknown> | null; statut: string } | null;
  if (ex && ex.statut !== "erreur" && !options?.forcer) {
    return { statut: "deja_extrait", donnees: ex.extracted_data };
  }

  let valide: ReturnType<typeof valider>;
  let model: string;
  try {
    const blob = await telecharger(admin, d.storage_path);
    if (!blob) throw new Error("Fichier indisponible dans le stockage");
    const octets = Buffer.from(await blob.arrayBuffer());
    if (octets.byteLength === 0) throw new Error("Fichier vide");
    if (octets.byteLength > TAILLE_MAX) throw new Error("Fichier trop volumineux (12 Mo maximum)");
    const appel = await appelerGemini(type, {
      nom: d.file_name || "document",
      mime: blob.type || d.mime_type || "application/pdf",
      base64: octets.toString("base64"),
    });
    model = appel.model;
    valide = valider(type, appel.brut);
  } catch (e) {
    const raison = e instanceof Error ? e.message : "erreur inconnue";
    console.error(`[Lot2C] extraction indisponible pour ${documentId} : ${raison}`);
    await tracerEchec(admin, documentId, type, raison);
    return { statut: "indisponible", raison };
  }

  if (!valide.lisible) {
    await tracerEchec(admin, documentId, type, "Document illisible selon la lecture IA — aucune donnée retenue");
    return { statut: "hors_perimetre", raison: "Document illisible — qualification humaine" };
  }

  const renseignes = Object.values(valide.donnees).filter((v) => v !== null).length;
  const fiable = valide.confidence >= SEUIL_EXTRACTION_FIABLE && renseignes > 0;

  const { error } = await admin.from("doc_extractions").upsert(
    {
      document_id: documentId,
      type_document: type,
      extracted_data: {
        ...valide.donnees,
        _meta: {
          champs_incertains: valide.incertains,
          champs_renseignes: renseignes,
          confidence_extraction: valide.confidence,
          extrait_le: new Date().toISOString(),
        },
      },
      raw_text: valide.raw,
      confidence_score: valide.confidence,
      statut: fiable ? "extrait" : "a_qualifier",
      erreur: null,
      model,
    } as never,
    { onConflict: "document_id" },
  );
  if (error) {
    console.error(`[Lot2C] enregistrement de l'extraction impossible : ${error.message}`);
    return { statut: "indisponible", raison: error.message };
  }

  return { statut: "extrait", type_document: type, donnees: valide.donnees, confidence: valide.confidence, fiable };
}
