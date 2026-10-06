/**
 * Agent relation client — traitement des emails entrants déjà rattachés à un
 * client existant.
 *
 * Trois niveaux cadrés avec le cabinet :
 *  - niveau_0 : sinistre, réclamation, résiliation, santé, paiement → jamais
 *    d'automatisation, même en brouillon. Tâche admin urgente.
 *  - niveau_1 : info contrat, info garanties, demande d'attestation, et
 *    seulement si l'IA est très confiante → réponse envoyée automatiquement.
 *  - niveau_2 : tout le reste (et tout doute) → réponse en brouillon dans la
 *    file d'attente, validée manuellement par le cabinet.
 * Les pièces KYC détectées en pièce jointe sont routées vers le pipeline
 * existant (lecture CNI, complétion fiche, relance LCB-FT), quel que soit le
 * niveau de la demande.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { SupabaseClient } from "@supabase/supabase-js";
import { creerTacheAdmin } from "@/lib/agent-taches.server";
import { grillePourFamille, synthetiserGaranties, type ValeursGrille } from "@/lib/garanties-grille";

type Admin = SupabaseClient<any, any, any>;

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODELES = ["google/gemini-3.6-flash", "google/gemini-2.5-flash"];
const CABINET = "EJ Partners Assurances";
const BUCKET = "dossier-documents";
const SEUIL_NIVEAU_1 = 0.8;
const STATUTS_CONTRAT_ACTIF = ["actif", "contrat_actif", "contrat_valide"];

/** Type de document contrat correspondant à une attestation d'assurance. */
export const TYPE_ATTESTATION = "attestation_assurance";

export type NiveauRelation = "niveau_0" | "niveau_1" | "niveau_2";
export type IntentionRelation = "info_contrat" | "info_garanties" | "attestation" | null;
/** Sous-type précisant la nature d'un email niveau 0. */
export type SousTypeNiveau0 = "sinistre" | "reclamation" | "resiliation" | "sante" | "paiement" | null;

export interface EmailClient {
  sujet: string | null;
  expediteur_nom: string | null;
  expediteur_email: string | null;
  texte: string | null;
  pieces_jointes: { nom: string; mime: string | null; attachment_id: string | null }[];
}

export interface ClassificationRelation {
  niveau: NiveauRelation;
  sous_type: SousTypeNiveau0;
  intention: IntentionRelation;
  piece_jointe_kyc: boolean;
  pieces_kyc: { nom: string; type: "cni" | "justificatif_domicile" | "rib" | "kbis" }[];
  /** Pièces jointes reconnues comme document de prêt (tableau d'amortissement, offre de prêt). */
  pieces_pret: { nom: string }[];
  /** Autres pièces jointes reconnues, avec le contexte de classement. */
  pieces_documents: { nom: string; contexte: "contrat" | "sinistre" | "reclamation" | "autre" }[];
  /** Le client annonce explicitement l'envoi du reste des pièces plus tard. */
  complement_annonce: boolean;
  /** Le client tutoie : la réponse peut le tutoyer en miroir (règles de ton Drive). */
  tutoiement: boolean;
  /** Cas jugé significatif pour lequel aucune règle connue ne s'applique. */
  cas_non_couvert: { situation: string; pourquoi: string } | null;
  /**
   * Mail de simple suivi / information / transmission de pièces : le client
   * n'attend AUCUNE action ni réponse du cabinet. Permet d'archiver le mail
   * après traçage (et classement des pièces) au lieu de l'empiler dans
   * « A valider ».
   */
  sans_action_attendue: boolean;
  confiance: number;
  resume: string;
  modele: string | null;
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

function texteOuNull(v: unknown, max = 400): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t || t.toLowerCase() === "null") return null;
  return t.slice(0, max);
}

function consigne(email: EmailClient, reglesTon: string): string {
  return [
    "Tu es assistant relation client dans un cabinet de courtage en assurances français.",
    "On te transmet un email entrant provenant d'un CLIENT DÉJÀ CONNU du cabinet.",
    "",
    "RÈGLES DE TON ET DE JUGEMENT EN VIGUEUR (document du cabinet, prioritaires) :",
    reglesTon.slice(0, 4000),
    "",
    "Classe la demande dans un seul niveau :",
    '- "niveau_0" : sinistre, déclaration de dommage, réclamation, mécontentement, résiliation,',
    "  sujet de santé (maladie, hospitalisation, arrêt de travail, remboursement de soins),",
    "  ou sujet de paiement (prélèvement, impayé, remboursement, cotisation non passée).",
    '  Pour le niveau_0 UNIQUEMENT, précise le sous-type dans "sous_type" :',
    '  * "sinistre" : le client déclare un sinistre / un dommage survenu et attend une indemnisation',
    '    ou une prise en charge au titre d\'un événement assuré',
    '  * "reclamation" : plainte, mécontentement ou litige visant le cabinet (conseil donné, délai de',
    "    traitement, erreur) ou la gestion d'un dossier par la compagnie — SANS demande d'indemnisation",
    "    sur un événement assuré. Ne confonds jamais « reclamation » et « sinistre » : s'il s'agit d'un",
    '    événement assuré à indemniser, réponds "sinistre".',

    '  * "resiliation" : demande de résiliation',
    '  * "sante" : sujet médical ou de remboursement de soins',
    '  * "paiement" : prélèvement, impayé, cotisation, remboursement de cotisation',
    '- "niveau_1" : UNIQUEMENT si la demande correspond exactement à une de ces trois intentions,',
    "  sans aucune ambiguïté et sans autre demande associée :",
    '  * "info_contrat" : demande d\'information sur le contrat en cours (numéro, compagnie, cotisation, date d\'effet)',
    '  * "info_garanties" : demande d\'information sur les garanties souscrites',
    '  * "attestation" : demande d\'attestation d\'assurance',
    '- "niveau_2" : tout le reste (conseil, changement de situation, demande floue, plusieurs demandes,',
    "  ou intention ci-dessus mais dont tu n'es pas certain).",
    "Indique aussi si l'email contient une pièce KYC en pièce jointe (pièce d'identité, justificatif de",
    "domicile, RIB, Kbis) d'après les noms de fichiers. Cela se cumule avec le niveau.",
    'Liste séparément dans "pieces_pret" les pièces jointes qui ressemblent à un document de prêt',
    "(tableau d'amortissement, offre de prêt, échéancier de crédit) d'après leur nom de fichier.",
    'Liste dans "pieces_documents" les AUTRES pièces jointes, avec le contexte de classement le plus',
    'probable d\'après le mail : "contrat" (document contractuel, avenant, attestation, échéancier de',
    'cotisation), "sinistre" (constat, facture de réparation, devis, rapport médical lié à un sinistre),',
    '"reclamation" (pièce à l\'appui d\'une plainte), ou "autre" si tu ne sais pas rattacher.',
    "Classe chaque pièce jointe dans une seule liste au maximum.",
    'Renseigne "complement_annonce" à true si le client indique explicitement qu\'il enverra le reste des',
    "pièces / documents plus tard.",
    'Renseigne "tutoiement" à true si le client te tutoie dans son message, en appliquant les règles de ton',
    "ci-dessus. Par défaut : false (vouvoiement).",
    'Renseigne "cas_non_couvert" (sinon null) UNIQUEMENT si la situation est significative et qu\'AUCUNE',
    "règle ci-dessus ni règle de ton ne permet de décider quoi faire : décris alors la situation et",
    "pourquoi aucune règle ne s'applique. N'utilise pas ce champ pour une simple demande floue habituelle.",
    'Renseigne "sans_action_attendue" à true UNIQUEMENT si le mail n\'attend aucune action ni réponse du',
    "cabinet : simple suivi de dossier, information, confirmation, remerciement, ou transmission de pièces",
    "demandées (« voici les documents ») sans question associée. Réponds false dès qu\'il y a une question,",
    "une demande, une réclamation, une modification, un devis ou une urgence.",
    "En cas de doute, réponds toujours niveau_2. N'invente rien.",
    "",
    `Expéditeur : ${email.expediteur_nom ?? ""} <${email.expediteur_email ?? ""}>`,
    `Objet : ${email.sujet ?? "(sans objet)"}`,
    `Pièces jointes : ${email.pieces_jointes.map((p) => p.nom).join(", ") || "aucune"}`,
    "Corps du message :",
    (email.texte ?? "").slice(0, 6000),
    "",
    'Réponds STRICTEMENT en JSON : {"niveau":"niveau_0|niveau_1|niveau_2",',
    '"sous_type":"sinistre|reclamation|resiliation|sante|paiement|null",',
    '"intention":"info_contrat|info_garanties|attestation|null","piece_jointe_kyc":false,',
    '"pieces_kyc":[{"nom":"fichier.pdf","type":"cni|justificatif_domicile|rib|kbis"}],',
    '"pieces_pret":[{"nom":"fichier.pdf"}],',
    '"pieces_documents":[{"nom":"fichier.pdf","contexte":"contrat|sinistre|reclamation|autre"}],',
    '"complement_annonce":false,"tutoiement":false,"sans_action_attendue":false,',
    '"cas_non_couvert":{"situation":"...","pourquoi":"..."}|null,',
    '"confiance":0.0,"resume":"une phrase"}',

  ].join("\n");
}



/** Analyse IA d'un email client. Toute incertitude retombe en niveau_2. */
export async function analyserEmailClient(email: EmailClient): Promise<ClassificationRelation> {
  const cle = process.env["LOVABLE_API_KEY"];
  if (!cle) throw new Error("Analyse indisponible : clé IA absente du projet.");

  // Règles de ton de la Direction Commerciale (document Drive, cache 5 min).
  const { chargerReglesDeTon } = await import("@/lib/regles-agent.server");
  const reglesTon = await chargerReglesDeTon("commerciale");

  let derniere = "";
  for (const modele of MODELES) {
    const res = await fetch(GATEWAY, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cle}` },
      body: JSON.stringify({
        model: modele,
        messages: [{ role: "user", content: consigne(email, reglesTon) }],
      }),
    });

    if (res.ok) {
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const contenu = json.choices?.[0]?.message?.content ?? "";
      if (!contenu) throw new Error("Réponse IA vide");
      const brut = extraireJson(contenu);

      const niveauBrut = String(brut["niveau"] ?? "").toLowerCase().replace(/\s|-/g, "_");
      const confiance = Math.max(0, Math.min(1, Number(brut["confiance"]) || 0));
      const intentionBrut = texteOuNull(brut["intention"], 40)?.toLowerCase() ?? null;
      const intention: IntentionRelation =
        intentionBrut === "info_contrat" || intentionBrut === "info_garanties" || intentionBrut === "attestation"
          ? intentionBrut
          : null;

      // Garde-fou : niveau_1 exige une intention explicite ET une forte confiance.
      let niveau: NiveauRelation = "niveau_2";
      if (niveauBrut === "niveau_0") niveau = "niveau_0";
      else if (niveauBrut === "niveau_1" && intention && confiance >= SEUIL_NIVEAU_1) niveau = "niveau_1";

      const piecesBrut = Array.isArray(brut["pieces_kyc"]) ? (brut["pieces_kyc"] as any[]) : [];
      const pieces_kyc = piecesBrut
        .map((p) => ({
          nom: texteOuNull(p?.nom, 250) ?? "",
          type: String(p?.type ?? "").toLowerCase(),
        }))
        .filter(
          (p): p is { nom: string; type: "cni" | "justificatif_domicile" | "rib" | "kbis" } =>
            !!p.nom && ["cni", "justificatif_domicile", "rib", "kbis"].includes(p.type),
        );

      const pretsBrut = Array.isArray(brut["pieces_pret"]) ? (brut["pieces_pret"] as any[]) : [];
      const pieces_pret = pretsBrut
        .map((p) => ({ nom: texteOuNull(typeof p === "string" ? p : p?.nom, 250) ?? "" }))
        .filter((p) => !!p.nom);

      const docsBrut = Array.isArray(brut["pieces_documents"]) ? (brut["pieces_documents"] as any[]) : [];
      const contextes = ["contrat", "sinistre", "reclamation", "autre"] as const;
      const pieces_documents = docsBrut
        .map((p) => {
          const contexte = String(p?.contexte ?? "autre").toLowerCase();
          return {
            nom: texteOuNull(typeof p === "string" ? p : p?.nom, 250) ?? "",
            contexte: (contextes as readonly string[]).includes(contexte)
              ? (contexte as (typeof contextes)[number])
              : ("autre" as const),
          };
        })
        .filter((p) => !!p.nom);

      const casBrut = brut["cas_non_couvert"] as { situation?: unknown; pourquoi?: unknown } | null;
      const situationCas = casBrut ? texteOuNull(casBrut.situation, 600) : null;
      const cas_non_couvert = situationCas
        ? { situation: situationCas, pourquoi: texteOuNull(casBrut?.pourquoi, 600) ?? "non précisé" }
        : null;


      const sousTypeBrut = texteOuNull(brut["sous_type"], 30)?.toLowerCase() ?? null;
      const sous_type: SousTypeNiveau0 =
        niveau === "niveau_0" &&
        (sousTypeBrut === "sinistre" ||
          sousTypeBrut === "reclamation" ||
          sousTypeBrut === "resiliation" ||
          sousTypeBrut === "sante" ||
          sousTypeBrut === "paiement")
          ? sousTypeBrut
          : null;

      return {
        niveau,
        sous_type,
        intention: niveau === "niveau_1" ? intention : intention,

        piece_jointe_kyc: brut["piece_jointe_kyc"] === true || pieces_kyc.length > 0,
        pieces_kyc,
        pieces_pret,
        pieces_documents,
        complement_annonce: brut["complement_annonce"] === true,
        tutoiement: brut["tutoiement"] === true,
        cas_non_couvert,
        // Un mail sensible (niveau_0) n'est JAMAIS considéré sans action.
        sans_action_attendue: niveau !== "niveau_0" && brut["sans_action_attendue"] === true,
        confiance,
        resume: texteOuNull(brut["resume"], 400) ?? "",
        modele,
      };


    }
    derniere = `${res.status} ${await res.text()}`;
    if (res.status === 429) throw new Error("Analyse IA momentanément saturée.");
    if (res.status !== 400 && res.status !== 404) break;
  }
  throw new Error(`Analyse IA impossible : ${derniere}`);
}

type ClientMini = { id: string; nom: string | null; prenom: string | null; email: string | null };

type ContratMini = {
  id: string;
  numero: string | null;
  assureur: string | null;
  produit: string | null;
  produit_id: string | null;
  date_effet: string | null;
  prime_annuelle: number | null;
  fractionnement: string | null;
  statut: string | null;
};

function nomComplet(c: ClientMini): string {
  return [c.prenom, c.nom].filter(Boolean).join(" ") || "Madame, Monsieur";
}

function euros(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  return `${v.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

async function contratActif(admin: Admin, clientId: string): Promise<ContratMini | null> {
  const { data } = await admin
    .from("contrats")
    .select("id, numero, assureur, produit, produit_id, date_effet, prime_annuelle, fractionnement, statut")
    .eq("client_id", clientId)
    .in("statut", STATUTS_CONTRAT_ACTIF)
    .order("date_effet", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as ContratMini | null) ?? null;
}

async function lignesGaranties(admin: Admin, produitId: string | null) {
  if (!produitId) return null;
  const { data: produit } = await admin
    .from("produits")
    .select("nom, produit_familles!produits_famille_id_fkey(code)")
    .eq("id", produitId)
    .maybeSingle();
  const familleCode = (produit as any)?.produit_familles?.code ?? null;
  const grille = grillePourFamille(familleCode);
  if (!grille) return null;

  const { data: ligne } = await admin
    .from("produit_garanties")
    .select("grille_version, valeurs, statut")
    .eq("produit_id", produitId)
    .maybeSingle();
  const g = ligne as { grille_version: number; valeurs: ValeursGrille; statut: string } | null;
  if (!g || g.statut !== "valide" || g.grille_version !== grille.version) return null;

  const synthese = synthetiserGaranties(grille, g.valeurs ?? {});
  return synthese.detail
    .filter((d) => d.couverture === "oui" || d.couverture === "option")
    .map((d) => ({
      libelle: d.libelle + (d.couverture === "option" ? " (option)" : ""),
      valeur:
        [
          d.plafond ? `plafond ${d.plafond}` : null,
          d.franchise ? `franchise ${d.franchise}` : null,
          d.delai_carence ? `délai de carence ${d.delai_carence}` : null,
        ]
          .filter(Boolean)
          .join(" · ") || "Couvert",
    }));
}

async function journaliser(
  admin: Admin,
  clientId: string,
  titre: string,
  contenu: string,
  type: "email" | "systeme" = "email",
) {
  try {
    await admin.from("activites").insert({ client_id: clientId, type, titre, contenu: contenu.slice(0, 6000) });
  } catch (e) {
    console.error("[agent-relation-client] activité non enregistrée", e);
  }
}

function lienMail(messageId: string | null): string {
  return messageId ? `https://mail.google.com/mail/u/0/#all/${messageId}` : "";
}

async function enregistrerReponse(
  admin: Admin,
  row: Record<string, unknown>,
): Promise<void> {
  try {
    await admin.from("client_reponses_ia").upsert(row as never, { onConflict: "gmail_message_id" });
  } catch (e) {
    console.error("[agent-relation-client] enregistrement réponse impossible", e);
  }
}

async function envoyerReponse(
  destinataire: string,
  donnees: {
    clientName: string;
    titre: string;
    paragraphes: string[];
    lignes?: { libelle: string; valeur: string }[];
  },
  attachments?: { name: string; base64: string }[],
): Promise<void> {
  const { sendTemplateEmail } = await import("@/lib/email-templates/send-email");
  await sendTemplateEmail("relation-client-reponse", destinataire, {
    templateData: { ...donnees, cabinetName: CABINET },
    ...(attachments && attachments.length ? { attachments } : {}),
  });
}

/** Pièces KYC en pièce jointe : dépôt + pipeline existant (CNI → LCB-FT). */
async function routerPiecesKyc(
  admin: Admin,
  params: {
    client: ClientMini;
    email: EmailClient;
    classification: ClassificationRelation;
    gmail_message_id: string;
    userId: string;
  },
): Promise<number> {
  const { client, email, classification } = params;
  const parNom = new Map(email.pieces_jointes.map((p) => [p.nom.toLowerCase(), p]));
  let deposees = 0;

  const { telechargerPieceJointe } = await import("@/lib/gmail.server");
  for (const piece of classification.pieces_kyc) {
    const jointe = parNom.get(piece.nom.toLowerCase());
    if (!jointe?.attachment_id) continue;
    try {
      const { base64 } = await telechargerPieceJointe(params.gmail_message_id, jointe.attachment_id);
      const octets = Buffer.from(base64, "base64");
      const chemin = `${client.id}/kyc/${piece.type}-${Date.now()}-${jointe.nom}`;
      const { error: upErr } = await admin.storage
        .from(BUCKET)
        .upload(chemin, octets, { contentType: jointe.mime ?? "application/octet-stream" });
      if (upErr) throw new Error(upErr.message);

      const { data: insere, error: insErr } = await admin
        .from("client_kyc_documents")
        .insert({
          client_id: client.id,
          type: piece.type,
          nom: jointe.nom,
          storage_path: chemin,
          statut: "a_valider",
          notes: "Reçu en pièce jointe d'un email client (agent relation client)",
          uploaded_by: params.userId,
        })
        .select("id")
        .maybeSingle();
      if (insErr) throw new Error(insErr.message);
      deposees += 1;

      await journaliser(
        admin,
        client.id,
        "Pièce KYC reçue par email et déposée automatiquement",
        `Document : ${jointe.nom} (${piece.type})\nEmail : ${lienMail(params.gmail_message_id)}`,
        "systeme",
      );

      if (piece.type === "cni" && insere) {
        const { traiterPieceIdentiteEtRelancerLcb } = await import("@/lib/cni-extraction.server");
        await traiterPieceIdentiteEtRelancerLcb(admin as never, (insere as { id: string }).id);
      }
    } catch (e) {
      await creerTacheAdmin(admin as never, {
        titre: `Pièce jointe KYC non traitée — ${nomComplet(client)}`,
        description: [
          `Fichier : ${piece.nom}`,
          `Erreur : ${e instanceof Error ? e.message : "erreur inconnue"}`,
          `Email : ${lienMail(params.gmail_message_id)}`,
          "Action : déposer la pièce manuellement depuis l'onglet Conformité de la fiche client.",
        ].join("\n"),
        client_id: client.id,
        created_by: params.userId,
      });
    }
  }
  return deposees;
}

/**
 * Vrai si l'adresse est bien celle d'un client à qui l'on peut écrire.
 * Jamais d'envoi vers un automate, un partenaire ou une adresse interne.
 */
async function adresseClientEnvoyable(adresseBrute: string | null): Promise<boolean> {
  if (!adresseBrute) return false;
  const adresse = adresseBrute.toLowerCase();
  const { estEmailInterne } = await import("@/lib/domaines-internes");
  const { nomPartenairePourDomaine, extraireDomaine } = await import("@/lib/partenaires-domaines");
  const domaine = extraireDomaine(adresse);
  const automate = /(no[-_.]?reply|nepasrepondre|ne-pas-repondre|donotreply|notification|mailer|postmaster)/i.test(
    adresse,
  );
  if (automate || estEmailInterne(adresse) || (domaine && nomPartenairePourDomaine(domaine))) {
    console.info(`[agent-relation-client] envoi bloqué (adresse non cliente) — ${adresse}`);
    return false;
  }
  return true;
}

/**
 * Garde-fou « humain d'abord » : si une réponse du cabinet existe déjà dans le
 * fil Gmail, postérieure au message du client, aucun accusé automatique ne
 * part. Le cas est journalisé dans le CRM pour traçabilité.
 */
async function reponseCabinetDejaPresente(
  admin: Admin,
  client: ClientMini,
  gmailThreadId: string | null,
  gmailMessageId: string | null,
  genre: "message" | "pieces",
): Promise<boolean> {
  if (!gmailThreadId) return false;
  const { reponseCabinetPosterieure } = await import("@/lib/gmail.server");
  const dejaRepondu = await reponseCabinetPosterieure(gmailThreadId, gmailMessageId);
  if (!dejaRepondu) return false;
  console.info(`[agent-relation-client] accusé (${genre}) supprimé — réponse manuelle déjà présente dans le fil`);
  await journaliser(
    admin,
    client.id,
    genre === "pieces"
      ? "Accusé de réception des pièces supprimé (réponse manuelle déjà envoyée)"
      : "Accusé de réception automatique supprimé (réponse manuelle déjà envoyée)",
    [
      "Une réponse du cabinet postérieure au message du client existe déjà dans le fil Gmail.",
      `Email : ${lienMail(gmailMessageId)}`,
      gmailThreadId ? `Fil Gmail : ${gmailThreadId}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    "systeme",
  );
  return true;
}


/**
 * Accusé de réception générique envoyé immédiatement en niveau 2.
 * Strictement neutre : aucun conseil, aucune donnée de dossier.
 */
async function envoyerAccuseReception(
  admin: Admin,
  client: ClientMini,
  gmailMessageId: string | null,
  gmailThreadId: string | null = null,
): Promise<void> {
  if (!client.email) return;
  if (!(await adresseClientEnvoyable(client.email))) return;

  // Priorité à l'humain : si le cabinet a déjà répondu dans le fil après le
  // message du client, aucun accusé automatique ne part.
  if (await reponseCabinetDejaPresente(admin, client, gmailThreadId, gmailMessageId, "message")) return;



  // Anti-doublon : lecture de l'historique CRM (message, fil, fenêtre 72 h).
  const { accuseAutorise, TITRE_ACCUSE } = await import("@/lib/accuses-historique.server");
  const decision = await accuseAutorise(admin, {
    client_id: client.id,
    genre: "message",
    gmail_message_id: gmailMessageId,
    gmail_thread_id: gmailThreadId,
  });
  if (!decision.autorise) {
    console.info(`[agent-relation-client] accusé non envoyé — ${decision.motif}`);
    await journaliser(
      admin,
      client.id,
      "Accusé de réception automatique supprimé (doublon évité)",
      [decision.motif ?? "Doublon détecté dans l'historique.", `Email : ${lienMail(gmailMessageId)}`].join("\n"),
      "systeme",
    );
    return;
  }

  try {
    await envoyerReponse(client.email, {
      clientName: nomComplet(client),
      titre: "Nous avons bien reçu votre message",
      paragraphes: [
        "Nous avons bien reçu votre message et revenons vers vous rapidement.",
        `Ce message est un accusé de réception automatique : il ne contient aucune réponse à votre demande.`,
        `L'équipe ${CABINET}`,
      ],
    });
    await journaliser(
      admin,
      client.id,
      TITRE_ACCUSE.message,
      [
        `Accusé de réception neutre envoyé à ${client.email}.`,
        `Email d'origine : ${lienMail(gmailMessageId)}`,
        gmailMessageId ? `Message Gmail : ${gmailMessageId}` : "",
        gmailThreadId ? `Fil Gmail : ${gmailThreadId}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  } catch (e) {
    console.error("[agent-relation-client] accusé de réception non envoyé", e);
  }
}


/** Dernier sinistre / dernière réclamation ouverte du client (rattachement des pièces). */
async function dernierObjet(
  admin: Admin,
  table: "sinistres" | "reclamations",
  clientId: string,
): Promise<{ id: string; reference: string | null } | null> {
  const { data } = await admin
    .from(table)
    .select("id, reference")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { id: string; reference: string | null } | null) ?? null;
}

/** Dépose une pièce jointe dans le stockage du cabinet. */
async function deposerPieceJointe(
  admin: Admin,
  params: {
    clientId: string;
    gmail_message_id: string;
    piece: { nom: string; mime: string | null; attachment_id: string | null };
    sousDossier: string;
  },
): Promise<{ chemin: string; taille: number } | null> {
  if (!params.piece.attachment_id) return null;
  const { telechargerPieceJointe } = await import("@/lib/gmail.server");
  const { base64 } = await telechargerPieceJointe(params.gmail_message_id, params.piece.attachment_id);
  const octets = Buffer.from(base64, "base64");
  const chemin = `${params.clientId}/${params.sousDossier}/${Date.now()}-${params.piece.nom}`;
  const { error } = await admin.storage
    .from(BUCKET)
    .upload(chemin, octets, { contentType: params.piece.mime ?? "application/octet-stream" });
  if (error) throw new Error(error.message);
  return { chemin, taille: octets.byteLength };
}

/**
 * Classification pièce par pièce des pièces jointes NON KYC :
 *  - document de prêt reconnu → tâche de vérification du dossier emprunteur ;
 *  - pièce rattachable (contrat, sinistre, réclamation) → dépôt réel au bon
 *    endroit (documents du contrat, pièces du sinistre, pièces de la réclamation) ;
 *  - pièce non reconnue → dépôt sur la fiche client + tâche de classement.
 * Aucune pièce ne doit être ignorée en silence.
 */
async function routerAutresPieces(
  admin: Admin,
  params: {
    client: ClientMini;
    email: EmailClient;
    classification: ClassificationRelation;
    gmail_message_id: string;
    userId: string;
  },
): Promise<{ pret: number; non_classees: number; classees: number }> {
  const { client, email, classification } = params;
  const clef = (n: string) => n.trim().toLowerCase();
  const kyc = new Set(classification.pieces_kyc.map((p) => clef(p.nom)));
  const pret = new Set(classification.pieces_pret.map((p) => clef(p.nom)));
  const contextes = new Map(classification.pieces_documents.map((p) => [clef(p.nom), p.contexte]));

  let nbPret = 0;
  let nbNonClassees = 0;
  let nbClassees = 0;

  for (const piece of email.pieces_jointes) {
    const nom = clef(piece.nom);
    if (kyc.has(nom)) continue;

    if (pret.has(nom)) {
      nbPret += 1;
      await creerTacheAdmin(admin as never, {
        titre: `Document de prêt reçu — à vérifier`,
        description: [
          `Client : ${nomComplet(client)}`,
          `Fichier : ${piece.nom}`,
          `Objet du mail : ${email.sujet ?? "(sans objet)"}`,
          `Email : ${lienMail(params.gmail_message_id)}`,
          "Action : vérifier le tableau d'amortissement / l'offre de prêt et compléter le dossier emprunteur.",
        ].join("\n"),
        client_id: client.id,
        created_by: params.userId,
      });
      await journaliser(
        admin,
        client.id,
        "Document de prêt reçu par email",
        `Fichier : ${piece.nom}\nEmail : ${lienMail(params.gmail_message_id)}`,
        "systeme",
      );
      continue;
    }

    const contexte = contextes.get(nom) ?? "autre";
    try {
      const depot = await deposerPieceJointe(admin, {
        clientId: client.id,
        gmail_message_id: params.gmail_message_id,
        piece,
        sousDossier: `emails/${contexte}`,
      });
      if (!depot) throw new Error("pièce jointe illisible (identifiant absent)");

      let rattachement = "fiche client";
      let documentId: string | null = null;
      let classificationTrace: string | null = null;
      let rattachementTrace: string | null = null;
      let extractionTrace: string | null = null;
      let completudeTrace: string | null = null;


      if (contexte === "sinistre" || contexte === "reclamation") {
        const objet = await dernierObjet(admin, contexte === "sinistre" ? "sinistres" : "reclamations", client.id);
        if (contexte === "sinistre" && objet) {
          const { error } = await admin.from("sinistre_pieces").insert({
            sinistre_id: objet.id,
            code: "piece_email",
            libelle: piece.nom.slice(0, 200),
            nom_fichier: piece.nom.slice(0, 250),
            storage_path: depot.chemin,
            mime_type: piece.mime,
            taille: depot.taille,
            obligatoire: false,
            statut: "recue",
            commentaire: `Reçue par email — ${lienMail(params.gmail_message_id)}`,
            uploaded_by: params.userId,
          });
          if (error) throw new Error(error.message);
          rattachement = `sinistre ${objet.reference ?? objet.id}`;
        } else {
          const { data: cree, error } = await admin
            .from("documents")
            .insert({
              client_id: client.id,
              file_name: piece.nom.slice(0, 250),
              storage_path: depot.chemin,
              mime_type: piece.mime,
              file_size: depot.taille,
              categorie: contexte,
              type_document: "piece_client_email",
              uploader_id: params.userId,
            })
            .select("id")
            .maybeSingle();
          if (error) throw new Error(error.message);
          documentId = (cree as { id: string } | null)?.id ?? null;
          rattachement = objet
            ? `${contexte} ${objet.reference ?? objet.id} (pièce sur la fiche client)`
            : `fiche client (aucun dossier ${contexte} ouvert)`;
        }
      } else {
        const { data: cree, error } = await admin
          .from("documents")
          .insert({
            client_id: client.id,
            file_name: piece.nom.slice(0, 250),
            storage_path: depot.chemin,
            mime_type: piece.mime,
            file_size: depot.taille,
            categorie: contexte === "contrat" ? "contrat" : "a_classer",
            type_document: "piece_client_email",
            uploader_id: params.userId,
          })
          .select("id")
          .maybeSingle();
        if (error) throw new Error(error.message);
        documentId = (cree as { id: string } | null)?.id ?? null;
        rattachement = "fiche client";
      }


      // LOT 2A — classification documentaire : lecture réelle du fichier par l'IA
      // puis enregistrement du résultat sur le document. Sans effet sur le
      // classement déjà réalisé ci-dessus ; une panne IA n'interrompt rien.
      if (documentId) {
        try {
          const { classifierDocument } = await import("@/lib/classification-documentaire.server");
          const res = await classifierDocument(admin, documentId);
          if (res.statut === "classe") {
            classificationTrace = `Classification IA : ${res.classification.type_document} (confiance ${res.classification.confidence}, ${res.classification.traitement})`;
          } else if (res.statut === "indisponible") {
            classificationTrace = `Classification IA non disponible (${res.raison}) — qualification humaine`;
          }
        } catch (e) {
          console.error("[Lot2A] classification non effectuée", e);
        }
      }

      // LOT 2B — rattachement documentaire : décision indépendante de la
      // classification. Aucun client, dossier, contrat ni référence n'est créé ;
      // en cas de doute le document reste sur la fiche client et une
      // qualification humaine est demandée.
      if (documentId) {
        try {
          const { rattacherDocument } = await import("@/lib/rattachement-documentaire.server");
          const d = await rattacherDocument(admin, {
            documentId,
            clientId: client.id,
            sujet: email.sujet,
            texte: email.texte,
            lienEmail: lienMail(params.gmail_message_id),
            userId: params.userId,
          });
          rattachementTrace = d.qualification_humaine
            ? `Rattachement : qualification humaine requise (${d.source})`
            : `Rattachement automatique : dossier ${d.dossier_reference ?? d.dossier_id}${
                d.contrat_numero || d.contrat_id ? ` · contrat ${d.contrat_numero ?? d.contrat_id}` : ""
              } (preuve ${d.niveau_preuve}, confiance ${d.confiance_rattachement.toFixed(2)})`;
        } catch (e) {
          console.error("[Lot2B] rattachement non effectué", e);
        }
      }

      // LOT 2C — extraction documentaire : lecture du contenu réel et relevé des
      // données prévues par le type documentaire retenu au Lot 2A. Résultat
      // strictement documentaire (table `doc_extractions`) : aucune table métier
      // n'est alimentée, aucun document médical n'est interprété.
      if (documentId) {
        try {
          const { extraireDocument } = await import("@/lib/extraction-documentaire.server");
          const x = await extraireDocument(admin, documentId);
          if (x.statut === "extrait") {
            const renseignes = Object.entries(x.donnees).filter(([, v]) => v !== null).length;
            extractionTrace = `Extraction IA (${x.type_document}) : ${renseignes} donnée(s) relevée(s), confiance ${x.confidence.toFixed(2)}${
              x.fiable ? "" : " — à qualifier"
            }`;
          } else if (x.statut === "hors_perimetre") {
            extractionTrace = `Extraction IA non applicable (${x.raison})`;
          } else if (x.statut === "indisponible") {
            extractionTrace = `Extraction IA non disponible (${x.raison}) — aucune donnée retenue`;
          }
        } catch (e) {
          console.error("[Lot2C] extraction non effectuée", e);
        }
      }

      // LOT 2D — complétude documentaire : recalcul du dossier réellement
      // rattaché au document (jamais un dossier déduit du seul client).
      // Lecture seule des pièces ; aucune relance ni e-mail automatique.
      if (documentId) {
        try {
          const { data: docDossier } = await admin
            .from("documents")
            .select("dossier_id")
            .eq("id", documentId)
            .maybeSingle();
          const dossierId = (docDossier as { dossier_id: string | null } | null)?.dossier_id ?? null;
          if (dossierId) {
            const { recalculerCompletude } = await import("@/lib/completude-documentaire.server");
            const c = await recalculerCompletude(admin, dossierId, { userId: params.userId });
            completudeTrace = `Complétude documentaire : ${c.resultat.etat} — ${c.resultat.prochaine_action}`;
          }
        } catch (e) {
          console.error("[Lot2D] complétude non recalculée", e);
        }
      }

      // EXPLOITATION MÉTIER — offre de prêt : pré-remplissage du recueil
      // emprunteur (jamais d'écrasement d'une saisie humaine) puis lettre de
      // mission si le prêt est complet ; relevé de placement : étude épargne.
      // Aucun devoir de conseil n'est produit : cet acte reste humain.
      if (documentId) {
        try {
          const { exploiterDocumentEtude } = await import("@/lib/etude-documents.server");
          const ex = await exploiterDocumentEtude(admin, documentId, params.userId);
          if (ex.actions.length > 0) {
            console.info(`[etude] ${documentId} · ${ex.actions.join(" · ")}`);
          }
        } catch (e) {
          console.error("[etude] exploitation non effectuée", e);
        }
      }





      nbClassees += 1;
      await journaliser(
        admin,
        client.id,
        "Pièce jointe reçue et classée automatiquement",
        [
          `Fichier : ${piece.nom}`,
          `Contexte retenu : ${contexte}`,
          `Rattachement : ${rattachement}`,
          ...(classificationTrace ? [classificationTrace] : []),
          ...(rattachementTrace ? [rattachementTrace] : []),
          ...(extractionTrace ? [extractionTrace] : []),
          ...(completudeTrace ? [completudeTrace] : []),



          `Email : ${lienMail(params.gmail_message_id)}`,
        ].join("\n"),
        "systeme",
      );

      if (contexte === "autre") {
        nbNonClassees += 1;
        await creerTacheAdmin(admin as never, {
          titre: `Pièce jointe à classer — ${piece.nom}`.slice(0, 200),
          description: [
            `Client : ${nomComplet(client)}`,
            `Fichier : ${piece.nom}${piece.mime ? ` (${piece.mime})` : ""}`,
            `Objet du mail : ${email.sujet ?? "(sans objet)"}`,
            `Email : ${lienMail(params.gmail_message_id)}`,
            "La pièce est déposée sur la fiche client (catégorie « à classer ») : rattachez-la au bon dossier.",
          ].join("\n"),
          client_id: client.id,
          created_by: params.userId,
        });
      }
    } catch (e) {
      nbNonClassees += 1;
      await creerTacheAdmin(admin as never, {
        titre: `Pièce jointe non classée reçue — ${piece.nom}`.slice(0, 200),
        description: [
          `Client : ${nomComplet(client)}`,
          `Fichier : ${piece.nom}${piece.mime ? ` (${piece.mime})` : ""}`,
          `Objet du mail : ${email.sujet ?? "(sans objet)"}`,
          `Erreur : ${e instanceof Error ? e.message : "erreur inconnue"}`,
          `Email : ${lienMail(params.gmail_message_id)}`,
          "Action : récupérer la pièce dans Gmail et la déposer manuellement.",
        ].join("\n"),
        client_id: client.id,
        created_by: params.userId,
      });
    }
  }

  return { pret: nbPret, non_classees: nbNonClassees, classees: nbClassees };
}

/**
 * Accusé de réception des pièces jointes reçues, avec remerciement.
 * Si le client annonce l'envoi du reste plus tard : on le lui confirme et une
 * tâche de relance est créée à J+5.
 */
async function accuserReceptionPieces(
  admin: Admin,
  params: {
    client: ClientMini;
    classification: ClassificationRelation;
    nb_pieces: number;
    gmail_message_id: string;
    gmail_thread_id?: string | null;
    userId: string;
  },
): Promise<void> {
  const { client, classification } = params;
  if (!client.email || params.nb_pieces === 0) return;
  if (!(await adresseClientEnvoyable(client.email))) return;
  if (
    await reponseCabinetDejaPresente(
      admin,
      client,
      params.gmail_thread_id ?? null,
      params.gmail_message_id,
      "pieces",
    )
  )
    return;
  const tu = classification.tutoiement;

  // Anti-doublon : historique CRM (même message, même fil, fenêtre 72 h).
  const { accuseAutorise } = await import("@/lib/accuses-historique.server");
  const decision = await accuseAutorise(admin, {
    client_id: client.id,
    genre: "pieces",
    gmail_message_id: params.gmail_message_id,
    gmail_thread_id: params.gmail_thread_id ?? null,
  });
  if (!decision.autorise) {
    console.info(`[agent-relation-client] accusé pièces non envoyé — ${decision.motif}`);
    await journaliser(
      admin,
      client.id,
      "Accusé de réception des pièces supprimé (doublon évité)",
      [decision.motif ?? "Doublon détecté dans l'historique.", `Email : ${lienMail(params.gmail_message_id)}`].join(
        "\n",
      ),
      "systeme",
    );
    return;
  }


  try {
    await envoyerReponse(client.email, {
      clientName: nomComplet(client),
      titre: tu ? "Merci, on a bien reçu tes documents" : "Nous avons bien reçu vos documents",
      paragraphes: [
        tu
          ? `Merci pour ${params.nb_pieces > 1 ? "tes documents" : "ton document"} : nous ${params.nb_pieces > 1 ? "les avons bien reçus" : "l'avons bien reçu"} et ${params.nb_pieces > 1 ? "enregistrés" : "enregistré"} dans ton dossier.`
          : `Nous vous remercions pour ${params.nb_pieces > 1 ? "vos documents" : "votre document"} : ${params.nb_pieces > 1 ? "ils ont bien été reçus et enregistrés" : "il a bien été reçu et enregistré"} dans votre dossier.`,
        ...(classification.complement_annonce
          ? [
              tu
                ? "Nous restons en attente du complément que tu nous annonces ; pas d'inquiétude, nous te relancerons si besoin."
                : "Nous restons en attente du complément que vous nous annoncez ; nous reviendrons vers vous si nécessaire.",
            ]
          : []),
        `L'équipe ${CABINET}`,
      ],
    });
    await journaliser(
      admin,
      client.id,
      "Accusé de réception des pièces jointes envoyé au client",
      [
        `${params.nb_pieces} pièce(s) reçue(s).`,
        classification.complement_annonce ? "Complément annoncé par le client : relance programmée à J+5." : "",
        `Email : ${lienMail(params.gmail_message_id)}`,
        `Message Gmail : ${params.gmail_message_id}`,
        params.gmail_thread_id ? `Fil Gmail : ${params.gmail_thread_id}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  } catch (e) {
    console.error("[agent-relation-client] accusé de réception des pièces non envoyé", e);
  }

  if (classification.complement_annonce) {
    await creerTacheAdmin(admin as never, {
      titre: `Relancer ${nomComplet(client)} — complément de pièces annoncé`.slice(0, 200),
      description: [
        `Le client a indiqué qu'il enverrait le reste des pièces plus tard.`,
        `Pièces déjà reçues : ${params.nb_pieces}`,
        `Email : ${lienMail(params.gmail_message_id)}`,
        "Action : si rien n'est arrivé, relancer le client pour le complément.",
      ].join("\n"),
      client_id: client.id,
      priorite: "normale",
      echeance_jours: 5,
      created_by: params.userId,
    });
  }
}


export interface ResultatRelationClient {
  niveau: NiveauRelation;
  intention: IntentionRelation;
  action: "tache_urgente" | "reponse_envoyee" | "brouillon" | "rien";
  pieces_kyc: number;
  pieces_pret?: number;
  pieces_non_classees?: number;
  motif?: string;
  /** Sous-type retenu pour un email niveau 0 (sinistre, réclamation, …). */
  sous_type?: SousTypeNiveau0;
}

/**
 * Traite un email entrant rattaché à un client existant.
 * À l'issue du traitement, le message est classé dans « Direction Commerciale/
 * Service Client » : A_Traiter à la prise en charge, puis Archive (réponse
 * automatique envoyée) ou En_Attente_De_Validation (brouillon à valider).
 * Le niveau 0 « sinistre » reste piloté par le module sinistres et le niveau 0
 * « réclamation » par le module réclamations (Service Réclamation), qui posent
 * eux-mêmes leurs propres étiquettes.
 * Aucune étape ne doit échouer silencieusement : toute erreur crée une tâche.
 */

export async function traiterEmailClient(
  admin: Admin,
  params: {
    client_id: string;
    email: EmailClient;
    gmail_message_id: string;
    gmail_thread_id?: string | null;
    userId: string;
  },
): Promise<ResultatRelationClient> {
  const pieces = { pret: 0, non_classees: 0 };
  const resultat = await traiterEmailClientInterne(admin, params, pieces);
  const { poserLabelCabinet } = await import("@/lib/gmail.server");
  // Une réclamation ne passe jamais par le Service Client : son circuit propre
  // (Direction Juridique et Conformité / Service Réclamation) est posé par le
  // module réclamations.
  if (resultat.sous_type !== "reclamation") {
    // Le libellé de service est posé manuellement par le staff : l'agent ne
    // fait évoluer que le sous-état.
    if (resultat.niveau !== "niveau_0") {
      await poserLabelCabinet(
        params.gmail_message_id,
        // « rien » = mail traité sans réponse nécessaire (suivi, pièces classées) :
        // il est archivé, pas mis en attente de validation.
        resultat.action === "reponse_envoyee" || resultat.action === "rien"
          ? "sc_archive"
          : "sc_attente_validation",
        { retirer: ["sc_a_traiter"] },
      );
    }
  }


  return { ...resultat, pieces_pret: pieces.pret, pieces_non_classees: pieces.non_classees };
}


async function traiterEmailClientInterne(
  admin: Admin,
  params: {
    client_id: string;
    email: EmailClient;
    gmail_message_id: string;
    gmail_thread_id?: string | null;
    userId: string;
  },
  pieces: { pret: number; non_classees: number },
): Promise<ResultatRelationClient> {

  const { email, gmail_message_id } = params;

  const { data: clientRow } = await admin
    .from("clients")
    .select("id, nom, prenom, email")
    .eq("id", params.client_id)
    .maybeSingle();
  const client = (clientRow as ClientMini | null) ?? null;
  if (!client) throw new Error("Fiche client introuvable");

  // Cas dédié : réponse du client à l'email de point de suivi périodique.
  // Traitement spécifique (tâche + note factuelle sur les contrats), jamais de
  // réponse ni de brouillon automatique — différent du niveau 2 générique.
  const { sujetEstSuiviContrats } = await import("@/lib/suivi-contrats");
  if (sujetEstSuiviContrats(email.sujet)) {
    const { traiterRetourSuiviContrats } = await import("@/lib/suivi-contrats.server");

    await traiterRetourSuiviContrats(admin, {
      client,
      sujet: email.sujet,
      texte: email.texte,
      gmail_message_id,
      userId: params.userId,
    });
    return {
      niveau: "niveau_2",
      intention: null,
      action: "tache_urgente",
      pieces_kyc: 0,
      motif: "Retour du client sur le point de suivi périodique : tâche et note de contrat créées.",
    };
  }

  const classification = await analyserEmailClient(email);

  // BESOIN DE RÉPONSE : un message purement informationnel (confirmation, avis,
  // notification) n'appelle aucune réponse ni accusé automatique. Sans pièce
  // jointe à traiter, le message est simplement journalisé.
  const { classerBesoinReponse } = await import("@/lib/besoin-reponse");
  const besoin = classerBesoinReponse({
    sujet: email.sujet,
    texte: email.texte,
    expediteur_email: client.email,
    pieces_jointes: email.pieces_jointes.length,
  });
  if (
    besoin.categorie === "informationnel" &&
    classification.niveau !== "niveau_0" &&
    email.pieces_jointes.length === 0
  ) {
    await journaliser(
      admin,
      client.id,
      "Email informationnel — aucune réponse automatique",
      [besoin.motif, `Objet : ${email.sujet ?? "—"}`, `Email : ${lienMail(gmail_message_id)}`].join("\n"),
      "systeme",
    );
    return {
      niveau: classification.niveau,
      intention: classification.intention,
      action: "rien",
      pieces_kyc: 0,
      motif: `Message informationnel : ${besoin.motif}`,
    };
  }





  const base = {
    client_id: client.id,
    gmail_message_id,
    gmail_thread_id: params.gmail_thread_id ?? null,
    email_sujet: email.sujet ?? null,
    categorie: classification.niveau,
    intention: classification.intention,
    confiance: classification.confiance,
    resume: classification.resume,
    destinataire: client.email,
    created_by: params.userId,
    updated_at: new Date().toISOString(),
  };

  // Pièces KYC : routées quel que soit le niveau de la demande.
  const piecesKyc = classification.piece_jointe_kyc
    ? await routerPiecesKyc(admin, { client, email, classification, gmail_message_id, userId: params.userId })
    : 0;

  // Autres pièces jointes : document de prêt ou pièce non reconnue → tâche admin.
  // Accusé de réception des pièces jointes : envoyé une seule fois par message.
  let accuseEnvoye = false;
  if (email.pieces_jointes.length) {
    const compte = await routerAutresPieces(admin, {
      client,
      email,
      classification,
      gmail_message_id,
      userId: params.userId,
    });
    pieces.pret = compte.pret;
    pieces.non_classees = compte.non_classees;

    await accuserReceptionPieces(admin, {
      gmail_thread_id: params.gmail_thread_id ?? null,
      client,
      classification,
      nb_pieces: email.pieces_jointes.length,
      gmail_message_id,
      userId: params.userId,
    });
    accuseEnvoye = true;
  }
  // Toutes les pièces jointes ont-elles été réellement classées, sans reprise
  // humaine (aucune pièce « à classer », aucun document de prêt à vérifier) ?
  const toutesPiecesClassees = pieces.non_classees === 0 && pieces.pret === 0;


  const brouillon = async (motif: string, objet: string, corps: string): Promise<ResultatRelationClient> => {
    await enregistrerReponse(admin, {
      ...base,
      categorie: "niveau_2",
      statut: "brouillon",
      motif,
      objet,
      corps,
    });
    await journaliser(
      admin,
      client.id,
      "Réponse préparée en brouillon (à valider)",
      `${motif}\nEmail : ${lienMail(gmail_message_id)}\n\n${corps}`,
    );
    if (!accuseEnvoye)
      await envoyerAccuseReception(admin, client, gmail_message_id, params.gmail_thread_id ?? null);

    // Cas significatif sans règle applicable : journal Drive + email à l'admin,
    // pour décider ensemble s'il faut créer une nouvelle règle (ton ou action).
    if (classification.cas_non_couvert) {
      const { journaliserCasNonCouvert } = await import("@/lib/regles-agent.server");
      await journaliserCasNonCouvert(admin, {
        client: nomComplet(client),
        sujet: email.sujet,
        gmail_message_id,
        situation: classification.cas_non_couvert.situation,
        pourquoi_non_couvert: classification.cas_non_couvert.pourquoi,
      });
    }
    return {
      niveau: "niveau_2",
      intention: classification.intention,
      action: "brouillon",
      pieces_kyc: piecesKyc,
      motif,
    };
  };

  /**
   * Document demandé par le client mais absent du CRM : tâche urgente + email au
   * gestionnaire. Aucune réponse au client tant que la tâche n'est pas close ;
   * l'envoi reprend via /api/public/documents-attendus une fois la tâche fermée.
   */
  const attendreDocument = async (motif: string, objet: string, corps: string): Promise<ResultatRelationClient> => {
    const tacheId = await creerTacheAdmin(admin as never, {
      titre: `Document demandé par ${nomComplet(client)} — indisponible dans le CRM`.slice(0, 200),
      description: [
        `Objet du mail : ${email.sujet ?? "(sans objet)"}`,
        `Demande : ${classification.resume || "document demandé par le client"}`,
        `Manque : ${motif}`,
        `Email : ${lienMail(gmail_message_id)}`,
        "Action : ajouter le document au CRM puis clôturer cette tâche — la réponse au client partira automatiquement.",
        "Aucune réponse n'a été envoyée au client à ce stade.",
      ].join("\n"),
      client_id: client.id,
      priorite: "urgente",
      created_by: params.userId,
    });

    await enregistrerReponse(admin, {
      ...base,
      statut: "attente_document",
      motif: `${motif}${tacheId ? ` (tâche ${tacheId})` : ""}`,
      objet,
      corps,
    });
    const { informerAdmin } = await import("@/lib/regles-agent.server");
    await informerAdmin(admin, {
      titre: "Document demandé par un client — indisponible dans le CRM",
      paragraphes: [
        `${nomComplet(client)} demande un document qui n'est pas disponible dans le CRM.`,
        "Aucune réponse n'a été envoyée au client : elle partira automatiquement une fois la tâche clôturée (donc le document ajouté).",
      ],
      lignes: [
        { libelle: "Client", valeur: nomComplet(client) },
        { libelle: "Objet du mail", valeur: email.sujet ?? "(sans objet)" },
        { libelle: "Manque", valeur: motif },
        { libelle: "Mail", valeur: lienMail(gmail_message_id) || "—" },
      ],
    });
    await journaliser(
      admin,
      client.id,
      "Document demandé indisponible — réponse suspendue",
      `${motif}\nEmail : ${lienMail(gmail_message_id)}`,
      "systeme",
    );
    return {
      niveau: "niveau_2",
      intention: classification.intention,
      action: "tache_urgente",
      pieces_kyc: piecesKyc,
      motif,
    };
  };


  // ---- Mail de suivi / transmission de pièces : AUCUNE action attendue.
  // L'IA a lu le mail, tracé le suivi sur la fiche client et classé les pièces
  // jointes au bon endroit : le mail est traité et archivé, il n'a rien à faire
  // dans la file « A valider ». Ne s'applique jamais au niveau_0 (sensible),
  // ni s'il reste une pièce à classer ou un document de prêt à vérifier.
  if (
    classification.niveau !== "niveau_0" &&
    classification.sans_action_attendue &&
    !classification.complement_annonce &&
    !classification.cas_non_couvert &&
    toutesPiecesClassees
  ) {
    const motif = email.pieces_jointes.length
      ? `Transmission de pièces : ${email.pieces_jointes.length} pièce(s) reçue(s) et classée(s) automatiquement — aucune action attendue.`
      : "Mail de suivi / information : aucune action ni réponse attendue — suivi tracé sur la fiche client.";
    await enregistrerReponse(admin, {
      ...base,
      statut: "aucune_reponse",
      motif,
    });
    await journaliser(
      admin,
      client.id,
      email.pieces_jointes.length
        ? "Pièces reçues par email et classées — dossier suivi"
        : "Mail de suivi reçu — aucune action attendue",
      `${classification.resume}\n${motif}\nEmail : ${lienMail(gmail_message_id)}`,
      "systeme",
    );
    return {
      niveau: classification.niveau,
      intention: classification.intention,
      action: "rien",
      pieces_kyc: piecesKyc,
      motif,
    };
  }

  // ---- Niveau 0 : aucune automatisation, tâche urgente.
  if (classification.niveau === "niveau_0") {
    // Sous-type sinistre : ouverture d'un dossier dédié + analyse de couverture.
    let sinistre: { sinistre_id: string; action_recommandee: string; analyse_couverture: string } | null = null;
    if (classification.sous_type === "sinistre") {
      try {
        const { ouvrirSinistreDepuisEmail } = await import("@/lib/sinistres-agent.server");
        sinistre = await ouvrirSinistreDepuisEmail(admin, {
          client_id: client.id,
          resume: classification.resume,
          texte_email: email.texte,
          sujet: email.sujet,
          gmail_message_id,
          userId: params.userId,
        });
      } catch (e) {
        console.error("[agent-relation-client] ouverture sinistre impossible", e);
      }
    }

    // Sous-type réclamation : circuit conformité dédié (module réclamations),
    // totalement distinct du module sinistres. La tâche et l'étiquetage Gmail
    // sont pris en charge par le module lui-même.
    let reclamation: { reclamation_id: string; concerne: string; solution_proposee: string | null } | null = null;
    if (classification.sous_type === "reclamation") {
      try {
        const { ouvrirReclamationDepuisEmail } = await import("@/lib/reclamations-agent.server");
        reclamation = await ouvrirReclamationDepuisEmail(admin, {
          client_id: client.id,
          resume: classification.resume,
          texte_email: email.texte,
          sujet: email.sujet,
          gmail_message_id,
          userId: params.userId,
        });
      } catch (e) {
        console.error("[agent-relation-client] ouverture réclamation impossible", e);
      }
    }

    if (!reclamation) {
      await creerTacheAdmin(admin as never, {
        idempotency_key: `relation_client:niveau0:${gmail_message_id}`,
        source: "relation-client",
        source_event_id: gmail_message_id,
        titre: sinistre
          ? `Sinistre déclaré — ${nomComplet(client)}`
          : classification.sous_type === "reclamation"
            ? `Réclamation reçue — ${nomComplet(client)}`
            : `Email sensible reçu — ${nomComplet(client)}`,
        description: [
          `Objet : ${email.sujet ?? "(sans objet)"}`,
          `Résumé IA : ${classification.resume || "non fourni"}`,
          `Email : ${lienMail(gmail_message_id)}`,
          ...(sinistre
            ? [
                `Fiche sinistre : /espace/sinistres/${sinistre.sinistre_id}`,
                `Action recommandée : ${sinistre.action_recommandee}`,
                `Analyse de couverture : ${sinistre.analyse_couverture}`,
              ]
            : []),
          "Aucune réponse automatique n'a été envoyée : traitement humain obligatoire.",
        ].join("\n"),
        client_id: client.id,
        priorite: "urgente",
        created_by: params.userId,
      });
    }
    await enregistrerReponse(admin, {
      ...base,
      statut: "aucune_reponse",
      motif: sinistre
        ? "Niveau 0 — sinistre : dossier ouvert, traitement humain"
        : reclamation
          ? "Niveau 0 — réclamation : dossier conformité ouvert, traitement humain"
          : "Niveau 0 — traitement humain",
    });
    await journaliser(
      admin,
      client.id,
      sinistre
        ? "Sinistre déclaré par email — dossier ouvert"
        : reclamation
          ? "Réclamation reçue par email — dossier conformité ouvert"
          : "Email sensible reçu — traitement humain requis",
      `${classification.resume}\nEmail : ${lienMail(gmail_message_id)}${sinistre ? `\n\n${sinistre.analyse_couverture}` : ""}${
        reclamation
          ? `\n\nPérimètre : ${reclamation.concerne}${reclamation.solution_proposee ? `\nProposition à valider : ${reclamation.solution_proposee}` : ""}`
          : ""
      }`,
    );
    return {
      niveau: "niveau_0",
      intention: null,
      action: "tache_urgente",
      pieces_kyc: piecesKyc,
      sous_type: classification.sous_type,
    };

  }



  const objetReponse = `Votre demande — ${email.sujet ?? "votre contrat"}`.slice(0, 200);

  // ---- Niveau 1 : réponses automatiques strictement cadrées.
  if (classification.niveau === "niveau_1" && client.email) {
    const contrat = await contratActif(admin, client.id);
    if (!contrat) {
      return brouillon(
        "Aucun contrat actif trouvé sur la fiche client : réponse à compléter manuellement.",
        objetReponse,
        `Bonjour ${nomComplet(client)},\n\nNous revenons vers vous concernant votre demande.\n\n[À compléter : aucun contrat actif n'a été trouvé sur la fiche client.]\n\nCordialement,\nL'équipe ${CABINET}`,
      );
    }

    if (classification.intention === "info_contrat") {
      const lignes = [
        { libelle: "Numéro de contrat", valeur: contrat.numero ?? "—" },
        { libelle: "Compagnie", valeur: contrat.assureur ?? "—" },
        { libelle: "Produit", valeur: contrat.produit ?? "—" },
        {
          libelle: "Cotisation annuelle",
          valeur: `${euros(contrat.prime_annuelle)}${contrat.fractionnement ? ` (${contrat.fractionnement})` : ""}`,
        },
        {
          libelle: "Date d'effet",
          valeur: contrat.date_effet ? new Date(contrat.date_effet).toLocaleDateString("fr-FR") : "—",
        },
      ];
      await envoyerReponse(client.email, {
        clientName: nomComplet(client),
        titre: "Les informations de votre contrat en cours",
        paragraphes: [
          "Vous trouverez ci-dessous les informations de votre contrat en cours.",
          "Pour toute autre question, il vous suffit de répondre à cet email.",
        ],
        lignes,
      });
      await enregistrerReponse(admin, {
        ...base,
        contrat_id: contrat.id,
        statut: "envoye",
        objet: objetReponse,
        corps: lignes.map((l) => `${l.libelle} : ${l.valeur}`).join("\n"),
        envoye_le: new Date().toISOString(),
      });
      await journaliser(
        admin,
        client.id,
        "Réponse automatique envoyée — informations du contrat",
        `Email : ${lienMail(gmail_message_id)}\n\n${lignes.map((l) => `${l.libelle} : ${l.valeur}`).join("\n")}`,
      );
      return { niveau: "niveau_1", intention: "info_contrat", action: "reponse_envoyee", pieces_kyc: piecesKyc };
    }

    if (classification.intention === "info_garanties") {
      const lignes = await lignesGaranties(admin, contrat.produit_id);
      if (!lignes || lignes.length === 0) {
        return brouillon(
          "Aucune grille de garanties validée n'est disponible pour ce produit : détail à fournir manuellement.",
          objetReponse,
          `Bonjour ${nomComplet(client)},\n\nVous trouverez ci-dessous le détail des garanties de votre contrat ${contrat.numero ?? ""}.\n\n[À compléter : grille de garanties non validée pour ce produit.]\n\nCordialement,\nL'équipe ${CABINET}`,
        );
      }
      await envoyerReponse(client.email, {
        clientName: nomComplet(client),
        titre: "Le détail des garanties de votre contrat",
        paragraphes: [
          `Voici le détail des garanties de votre contrat ${contrat.numero ?? ""} (${contrat.assureur ?? "votre assureur"}).`,
          "Les conditions générales du contrat restent la référence contractuelle.",
        ],
        lignes,
      });
      await enregistrerReponse(admin, {
        ...base,
        contrat_id: contrat.id,
        statut: "envoye",
        objet: objetReponse,
        corps: lignes.map((l) => `${l.libelle} : ${l.valeur}`).join("\n"),
        envoye_le: new Date().toISOString(),
      });
      await journaliser(
        admin,
        client.id,
        "Réponse automatique envoyée — détail des garanties",
        `Email : ${lienMail(gmail_message_id)}\n\n${lignes.map((l) => `${l.libelle} : ${l.valeur}`).join("\n")}`,
      );
      return { niveau: "niveau_1", intention: "info_garanties", action: "reponse_envoyee", pieces_kyc: piecesKyc };
    }

    if (classification.intention === "attestation") {
      const { data: docs } = await admin
        .from("documents")
        .select("id, file_name, storage_path, mime_type, type_document")
        .eq("contrat_id", contrat.id)
        .eq("type_document", TYPE_ATTESTATION)
        .order("created_at", { ascending: false })
        .limit(1);
      const doc = ((docs ?? []) as any[])[0] as
        | { file_name: string; storage_path: string; mime_type: string | null }
        | undefined;

      if (!doc) {
        return attendreDocument(
          "Aucune attestation d'assurance n'est archivée sur le contrat.",
          objetReponse,
          `Bonjour ${nomComplet(client)},\n\nVous trouverez ci-joint votre attestation d'assurance pour le contrat ${contrat.numero ?? ""}.\n\n[À compléter : aucune attestation n'est archivée sur le contrat — la demander à la compagnie puis la joindre.]\n\nCordialement,\nL'équipe ${CABINET}`,
        );
      }

      const { data: fichier, error: dlErr } = await admin.storage.from(BUCKET).download(doc.storage_path);
      if (dlErr || !fichier) {
        return attendreDocument(
          "Attestation référencée sur le contrat mais fichier illisible dans le stockage.",
          objetReponse,
          `Bonjour ${nomComplet(client)},\n\nVous trouverez ci-joint votre attestation d'assurance.\n\n[À compléter : fichier introuvable dans le stockage.]\n\nCordialement,\nL'équipe ${CABINET}`,
        );
      }
      const base64 = Buffer.from(await fichier.arrayBuffer()).toString("base64");
      await envoyerReponse(
        client.email,
        {
          clientName: nomComplet(client),
          titre: "Votre attestation d'assurance",
          paragraphes: [
            `Vous trouverez en pièce jointe votre attestation d'assurance pour le contrat ${contrat.numero ?? ""} (${contrat.assureur ?? "votre assureur"}).`,
            "Nous restons à votre disposition pour toute précision.",
          ],
        },
        [{ name: doc.file_name, base64 }],
      );
      await enregistrerReponse(admin, {
        ...base,
        contrat_id: contrat.id,
        statut: "envoye",
        objet: objetReponse,
        corps: `Attestation envoyée en pièce jointe : ${doc.file_name}`,
        envoye_le: new Date().toISOString(),
      });
      await journaliser(
        admin,
        client.id,
        "Attestation d'assurance envoyée automatiquement",
        `Pièce jointe : ${doc.file_name}\nEmail : ${lienMail(gmail_message_id)}`,
      );
      return { niveau: "niveau_1", intention: "attestation", action: "reponse_envoyee", pieces_kyc: piecesKyc };
    }
  }

  // ---- Niveau 2 (et tout doute) : brouillon à valider.
  return brouillon(
    classification.niveau === "niveau_1"
      ? "Adresse email du client absente : envoi automatique impossible."
      : `Classification niveau 2 (confiance ${(classification.confiance * 100).toFixed(0)} %) — validation humaine requise.`,
    objetReponse,
    [
      `Bonjour ${nomComplet(client)},`,
      "",
      "Nous avons bien reçu votre message et revenons vers vous.",
      "",
      `[Demande résumée : ${classification.resume || "à qualifier"}]`,
      "",
      `Cordialement,\nL'équipe ${CABINET}`,
    ].join("\n"),
  );
}
