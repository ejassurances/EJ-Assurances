import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/**
 * Agent finance — lit les emails entrants du cabinet non rattachés à un client
 * et détecte s'il s'agit d'une facture fournisseur ou d'un bordereau de
 * commissions. L'extraction réutilise les modules existants
 * (`facture-email.server` et `bulletin-commission.server`).
 *
 * Principe appliqué partout dans le CRM : aucun rapprochement de paiement
 * automatique. Rien n'est marqué « payé », et toute anomalie ouvre une tâche.
 */

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODELES = ["google/gemini-3.6-flash", "google/gemini-2.5-flash"];

type Admin = SupabaseClient<Database>;

export type CategorieFinance = "facture_fournisseur" | "bordereau_commission" | "autre";

export interface PieceJointeFinance {
  nom: string;
  mime: string | null;
  attachment_id: string | null;
}

export interface EmailFinance {
  sujet: string | null;
  expediteur_nom: string | null;
  expediteur_email: string | null;
  texte: string | null;
  pieces_jointes: PieceJointeFinance[];
}

export interface ClassificationFinance {
  categorie: CategorieFinance;
  piece: string | null;
  emetteur: string | null;
  periode: string | null;
  confiance: number;
  resume: string;
}

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

const texteOuNull = (v: unknown, max = 200): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t || t.toLowerCase() === "null") return null;
  return t.slice(0, max);
};

function consigne(email: EmailFinance): string {
  return [
    "Tu es assistant comptable dans un cabinet de courtage en assurances français.",
    "On te transmet un email entrant reçu sur la boîte du cabinet, qui ne correspond à aucun client connu.",
    "Détermine sa nature UNIQUEMENT parmi :",
    '- "facture_fournisseur" : facture ou note de frais émise par un fournisseur/prestataire à payer par le cabinet.',
    '- "bordereau_commission" : bordereau, bulletin ou relevé de commissions émis par une compagnie d\'assurance.',
    '- "autre" : tout le reste (prospect, publicité, administratif, doute) — dans ce cas ne propose rien.',
    "Contrainte : la catégorie facture ou bordereau n'est valable QUE si une pièce jointe PDF (ou image scannée)",
    "correspond visiblement à ce document, d'après son nom de fichier et le corps du mail. Sinon réponds \"autre\".",
    "N'invente jamais : dans le doute, \"autre\".",
    "",
    `Expéditeur : ${email.expediteur_nom ?? ""} <${email.expediteur_email ?? ""}>`,
    `Objet : ${email.sujet ?? "(sans objet)"}`,
    `Pièces jointes : ${email.pieces_jointes.map((p) => `${p.nom}${p.mime ? ` (${p.mime})` : ""}`).join(", ") || "aucune"}`,
    "Corps du message :",
    (email.texte ?? "").slice(0, 5000),
    "",
    'Réponds STRICTEMENT en JSON : {"categorie":"facture_fournisseur|bordereau_commission|autre",',
    '"piece":"nom exact du fichier concerné|null","emetteur":"fournisseur ou compagnie|null",',
    '"periode":"période du bordereau si visible|null","confiance":0.0,"resume":"une phrase"}',
  ].join("\n");
}

/** Classification IA d'un email entrant non rattaché à un client. */
export async function classifierEmailFinance(email: EmailFinance): Promise<ClassificationFinance> {
  const cle = process.env["LOVABLE_API_KEY"];
  if (!cle) throw new Error("Analyse indisponible : clé IA absente du projet.");

  let derniere = "";
  for (const modele of MODELES) {
    const res = await fetch(GATEWAY, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cle}` },
      body: JSON.stringify({ model: modele, messages: [{ role: "user", content: consigne(email) }] }),
    });
    if (!res.ok) {
      derniere = `${res.status} ${(await res.text()).slice(0, 300)}`;
      if (res.status === 429) throw new Error("Analyse IA momentanément saturée.");
      continue;
    }
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const contenu = json.choices?.[0]?.message?.content ?? "";
    if (!contenu) {
      derniere = "réponse vide";
      continue;
    }
    const brut = extraireJson(contenu);
    const brute = String(brut["categorie"] ?? "autre").toLowerCase();
    const categorie: CategorieFinance = brute.includes("facture")
      ? "facture_fournisseur"
      : brute.includes("bordereau") || brute.includes("commission")
        ? "bordereau_commission"
        : "autre";

    return {
      categorie,
      piece: texteOuNull(brut["piece"], 300),
      emetteur: texteOuNull(brut["emetteur"], 160),
      periode: texteOuNull(brut["periode"], 40),
      confiance: Math.max(0, Math.min(1, Number(brut["confiance"]) || 0)),
      resume: texteOuNull(brut["resume"], 400) ?? "",
    };
  }
  throw new Error(`Analyse IA impossible : ${derniere || "service indisponible"}`);
}

/** Sélectionne la pièce jointe exploitable (PDF/image) correspondant à la catégorie. */
function choisirPiece(email: EmailFinance, nomAttendu: string | null): PieceJointeFinance | null {
  const exploitable = (p: PieceJointeFinance) =>
    !!p.attachment_id &&
    (/\.(pdf|png|jpe?g)$/i.test(p.nom) || (p.mime ?? "").includes("pdf") || (p.mime ?? "").startsWith("image/"));
  const clef = (n: string) => n.trim().toLowerCase();
  if (nomAttendu) {
    const exact = email.pieces_jointes.find((p) => clef(p.nom) === clef(nomAttendu) && exploitable(p));
    if (exact) return exact;
  }
  return email.pieces_jointes.find(exploitable) ?? null;
}

const mimeDe = (piece: PieceJointeFinance) =>
  piece.mime || (piece.nom.toLowerCase().endsWith(".pdf") ? "application/pdf" : "application/octet-stream");

const octetsDe = (base64: string) => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

const normaliser = (v: string) =>
  v
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

export interface ResultatFinance {
  categorie: CategorieFinance;
  action: "facture_creee" | "bordereau_cree" | "tache_anomalie" | "ignore";
  facture_id?: string;
  bordereau_id?: string;
  commissions_creees?: number;
  lignes_non_rapprochees?: number;
  message?: string;
}

/**
 * Traitement complet d'un email finance : classification puis extraction du
 * document, création de la facture d'achat ou du bordereau de commissions.
 * Le message est classé dans l'arborescence COMPTABILITE du cabinet.
 */
export async function traiterEmailFinance(
  admin: Admin,
  params: {
    email: EmailFinance;
    gmail_message_id: string;
    recu_le?: string | null;
    userId: string;
  },
): Promise<ResultatFinance> {
  const { email } = params;
  const classification = await classifierEmailFinance(email);
  if (classification.categorie === "autre") return { categorie: "autre", action: "ignore" };

  // Lot 7 — session de journalisation de l'Agent (best-effort, jamais bloquant).
  let agentRunId: string | null = null;
  try {
    const { demarrerRun } = await import("@/lib/agent-gouvernance.server");
    agentRunId = await demarrerRun(admin, {
      agentName: "finance",
      triggerType: "email",
      triggerRef: params.gmail_message_id,
      context: { categorie: classification.categorie },
    });
  } catch (e) {
    console.error("[agent-finance] run non démarré", e);
  }

  // Journalise l'issue du traitement puis clôt la session. Idempotent sur le
  // message Gmail : un email retraité ne crée pas de doublon dans le journal.
  const tracerFinance = async (resultat: ResultatFinance): Promise<ResultatFinance> => {
    try {
      const { journaliserAction, terminerRun } = await import("@/lib/agent-gouvernance.server");
      await journaliserAction(admin, {
        runId: agentRunId,
        actionType: "traitement_finance",
        status: resultat.action === "tache_anomalie" ? "skipped" : "executed",
        targetType: resultat.categorie,
        idempotencyKey: `finance:${params.gmail_message_id}`,
        outputSummary: [
          `action=${resultat.action}`,
          resultat.commissions_creees != null ? `commissions=${resultat.commissions_creees}` : null,
          resultat.lignes_non_rapprochees != null ? `non_rapprochees=${resultat.lignes_non_rapprochees}` : null,
          "aucun rapprochement de paiement automatique",
        ]
          .filter(Boolean)
          .join(" · "),
      });
      if (agentRunId) {
        await terminerRun(admin, agentRunId, {
          status: "completed",
          summary: `Email finance traité (${resultat.categorie}) — ${resultat.action}`,
        });
      }
    } catch (e) {
      console.error("[agent-finance] journalisation agent échouée", e);
    }
    return resultat;
  };

  const piece = choisirPiece(email, classification.piece);
  if (!piece || !piece.attachment_id) {
    // Facture fournisseur / bordereau identifié mais document non exploitable
    // (montant dans le corps du mail, lien de téléchargement, PDF absent).
    // Le mail RESTE finance : il ne doit surtout pas retomber dans le tri
    // prospect, qui créerait une fiche client à tort.
    const { poserLabelCabinet: poser } = await import("@/lib/gmail.server");
    const { creerTacheAdmin } = await import("@/lib/agent-taches.server");
    const libelle =
      classification.categorie === "facture_fournisseur" ? "achat_a_traiter" : "commission_a_traiter";
    await poser(params.gmail_message_id, libelle);
    await creerTacheAdmin(admin, {
      titre:
        (classification.categorie === "facture_fournisseur"
          ? "Facture fournisseur à saisir manuellement — "
          : "Bordereau de commissions à saisir manuellement — ") +
        (email.sujet ?? "(sans objet)"),
      description: [
        `Objet de la demande : ${email.sujet ?? "(sans objet)"}`,
        `Nature : ${classification.categorie === "facture_fournisseur" ? "facture fournisseur" : "bordereau de commissions"}`,
        `Émetteur : ${email.expediteur_nom ?? ""} <${email.expediteur_email ?? "inconnu"}>`,
        `Analyse de l'agent finance : ${classification.resume || "non fournie"}`,
        `Ce qui bloque : aucun document exploitable en pièce jointe (montant dans le corps du mail, lien externe, ou pièce non lisible).`,
        `Conseil : ouvrir le mail, récupérer le document, puis créer la ${
          classification.categorie === "facture_fournisseur" ? "facture d'achat" : "ligne de bordereau"
        } depuis le module Comptabilité.`,
        `Email : https://mail.google.com/mail/u/0/#all/${params.gmail_message_id}`,
      ].join("\n"),
      priorite: "normale",
      created_by: params.userId,
    });
    return tracerFinance({
      categorie: classification.categorie,
      action: "tache_anomalie",
      message: "Document non exploitable — saisie manuelle requise",
    });
  }


  const { poserLabelCabinet, telechargerPieceJointe } = await import("@/lib/gmail.server");

  const { base64 } = await telechargerPieceJointe(params.gmail_message_id, piece.attachment_id);
  const resultat =
    classification.categorie === "facture_fournisseur"
      ? await traiterFacture(admin, { ...params, classification, piece, base64 })
      : await traiterBordereau(admin, { ...params, classification, piece, base64 });

  // Classement dans l'arborescence financière du cabinet : A_Traiter puis Archive
  // dans le service concerné (Achat pour les factures, Commission pour les bordereaux).
  const aTraiter = classification.categorie === "facture_fournisseur" ? "achat_a_traiter" : "commission_a_traiter";
  const archive = classification.categorie === "facture_fournisseur" ? "achat_archive" : "commission_archive";
  await poserLabelCabinet(params.gmail_message_id, archive, { retirer: [aTraiter] });

  return tracerFinance(resultat);
}


const lienFacture = "/espace/comptabilite";

/** Facture fournisseur : archivage du PDF + ligne `factures_achat` + tâche de vérification. */
async function traiterFacture(
  admin: Admin,
  params: {
    email: EmailFinance;
    classification: ClassificationFinance;
    piece: PieceJointeFinance;
    base64: string;
    gmail_message_id: string;
    recu_le?: string | null;
    userId: string;
  },
): Promise<ResultatFinance> {
  const { email, piece, classification } = params;
  const { creerTacheAdmin } = await import("@/lib/agent-taches.server");
  const mime = mimeDe(piece);

  const anomalie = async (probleme: string): Promise<ResultatFinance> => {
    await creerTacheAdmin(admin as never, {
      titre: `Facture fournisseur à saisir manuellement — ${classification.emetteur ?? email.expediteur_email ?? "fournisseur inconnu"}`.slice(0, 200),
      description: [
        `Problème : ${probleme}`,
        `Pièce de référence : ${piece.nom}`,
        `Objet du mail : ${email.sujet ?? "(sans objet)"}`,
        `Email : https://mail.google.com/mail/u/0/#all/${params.gmail_message_id}`,
        "Aucune facture n'a été créée automatiquement — saisie et contrôle manuels requis.",
      ].join("\n"),
      created_by: params.userId,
    });
    return { categorie: "facture_fournisseur", action: "tache_anomalie", message: probleme };
  };

  let lue: Awaited<ReturnType<typeof import("@/lib/facture-email.server").lireFactureDepuisFichier>> | null = null;
  try {
    const { lireFactureDepuisFichier } = await import("@/lib/facture-email.server");
    const { data: comptes } = await admin
      .from("plan_comptable")
      .select("numero, libelle")
      .eq("actif", true)
      .gte("numero", "600000")
      .lt("numero", "700000")
      .order("numero");
    lue = await lireFactureDepuisFichier(
      { nom: piece.nom, mime, base64: params.base64 },
      (comptes ?? []) as { numero: string; libelle: string }[],
    );
  } catch (e) {
    return anomalie(e instanceof Error ? e.message : "Lecture automatique de la facture impossible.");
  }

  const ht = lue.montant_ht;
  const tva = lue.montant_tva;
  const ttc = lue.montant_ttc;
  if (ht == null || tva == null || ttc == null) {
    return anomalie("Montants HT / TVA / TTC non lisibles sur le document.");
  }
  if (Math.abs(Number((ht + tva).toFixed(2)) - Number(ttc.toFixed(2))) > 0.01) {
    return anomalie(`Montants incohérents : HT ${ht} + TVA ${tva} ≠ TTC ${ttc}.`);
  }

  // Anti-doublon : même pièce jointe déjà importée.
  const marqueur = `[email:${params.gmail_message_id}:${params.piece.attachment_id?.slice(0, 24)}]`;
  const { data: dejaLa } = await admin
    .from("factures_achat")
    .select("id")
    .like("notes", `%${marqueur}%`)
    .maybeSingle();
  if (dejaLa) return { categorie: "facture_fournisseur", action: "ignore", facture_id: dejaLa.id };

  const nomNettoye = piece.nom.replace(/[^\w.\-]+/g, "_").slice(-80);
  const chemin = `emails/${params.gmail_message_id}/${Date.now()}-${nomNettoye}`;
  const { error: upErr } = await admin.storage
    .from("factures-achat")
    .upload(chemin, octetsDe(params.base64), { contentType: mime, upsert: false });
  if (upErr) return anomalie(`Archivage du justificatif impossible : ${upErr.message}`);

  const fournisseur =
    lue.fournisseur ||
    classification.emetteur ||
    email.expediteur_nom ||
    (email.expediteur_email ? email.expediteur_email.split("@")[1] || email.expediteur_email : null) ||
    "Fournisseur à préciser";

  const insertion: Record<string, unknown> = {
    fournisseur: fournisseur.slice(0, 160),
    numero_facture: lue.numero_facture ?? null,
    date_facture:
      lue.date_facture ?? (params.recu_le ? params.recu_le.slice(0, 10) : new Date().toISOString().slice(0, 10)),
    date_echeance: lue.date_echeance ?? null,
    montant_ht: ht,
    montant_tva: tva,
    montant_ttc: ttc,
    // Jamais de paiement automatique : ni date_paiement, ni statut « payée ».
    statut: "a_payer",
    notes: [
      "Agent finance — facture détectée dans un email entrant.",
      `Objet : ${email.sujet ?? "(sans objet)"}`,
      `Email : https://mail.google.com/mail/u/0/#all/${params.gmail_message_id}`,
      lue.nature ? `Nature : ${lue.nature}` : null,
      "À vérifier avant paiement et génération de l'écriture.",
      marqueur,
    ]
      .filter(Boolean)
      .join("\n"),
    fichier_path: chemin,
    fichier_nom: piece.nom.slice(0, 300),
    created_by: params.userId,
  };
  // Comptes laissés aux valeurs par défaut du plan comptable si l'IA n'a rien reconnu.
  if (lue.compte_charge) insertion["compte_charge"] = lue.compte_charge;

  const { data: creee, error } = await admin
    .from("factures_achat")
    .insert(insertion as never)
    .select("id")
    .single();
  if (error || !creee) {
    await admin.storage.from("factures-achat").remove([chemin]);
    return anomalie(error?.message ?? "Création de la facture impossible.");
  }

  await creerTacheAdmin(admin as never, {
    titre: `Facture fournisseur à vérifier — ${fournisseur}`.slice(0, 200),
    description: [
      `Facture ${lue.numero_facture ?? "(numéro non lu)"} — ${ttc.toFixed(2)} € TTC`,
      `Fichier : ${piece.nom}`,
      `Fiche : ${lienFacture}`,
      `Email : https://mail.google.com/mail/u/0/#all/${params.gmail_message_id}`,
      "Créée automatiquement en « à payer » : vérifier les montants, le compte de charge, puis décider du paiement.",
    ].join("\n"),
    created_by: params.userId,
  });

  return { categorie: "facture_fournisseur", action: "facture_creee", facture_id: creee.id };
}

/** Bordereau de commissions : lecture des lignes, création du bordereau et des commissions rapprochées. */
async function traiterBordereau(
  admin: Admin,
  params: {
    email: EmailFinance;
    classification: ClassificationFinance;
    piece: PieceJointeFinance;
    base64: string;
    gmail_message_id: string;
    recu_le?: string | null;
    userId: string;
  },
): Promise<ResultatFinance> {
  const { email, piece, classification } = params;
  const { creerTacheAdmin } = await import("@/lib/agent-taches.server");
  const mime = mimeDe(piece);

  let lu: Awaited<ReturnType<typeof import("@/lib/bulletin-commission.server").lireBulletinCommission>>;
  try {
    const { lireBulletinCommission } = await import("@/lib/bulletin-commission.server");
    lu = await lireBulletinCommission({ nom: piece.nom, mime, base64: params.base64 });
  } catch (e) {
    const probleme = e instanceof Error ? e.message : "Lecture automatique du bordereau impossible.";
    await creerTacheAdmin(admin as never, {
      titre: `Bordereau de commissions à importer manuellement — ${classification.emetteur ?? "compagnie inconnue"}`.slice(0, 200),
      description: [
        `Problème : ${probleme}`,
        `Pièce de référence : ${piece.nom}`,
        `Email : https://mail.google.com/mail/u/0/#all/${params.gmail_message_id}`,
        "Aucun bordereau n'a été créé automatiquement — import manuel requis depuis la comptabilité.",
      ].join("\n"),
      created_by: params.userId,
    });
    return { categorie: "bordereau_commission", action: "tache_anomalie", message: probleme };
  }

  const nomNettoye = piece.nom.replace(/[^\w.\-]+/g, "_").slice(-80);
  const chemin = `emails/${params.gmail_message_id}/${Date.now()}-${nomNettoye}`;
  const { error: upErr } = await admin.storage
    .from("bordereaux-commissions")
    .upload(chemin, octetsDe(params.base64), { contentType: mime, upsert: false });
  if (upErr) {
    await creerTacheAdmin(admin as never, {
      titre: `Bordereau de commissions non archivé — ${classification.emetteur ?? "compagnie inconnue"}`.slice(0, 200),
      description: `Archivage impossible : ${upErr.message}\nEmail : https://mail.google.com/mail/u/0/#all/${params.gmail_message_id}`,
      created_by: params.userId,
    });
    return { categorie: "bordereau_commission", action: "tache_anomalie", message: upErr.message };
  }

  const lignes = lu.lignes;
  const total = lu.montant_total ?? Number(lignes.reduce((s, l) => s + (l.montant ?? 0), 0).toFixed(2));

  const { data: bordereau, error: bErr } = await admin
    .from("bordereaux_commissions")
    .insert({
      assureur: (lu.assureur || classification.emetteur || "Compagnie à préciser").slice(0, 160),
      periode: (lu.periode || classification.periode || new Date().toISOString().slice(0, 7)).slice(0, 40),
      montant_total: total,
      nb_lignes: lignes.length,
      statut: "importe",
      fichier_path: chemin,
      fichier_nom: piece.nom.slice(0, 300),
      fichier_source: piece.nom.slice(0, 300),
      analyse_le: new Date().toISOString(),
      notes: [
        "Agent finance — bordereau détecté dans un email entrant.",
        `Email : https://mail.google.com/mail/u/0/#all/${params.gmail_message_id}`,
      ].join("\n"),
      created_by: params.userId,
    })
    .select("id")
    .single();
  if (bErr || !bordereau) {
    await admin.storage.from("bordereaux-commissions").remove([chemin]);
    await creerTacheAdmin(admin as never, {
      titre: `Bordereau de commissions non créé — ${classification.emetteur ?? "compagnie inconnue"}`.slice(0, 200),
      description: `Erreur : ${bErr?.message ?? "création impossible"}\nEmail : https://mail.google.com/mail/u/0/#all/${params.gmail_message_id}`,
      created_by: params.userId,
    });
    return { categorie: "bordereau_commission", action: "tache_anomalie", message: bErr?.message };
  }

  // Rapprochement par numéro / référence d'adhésion de contrat.
  const { data: contrats } = await admin.from("contrats").select("id,numero,client_id,dossier_id,mandataire_id");
  const parNumero = new Map<
    string,
    { id: string; client_id: string | null; dossier_id: string | null; mandataire_id: string | null }
  >();
  for (const c of contrats ?? []) {
    if (c.numero) parNumero.set(normaliser(c.numero), c);
  }

  const aujourdhui = new Date().toISOString().slice(0, 10);
  let commissionsCreees = 0;
  const nonRapprochees: string[] = [];

  for (const l of lignes) {
    const cle = l.numero_contrat ? normaliser(l.numero_contrat) : "";
    const contrat = cle ? parNumero.get(cle) : undefined;
    const libelle = `${l.client_nom ?? "client inconnu"} / ${l.numero_contrat ?? "référence absente"} — ${
      l.montant != null ? `${l.montant.toFixed(2)} €` : "montant non lu"
    }`;

    if (!contrat) {
      nonRapprochees.push(libelle);
      await creerTacheAdmin(admin as never, {
        titre: `Ligne de bordereau non rapprochée — ${lu.assureur ?? classification.emetteur ?? "compagnie"} / ${
          l.numero_contrat ?? l.client_nom ?? "référence absente"
        }`.slice(0, 200),
        description: [
          `Bordereau : ${lu.assureur ?? classification.emetteur ?? "compagnie"} — période ${lu.periode ?? "non précisée"}`,
          `Ligne : ${libelle}`,
          `Fichier : ${piece.nom}`,
          "Aucun contrat trouvé en base pour cette référence — rattachement manuel requis.",
        ].join("\n"),
        created_by: params.userId,
      });
      continue;
    }

    const { error: cErr } = await admin.from("commissions").insert({
      bordereau_id: bordereau.id,
      contrat_id: contrat.id,
      dossier_id: contrat.dossier_id,
      beneficiaire_id: contrat.mandataire_id ?? params.userId,
      montant: l.montant ?? 0,
      statut: "versee",
      date_versement: aujourdhui,
      notes: `Bordereau agent finance — ${libelle}`,
    });
    if (cErr) {
      nonRapprochees.push(`${libelle} (enregistrement impossible : ${cErr.message})`);
      continue;
    }
    commissionsCreees += 1;
  }

  const avertissement = nonRapprochees.length
    ? [`${nonRapprochees.length} ligne(s) non rapprochée(s) :`, ...nonRapprochees.slice(0, 100)].join("\n")
    : null;
  if (avertissement) {
    await admin
      .from("bordereaux_commissions")
      .update({ analyse_avertissement: avertissement })
      .eq("id", bordereau.id);
  }

  return {
    categorie: "bordereau_commission",
    action: "bordereau_cree",
    bordereau_id: bordereau.id,
    commissions_creees: commissionsCreees,
    lignes_non_rapprochees: nonRapprochees.length,
  };
}
