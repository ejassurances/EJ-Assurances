import { geminiFetch } from "@/lib/gemini-gateway.server";
/**
 * ANALYSE IA D'UNE OFFRE DE PRÊT (ou tableau d'amortissement) DÉPOSÉE À LA
 * CRÉATION D'UN DOSSIER EMPRUNTEUR.
 *
 * Objectif : relever, en une lecture, les caractéristiques du prêt ET l'identité
 * des emprunteurs, afin de pré-remplir le recueil des besoins et de rapprocher
 * (ou créer) les fiches clients correspondantes.
 *
 * Garde-fous :
 *  - aucune donnée inventée : absente ou illisible => null ;
 *  - aucune donnée de santé (loi Lemoine) : seul le statut fumeur est accepté,
 *    et uniquement s'il est écrit noir sur blanc ;
 *  - aucune écriture en base ici : ce module lit uniquement le document.
 */

const GATEWAY = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const MODELES = ["gemini-3.6-flash", "gemini-2.5-flash"];

export interface EmprunteurDetecte {
  prenom: string;
  nom: string;
  date_naissance: string;
  quotite_pct: number | null;
  csp: string;
  fumeur: boolean | null;
  email: string | null;
  telephone: string | null;
}

export interface AnalyseOffrePret {
  lisible: boolean;
  confidence: number;
  /** Champs du prêt, au format attendu par `prefillRecueilEmprunteur`. */
  pret: Record<string, unknown>;
  emprunteurs: EmprunteurDetecte[];
}

const CHAMPS_PRET = [
  ["banque", "nom de la banque prêteuse"],
  ["montant_capital", "capital emprunté en euros (nombre)"],
  ["taux_nominal", "taux nominal annuel du prêt en % (nombre)"],
  ["duree_mois", "durée totale du prêt en mois (nombre entier)"],
  ["mensualite", "mensualité hors assurance en euros (nombre)"],
  ["taux_assurance", "taux annuel de l'assurance emprunteur de la banque en % (nombre)"],
  [
    "cotisation_assurance_mensuelle",
    "cotisation mensuelle d'assurance emprunteur en euros (nombre)",
  ],
  [
    "cout_assurance_total",
    "coût total de l'assurance emprunteur écrit dans l'offre ou sur la ligne Total du tableau d'amortissement, en euros (nombre)",
  ],
  ["date_premiere_echeance", "date de la première échéance AAAA-MM-JJ"],
  [
    "date_edition_document",
    "date d'édition / d'établissement du document (offre de prêt, tableau d'amortissement) AAAA-MM-JJ",
  ],
  ["capital_restant_du", "capital restant dû explicitement écrit, en euros"],
  ["date_capital_restant_du", "date associée au capital restant dû, AAAA-MM-JJ"],
  ["date_fin_pret", "date de fin du prêt écrite, AAAA-MM-JJ"],
  ["cout_total_pret", "coût total du prêt explicitement écrit, euros"],
  ["objet_pret", "objet du financement tel qu'écrit (résidence principale, locatif…)"],
] as const;

const NOMBRES = new Set([
  "capital_restant_du",
  "cout_total_pret",
  "montant_capital",
  "taux_nominal",
  "duree_mois",
  "mensualite",
  "taux_assurance",
  "cotisation_assurance_mensuelle",
  "cout_assurance_total",
]);
const ISO = /^\d{4}-\d{2}-\d{2}$/;

function prompt(): string {
  return [
    "Tu es un moteur d'EXTRACTION documentaire. Le document est une offre de prêt immobilier",
    "ou un tableau d'amortissement.",
    "Ta seule mission : relever ce qui est RÉELLEMENT ÉCRIT dans le document.",
    "",
    "INTERDICTIONS ABSOLUES :",
    "- n'invente jamais une valeur absente ou illisible : mets null ;",
    "- ne calcule ni ne déduis aucune valeur non écrite ;",
    "- ne relève AUCUNE donnée de santé (antécédents, pathologies, traitements).",
    "",
    "Champs du prêt à relever :",
    ...CHAMPS_PRET.map(([nom, desc]) => `- ${nom} : ${desc}`),
    "",
    "Emprunteurs : pour chaque personne empruntrice nommée dans le document, relève",
    "prenom, nom, date_naissance (AAAA-MM-JJ), quotite_pct (quotité assurée en %, nombre),",
    "csp (profession écrite), fumeur toujours null : ne pas extraire de données de santé ou tabagisme,",
    "email, telephone. Toute valeur non écrite vaut null.",
    "",
    "Où chercher ces informations (parcours TOUTES les pages, y compris les annexes) :",
    "- date_naissance : mentions du type « Né(e) le 26/02/1971 », « né le », « date de naissance »",
    "  dans le bloc EMPRUNTEUR(S) / EMPRUNTEUR(S) SOLIDAIRE(S) ou sur la fiche d'assurance.",
    "  Convertis toujours JJ/MM/AAAA en AAAA-MM-JJ.",
    "- quotite_pct : mentions du type « Quotité de prêt assuré : 100 % », « quotité assurée »,",
    "  « part d'assurance » du paragraphe ASSURANCES, rattachée au nom de la personne concernée.",
    "- csp : profession ou catégorie socio-professionnelle écrite (salarié, cadre, artisan…).",
    "  La situation de famille (marié, divorcé) n'est PAS une csp : dans ce cas csp vaut null.",
    "Ne renvoie ces champs à null que si tu as vraiment parcouru le document sans les trouver.",
    "",
    "Réponds STRICTEMENT en JSON, sans texte autour :",
    `{"pret":{${CHAMPS_PRET.map(([n]) => `"${n}":null`).join(",")}},"emprunteurs":[{"prenom":null,"nom":null,"date_naissance":null,"quotite_pct":null,"csp":null,"fumeur":null,"email":null,"telephone":null}],"confidence":0.00,"document_lisible":true}`,
    "",
    "Règles : confidence entre 0.00 et 1.00 ; document illisible => document_lisible false,",
    "pret à null et emprunteurs vide.",
  ].join("\n");
}

function extraireJson(texte: string): Record<string, unknown> {
  const nettoye = texte
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  try {
    return JSON.parse(nettoye) as Record<string, unknown>;
  } catch {
    const debut = nettoye.indexOf("{");
    const fin = nettoye.lastIndexOf("}");
    if (debut === -1 || fin <= debut) throw new Error("Réponse IA illisible (JSON attendu)");
    return JSON.parse(nettoye.slice(debut, fin + 1)) as Record<string, unknown>;
  }
}

function texteOuNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s || /^(n\/?a|néant|non renseign)/i.test(s)) return null;
  return s;
}

function nombreOuNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n =
    typeof v === "number"
      ? v
      : Number(
          String(v)
            .replace(/\s/g, "")
            .replace(/[^\d.,-]/g, "")
            .replace(",", "."),
        );
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Normalise une date écrite en clair (JJ/MM/AAAA, JJ-MM-AAAA, JJ.MM.AAAA) vers
 * le format ISO AAAA-MM-JJ. Retourne null si la date est absente ou invalide.
 */
export function dateIsoOuNull(v: unknown): string | null {
  const s = texteOuNull(v);
  if (!s) return null;
  const valide = (iso: string) => (!Number.isNaN(Date.parse(iso)) ? iso : null);
  if (ISO.test(s)) return valide(s);
  const fr = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (fr) {
    const [, j, m, a] = fr as unknown as [string, string, string, string];
    return valide(`${a}-${m.padStart(2, "0")}-${j.padStart(2, "0")}`);
  }
  return null;
}

/** Une situation de famille n'est jamais une catégorie socio-professionnelle. */
const NON_CSP = /^(marié|mariée|célibataire|divorcé|divorcée|veuf|veuve|pacsé|pacsée|concubin)/i;

function normaliserEmprunteurs(brut: unknown): EmprunteurDetecte[] {
  if (!Array.isArray(brut)) return [];
  const out: EmprunteurDetecte[] = [];
  for (const item of brut) {
    if (typeof item !== "object" || item === null) continue;
    const o = item as Record<string, unknown>;
    const nom = texteOuNull(o["nom"]);
    if (!nom) continue; // sans nom écrit, aucune fiche n'est proposée
    const csp = texteOuNull(o["csp"]);
    out.push({
      nom,
      prenom: texteOuNull(o["prenom"]) ?? "",
      date_naissance: dateIsoOuNull(o["date_naissance"]) ?? "",
      quotite_pct: nombreOuNull(o["quotite_pct"]),
      csp: csp && !NON_CSP.test(csp) ? csp : "",
      fumeur: null,
      email: texteOuNull(o["email"]),
      telephone: texteOuNull(o["telephone"]),
    });
  }
  return out;
}

/** Lit un document (PDF ou image, en base64) et en retourne prêt + emprunteurs. */
export async function analyserOffrePretFichier(fichier: {
  nom: string;
  mime: string;
  base64: string;
}): Promise<AnalyseOffrePret> {
  const cle = process.env["GEMINI_API_KEY"];
  if (!cle) throw new Error("Analyse indisponible : clé IA absente du projet.");

  const dataUrl = `data:${fichier.mime || "application/pdf"};base64,${fichier.base64}`;
  const contenu = (fichier.mime || "").startsWith("image/")
    ? [
        { type: "text", text: prompt() },
        { type: "image_url", image_url: { url: dataUrl } },
      ]
    : [
        { type: "text", text: prompt() },
        { type: "file", file: { filename: fichier.nom, file_data: dataUrl } },
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
      const texte = json.choices?.[0]?.message?.content ?? "";
      if (!texte) throw new Error("Réponse IA vide");
      brut = extraireJson(texte);
      break;
    }
    derniere = `${res.status} ${await res.text()}`;
    if (res.status === 429) throw new Error("Analyse IA momentanément saturée, réessayez.");
    if (res.status !== 400 && res.status !== 404) break;
  }
  if (!brut) throw new Error(`Analyse IA impossible : ${derniere}`);

  const lisible = brut["document_lisible"] !== false;
  const conf = Number(brut["confidence"]);
  const source = (
    typeof brut["pret"] === "object" && brut["pret"] !== null ? brut["pret"] : {}
  ) as Record<string, unknown>;

  const pret: Record<string, unknown> = {};
  if (lisible) {
    for (const [nom] of CHAMPS_PRET) {
      const v = source[nom];
      if (NOMBRES.has(nom)) {
        const n = nombreOuNull(v);
        if (n !== null) pret[nom] = n;
        continue;
      }
      const s = texteOuNull(v);
      if (!s) continue;
      if (nom.startsWith("date_")) {
        const iso = dateIsoOuNull(s);
        if (iso) pret[nom] = iso;
        continue;
      }
      pret[nom] = s;
    }
  }

  return {
    lisible,
    confidence: Number.isFinite(conf) ? Math.min(1, Math.max(0, conf)) : 0,
    pret,
    emprunteurs: lisible ? normaliserEmprunteurs(brut["emprunteurs"]) : [],
  };
}

const BUCKETS = ["dossier-documents", "conformite-documents"];
const TAILLE_MAX = 12 * 1024 * 1024;

/**
 * Lit un document DÉJÀ DÉPOSÉ (offre de prêt / tableau d'amortissement) et en
 * retourne les caractéristiques du prêt et les emprunteurs (dont la quotité).
 * Aucune écriture en base.
 */
export async function analyserOffrePretDocument(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: { from: (t: string) => any; storage: { from: (b: string) => any } },
  documentId: string,
): Promise<AnalyseOffrePret> {
  const { data: doc } = await admin
    .from("documents")
    .select("id, file_name, mime_type, storage_path")
    .eq("id", documentId)
    .maybeSingle();
  if (!doc) throw new Error("Document introuvable");
  const d = doc as { file_name: string | null; mime_type: string | null; storage_path: string };

  let blob: Blob | null = null;
  for (const bucket of BUCKETS) {
    const { data } = await admin.storage.from(bucket).download(d.storage_path);
    if (data) {
      blob = data as Blob;
      break;
    }
  }
  if (!blob) throw new Error("Fichier indisponible dans le stockage");
  const octets = Buffer.from(await blob.arrayBuffer());
  if (octets.byteLength === 0) throw new Error("Fichier vide");
  if (octets.byteLength > TAILLE_MAX) throw new Error("Fichier trop volumineux (12 Mo maximum)");

  return analyserOffrePretFichier({
    nom: d.file_name || "offre-de-pret.pdf",
    mime: blob.type || d.mime_type || "application/pdf",
    base64: octets.toString("base64"),
  });
}
