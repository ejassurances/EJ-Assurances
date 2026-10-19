import { geminiFetch } from "@/lib/gemini-gateway.server";
/**
 * Lecture IA d'une facture d'achat reçue en pièce jointe d'email.
 * Server-only : n'importez jamais ce fichier depuis un composant.
 */

const GATEWAY = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const MODELES = ["gemini-3.6-flash", "gemini-2.5-flash"];

export type FactureLue = {
  fournisseur: string | null;
  numero_facture: string | null;
  date_facture: string | null;
  date_echeance: string | null;
  montant_ht: number | null;
  montant_tva: number | null;
  montant_ttc: number | null;
  taux_tva: number | null;
  nature: string | null;
  compte_charge: string | null;
  confiance: number | null;
};

const PROMPT_BASE = [
  "Tu lis une FACTURE D'ACHAT française (fournisseur d'un cabinet de courtage en assurances).",
  "Extrais les informations comptables sans jamais les inventer : si une donnée est absente, mets null.",
  "",
  "Règles :",
  "- fournisseur : raison sociale de l'émetteur de la facture (pas le cabinet destinataire).",
  "- dates au format ISO AAAA-MM-JJ.",
  "- montants en nombres décimaux (point décimal), sans symbole ni espace.",
  "- taux_tva en pourcentage (ex. 20).",
  "- nature : courte description de la dépense (ex. « abonnement logiciel », « honoraires comptables »).",
  "- compte_charge : numéro de compte du plan comptable français (classe 6) le plus adapté à la dépense, choisi dans la liste fournie si elle est présente.",
  "- confiance : nombre entre 0 et 1.",
  "",
  'Réponds STRICTEMENT en JSON : {"fournisseur":"...","numero_facture":"...","date_facture":"2026-01-31","date_echeance":null,"montant_ht":100.0,"montant_tva":20.0,"montant_ttc":120.0,"taux_tva":20,"nature":"...","compte_charge":"606300","confiance":0.9}',
].join("\n");

function extraireJson(texte: string): Record<string, unknown> {
  const nettoye = texte.replace(/```json/gi, "").replace(/```/g, "").trim();
  try {
    return JSON.parse(nettoye) as Record<string, unknown>;
  } catch {
    const debut = nettoye.indexOf("{");
    const fin = nettoye.lastIndexOf("}");
    if (debut === -1 || fin <= debut) throw new Error("Réponse IA illisible (JSON attendu)");
    return JSON.parse(nettoye.slice(debut, fin + 1)) as Record<string, unknown>;
  }
}

const nombre = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const texteCourt = (v: unknown, max = 200): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;

const dateIso = (v: unknown): string | null => {
  const s = texteCourt(v, 30);
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

/** Analyse le justificatif et renvoie les champs comptables détectés. */
export async function lireFactureDepuisFichier(
  fichier: {
    nom: string;
    mime: string;
    base64: string;
  },
  comptesCharge?: { numero: string; libelle: string }[],
): Promise<FactureLue> {
  const PROMPT =
    comptesCharge && comptesCharge.length > 0
      ? [
          PROMPT_BASE,
          "",
          "Plan comptable du cabinet — choisis compte_charge STRICTEMENT dans cette liste :",
          ...comptesCharge.slice(0, 120).map((c) => `- ${c.numero} : ${c.libelle}`),
        ].join("\n")
      : PROMPT_BASE;

  const cle = process.env["GEMINI_API_KEY"];
  if (!cle) throw new Error("Lecture automatique indisponible : clé IA absente du projet.");

  let derniere = "";
  for (const modele of MODELES) {
    const res = await geminiFetch(GATEWAY, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cle}` },
      body: JSON.stringify({
        model: modele,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: PROMPT },
              fichier.mime.startsWith("image/")
                ? { type: "image_url", image_url: { url: `data:${fichier.mime};base64,${fichier.base64}` } }
                : {
                    type: "file",
                    file: { filename: fichier.nom, file_data: `data:${fichier.mime};base64,${fichier.base64}` },
                  },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      derniere = `${res.status} ${(await res.text()).slice(0, 300)}`;
      continue;
    }
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const contenu = json.choices?.[0]?.message?.content ?? "";
    if (!contenu) {
      derniere = "réponse vide";
      continue;
    }
    const brut = extraireJson(contenu);
    const ht = nombre(brut["montant_ht"]);
    const tva = nombre(brut["montant_tva"]);
    const ttc = nombre(brut["montant_ttc"]);
    return {
      fournisseur: texteCourt(brut["fournisseur"], 160),
      numero_facture: texteCourt(brut["numero_facture"], 60),
      date_facture: dateIso(brut["date_facture"]),
      date_echeance: dateIso(brut["date_echeance"]),
      montant_ht: ht ?? (ttc !== null && tva !== null ? Number((ttc - tva).toFixed(2)) : null),
      montant_tva: tva ?? (ttc !== null && ht !== null ? Number((ttc - ht).toFixed(2)) : null),
      montant_ttc: ttc ?? (ht !== null && tva !== null ? Number((ht + tva).toFixed(2)) : null),
      taux_tva: nombre(brut["taux_tva"]),
      nature: texteCourt(brut["nature"], 200),
      compte_charge: (() => {
        const c = texteCourt(brut["compte_charge"], 20);
        if (!c) return null;
        const num = c.replace(/[^0-9]/g, "");
        if (!num) return null;
        if (comptesCharge && comptesCharge.length > 0) {
          const exact = comptesCharge.find((x) => x.numero === num);
          if (exact) return exact.numero;
          const proche = comptesCharge.find((x) => x.numero.startsWith(num.slice(0, 4)));
          return proche?.numero ?? null;
        }
        return num;
      })(),
      confiance: nombre(brut["confiance"]),
    };
  }
  throw new Error(`Lecture automatique de la facture impossible (${derniere || "service indisponible"}).`);
}
