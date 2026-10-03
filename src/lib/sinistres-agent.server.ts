/**
 * Ouverture automatique d'un dossier sinistre depuis un email client classé
 * niveau 0 / sous-type "sinistre", puis analyse de couverture à partir de la
 * SEULE grille de garanties validée du produit du contrat actif.
 *
 * Aucun envoi d'email n'est déclenché ici : l'analyse est une aide à la
 * décision pour le cabinet.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { SupabaseClient } from "@supabase/supabase-js";
import { grillePourFamille, synthetiserGaranties, type ValeursGrille } from "@/lib/garanties-grille";

type Admin = SupabaseClient<any, any, any>;

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODELES = ["google/gemini-3.6-flash", "google/gemini-2.5-flash"];
const STATUTS_CONTRAT_ACTIF = ["actif", "contrat_actif", "contrat_valide"];

export type ActionSinistre = "reponse_non_couvert" | "transmission_compagnie" | "escalade_humaine";

function extraireJson(texte: string): Record<string, unknown> {
  const nettoye = texte.replace(/```json/gi, "").replace(/```/g, "").trim();
  try {
    return JSON.parse(nettoye) as Record<string, unknown>;
  } catch {
    const d = nettoye.indexOf("{");
    const f = nettoye.lastIndexOf("}");
    if (d === -1 || f <= d) throw new Error("Réponse IA illisible");
    return JSON.parse(nettoye.slice(d, f + 1)) as Record<string, unknown>;
  }
}

/** Trame factuelle de la grille validée du produit (ou null si absente). */
async function grilleValidee(
  admin: Admin,
  produitId: string | null,
): Promise<{ produit: string; lignes: string[] } | null> {
  if (!produitId) return null;
  const { data: produit } = await admin
    .from("produits")
    .select("nom, produit_familles!produits_famille_id_fkey(code)")
    .eq("id", produitId)
    .maybeSingle();
  const grille = grillePourFamille((produit as any)?.produit_familles?.code ?? null);
  if (!grille) return null;

  const { data: ligne } = await admin
    .from("produit_garanties")
    .select("grille_version, valeurs, statut")
    .eq("produit_id", produitId)
    .maybeSingle();
  const g = ligne as { grille_version: number; valeurs: ValeursGrille; statut: string } | null;
  if (!g || g.statut !== "valide" || g.grille_version !== grille.version) return null;

  const synthese = synthetiserGaranties(grille, g.valeurs ?? {});
  const lignes = synthese.detail.map((d) => {
    const etat =
      d.couverture === "oui"
        ? "couvert"
        : d.couverture === "option"
          ? "couvert en option"
          : d.couverture === "non"
            ? "NON couvert / exclu"
            : "non renseigné dans la grille";
    const precisions = [
      d.plafond ? `plafond ${d.plafond}` : null,
      d.franchise ? `franchise ${d.franchise}` : null,
      d.delai_carence ? `délai de carence ${d.delai_carence}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    return `- ${d.libelle} : ${etat}${precisions ? ` (${precisions})` : ""}`;
  });
  return { produit: (produit as any)?.nom ?? "produit", lignes };
}

async function appelIa(consigne: string): Promise<Record<string, unknown>> {
  const cle = process.env["LOVABLE_API_KEY"];
  if (!cle) throw new Error("Analyse indisponible : clé IA absente du projet.");
  let derniere = "";
  for (const modele of MODELES) {
    const res = await fetch(GATEWAY, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cle}` },
      body: JSON.stringify({ model: modele, messages: [{ role: "user", content: consigne }] }),
    });
    if (res.ok) {
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const contenu = json.choices?.[0]?.message?.content ?? "";
      if (!contenu) throw new Error("Réponse IA vide");
      return extraireJson(contenu);
    }
    derniere = `${res.status} ${await res.text()}`;
    if (res.status !== 400 && res.status !== 404) break;
  }
  throw new Error(`Analyse IA impossible : ${derniere}`);
}

export interface OuvertureSinistre {
  sinistre_id: string;
  action_recommandee: ActionSinistre;
  analyse_couverture: string;
}

/**
 * Crée la fiche sinistre puis, si possible, l'analyse de couverture.
 * Ne lève jamais pour l'analyse : le dossier reste ouvert et escaladé.
 */
export async function ouvrirSinistreDepuisEmail(
  admin: Admin,
  params: {
    client_id: string;
    resume: string;
    texte_email: string | null;
    sujet: string | null;
    gmail_message_id: string | null;
    userId: string;
  },
): Promise<OuvertureSinistre | null> {
  const { data: contratRow } = await admin
    .from("contrats")
    .select("id, numero, assureur, produit, produit_id, statut")
    .eq("client_id", params.client_id)
    .in("statut", STATUTS_CONTRAT_ACTIF)
    .order("date_effet", { ascending: false })
    .limit(1)
    .maybeSingle();
  const contrat = contratRow as { id: string; numero: string | null; produit_id: string | null } | null;

  const { data: insere, error } = await admin
    .from("sinistres")
    .upsert(
      {
        client_id: params.client_id,
        contrat_id: contrat?.id ?? null,
        statut: "ouvert",
        etape: "declare",
        gmail_message_id: params.gmail_message_id,
        resume: params.resume || (params.sujet ?? "Sinistre déclaré par email"),
        description: (params.texte_email ?? "").slice(0, 6000) || null,
        declare_par_client: true,
        declare_le: new Date().toISOString(),
        date_ouverture: new Date().toISOString(),
        created_by: params.userId,
      } as never,
      params.gmail_message_id ? { onConflict: "gmail_message_id" } : {},
    )
    .select("id")
    .maybeSingle();
  if (error || !insere) {
    console.error("[agent-sinistre] création impossible", error);
    return null;
  }
  const sinistreId = (insere as { id: string }).id;

  // Lot 7 — session de journalisation de l'Agent (best-effort, jamais bloquant).
  let agentRunId: string | null = null;
  try {
    const { demarrerRun } = await import("@/lib/agent-gouvernance.server");
    agentRunId = await demarrerRun(admin, {
      agentName: "sinistres",
      triggerType: "email",
      triggerRef: params.gmail_message_id,
      context: { client_id: params.client_id, sinistre_id: sinistreId },
    });
  } catch (e) {
    console.error("[agent-sinistre] run non démarré", e);
  }

  let action: ActionSinistre = "escalade_humaine";
  let analyse = "";
  try {
    const grille = await grilleValidee(admin, contrat?.produit_id ?? null);
    if (!grille) {
      analyse =
        "Aucune grille de garanties validée n'est disponible pour le produit du contrat actif de ce client : aucune analyse de couverture n'a pu être menée. Escalade humaine obligatoire.";
    } else {
      const consigne = [
        "Tu assistes un cabinet de courtage en assurances français dans l'analyse d'un sinistre déclaré par un client.",
        "Tu ne dois t'appuyer QUE sur les données factuelles de la grille de garanties validée ci-dessous.",
        "N'invente aucune garantie, aucun plafond, aucune exclusion. Si la grille ne permet pas de trancher, réponds 'incertain'.",
        "",
        `Produit du contrat : ${grille.produit}${contrat?.numero ? ` (contrat ${contrat.numero})` : ""}`,
        "Grille de garanties validée :",
        ...grille.lignes,
        "",
        "Sinistre décrit par le client :",
        params.resume,
        (params.texte_email ?? "").slice(0, 4000),
        "",
        'Réponds STRICTEMENT en JSON : {"verdict":"couvert|non_couvert|incertain","justification":"3 phrases maximum, factuelles, citant les postes de la grille utilisés"}',
      ].join("\n");
      const brut = await appelIa(consigne);
      const verdict = String(brut["verdict"] ?? "").toLowerCase();
      const justification = String(brut["justification"] ?? "").trim().slice(0, 2000);
      if (verdict === "non_couvert") action = "reponse_non_couvert";
      else if (verdict === "couvert") action = "transmission_compagnie";
      else action = "escalade_humaine";
      const label =
        verdict === "non_couvert"
          ? "Clairement exclu par la grille"
          : verdict === "couvert"
            ? "Probablement couvert / à instruire par l'assureur"
            : "Analyse incertaine";
      analyse = `${label}.\n\n${justification || "Aucune justification fournie par l'analyse."}`;
    }
  } catch (e) {
    analyse = `Analyse de couverture indisponible : ${e instanceof Error ? e.message : "erreur inconnue"}. Escalade humaine.`;
    action = "escalade_humaine";
  }

  await admin
    .from("sinistres")
    .update({
      statut: "en_analyse",
      analyse_couverture: analyse,
      action_recommandee: action,
      updated_at: new Date().toISOString(),
    } as never)
    .eq("id", sinistreId);

  // Service Client : le dossier est ouvert (A_Traiter) puis passe en attente
  // de validation tant qu'aucune des actions manuelles n'a été prise. Le
  // statut lu / non lu du message n'entre jamais en compte.
  if (params.gmail_message_id) {
    const { poserLabelCabinet } = await import("@/lib/gmail.server");
    await poserLabelCabinet(params.gmail_message_id, "sc_attente_validation", {
      retirer: ["sc_a_traiter"],
    });
  }

  // Lot 7 — trace de l'action + clôture de session. Idempotent sur le message
  // Gmail : un email retraité ne crée pas de doublon dans le journal.
  try {
    const { journaliserAction, terminerRun } = await import("@/lib/agent-gouvernance.server");
    await journaliserAction(admin, {
      runId: agentRunId,
      actionType: "ouverture_sinistre",
      status: "executed",
      targetType: "sinistre",
      targetId: sinistreId,
      idempotencyKey: params.gmail_message_id ? `sinistre:${params.gmail_message_id}` : null,
      outputSummary: `action_recommandee=${action} · aide à la décision, aucun envoi automatique`,
    });
    if (agentRunId) {
      await terminerRun(admin, agentRunId, {
        status: "completed",
        summary: `Sinistre ${sinistreId} ouvert — recommandation ${action}`,
      });
    }
  } catch (e) {
    console.error("[agent-sinistre] journalisation agent échouée", e);
  }

  return { sinistre_id: sinistreId, action_recommandee: action, analyse_couverture: analyse };
}
