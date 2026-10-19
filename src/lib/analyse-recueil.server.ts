/**
 * Analyse IA (Gemini) du recueil des besoins d'un dossier.
 *
 * Déclenchée dès que le recueil est complété / la DDA validée : la fiche client
 * et le recueil sont transmis à l'API Gemini, le résultat est stocké sur le
 * dossier (`analyse_ia`) puis le statut du dossier avance vers
 * « devis en cours ». Aucun email n'est envoyé : l'analyse est une aide à la
 * décision, toujours relue par un conseiller.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { SupabaseClient } from "@supabase/supabase-js";
import { STATUTS_DOSSIER_AMONT_ANALYSE } from "./referentiels";

type Db = SupabaseClient<any, any, any>;

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const MODELES = ["gemini-3.6-flash", "gemini-2.5-flash"];

export interface AnalyseRecueil {
  synthese: string;
  besoins_prioritaires: string[];
  points_de_vigilance: string[];
  garanties_recommandees: string[];
  prochaine_action: string;
  recueil_complet: boolean;
  informations_manquantes: string[];
}

function extraireJson(texte: string): Record<string, unknown> {
  const nettoye = texte
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
  try {
    return JSON.parse(nettoye) as Record<string, unknown>;
  } catch {
    const d = nettoye.indexOf("{");
    const f = nettoye.lastIndexOf("}");
    if (d === -1 || f <= d) throw new Error("Réponse Gemini illisible");
    return JSON.parse(nettoye.slice(d, f + 1)) as Record<string, unknown>;
  }
}

function listeTexte(valeur: unknown, max = 8): string[] {
  if (!Array.isArray(valeur)) return [];
  return valeur
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim().slice(0, 400))
    .filter(Boolean)
    .slice(0, max);
}

/**
 * Appel direct à l'API Gemini avec la clé serveur GEMINI_API_KEY.
 */
async function appelGemini(
  consigne: string,
): Promise<{ json: Record<string, unknown>; modele: string }> {
  const cle = process.env["GEMINI_API_KEY"];
  if (!cle) throw new Error("GEMINI_API_KEY n'est pas configurée.");
  let derniere = "";
  for (const modele of MODELES) {
    const res = await fetch(`${ENDPOINT}/${modele}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": cle },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: consigne }] }],
        generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
      }),
    });
    if (res.ok) {
      const json = (await res.json()) as any;
      const contenu: string =
        json?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text ?? "").join("") ?? "";
      if (!contenu) throw new Error("Réponse Gemini vide");
      return { json: extraireJson(contenu), modele };
    }
    derniere = `${res.status} ${(await res.text()).slice(0, 300)}`;
    if (res.status !== 400 && res.status !== 404 && res.status !== 403 && res.status !== 429) break;
  }
  console.warn(
    `[analyse-recueil] API Gemini indisponible (${derniere}).`,
  );
  throw new Error(`Analyse IA impossible : ${derniere}`);
}

/**
 * Analyse le dossier `dossierId` et met à jour le CRM.
 * `db` doit pouvoir lire/écrire le dossier (client authentifié staff ou admin).
 */
export async function analyserRecueilDossier(
  db: Db,
  dossierId: string,
): Promise<{ analyse: AnalyseRecueil; statut: string; modele: string }> {
  const { data: dossierRow, error } = await db
    .from("dossiers")
    .select(
      "id, reference, statut, type_assurance, capital, duree_mois, age, fumeur, economie_estimee, notes, recueil_besoins, client_id, client_nom",
    )
    .eq("id", dossierId)
    .maybeSingle();
  if (error || !dossierRow) throw new Error("Dossier introuvable");
  const dossier = dossierRow as any;

  const recueil = (dossier.recueil_besoins ?? null) as Record<string, unknown> | null;
  if (!recueil || Object.keys(recueil).length === 0) {
    throw new Error("Le recueil des besoins est vide : rien à analyser.");
  }

  let client: any = null;
  if (dossier.client_id) {
    const { data } = await db
      .from("clients")
      .select(
        "civilite, nom, prenom, date_naissance, situation_familiale, nb_enfants, csp, metier, revenus_annuels, fumeur, code_postal, besoins, remarque",
      )
      .eq("id", dossier.client_id)
      .maybeSingle();
    client = data ?? null;
  }

  const consigne = [
    "Tu assistes un cabinet de courtage en assurances français (EJ Partners Assurances).",
    "Analyse le recueil des besoins ci-dessous pour préparer le devoir de conseil.",
    "Appuie-toi UNIQUEMENT sur les informations fournies : n'invente aucune donnée, aucun tarif, aucune garantie chiffrée.",
    "Réponds en français, de façon factuelle et concise.",
    "",
    `Dossier : ${dossier.reference} — type d'assurance : ${dossier.type_assurance}`,
    `Statut actuel : ${dossier.statut}`,
    `Éléments du projet : capital ${dossier.capital ?? "n/c"}, durée ${dossier.duree_mois ?? "n/c"} mois, âge ${dossier.age ?? "n/c"}, fumeur ${dossier.fumeur === null || dossier.fumeur === undefined ? "n/c" : dossier.fumeur ? "oui" : "non"}`,
    dossier.notes ? `Notes internes : ${String(dossier.notes).slice(0, 1500)}` : "",
    "",
    "Fiche client :",
    JSON.stringify(client ?? { nom: dossier.client_nom }),
    "",
    "Recueil des besoins :",
    JSON.stringify(recueil).slice(0, 12000),
    "",
    'Réponds STRICTEMENT en JSON avec ce format : {"synthese":"5 phrases maximum","besoins_prioritaires":["..."],"points_de_vigilance":["..."],"garanties_recommandees":["..."],"prochaine_action":"1 phrase","recueil_complet":true,"informations_manquantes":["..."]}',
  ]
    .filter(Boolean)
    .join("\n");

  const { json, modele } = await appelGemini(consigne);

  const analyse: AnalyseRecueil = {
    synthese: String(json["synthese"] ?? "")
      .trim()
      .slice(0, 3000),
    besoins_prioritaires: listeTexte(json["besoins_prioritaires"]),
    points_de_vigilance: listeTexte(json["points_de_vigilance"]),
    garanties_recommandees: listeTexte(json["garanties_recommandees"]),
    prochaine_action: String(json["prochaine_action"] ?? "")
      .trim()
      .slice(0, 600),
    recueil_complet: json["recueil_complet"] === true,
    informations_manquantes: listeTexte(json["informations_manquantes"]),
  };

  // Avancement du pipeline : uniquement depuis les étapes amont, pour ne jamais
  // faire reculer un dossier déjà en souscription ou clôturé.
  const statutsAmont: readonly string[] = STATUTS_DOSSIER_AMONT_ANALYSE;
  const nouveauStatut =
    analyse.recueil_complet && statutsAmont.includes(String(dossier.statut))
      ? "devis_en_cours"
      : String(dossier.statut);

  const { error: upErr } = await db
    .from("dossiers")
    .update({
      analyse_ia: analyse as never,
      analyse_ia_le: new Date().toISOString(),
      analyse_ia_modele: modele,
      statut: nouveauStatut as never,
    })
    .eq("id", dossierId);
  if (upErr) throw new Error(upErr.message);

  return { analyse, statut: nouveauStatut, modele };
}
