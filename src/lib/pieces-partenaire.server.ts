/**
 * PIÈCES JOINTES DES MAILS PARTENAIRES / FOURNISSEURS.
 *
 * Un mail de compagnie (April, Kereis, Néoliane…) n'est jamais un client, mais
 * il transporte très souvent une pièce qui appartient à un client du cabinet
 * (attestation, avenant, échéancier, carte verte…). Ces pièces ne doivent ni
 * créer une fiche client au nom du partenaire, ni disparaître.
 *
 * Principe : CERTITUDE > AUTOMATISATION.
 *  - Gemini lit la pièce et n'en extrait QUE de quoi identifier le titulaire
 *    (nom, prénom, numéro de contrat) ;
 *  - la pièce est déposée sur la fiche du client identifié, puis rattachée au
 *    dossier / contrat par le moteur de rattachement existant ;
 *  - aucun client, dossier ou contrat n'est créé ; en cas de doute la pièce est
 *    déposée dans le stockage « à classer » et une tâche humaine est créée.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { SupabaseClient } from "@supabase/supabase-js";

type Admin = SupabaseClient<any, any, any>;

const BUCKET = "dossier-documents";
const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODELES = ["google/gemini-3.6-flash", "google/gemini-2.5-flash"];
const TAILLE_MAX = 12 * 1024 * 1024;

export interface PieceEmail {
  nom: string;
  mime?: string | null;
  attachment_id?: string | null;
}

export interface IdentificationTitulaire {
  nom: string | null;
  prenom: string | null;
  numero_contrat: string | null;
  nature: string | null;
  confidence: number;
  justification: string;
  model: string;
}

export interface ResultatPiecePartenaire {
  piece: string;
  storage_path: string | null;
  document_id: string | null;
  client_id: string | null;
  dossier_id: string | null;
  contrat_id: string | null
  ;
  statut: "rattachee" | "a_classer" | "echec" | "deja_traite";
  detail: string;
}

function estImage(mime: string | null | undefined): boolean {
  return (mime ?? "").startsWith("image/");
}

function extraireJson(texte: string): Record<string, unknown> {
  const nettoye = texte.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(nettoye) as Record<string, unknown>;
  } catch {
    const debut = nettoye.indexOf("{");
    const fin = nettoye.lastIndexOf("}");
    if (debut >= 0 && fin > debut) return JSON.parse(nettoye.slice(debut, fin + 1)) as Record<string, unknown>;
    throw new Error("Réponse IA illisible");
  }
}

function prompt(contexte: { compagnie: string | null; sujet: string | null }): string {
  return [
    "Tu analyses une pièce jointe reçue par un cabinet de courtage en assurances,",
    `envoyée par un partenaire assureur${contexte.compagnie ? ` (${contexte.compagnie})` : ""}.`,
    contexte.sujet ? `Objet du mail : ${contexte.sujet}` : "",
    "",
    "MISSION UNIQUE : identifier le TITULAIRE (l'assuré) du document et, s'il est",
    "écrit noir sur blanc, le numéro de contrat. Rien d'autre.",
    "",
    "INTERDICTIONS : n'extrais aucune donnée de santé, aucun montant, aucune",
    "coordonnée bancaire ; n'invente jamais un nom ou un numéro absent du document.",
    "",
    "Réponds STRICTEMENT en JSON, sans texte autour :",
    '{"nom":"","prenom":"","numero_contrat":"","nature":"","confidence":0.00,"justification":""}',
    "",
    "Règles : champs inconnus = null ; `nature` décrit le document en 3 mots",
    "maximum (ex. « attestation EDPM ») ; `confidence` entre 0.00 et 1.00 reflète",
    "honnêtement ta certitude sur l'identité du titulaire ; justification en une",
    "phrase française sans donnée personnelle.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Lecture Gemini de la pièce : identification du titulaire uniquement. */
export async function identifierTitulaire(
  fichier: { nom: string; mime: string; base64: string },
  contexte: { compagnie: string | null; sujet: string | null },
): Promise<IdentificationTitulaire> {
  const cle = process.env["LOVABLE_API_KEY"];
  if (!cle) throw new Error("Lecture IA indisponible : clé IA absente du projet.");

  const dataUrl = `data:${fichier.mime};base64,${fichier.base64}`;
  const contenu = estImage(fichier.mime)
    ? [
        { type: "text", text: prompt(contexte) },
        { type: "image_url", image_url: { url: dataUrl } },
      ]
    : [
        { type: "text", text: prompt(contexte) },
        { type: "file", file: { filename: fichier.nom, file_data: dataUrl } },
      ];

  let derniere = "";
  for (const model of MODELES) {
    const res = await fetch(GATEWAY, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cle}` },
      body: JSON.stringify({ model, messages: [{ role: "user", content: contenu }] }),
    });
    if (res.ok) {
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const texte = json.choices?.[0]?.message?.content ?? "";
      if (!texte) throw new Error("Réponse IA vide");
      const brut = extraireJson(texte);
      const chaine = (c: unknown) => (typeof c === "string" && c.trim() ? c.trim().slice(0, 200) : null);
      const conf = Number(brut["confidence"]);
      return {
        nom: chaine(brut["nom"]),
        prenom: chaine(brut["prenom"]),
        numero_contrat: chaine(brut["numero_contrat"]),
        nature: chaine(brut["nature"]),
        confidence: Number.isFinite(conf) ? Math.min(1, Math.max(0, conf)) : 0,
        justification: chaine(brut["justification"]) ?? "Aucune justification fournie.",
        model,
      };
    }
    derniere = `${res.status} ${await res.text()}`;
    // 402/403 : blocage définitif (crédits ou politique) — inutile d'insister.
    if (res.status === 402 || res.status === 403 || res.status === 429) break;
    if (res.status !== 400 && res.status !== 404) break;
  }
  throw new Error(`Lecture IA impossible : ${derniere}`);
}

/** Recherche du client par numéro de contrat puis par nom + prénom. Aucune création. */
async function retrouverClient(
  admin: Admin,
  ident: IdentificationTitulaire,
): Promise<{ client_id: string; contrat_id: string | null; source: string } | { client_id: null; raison: string }> {
  if (ident.numero_contrat && ident.numero_contrat.length >= 5) {
    const { data } = await admin
      .from("contrats")
      .select("id, client_id, numero")
      .ilike("numero", ident.numero_contrat);
    const rows = (data ?? []) as { id: string; client_id: string | null }[];
    const avecClient = rows.filter((r) => r.client_id);
    if (avecClient.length === 1)
      return {
        client_id: avecClient[0]!.client_id!,
        contrat_id: avecClient[0]!.id,
        source: `numéro de contrat ${ident.numero_contrat}`,
      };
    if (avecClient.length > 1) return { client_id: null, raison: "plusieurs contrats portent ce numéro" };
  }

  if (!ident.nom) return { client_id: null, raison: "aucun titulaire identifiable dans le document" };
  let req = admin.from("clients").select("id, nom, prenom, statut").ilike("nom", ident.nom);
  if (ident.prenom) req = req.ilike("prenom", `${ident.prenom}%`);
  const { data } = await req;
  const clients = (data ?? []) as { id: string }[];
  if (clients.length === 1)
    return {
      client_id: clients[0]!.id,
      contrat_id: null,
      source: `nom du titulaire (${[ident.prenom, ident.nom].filter(Boolean).join(" ")})`,
    };
  if (clients.length > 1) return { client_id: null, raison: `${clients.length} fiches portent ce nom` };
  return { client_id: null, raison: "titulaire inconnu du CRM" };
}

function lienMail(id: string): string {
  return `https://mail.google.com/mail/u/0/#all/${id}`;
}

/** Clés d'idempotence des tâches humaines créées pour une pièce partenaire. */
export function clePieceAClasser(gmailMessageId: string, nomFichier: string): string {
  return `piece_partenaire:a_classer:${gmailMessageId}:${nomFichier}`;
}
export function clePieceEchec(gmailMessageId: string, nomFichier: string): string {
  return `piece_partenaire:echec:${gmailMessageId}:${nomFichier}`;
}

/**
 * Un objet existe-t-il déjà dans le stockage « à classer » pour ce mail et ce
 * nom de fichier ? Les objets sont nommés `<Date.now()>-<nomFichier>` : on
 * compare sur le suffixe `-<nomFichier>`.
 */
async function objetDejaDepose(admin: Admin, prefixe: string, nomFichier: string): Promise<string | null> {
  const { data, error } = await admin.storage.from(BUCKET).list(prefixe, { limit: 1000 });
  if (error) {
    console.error("[pieces-partenaire] lecture du stockage impossible", prefixe, error.message);
    return null;
  }
  const trouve = (data ?? []).find((o: { name?: string }) => (o.name ?? "").endsWith(`-${nomFichier}`));
  return trouve ? `${prefixe}/${trouve.name}` : null;
}

/**
 * Traite les pièces jointes d'un mail partenaire : lecture IA, identification du
 * client, dépôt et rattachement. Aucune exception n'est propagée : chaque pièce
 * est traitée indépendamment et, à défaut de certitude, laissée à l'humain.
 */
export async function traiterPiecesJointesPartenaire(
  admin: Admin,
  params: {
    gmail_message_id: string;
    sujet: string | null;
    texte: string | null;
    compagnie: string | null;
    pieces_jointes: PieceEmail[];
    userId: string;
  },
): Promise<{ traitees: number; rattachees: number; a_classer: number; details: ResultatPiecePartenaire[] }> {
  const details: ResultatPiecePartenaire[] = [];
  const utiles = params.pieces_jointes.filter((p) => p.attachment_id);
  if (utiles.length === 0) return { traitees: 0, rattachees: 0, a_classer: 0, details };

  const { telechargerPieceJointe } = await import("@/lib/gmail.server");
  const { creerTacheAdmin } = await import("@/lib/agent-taches.server");
  const { rattacherDocument } = await import("@/lib/rattachement-documentaire.server");

  for (const piece of utiles) {
    const resultat: ResultatPiecePartenaire = {
      piece: piece.nom,
      storage_path: null,
      document_id: null,
      client_id: null,
      dossier_id: null,
      contrat_id: null,
      statut: "echec",
      detail: "",
    };
    const nomFichier = piece.nom.replace(/[^\w.\-]+/g, "_").slice(0, 120);
    try {
      // Anti-doublon : si cette pièce de ce même mail a déjà été déposée (mail
      // retraité par le tri, retry, ou webhook dupliqué), on ne la redépose pas.
      const { data: dejaPresent } = await admin
        .from("documents")
        .select("id")
        .ilike("storage_path", `%/${params.gmail_message_id}/%-${nomFichier}`)
        .limit(1)
        .maybeSingle();
      if (dejaPresent) {
        resultat.statut = "deja_traite";
        resultat.detail = "Pièce déjà déposée pour ce mail — non redéposée.";
        resultat.document_id = dejaPresent.id;
        details.push(resultat);
        continue;
      }

      // Pièce déjà déposée « à classer » (aucune ligne documents) pour ce mail.
      const dejaAClasser = await objetDejaDepose(admin, `a-classer/${params.gmail_message_id}`, nomFichier);
      if (dejaAClasser) {
        resultat.statut = "deja_traite";
        resultat.storage_path = dejaAClasser;
        resultat.detail = "Pièce déjà déposée « à classer » pour ce mail — non redéposée.";
        details.push(resultat);
        continue;
      }

      // Pièce déjà signalée en échec ou à classer : la tâche humaine existe.
      const { data: tacheExistante } = await admin
        .from("taches")
        .select("id")
        .in("idempotency_key", [
          clePieceAClasser(params.gmail_message_id, nomFichier),
          clePieceEchec(params.gmail_message_id, nomFichier),
        ])
        .limit(1)
        .maybeSingle();
      if (tacheExistante) {
        resultat.statut = "deja_traite";
        resultat.detail = "Tâche humaine déjà ouverte pour cette pièce — non retraitée.";
        details.push(resultat);
        continue;
      }

      const { base64 } = await telechargerPieceJointe(params.gmail_message_id, piece.attachment_id!);
      const octets = Buffer.from(base64, "base64");
      if (octets.byteLength === 0) throw new Error("pièce vide");
      if (octets.byteLength > TAILLE_MAX) throw new Error("pièce trop volumineuse (12 Mo maximum)");

      const ident = await identifierTitulaire(
        {
          nom: piece.nom,
          mime: piece.mime ?? "application/pdf",
          base64,
        },
        { compagnie: params.compagnie, sujet: params.sujet },
      );
      const trouve = await retrouverClient(admin, ident);

      const chemin = trouve.client_id
        ? `${trouve.client_id}/partenaires/${params.gmail_message_id}/${Date.now()}-${nomFichier}`
        : `a-classer/${params.gmail_message_id}/${Date.now()}-${nomFichier}`;
      const { error: erreurDepot } = await admin.storage
        .from(BUCKET)
        .upload(chemin, octets, { contentType: piece.mime ?? "application/octet-stream" });
      if (erreurDepot) throw new Error(erreurDepot.message);
      resultat.storage_path = chemin;

      if (!trouve.client_id) {
        // Aucune fiche client n'est créée : la pièce attend une décision humaine.
        resultat.statut = "a_classer";
        resultat.detail = `Titulaire non identifié (${"raison" in trouve ? trouve.raison : "doute"})`;
        await creerTacheAdmin(admin as never, {
          idempotency_key: clePieceAClasser(params.gmail_message_id, nomFichier),
          source: "pieces-partenaire",
          source_event_id: params.gmail_message_id,
          titre: `Pièce partenaire à rattacher — ${piece.nom}`.slice(0, 200),
          description: [
            `Partenaire : ${params.compagnie ?? "inconnu"}`,
            `Objet du mail : ${params.sujet ?? "(sans objet)"}`,
            `Nature lue par l'IA : ${ident.nature ?? "indéterminée"} (confiance ${Math.round(ident.confidence * 100)} %)`,
            `Motif : ${resultat.detail}.`,
            `Fichier conservé : ${BUCKET}/${chemin}`,
            `Email : ${lienMail(params.gmail_message_id)}`,
            "Action : ouvrir la pièce et la rattacher au client concerné.",
          ].join("\n"),
          priorite: "normale",
          created_by: params.userId,
        });
        details.push(resultat);
        continue;
      }

      resultat.client_id = trouve.client_id;
      const { data: cree, error } = await admin
        .from("documents")
        .insert({
          client_id: trouve.client_id,
          contrat_id: trouve.contrat_id,
          file_name: piece.nom.slice(0, 250),
          storage_path: chemin,
          mime_type: piece.mime,
          file_size: octets.byteLength,
          categorie: "contrat",
          type_document: "piece_partenaire_email",
          uploader_id: params.userId,
        })
        .select("id")
        .maybeSingle();
      if (error) throw new Error(error.message);
      resultat.document_id = (cree as { id: string } | null)?.id ?? null;
      resultat.contrat_id = trouve.contrat_id;

      // Rattachement dossier / contrat par le moteur existant (aucune création).
      if (resultat.document_id) {
        const decision = await rattacherDocument(admin, {
          documentId: resultat.document_id,
          clientId: trouve.client_id,
          sujet: params.sujet,
          texte: [params.texte, ident.numero_contrat].filter(Boolean).join("\n"),
          lienEmail: lienMail(params.gmail_message_id),
          userId: params.userId,
        });
        resultat.dossier_id = decision.dossier_id;
        resultat.contrat_id = resultat.contrat_id ?? decision.contrat_id;
      }

      resultat.statut = "rattachee";
      resultat.detail = `Pièce déposée sur la fiche client — identification par ${"source" in trouve ? trouve.source : "IA"}`;

      await admin.from("activites").insert({
        client_id: trouve.client_id,
        type: "systeme",
        titre: `Pièce reçue d'un partenaire — ${ident.nature ?? piece.nom}`.slice(0, 200),
        contenu: [
          `Partenaire : ${params.compagnie ?? "inconnu"}`,
          `Fichier : ${piece.nom}`,
          resultat.detail,
          `Email : ${lienMail(params.gmail_message_id)}`,
        ].join("\n"),
      });

      // NOTIFICATION OBLIGATOIRE : aucune pièce n'est ajoutée silencieusement à
      // une fiche client ou à un dossier existant, même avec une identification sûre.
      const { notifierActionAgent } = await import("@/lib/agent-notifications.server");
      await notifierActionAgent(admin, {
        gmail_message_id: params.gmail_message_id,
        titre: `Pièce partenaire ajoutée automatiquement — ${piece.nom}`,
        lignes: [
          `Partenaire : ${params.compagnie ?? "inconnu"}`,
          `Objet du mail : ${params.sujet ?? "(sans objet)"}`,
          `Nature lue par l'IA : ${ident.nature ?? "indéterminée"}`,
          resultat.detail,
          resultat.dossier_id ? `Dossier rattaché : ${resultat.dossier_id}` : null,
          "Vérifier le rattachement de la pièce.",
        ],
        client_id: trouve.client_id,
        created_by: params.userId,
      }).catch(() => false);

    } catch (e) {
      resultat.statut = "echec";
      resultat.detail = e instanceof Error ? e.message : "erreur inconnue";
      console.error("[pieces-partenaire]", params.gmail_message_id, piece.nom, resultat.detail);
      await creerTacheAdmin(admin as never, {
        idempotency_key: clePieceEchec(params.gmail_message_id, nomFichier),
        source: "pieces-partenaire",
        source_event_id: params.gmail_message_id,
        titre: `Pièce partenaire non traitée — ${piece.nom}`.slice(0, 200),
        description: [
          `Partenaire : ${params.compagnie ?? "inconnu"}`,
          `Objet du mail : ${params.sujet ?? "(sans objet)"}`,
          `Motif : ${resultat.detail}`,
          `Email : ${lienMail(params.gmail_message_id)}`,
          "Action : télécharger la pièce depuis Gmail et la classer manuellement.",
        ].join("\n"),
        priorite: "normale",
        created_by: params.userId,
      }).catch(() => undefined);
    }
    details.push(resultat);
  }

  return {
    traitees: details.length,
    rattachees: details.filter((d) => d.statut === "rattachee").length,
    a_classer: details.filter((d) => d.statut === "a_classer" || d.statut === "echec").length,
    details,
  };
}
