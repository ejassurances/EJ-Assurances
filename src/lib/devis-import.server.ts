/* eslint-disable prettier/prettier -- legacy file formatting debt; keep other lint rules enabled */
/**
 * IMPORT D'UN DEVIS ASSUREUR (PDF ou photo) — lecture IA.
 *
 * Le devis reçu par e-mail ou extranet est lu par Gemini afin de proposer les
 * données du devis (compagnie, formule, cotisation, montant total, mode de
 * calcul, quotité, garanties). RIEN N'EST ENREGISTRÉ ICI : les valeurs sont
 * seulement proposées au conseiller, qui les vérifie et valide la création du
 * devis. Aucune décision assurantielle n'est prise par l'IA.
 */
import { geminiFetch } from "@/lib/gemini-gateway.server";
import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, any, any>;

const GATEWAY = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const MODELES = ["gemini-3.6-flash", "gemini-2.5-flash"];
const BUCKETS = ["dossier-documents", "conformite-documents"];
const TAILLE_MAX = 12 * 1024 * 1024;

export interface DevisImporte {
  compagnie: string | null;
  produit: string | null;
  formule: string | null;
  assure_nom: string | null;
  cotisation_mensuelle: number | null;
  montant_total: number | null;
  /** CI = capital initial (cotisation constante), CRD = capital restant dû. */
  type_cotisation: "CI" | "CRD" | null;
  cotisation_min: number | null;
  cotisation_max: number | null;
  quotite_pct: number | null;
  garanties_resume: string | null;
  date_effet: string | null;
  confidence: number;
}

function extraireJson(texte: string): Record<string, unknown> {
  const net = texte.replace(/```json/gi, "").replace(/```/g, "").trim();
  try {
    return JSON.parse(net) as Record<string, unknown>;
  } catch {
    const a = net.indexOf("{");
    const b = net.lastIndexOf("}");
    if (a === -1 || b <= a) throw new Error("Réponse IA illisible");
    return JSON.parse(net.slice(a, b + 1)) as Record<string, unknown>;
  }
}

function prompt(): string {
  return [
    "Tu lis un DEVIS d'assurance émis par un assureur ou un courtier grossiste français.",
    "Extrais uniquement ce qui est écrit sur le document. N'invente rien, ne calcule rien,",
    "ne déduis aucune garantie absente. Tout champ absent vaut null.",
    "",
    "Réponds STRICTEMENT en JSON :",
    "{",
    '  "compagnie": "nom de l\'assureur ou de la compagnie",',
    '  "produit": "nom commercial du contrat",',
    '  "formule": "nom de la formule ou du niveau de garanties",',
    '  "assure_nom": "nom de la personne assurée",',
    '  "cotisation_mensuelle": nombre en euros par mois ou null,',
    '  "montant_total": coût total de l\'assurance sur toute la durée en euros ou null,',
    '  "type_cotisation": "CI" si la cotisation est constante (capital initial), "CRD" si elle est dégressive (capital restant dû), sinon null,',
    '  "cotisation_min": mensualité la plus basse en euros ou null,',
    '  "cotisation_max": mensualité la plus haute en euros ou null,',
    '  "quotite_pct": quotité assurée en pourcentage ou null,',
    '  "garanties_resume": "résumé factuel des garanties et exclusions mentionnées, 500 caractères maximum",',
    '  "date_effet": "AAAA-MM-JJ" ou null,',
    '  "document_lisible": true ou false,',
    '  "confidence": nombre entre 0 et 1',
    "}",
  ].join("\n");
}

function nombre(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n =
    typeof v === "number"
      ? v
      : Number(String(v).replace(/\s/g, "").replace(/[^\d.,-]/g, "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function texte(v: unknown, max = 200): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
}

/**
 * Lit un document déjà déposé et propose les données du devis.
 * Aucune écriture en base.
 */
export async function lireDevisDocument(admin: Admin, documentId: string): Promise<DevisImporte> {
  const cle = process.env["GEMINI_API_KEY"];
  if (!cle) throw new Error("Lecture indisponible : clé IA absente du projet.");

  const { data: doc } = await admin
    .from("documents")
    .select("id, dossier_id, file_name, mime_type, storage_path")
    .eq("id", documentId)
    .maybeSingle();
  if (!doc) throw new Error("Document introuvable");
  const d = doc as unknown as { file_name: string | null; mime_type: string | null; storage_path: string };

  let blob: Blob | null = null;
  for (const bucket of BUCKETS) {
    const { data } = await admin.storage.from(bucket).download(d.storage_path);
    if (data) {
      blob = data;
      break;
    }
  }
  if (!blob) throw new Error("Fichier indisponible dans le stockage");
  const octets = Buffer.from(await blob.arrayBuffer());
  if (octets.byteLength === 0) throw new Error("Fichier vide");
  if (octets.byteLength > TAILLE_MAX) throw new Error("Fichier trop volumineux (12 Mo maximum)");

  // Une même version source ne doit être lue par l'IA qu'une seule fois.
  // L'empreinte détecte aussi un remplacement du fichier sous le même document_id.
  const empreinteSha256 = Buffer.from(
    await crypto.subtle.digest("SHA-256", octets),
  ).toString("hex");
  const { data: lectureExistante, error: lectureExistanteError } = await admin
    .from("devis_import_lectures")
    .select("extraction")
    .eq("document_id", documentId)
    .eq("source_sha256", empreinteSha256)
    .maybeSingle();
  if (lectureExistanteError) throw new Error("Référence de lecture du devis indisponible.");
  if (lectureExistante?.extraction) return lectureExistante.extraction as DevisImporte;

  const mime = blob.type || d.mime_type || "application/pdf";
  const dataUrl = `data:${mime};base64,${octets.toString("base64")}`;
  const contenu = mime.startsWith("image/")
    ? [
        { type: "text", text: prompt() },
        { type: "image_url", image_url: { url: dataUrl } },
      ]
    : [
        { type: "text", text: prompt() },
        { type: "file", file: { filename: d.file_name || "devis.pdf", file_data: dataUrl } },
      ];

  let derniere = "";
  let brut: Record<string, unknown> | null = null;
  for (const model of MODELES) {
    const res = await geminiFetch(GATEWAY, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cle}` },
      body: JSON.stringify({ model, messages: [{ role: "user", content: contenu }] }),
    });
    if (res.ok) {
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const t = json.choices?.[0]?.message?.content ?? "";
      if (!t) throw new Error("Réponse IA vide");
      brut = extraireJson(t);
      break;
    }
    derniere = `${res.status} ${await res.text()}`;
    if (res.status === 429) throw new Error("Lecture IA momentanément saturée.");
    if (res.status !== 400 && res.status !== 404) break;
  }
  if (!brut) throw new Error(`Lecture IA impossible : ${derniere}`);
  if (brut["document_lisible"] === false) throw new Error("Document illisible : saisie manuelle nécessaire.");

  const type = texte(brut["type_cotisation"], 3)?.toUpperCase();
  const conf = Number(brut["confidence"]);
  const quotite = nombre(brut["quotite_pct"]);

  const resultat: DevisImporte = {
    compagnie: texte(brut["compagnie"]),
    produit: texte(brut["produit"]),
    formule: texte(brut["formule"]),
    assure_nom: texte(brut["assure_nom"]),
    cotisation_mensuelle: nombre(brut["cotisation_mensuelle"]),
    montant_total: nombre(brut["montant_total"]),
    type_cotisation: type === "CI" || type === "CRD" ? type : null,
    cotisation_min: nombre(brut["cotisation_min"]),
    cotisation_max: nombre(brut["cotisation_max"]),
    quotite_pct: quotite !== null && quotite > 0 && quotite <= 100 ? quotite : null,
    garanties_resume: texte(brut["garanties_resume"], 1000),
    date_effet: /^\d{4}-\d{2}-\d{2}$/.test(String(brut["date_effet"] ?? "")) ? String(brut["date_effet"]) : null,
    confidence: Number.isFinite(conf) ? Math.min(1, Math.max(0, conf)) : 0,
  };
  const { error: sauvegardeErreur } = await admin.from("devis_import_lectures").upsert(
    {
      document_id: documentId,
      dossier_id: (d as { dossier_id: string }).dossier_id,
      source_sha256: empreinteSha256,
      extraction: resultat,
      statut: "proposee",
    },
    { onConflict: "document_id,source_sha256" },
  );
  if (sauvegardeErreur) throw new Error("Impossible d'archiver la lecture du devis.");
  return resultat;
}

/** Normalisation simple pour rapprocher un nom lu du catalogue du cabinet. */
function cle(v: string): string {
  return v
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Rapproche un nom lu sur le devis d'une entrée du catalogue (compagnie ou
 * produit). Retourne null si aucune correspondance nette : le conseiller choisit.
 */
export function rapprocherCatalogue(
  nom: string | null,
  candidats: { id: string; nom: string }[],
): string | null {
  if (!nom) return null;
  const k = cle(nom);
  if (!k) return null;
  const exact = candidats.find((c) => cle(c.nom) === k);
  if (exact) return exact.id;
  const partiels = candidats.filter((c) => {
    const ck = cle(c.nom);
    return ck.length >= 4 && (ck.includes(k) || k.includes(ck));
  });
  return partiels.length === 1 ? partiels[0]!.id : null;
}
