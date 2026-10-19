/**
 * LOT 1 — Analyse d'intention des emails entrants (Gemini, sortie STRUCTURÉE).
 *
 * Gemini ANALYSE le contenu du mail AVANT toute décision de routage ou de
 * statut. Il ne décide rien : le résultat est consommé par le moteur de
 * décision CRM (`src/lib/email-decision.ts`).
 *
 * Le résultat est journalisé dans `crm_emails.triage_ia.analyse_gemini`
 * (aucune colonne ni table créée — la colonne `ai_metadata` n'existe pas dans
 * ce projet, `triage_ia` est la colonne d'analyse existante).
 */
import { geminiFetch } from "@/lib/gemini-gateway.server";
import {
  INTENTIONS_EMAIL,
  estIntention,
  type AnalyseIntentionEmail,
} from "@/lib/email-intention-types";

const GATEWAY = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const MODELES = ["gemini-3.6-flash", "gemini-2.5-flash"];

export interface EmailAAnalyser {
  sujet: string | null;
  expediteur_nom: string | null;
  expediteur_email: string | null;
  texte: string | null;
  pieces_jointes: { nom: string }[];
}

/** Schéma JSON structuré imposé au modèle. */
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "intention",
    "confidence",
    "summary",
    "client_identifiable",
    "contrat_identifiable",
    "reference_contrat",
    "telephone",
    "siren",
    "documents_demandes",
    "documents_recus",
    "action_recommandee",
  ],
  properties: {
    intention: { type: "string", enum: [...INTENTIONS_EMAIL] },
    confidence: { type: "number" },
    summary: { type: "string" },
    client_identifiable: { type: "boolean" },
    contrat_identifiable: { type: "boolean" },
    reference_contrat: { type: ["string", "null"] },
    telephone: { type: ["string", "null"] },
    siren: { type: ["string", "null"] },
    documents_demandes: { type: "array", items: { type: "string" } },
    documents_recus: { type: "array", items: { type: "string" } },
    action_recommandee: { type: ["string", "null"] },
  },
} as const;

function consigne(email: EmailAAnalyser): string {
  return [
    "Tu es analyste du courrier entrant d'un cabinet de courtage en assurances français.",
    "Tu ANALYSES uniquement : tu ne décides jamais d'une action engageante, tu ne signes rien,",
    "tu ne valides rien. Le CRM décide ensuite à partir de ton analyse.",
    "",
    "Classe la demande dans UNE SEULE intention parmi :",
    ...INTENTIONS_EMAIL.map((i) => `- ${i}`),
    "N'invente aucune autre catégorie. Si tu hésites ou si le message est trop pauvre : A_QUALIFIER.",
    "",
    "Règles impératives :",
    "- confidence : nombre entre 0 et 1, reflet honnête de ta certitude.",
    "- reference_contrat, telephone, siren : uniquement s'ils figurent EXPLICITEMENT dans le message,",
    "  sinon null. N'invente jamais une référence, un numéro de téléphone ou un SIREN.",
    "- documents_demandes : documents que l'expéditeur RÉCLAME (ex. ATTESTATION).",
    "- documents_recus : documents que l'expéditeur JOINT ou annonce joindre (d'après les noms de fichiers).",
    "- client_identifiable / contrat_identifiable : true seulement si le message contient de quoi",
    "  identifier la personne ou son contrat (nom complet, référence, numéro de contrat).",
    "- action_recommandee : la prochaine action administrative à PRÉPARER (ex. PREPARER_ATTESTATION),",
    "  jamais une action déjà réalisée, sinon null.",
    "- summary : une phrase factuelle, à la troisième personne, sans conseil.",
    "",
    `Expéditeur : ${email.expediteur_nom ?? ""} <${email.expediteur_email ?? ""}>`,
    `Objet : ${email.sujet ?? "(sans objet)"}`,
    `Pièces jointes : ${email.pieces_jointes.map((p) => p.nom).join(", ") || "aucune"}`,
    "Corps du message :",
    (email.texte ?? "").slice(0, 8000),
  ].join("\n");
}

function extraireJson(texte: string): Record<string, unknown> {
  const nettoye = texte.replace(/```json/gi, "").replace(/```/g, "").trim();
  try {
    return JSON.parse(nettoye) as Record<string, unknown>;
  } catch {
    const d = nettoye.indexOf("{");
    const f = nettoye.lastIndexOf("}");
    if (d === -1 || f <= d) throw new Error("Réponse IA illisible (JSON attendu)");
    return JSON.parse(nettoye.slice(d, f + 1)) as Record<string, unknown>;
  }
}

function texteOuNull(v: unknown, max = 120): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t || t.toLowerCase() === "null") return null;
  return t.slice(0, max);
}

function liste(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => texteOuNull(x, 80))
    .filter((x): x is string => !!x)
    .slice(0, 20);
}

function normaliser(brut: Record<string, unknown>, modele: string): AnalyseIntentionEmail {
  const intention = estIntention(brut["intention"]) ? brut["intention"] : "A_QUALIFIER";
  const confidence = Math.max(0, Math.min(1, Number(brut["confidence"]) || 0));
  return {
    intention,
    confidence: intention === "A_QUALIFIER" ? Math.min(confidence, 0.69) : confidence,
    summary: texteOuNull(brut["summary"], 400) ?? "",
    client_identifiable: brut["client_identifiable"] === true,
    contrat_identifiable: brut["contrat_identifiable"] === true,
    reference_contrat: texteOuNull(brut["reference_contrat"], 60),
    telephone: texteOuNull(brut["telephone"], 30),
    siren: texteOuNull(brut["siren"], 20),
    documents_demandes: liste(brut["documents_demandes"]),
    documents_recus: liste(brut["documents_recus"]),
    action_recommandee: texteOuNull(brut["action_recommandee"], 60),
    modele,
  };
}

/**
 * Analyse structurée d'un email. Ne lève jamais pour un simple refus du
 * modèle : en cas d'échec définitif l'appelant reçoit `null` et le moteur de
 * décision retombe sur le libellé Gmail (fallback documenté).
 */
export async function analyserIntentionEmail(
  email: EmailAAnalyser,
): Promise<AnalyseIntentionEmail | null> {
  const cle = process.env["GEMINI_API_KEY"];
  if (!cle) {
    console.error("[email-intention] clé IA absente : analyse impossible");
    return null;
  }

  let derniere = "";
  for (const modele of MODELES) {
    try {
      const res = await geminiFetch(GATEWAY, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${cle}` },
        body: JSON.stringify({
          model: modele,
          messages: [{ role: "user", content: consigne(email) }],
          response_format: {
            type: "json_schema",
            json_schema: { name: "analyse_email", strict: true, schema: SCHEMA },
          },
        }),
      });
      if (res.ok) {
        const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
        return normaliser(extraireJson(json.choices?.[0]?.message?.content ?? ""), modele);
      }
      derniere = `${res.status} ${await res.text()}`;
      if (res.status === 429) break;
    } catch (e) {
      derniere = e instanceof Error ? e.message : "erreur inconnue";
    }
  }
  console.error("[email-intention] analyse indisponible", derniere);
  return null;
}
