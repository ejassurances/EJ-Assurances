/**
 * Module réclamations — circuit conformité, distinct du module sinistres.
 *
 * Une réclamation est une plainte contre le cabinet ou contre la gestion d'un
 * dossier (conseil, délai, erreur, gestion par l'assureur) — jamais une demande
 * d'indemnisation sur un événement assuré, qui reste traitée par le module
 * sinistres.
 *
 * L'analyse IA détermine seulement si la réclamation concerne le cabinet ou la
 * compagnie et propose une solution : rien n'est jamais envoyé automatiquement,
 * hors accusé de réception factuel à J+4 (job planifié).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { SupabaseClient } from "@supabase/supabase-js";
import { creerTacheAdmin } from "@/lib/agent-taches.server";

type Admin = SupabaseClient<any, any, any>;

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODELES = ["google/gemini-3.6-flash", "google/gemini-2.5-flash"];
const STATUTS_CONTRAT_ACTIF = ["actif", "contrat_actif", "contrat_valide"];

export type ConcerneReclamation = "cabinet" | "compagnie" | "incertain";

export interface OuvertureReclamation {
  reclamation_id: string;
  concerne: ConcerneReclamation;
  solution_proposee: string | null;
}

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
    derniere = `${res.status} ${(await res.text()).slice(0, 300)}`;
    if (res.status !== 400 && res.status !== 404) break;
  }
  throw new Error(`Analyse IA impossible : ${derniere}`);
}

/**
 * Crée la fiche réclamation, lance l'analyse IA (périmètre + proposition) puis
 * dépose la tâche de traitement humain correspondante.
 */
export async function ouvrirReclamationDepuisEmail(
  admin: Admin,
  params: {
    client_id: string;
    resume: string;
    texte_email: string | null;
    sujet: string | null;
    gmail_message_id: string | null;
    userId: string;
  },
): Promise<OuvertureReclamation | null> {
  const { data: clientRow } = await admin
    .from("clients")
    .select("nom, prenom, email")
    .eq("id", params.client_id)
    .maybeSingle();
  const client = (clientRow as { nom: string | null; prenom: string | null; email: string | null } | null) ?? null;
  const nomClient = [client?.prenom, client?.nom].filter(Boolean).join(" ") || "Client";

  const { data: contratRow } = await admin
    .from("contrats")
    .select("id, numero, assureur, produit, compagnie_id, statut, date_effet")
    .eq("client_id", params.client_id)
    .in("statut", STATUTS_CONTRAT_ACTIF)
    .order("date_effet", { ascending: false })
    .limit(1)
    .maybeSingle();
  const contrat = contratRow as
    | { id: string; numero: string | null; assureur: string | null; produit: string | null; compagnie_id: string | null }
    | null;

  const { data: insere, error } = await admin
    .from("reclamations")
    .upsert(
      {
        client_id: params.client_id,
        contrat_id: contrat?.id ?? null,
        compagnie_id: contrat?.compagnie_id ?? null,
        gmail_message_id: params.gmail_message_id,
        resume: params.resume || (params.sujet ?? "Réclamation reçue par email"),
        concerne: "incertain",
        statut: "ouvert",
        date_ouverture: new Date().toISOString(),
        created_by: params.userId,
      } as never,
      params.gmail_message_id ? { onConflict: "gmail_message_id" } : {},
    )
    .select("id")
    .maybeSingle();
  if (error || !insere) {
    console.error("[agent-reclamation] création impossible", error);
    return null;
  }
  const reclamationId = (insere as { id: string }).id;

  // Lot 7 — ouverture d'une session de journalisation de l'Agent (best-effort,
  // jamais bloquant : un échec de trace ne doit pas affecter la réclamation).
  let agentRunId: string | null = null;
  try {
    const { demarrerRun } = await import("@/lib/agent-gouvernance.server");
    agentRunId = await demarrerRun(admin, {
      agentName: "reclamations",
      triggerType: "email",
      triggerRef: params.gmail_message_id,
      context: { client_id: params.client_id, reclamation_id: reclamationId },
    });
  } catch (e) {
    console.error("[agent-reclamation] run non démarré", e);
  }

  // Aucun libellé de service posé ici : le staff l'a déjà fait manuellement.

  let concerne: ConcerneReclamation = "incertain";
  let solution: string | null = null;
  let motifAnalyse = "";

  try {
    const consigne = [
      "Tu assistes le responsable conformité d'un cabinet de courtage en assurances français dans le",
      "traitement d'une RÉCLAMATION client (pas un sinistre).",
      "Détermine si la réclamation concerne :",
      "- \"cabinet\" : le conseil donné, le délai de traitement, une erreur ou un manquement du cabinet ;",
      "- \"compagnie\" : la gestion du contrat ou du sinistre par l'assureur ;",
      "- \"incertain\" : impossible de trancher avec les éléments fournis.",
      "Si et seulement si concerne = \"cabinet\", propose une solution en 3 phrases maximum : elle peut être",
      "un refus motivé ou un geste commercial. Sinon laisse solution_proposee à null.",
      "N'invente aucun fait, aucune garantie, aucun montant.",
      "",
      `Client : ${nomClient}`,
      `Contrat : ${contrat?.numero ?? "aucun contrat actif"}${contrat?.assureur ? ` — ${contrat.assureur}` : ""}`,
      `Objet du mail : ${params.sujet ?? "(sans objet)"}`,
      "Réclamation exprimée par le client :",
      params.resume,
      (params.texte_email ?? "").slice(0, 4000),
      "",
      'Réponds STRICTEMENT en JSON : {"concerne":"cabinet|compagnie|incertain","solution_proposee":"...|null",',
      '"justification":"2 phrases maximum"}',
    ].join("\n");

    const brut = await appelIa(consigne);
    const c = String(brut["concerne"] ?? "").toLowerCase();
    concerne = c === "cabinet" || c === "compagnie" ? (c as ConcerneReclamation) : "incertain";
    const sol = typeof brut["solution_proposee"] === "string" ? brut["solution_proposee"].trim() : "";
    solution = concerne === "cabinet" && sol && sol.toLowerCase() !== "null" ? sol.slice(0, 4000) : null;
    motifAnalyse = String(brut["justification"] ?? "").trim().slice(0, 1000);
  } catch (e) {
    concerne = "incertain";
    solution = null;
    motifAnalyse = `Analyse indisponible : ${e instanceof Error ? e.message : "erreur inconnue"}.`;
  }

  await admin
    .from("reclamations")
    .update({
      concerne,
      solution_proposee: solution,
      statut: "analyse",
      updated_at: new Date().toISOString(),
    } as never)
    .eq("id", reclamationId);

  // Compagnie : l'adresse dédiée aux réclamations doit être connue.
  let emailReclamationsCompagnie: string | null = null;
  if (concerne === "compagnie" && contrat?.compagnie_id) {
    const { data: comp } = await admin
      .from("compagnies")
      .select("nom, email_reclamations")
      .eq("id", contrat.compagnie_id)
      .maybeSingle();
    emailReclamationsCompagnie = (comp as any)?.email_reclamations ?? null;
    if (!emailReclamationsCompagnie) {
      await creerTacheAdmin(admin as never, {
        titre: `Adresse réclamations manquante — ${(comp as any)?.nom ?? "compagnie"}`.slice(0, 200),
        description: [
          `Réclamation à transmettre : /espace/conformite (onglet Réclamations)`,
          `Client : ${nomClient}`,
          "Action : renseigner l'adresse email dédiée aux réclamations sur la fiche compagnie.",
        ].join("\n"),
        client_id: params.client_id,
        priorite: "haute",
        created_by: params.userId,
      });
    }
  }

  const lienMail = params.gmail_message_id
    ? `https://mail.google.com/mail/u/0/#all/${params.gmail_message_id}`
    : "—";

  await creerTacheAdmin(admin as never, {
    titre: `Réclamation à traiter — ${nomClient}`.slice(0, 200),
    description: [
      `Périmètre : ${concerne === "cabinet" ? "cabinet" : concerne === "compagnie" ? "compagnie" : "à déterminer"}`,
      `Résumé : ${params.resume || params.sujet || "—"}`,
      motifAnalyse ? `Analyse : ${motifAnalyse}` : null,
      solution ? `Proposition à valider : ${solution}` : "Aucune proposition automatique : décision manuelle.",
      concerne === "compagnie"
        ? `Adresse réclamations compagnie : ${emailReclamationsCompagnie ?? "à renseigner sur la fiche compagnie"}`
        : null,
      `Email : ${lienMail}`,
      "Registre : /espace/conformite (onglet Réclamations)",
      "Aucune réponse n'a été envoyée : validation humaine obligatoire.",
    ]
      .filter(Boolean)
      .join("\n"),
    client_id: params.client_id,
    priorite: "urgente",
    created_by: params.userId,
  });

  // Tant que la solution / l'escalade n'est pas validée par le staff.
  if (params.gmail_message_id) {
    const { poserLabelCabinet } = await import("@/lib/gmail.server");
    await poserLabelCabinet(params.gmail_message_id, "rec_attente_validation", { retirer: ["rec_a_traiter"] });
  }

  // Lot 7 — trace de l'action significative + clôture de session. Idempotent sur
  // le message Gmail : un email retraité ne crée pas de doublon dans le journal.
  try {
    const { journaliserAction, terminerRun } = await import("@/lib/agent-gouvernance.server");
    await journaliserAction(admin, {
      runId: agentRunId,
      actionType: "ouverture_reclamation",
      status: "executed",
      targetType: "reclamation",
      targetId: reclamationId,
      idempotencyKey: params.gmail_message_id ? `reclamation:${params.gmail_message_id}` : null,
      outputSummary: `concerne=${concerne}${solution ? " · proposition préparée" : ""} · validation humaine requise`,
    });
    if (agentRunId) {
      await terminerRun(admin, agentRunId, {
        status: "completed",
        summary: `Réclamation ${reclamationId} ouverte (${concerne}) — tâche humaine créée`,
      });
    }
  } catch (e) {
    console.error("[agent-reclamation] journalisation agent échouée", e);
  }

  return { reclamation_id: reclamationId, concerne, solution_proposee: solution };
}
