/* eslint-disable @typescript-eslint/no-explicit-any */
import { geminiFetch } from "@/lib/gemini-gateway.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { creerTacheAdmin } from "@/lib/agent-taches.server";
import {
  OBJET_SUIVI_CONTRATS,
  TITRE_NOTE_RETOUR_SUIVI,
  listeLisibleContrats,
} from "@/lib/suivi-contrats";

/**
 * Conseil dans la durée — envoi groupé du point de suivi périodique et
 * traitement du retour client.
 *
 * Règles cadrées avec le cabinet :
 *  - un seul email par client, listant TOUS ses contrats actifs concernés ;
 *  - après envoi, l'horloge de suivi de tous ses contrats actifs repart ensemble ;
 *  - au retour du client : une tâche admin avec la recommandation de l'agent
 *    ET une note factuelle sur le(s) contrat(s), sans la recommandation.
 *    Jamais d'envoi ni de brouillon automatique dans ce cas précis.
 */

type Admin = SupabaseClient<any, any, any>;

const STATUTS_CONTRAT_ACTIF = ["actif", "contrat_actif", "contrat_valide"];
const GATEWAY = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const MODELES = ["gemini-3.6-flash", "gemini-2.5-flash"];

type ContratSuivi = { id: string; produit: string | null; assureur: string | null; prochain_suivi_le: string | null };
type ClientSuivi = { id: string; nom: string | null; prenom: string | null; email: string | null };

function nomComplet(c: ClientSuivi): string {
  return [c.prenom, c.nom].filter(Boolean).join(" ") || "Client";
}

async function noteContrat(
  admin: Admin,
  params: { client_id: string; contrat_id: string | null; titre: string; contenu: string; created_by?: string | null },
) {
  try {
    await admin.from("activites").insert({
      client_id: params.client_id,
      contrat_id: params.contrat_id,
      type: "systeme",
      titre: params.titre.slice(0, 300),
      contenu: params.contenu.slice(0, 6000),
      ...(params.created_by ? { created_by: params.created_by } : {}),
    });
  } catch (e) {
    console.error("[suivi-contrats] note non enregistrée", e);
  }
}

/** Job quotidien : un email groupé par client dont au moins un contrat est dû. */
export async function envoyerSuivisContratsDus(
  admin: Admin,
): Promise<{ clients: number; envoyes: number; taches: number }> {
  const aujourdhui = new Date().toISOString().slice(0, 10);

  const { data: dus, error } = await admin
    .from("contrats")
    .select("client_id")
    .in("statut", STATUTS_CONTRAT_ACTIF)
    .not("prochain_suivi_le", "is", null)
    .lte("prochain_suivi_le", aujourdhui)
    .limit(1000);
  if (error) throw new Error(error.message);

  const clientIds = [...new Set(((dus ?? []) as any[]).map((r) => r.client_id).filter(Boolean))];
  if (clientIds.length === 0) return { clients: 0, envoyes: 0, taches: 0 };

  let envoyes = 0;
  let taches = 0;

  for (const clientId of clientIds) {
    const { data: clientRow } = await admin
      .from("clients")
      .select("id, nom, prenom, email")
      .eq("id", clientId)
      .maybeSingle();
    const client = (clientRow as ClientSuivi | null) ?? null;
    if (!client) continue;

    // Tous les contrats actifs du client, même ceux pas encore échus.
    const { data: contratsRows } = await admin
      .from("contrats")
      .select("id, produit, assureur, prochain_suivi_le")
      .eq("client_id", clientId)
      .in("statut", STATUTS_CONTRAT_ACTIF);
    const contrats = ((contratsRows ?? []) as ContratSuivi[]).filter((c) => !!c.id);
    if (contrats.length === 0) continue;

    const liste = listeLisibleContrats(contrats.map((c) => c.produit ?? "contrat d'assurance"));

    let envoye = false;
    if (client.email) {
      try {
        const { sendTemplateEmail } = await import("@/lib/email-templates/send-email");
        const res = await sendTemplateEmail("suivi-contrats", client.email, {
          templateData: { prenom: client.prenom ?? nomComplet(client), listeContrats: liste },
          idempotencyKey: `suivi-contrats-${client.id}-${aujourdhui}`,
          liens: { client_id: client.id },
        });
        envoye = res.sent;
      } catch (e) {
        console.error("[suivi-contrats] envoi impossible", e);
        envoye = false;
      }
    }

    if (envoye) {
      envoyes += 1;
      for (const c of contrats) {
        await noteContrat(admin, {
          client_id: client.id,
          contrat_id: c.id,
          titre: "Point de suivi périodique envoyé au client",
          contenu: `Email envoyé à ${client.email} — objet : ${OBJET_SUIVI_CONTRATS}\nContrats listés : ${liste}`,
        });
      }
    } else {
      taches += 1;
      await creerTacheAdmin(admin as never, {
        titre: `Point de suivi à faire manuellement — ${nomComplet(client)}`,
        description: [
          client.email
            ? "L'envoi automatique du point de suivi a échoué."
            : "Aucune adresse email sur la fiche client : point de suivi à réaliser par téléphone ou courrier.",
          `Contrats concernés : ${liste}`,
        ].join("\n"),
        client_id: client.id,
        priorite: "normale",
      });
    }

    // L'horloge de suivi de TOUS les contrats actifs repart ensemble.
    try {
      await (admin as any).rpc("replanifier_suivi_client", { _client_id: client.id });
    } catch (e) {
      console.error("[suivi-contrats] replanification impossible", e);
    }
  }

  return { clients: clientIds.length, envoyes, taches };
}

function extraireJson(texte: string): Record<string, unknown> {
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

async function analyserRetour(params: {
  sujet: string | null;
  texte: string | null;
  contrats: string;
}): Promise<{ retour_client: string; recommandation: string }> {
  const cle = process.env["GEMINI_API_KEY"];
  const brut = (params.texte ?? "").trim().slice(0, 4000);
  if (!cle) return { retour_client: brut, recommandation: "" };

  const consigne = [
    "Tu es assistant relation client dans un cabinet de courtage en assurances français.",
    "Un client répond à notre email de point de suivi périodique sur ses contrats.",
    `Contrats actifs du client : ${params.contrats}`,
    "Produis deux éléments distincts :",
    '- "retour_client" : un résumé STRICTEMENT factuel de ce que le client dit (aucun conseil, aucune interprétation, aucune recommandation).',
    '- "recommandation" : l\'action que le cabinet devrait engager, en une ou deux phrases.',
    "N'invente aucune information absente du message.",
    "",
    `Objet : ${params.sujet ?? "(sans objet)"}`,
    "Message du client :",
    brut,
    "",
    'Réponds STRICTEMENT en JSON : {"retour_client":"...","recommandation":"..."}',
  ].join("\n");

  for (const modele of MODELES) {
    const res = await geminiFetch(GATEWAY, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cle}` },
      body: JSON.stringify({ model: modele, messages: [{ role: "user", content: consigne }] }),
    });
    if (!res.ok) {
      if (res.status !== 400 && res.status !== 404) break;
      continue;
    }
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const contenu = json.choices?.[0]?.message?.content ?? "";
    if (!contenu) break;
    try {
      const data = extraireJson(contenu);
      const retour = typeof data["retour_client"] === "string" ? (data["retour_client"] as string) : brut;
      const reco = typeof data["recommandation"] === "string" ? (data["recommandation"] as string) : "";
      return { retour_client: retour.slice(0, 4000) || brut, recommandation: reco.slice(0, 2000) };
    } catch {
      break;
    }
  }
  return { retour_client: brut, recommandation: "" };
}

/**
 * Traitement dédié du retour client au point de suivi périodique.
 * Ni envoi ni brouillon : uniquement une tâche admin (avec recommandation) et
 * une note factuelle sur chaque contrat actif concerné.
 */
export async function traiterRetourSuiviContrats(
  admin: Admin,
  params: {
    client: ClientSuivi;
    sujet: string | null;
    texte: string | null;
    gmail_message_id: string;
    userId?: string | null;
  },
): Promise<{ action: "tache_et_note"; contrats: number }> {
  const { client } = params;

  const { data: contratsRows } = await admin
    .from("contrats")
    .select("id, produit, assureur, prochain_suivi_le")
    .eq("client_id", client.id)
    .in("statut", STATUTS_CONTRAT_ACTIF);
  const contrats = (contratsRows ?? []) as ContratSuivi[];
  const liste = listeLisibleContrats(contrats.map((c) => c.produit ?? "contrat d'assurance"));

  const analyse = await analyserRetour({ sujet: params.sujet, texte: params.texte, contrats: liste });
  const lienMail = params.gmail_message_id
    ? `https://mail.ionos.fr/`
    : "";

  await creerTacheAdmin(admin as never, {
    titre: `Retour du client sur le point de suivi — ${nomComplet(client)}`,
    description: [
      `Contrats actifs : ${liste}`,
      "",
      `Ce que dit le client : ${analyse.retour_client || "(message vide)"}`,
      "",
      `Recommandation de l'agent : ${analyse.recommandation || "à apprécier par le cabinet."}`,
      lienMail ? `Email : ${lienMail}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    client_id: client.id,
    priorite: "haute",
  });

  // Note factuelle sur chaque contrat : uniquement le retour du client.
  for (const c of contrats) {
    await noteContrat(admin, {
      client_id: client.id,
      contrat_id: c.id,
      titre: TITRE_NOTE_RETOUR_SUIVI,
      contenu: analyse.retour_client || (params.texte ?? "").slice(0, 4000),
    });
  }
  if (contrats.length === 0) {
    await noteContrat(admin, {
      client_id: client.id,
      contrat_id: null,
      titre: TITRE_NOTE_RETOUR_SUIVI,
      contenu: analyse.retour_client || (params.texte ?? "").slice(0, 4000),
    });
  }

  return { action: "tache_et_note", contrats: contrats.length };
}
