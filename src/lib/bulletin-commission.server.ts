import { geminiFetch } from "@/lib/gemini-gateway.server";
/**
 * Lecture IA d'un bulletin / bordereau de commissions reçu d'une compagnie.
 * Server-only : n'importez jamais ce fichier depuis un composant.
 */

const GATEWAY = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const MODELES = ["gemini-3.6-flash", "gemini-2.5-flash"];

export type LigneBulletinLue = {
  client_nom: string | null;
  numero_contrat: string | null;
  produit: string | null;
  periode: string | null;
  montant: number | null;
  assiette: number | null;
  taux: number | null;
};

export type BulletinLu = {
  assureur: string | null;
  periode: string | null;
  montant_total: number | null;
  confiance: number | null;
  lignes: LigneBulletinLue[];
};

const PROMPT = [
  "Examine visuellement tout le document, notamment logo, en-tête, dates, période de règlement et mentions de l’émetteur. La compagnie et la période doivent être extraites du document, pas supposées à partir du nom de fichier ni de la date du jour.",
  "Tu lis un BULLETIN (ou bordereau) DE COMMISSIONS émis par une compagnie d'assurance française à destination d'un cabinet de courtage.",
  "Objectif : extraire l'en-tête et TOUTES les lignes de commission, sans jamais inventer de données (null si absent).",
  "",
  "Règles :",
  "- assureur : nom exact de la compagnie/assureur qui a émis le bulletin, à relever dans le logo, l’en-tête, le pied de page ou les mentions légales ; ne confonds pas avec le cabinet destinataire ou un courtier gestionnaire. Retourne null si impossible à déterminer.",
  "- periode : mois de commission/règlement couvert par le bulletin, pas la date d’édition ni la date du jour. Cherche dans l’en-tête, le titre, les périodes de règlement et les dates des tableaux. Si un mois et une année sont identifiables, retourne toujours au format strict « AAAA-MM » (ex. juillet 2026 = « 2026-07 »). Si plusieurs périodes figurent, choisis la période principale du bulletin ; si aucune période ne peut être établie, retourne null.",
  "- montant_total : total net de commissions du bulletin (nombre décimal, point décimal).",
  "- lignes : une entrée par ligne de commission du tableau.",
  "  - client_nom : nom (et prénom si présent) de l'assuré/souscripteur de la ligne.",
  "  - numero_contrat : référence du contrat / police telle qu'imprimée.",
  "  - produit : libellé du produit ou de la garantie.",
  "  - periode : période propre à la ligne si différente de l'en-tête.",
  "  - montant : commission de la ligne (négative si reprise/annulation).",
  "  - assiette : prime ou base de calcul de la ligne.",
  "  - taux : taux de commission en pourcentage (ex. 12.5).",
  "- N'agrège jamais plusieurs lignes ; ignore les lignes de sous-total et de total.",
  "- confiance : nombre entre 0 et 1 sur la qualité globale de lecture.",
  "",
  'Réponds STRICTEMENT en JSON : {"assureur":"...","periode":"2026-07","montant_total":1234.56,"confiance":0.9,"lignes":[{"client_nom":"DUPONT Jean","numero_contrat":"A123456","produit":"Emprunteur","periode":null,"montant":42.5,"assiette":340,"taux":12.5}]}',
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
    const n = Number(v.replace(/[\s€%]/g, "").replace(/\u00a0/g, "").replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const texteCourt = (v: unknown, max = 200): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;

/** Analyse le bulletin et renvoie l'en-tête et les lignes détectées. */
export async function lireBulletinCommission(fichier: {
  nom: string;
  mime: string;
  base64: string;
}): Promise<BulletinLu> {
  const cle = process.env["GEMINI_API_KEY"];
  if (!cle) throw new Error("Analyse indisponible : clé IA absente du projet.");

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
    const lignesBrutes = Array.isArray(brut["lignes"]) ? (brut["lignes"] as unknown[]) : [];
    const lignes: LigneBulletinLue[] = lignesBrutes
      .filter((l): l is Record<string, unknown> => typeof l === "object" && l !== null)
      .map((l) => ({
        client_nom: texteCourt(l["client_nom"], 160),
        numero_contrat: texteCourt(l["numero_contrat"], 80),
        produit: texteCourt(l["produit"], 160),
        periode: texteCourt(l["periode"], 40),
        montant: nombre(l["montant"]),
        assiette: nombre(l["assiette"]),
        taux: nombre(l["taux"]),
      }))
      .filter((l) => l.client_nom || l.numero_contrat || l.montant !== null)
      .slice(0, 400);

    return {
      assureur: texteCourt(brut["assureur"], 160),
      periode: texteCourt(brut["periode"], 40),
      montant_total: nombre(brut["montant_total"]),
      confiance: nombre(brut["confiance"]),
      lignes,
    };
  }
  throw new Error(`Analyse du bulletin impossible (${derniere || "service indisponible"}).`);
}
