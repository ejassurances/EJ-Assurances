import { geminiFetch } from "@/lib/gemini-gateway.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/**
 * Agent veille réglementaire — détecte les emails de la newsletter ACPR,
 * récupère (best-effort) les PDF liés dans le corps du mail, puis demande à
 * l'IA si le contenu concerne l'activité d'assurance / courtage du cabinet.
 *
 * Impact assurance -> entrée « à examiner » + tâche admin + label Gmail
 * « Veille/À examiner ». Sinon entrée « non impacté » + label
 * « Veille/Non impacté », sans tâche.
 */

const GATEWAY = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const MODELES = ["gemini-3.6-flash", "gemini-2.5-flash"];

type Admin = SupabaseClient<Database>;

// Étiquettes Gmail réelles du cabinet (voir LABELS_CABINET).


export interface EmailVeille {
  sujet: string | null;
  expediteur_nom: string | null;
  expediteur_email: string | null;
  texte: string | null;
}

export interface AnalyseVeille {
  sujet: string;
  resume: string;
  impact_assurance: boolean;
  document_source_url: string | null;
}

export interface ResultatVeille {
  action: "ignore" | "veille_creee";
  impact_assurance?: boolean;
  veille_id?: string;
  sujet?: string;
}

/** Vrai si l'email provient de la newsletter réglementaire de l'ACPR. */
export function estEmailVeilleAcpr(email: EmailVeille): boolean {
  const exp = (email.expediteur_email ?? "").toLowerCase();
  const nom = (email.expediteur_nom ?? "").toLowerCase();
  const sujet = (email.sujet ?? "").toLowerCase();
  if (exp.includes("acpr.banque-france.fr")) return true;
  if (exp.includes("banque-france.fr") && /acpr|lettre|newsletter|veille/.test(`${nom} ${sujet}`)) return true;
  if (/\bacpr\b/.test(nom) && /newsletter|lettre|actualit|veille/.test(`${nom} ${sujet}`)) return true;
  return false;
}

/** Liens PDF présents dans le corps du mail (dédoublonnés, 3 maximum). */
export function liensPdf(texte: string | null): string[] {
  if (!texte) return [];
  const trouves = texte.match(/https?:\/\/[^\s"'<>)\]]+/gi) ?? [];
  const pdf = trouves
    .map((u) => u.replace(/[.,;)]+$/, ""))
    .filter((u) => /\.pdf(\?|$)/i.test(u));
  return [...new Set(pdf)].slice(0, 3);
}

const extraireJson = (texte: string): Record<string, unknown> => {
  const nettoye = texte.replace(/```json/gi, "").replace(/```/g, "").trim();
  try {
    return JSON.parse(nettoye) as Record<string, unknown>;
  } catch {
    const debut = nettoye.indexOf("{");
    const fin = nettoye.lastIndexOf("}");
    if (debut === -1 || fin <= debut) throw new Error("Réponse IA illisible (JSON attendu)");
    return JSON.parse(nettoye.slice(debut, fin + 1)) as Record<string, unknown>;
  }
};

const texteOuNull = (v: unknown, max = 400): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t || t.toLowerCase() === "null") return null;
  return t.slice(0, max);
};

const base64De = (octets: ArrayBuffer): string => {
  const bytes = new Uint8Array(octets);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
};

/** Récupération best-effort d'un PDF lié dans le mail (2 Mo maximum). */
async function telechargerPdf(url: string): Promise<{ nom: string; base64: string } | null> {
  try {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    if (!buf.byteLength || buf.byteLength > 2_000_000) return null;
    const nom = decodeURIComponent(url.split("/").pop()?.split("?")[0] || "document.pdf");
    return { nom, base64: base64De(buf) };
  } catch {
    return null;
  }
}

function consigne(email: EmailVeille, urls: string[]): string {
  return [
    "Tu assistes le responsable conformité d'un cabinet de courtage en assurances français (ORIAS,",
    "intermédiation en assurance : emprunteur, santé, prévoyance).",
    "On te transmet un email de veille réglementaire de l'ACPR (autorité qui supervise à la fois les",
    "banques, les organismes d'assurance et les intermédiaires).",
    "Détermine si le contenu concerne l'activité d'assurance ou d'intermédiation en assurance du cabinet.",
    "Si le sujet porte uniquement sur la banque, le crédit, les paiements, la monnaie électronique, les",
    "sociétés de financement ou la résolution bancaire, alors impact_assurance = false.",
    "Rédige un sujet court (moins de 120 caractères) et un résumé de 2 à 4 phrases en français.",
    "N'invente rien : si le contenu est illisible, résume ce qui est visible.",
    "",
    `Expéditeur : ${email.expediteur_nom ?? ""} <${email.expediteur_email ?? ""}>`,
    `Objet : ${email.sujet ?? "(sans objet)"}`,
    `Documents liés : ${urls.join(", ") || "aucun"}`,
    "Corps du message :",
    (email.texte ?? "").slice(0, 8000),
    "",
    'Réponds STRICTEMENT en JSON : {"sujet":"...","resume":"...","impact_assurance":true|false,',
    '"document_source_url":"url du document principal|null"}',
  ].join("\n");
}

/** Analyse IA de l'email de veille (avec les PDF récupérés, si récupérables). */
export async function analyserVeille(
  email: EmailVeille,
  documents: { nom: string; base64: string }[],
  urls: string[],
): Promise<AnalyseVeille> {
  const cle = process.env["GEMINI_API_KEY"];
  if (!cle) throw new Error("Analyse indisponible : clé IA absente du projet.");

  const contenu: unknown[] = [{ type: "text", text: consigne(email, urls) }];
  for (const d of documents) {
    contenu.push({
      type: "file",
      file: { filename: d.nom, file_data: `data:application/pdf;base64,${d.base64}` },
    });
  }

  let derniere = "";
  for (const modele of MODELES) {
    const res = await geminiFetch(GATEWAY, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cle}` },
      body: JSON.stringify({ model: modele, messages: [{ role: "user", content: contenu }] }),
    });
    if (!res.ok) {
      derniere = `${res.status} ${(await res.text()).slice(0, 300)}`;
      if (res.status === 429) throw new Error("Analyse IA momentanément saturée.");
      continue;
    }
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const brutTexte = json.choices?.[0]?.message?.content ?? "";
    if (!brutTexte) {
      derniere = "réponse vide";
      continue;
    }
    const brut = extraireJson(brutTexte);
    return {
      sujet: texteOuNull(brut["sujet"], 160) ?? email.sujet ?? "Veille réglementaire ACPR",
      resume: texteOuNull(brut["resume"], 2000) ?? "",
      impact_assurance: brut["impact_assurance"] === true || String(brut["impact_assurance"]) === "true",
      document_source_url: texteOuNull(brut["document_source_url"], 500) ?? urls[0] ?? null,
    };
  }
  throw new Error(`Analyse IA impossible : ${derniere || "service indisponible"}`);
}

/** Traitement complet d'un email entrant candidat à la veille réglementaire. */
export async function traiterEmailVeille(
  admin: Admin,
  params: { email: EmailVeille; gmail_message_id: string; recu_le?: string | null; userId: string },
): Promise<ResultatVeille> {
  const { email } = params;
  if (!estEmailVeilleAcpr(email)) return { action: "ignore" };

  const { poserLabelCabinet } = await import("@/lib/gmail.server");


  const urls = liensPdf(email.texte);
  const documents: { nom: string; base64: string }[] = [];
  for (const url of urls) {
    const doc = await telechargerPdf(url);
    if (doc) documents.push(doc);
  }

  const analyse = await analyserVeille(email, documents, urls);

  const { data, error } = await admin
    .from("veille_reglementaire")
    .upsert(
      {
        source: "ACPR",
        sujet: analyse.sujet,
        resume: analyse.resume || null,
        impact_assurance: analyse.impact_assurance,
        document_source_url: analyse.document_source_url,
        gmail_message_id: params.gmail_message_id,
        date_reception: params.recu_le ?? new Date().toISOString(),
        statut: analyse.impact_assurance ? "a_examiner" : "non_impacte",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "gmail_message_id" },
    )
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`Enregistrement de la veille impossible : ${error.message}`);

  if (analyse.impact_assurance) {
    const { creerTacheAdmin } = await import("@/lib/agent-taches.server");
    await creerTacheAdmin(admin as never, {
      titre: `Veille réglementaire — ${analyse.sujet} à examiner`.slice(0, 200),
      description: [
        analyse.resume || "(résumé indisponible)",
        "",
        analyse.document_source_url ? `Document source : ${analyse.document_source_url}` : "Document source : —",
        `Email : https://mail.ionos.fr/`,
        "Registre : /espace/conformite (onglet Veille réglementaire)",
      ].join("\n"),
      priorite: "normale",
      created_by: params.userId,
    });
  }

  // Étiquetage Gmail : toute erreur remonte à l'appelant (jamais avalée).
  // Direction Juridique et Conformité : A_Traiter à la réception puis Archive (la veille ne
  // bloque sur aucune validation). Hors périmètre assurance : label « à ignorer ».
  if (analyse.impact_assurance) {
    await poserLabelCabinet(params.gmail_message_id, "veille_archive", { retirer: ["veille_a_traiter"] });
  } else {
    await poserLabelCabinet(params.gmail_message_id, "veille_non_impactee");
  }



  return {
    action: "veille_creee",
    impact_assurance: analyse.impact_assurance,
    veille_id: (data as { id: string } | null)?.id,
    sujet: analyse.sujet,
  };
}
