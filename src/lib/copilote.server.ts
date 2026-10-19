import { geminiFetch } from "@/lib/gemini-gateway.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PRIORITES_TACHE } from "./referentiels";
import { ETAPES } from "@/lib/pipeline-dossier";
import { phaseClient } from "@/lib/pipeline-client";
import { labelForBranche } from "@/lib/recueil-besoins-schemas";

const GATEWAY = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const MODELES = ["gemini-3.6-flash", "gemini-2.5-flash"];

export type ModeCopilote = "synthese" | "prochaine_action" | "email_client" | "email_compagnie";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>;

async function appelerIa(systeme: string, utilisateur: string) {
  const cle = process.env["GEMINI_API_KEY"];
  if (!cle) throw new Error("Copilote indisponible : clé IA absente du projet.");

  let derniere = "";
  for (const modele of MODELES) {
    const res = await geminiFetch(GATEWAY, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cle}` },
      body: JSON.stringify({
        model: modele,
        messages: [
          { role: "system", content: systeme },
          { role: "user", content: utilisateur },
        ],
      }),
    });
    if (res.ok) {
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const contenu = json.choices?.[0]?.message?.content ?? "";
      if (!contenu) throw new Error("Réponse IA vide");
      return { modele, contenu };
    }
    derniere = `${res.status} ${await res.text()}`;
    if (res.status === 429) throw new Error("Copilote momentanément saturé, réessayez dans une minute.");
    if (res.status !== 400 && res.status !== 404) break;
  }
  throw new Error(`Copilote indisponible : ${derniere}`);
}

/** Rassemble le contexte d'un dossier, sous les droits de l'utilisateur (RLS). */
export async function contexteDossierCopilote(supabase: Db, dossierId: string) {
  const { data: dossier, error } = await supabase
    .from("dossiers")
    .select(
      "id, reference, statut, type_assurance, client_nom, client_email, client_id, capital, duree_mois, economie_estimee, notes, recueil_besoins, souscription_envoyee_le, souscription_relances_nb, created_at, compagnies:compagnie_id(nom), produits:produit_id(nom)",
    )
    .eq("id", dossierId)
    .maybeSingle();
  if (error || !dossier) throw new Error("Dossier introuvable ou accès refusé");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = dossier as any;

  const [client, devoir, devis, pieces, historique, contrats] = await Promise.all([
    d.client_id
      ? supabase
          .from("clients")
          .select(
            "id, prenom, nom, email, telephone, statut, conformite_score, conformite_niveau, dda_statut, marque",
          )
          .eq("id", d.client_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("devoirs_conseil")
      .select("id, statut, recommandation, motifs, refus_motif, created_at")
      .eq("dossier_id", dossierId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("dossier_devis")
      .select("cotisation_mensuelle, garanties_resume, compagnies:compagnie_id(nom), produits:produit_id(nom)")
      .eq("dossier_id", dossierId)
      .limit(6),
    supabase
      .from("dossier_pieces_requises")
      .select("libelle, obligatoire, statut")
      .eq("dossier_id", dossierId)
      .limit(30),
    supabase
      .from("dossier_etapes_historique")
      .select("ancienne_etape, nouvelle_etape, commentaire, created_at")
      .eq("dossier_id", dossierId)
      .order("created_at", { ascending: false })
      .limit(10),
    d.client_id
      ? supabase
          .from("contrats")
          .select("numero, assureur, produit, statut, prime_annuelle, date_effet")
          .eq("client_id", d.client_id)
          .limit(10)
      : Promise.resolve({ data: [] }),
  ]);

  const etape = ETAPES.find((e) => e.key === d.statut);
  const phase = phaseClient(d.statut);

  return {
    dossier: {
      reference: d.reference,
      branche: labelForBranche(d.type_assurance),
      grande_etape: phase ? `${phase.label} — ${phase.description}` : "Hors parcours nominal",
      etape: etape ? `${etape.label} (${etape.description})` : d.statut,

      client: d.client_nom,
      email: d.client_email,
      capital: d.capital,
      duree_mois: d.duree_mois,
      economie_estimee: d.economie_estimee,
      compagnie: d.compagnies?.nom ?? null,
      produit: d.produits?.nom ?? null,
      notes: d.notes,
      cree_le: d.created_at,
      souscription_envoyee_le: d.souscription_envoyee_le,
      souscription_relances: d.souscription_relances_nb,
    },
    client: client?.data ?? null,
    recueil: d.recueil_besoins ?? null,
    devoir_conseil: devoir?.data ?? null,
    devis: devis?.data ?? [],
    pieces: pieces?.data ?? [],
    historique: historique?.data ?? [],
    contrats: contrats?.data ?? [],
  };
}

const SYSTEME = [
  "Tu es le copilote d'un cabinet de courtage en assurances français (EJ Partners Assurances).",
  "Tu travailles pour le courtier, jamais pour le client final.",
  "Règles impératives :",
  "- Ne t'appuie que sur les données fournies ; si une information manque, dis-le explicitement.",
  "- N'invente aucun tarif, aucune garantie, aucun numéro de contrat.",
  "- Respecte la réglementation DDA/ACPR : pas de promesse de rendement, pas de conseil sans recueil des besoins,",
  "  rappel de la validation humaine lorsque tu proposes un document réglementaire.",
  "- Réponds en français, de façon concise et directement exploitable.",
].join("\n");

function consigne(mode: ModeCopilote): string {
  switch (mode) {
    case "synthese":
      return [
        "Rédige une synthèse du dossier en markdown, en 4 sections courtes :",
        "**Situation** (client, projet, chiffres clés), **Où en est le dossier**,",
        "**Points de vigilance conformité** (KYC, score, DDA, pièces manquantes),",
        "**Ce qui bloque** (le cas échéant). 250 mots maximum.",
      ].join(" ");
    case "prochaine_action":
      return [
        "Détermine LA prochaine action concrète à réaliser par le cabinet sur ce dossier.",
        'Réponds STRICTEMENT en JSON : {"titre":"action courte (80 caractères max)",',
        '"description":"pourquoi et comment, 400 caractères max","echeance_jours":3,"priorite":"basse|normale|haute|urgente"}',
      ].join(" ");
    case "email_client":
      return [
        "Rédige un brouillon d'email du cabinet AU CLIENT, adapté à l'étape actuelle du dossier.",
        'Réponds STRICTEMENT en JSON : {"objet":"...","corps":"texte brut avec sauts de ligne, sans signature"}',
        "Pas de tarif inventé, pas d'engagement de garantie ; ton professionnel et chaleureux.",
      ].join(" ");
    case "email_compagnie":
      return [
        "Rédige un brouillon d'email du cabinet À LA COMPAGNIE (service souscription), adapté à l'étape actuelle.",
        'Réponds STRICTEMENT en JSON : {"objet":"...","corps":"texte brut avec sauts de ligne, sans signature"}',
        "Rappelle la référence du dossier et formule une demande précise.",
      ].join(" ");
  }
}

export function extraireJson(texte: string): Record<string, unknown> {
  const nettoye = texte.replace(/```json/gi, "").replace(/```/g, "").trim();
  try {
    return JSON.parse(nettoye) as Record<string, unknown>;
  } catch {
    const debut = nettoye.indexOf("{");
    const fin = nettoye.lastIndexOf("}");
    if (debut === -1 || fin <= debut) throw new Error("Réponse IA illisible");
    return JSON.parse(nettoye.slice(debut, fin + 1)) as Record<string, unknown>;
  }
}

/** Exécute une demande du copilote sur un dossier. */
export async function executerCopilote(
  supabase: Db,
  dossierId: string,
  mode: ModeCopilote,
  precision?: string | null,
) {
  const ctx = await contexteDossierCopilote(supabase, dossierId);
  const utilisateur = [
    consigne(mode),
    precision ? `Précision du courtier : ${precision}` : "",
    "",
    "Données du dossier (JSON) :",
    JSON.stringify(ctx).slice(0, 20000),
  ]
    .filter(Boolean)
    .join("\n");

  const { modele, contenu } = await appelerIa(SYSTEME, utilisateur);

  if (mode === "synthese") {
    return { mode, modele, texte: contenu.slice(0, 6000) };
  }
  const json = extraireJson(contenu);
  if (mode === "prochaine_action") {
    const priorites: readonly string[] = PRIORITES_TACHE;
    const priorite = String(json["priorite"] ?? "normale");
    return {
      mode,
      modele,
      action: {
        titre: String(json["titre"] ?? "").slice(0, 120) || "Action à définir",
        description: String(json["description"] ?? "").slice(0, 1000),
        echeance_jours: Math.max(0, Math.min(60, Number(json["echeance_jours"] ?? 3) || 3)),
        priorite: priorites.includes(priorite) ? priorite : "normale",
      },
    };
  }
  return {
    mode,
    modele,
    email: {
      objet: String(json["objet"] ?? "").slice(0, 300),
      corps: String(json["corps"] ?? "").slice(0, 8000),
    },
  };
}
