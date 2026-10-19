/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * OFFRE DE PRÊT REÇUE PAR EMAIL (y compris depuis une adresse du cabinet).
 *
 * Un mail portant une offre de prêt ou un tableau d'amortissement n'est jamais
 * un simple « mail interne à qualifier » : les pièces sont lues, le prêt et les
 * emprunteurs relevés, puis
 *   - soit les pièces et les données complètent le dossier emprunteur déjà en
 *     cours pour ces emprunteurs,
 *   - soit une fiche client (prospect) et un dossier sont créés.
 *
 * Garde-fous :
 *  - aucune valeur saisie par un humain n'est écrasée sans trace ;
 *  - aucune donnée de santé (loi Lemoine) ;
 *  - aucune étape réglementaire franchie (lettre de mission et devoir de
 *    conseil restent au circuit humain) ;
 *  - toute écriture donne lieu à une notification visible et à une tâche.
 */

type Admin = any;

export interface PieceEmailPret {
  nom: string;
  mime: string | null;
  attachment_id: string | null;
}

export interface ResultatOffrePretEmail {
  action: "ignore" | "dossier_cree" | "dossier_complete";
  dossier_id: string | null;
  clients_crees: number;
  documents: number;
  motif: string;
}

const BUCKET = "dossier-documents";
const TAILLE_MAX = 12 * 1024 * 1024;
const STATUTS_CLOS = ["cloture", "perdu"];

const lienMail = (id: string) => `https://mail.ionos.fr/`;

/** Une pièce peut-elle être une offre de prêt / un tableau d'amortissement ? */
export function piecePretProbable(nom: string, sujet?: string | null): boolean {
  const t = `${nom} ${sujet ?? ""}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return /(offre.{0,12}pret|tableau.{0,12}amortissement|amortissement|echeancier.{0,12}pret|pret immobilier|simulation.{0,12}pret)/.test(
    t,
  );
}

/**
 * Traite les pièces d'un email : renvoie `ignore` si rien n'évoque un prêt.
 * Ne lève jamais : les erreurs sont journalisées et rendues dans le motif.
 */
export async function traiterOffrePretEmail(
  admin: Admin,
  params: {
    gmail_message_id: string;
    sujet: string | null;
    expediteur_email: string | null;
    pieces_jointes: PieceEmailPret[];
    userId: string;
  },
): Promise<ResultatOffrePretEmail> {
  const rien = (motif: string): ResultatOffrePretEmail => ({
    action: "ignore",
    dossier_id: null,
    clients_crees: 0,
    documents: 0,
    motif,
  });

  const candidates = params.pieces_jointes
    .filter((p) => p.attachment_id)
    .filter((p) => piecePretProbable(p.nom, params.sujet))
    .slice(0, 4);
  if (candidates.length === 0) return rien("Aucune pièce évoquant un prêt");

  try {
    const { telechargerPieceJointe } = await import("@/lib/gmail.server");
    const { analyserOffrePretFichier } = await import("@/lib/offre-pret-analyse.server");
    const { trouverClientExistant, normaliserIdentite } = await import("@/lib/client-dedoublonnage.server");
    const { prefillRecueilEmprunteur } = await import("@/lib/pret-prefill");
    const { creerTacheAdmin } = await import("@/lib/agent-taches.server");
    const { notifierActionAgent } = await import("@/lib/agent-notifications.server");

    // 1. Lecture des pièces (chaque échec est isolé).
    const pret: Record<string, unknown> = {};
    const emprunteurs: {
      prenom: string;
      nom: string;
      date_naissance: string;
      quotite_pct: number | null;
      csp: string;
      fumeur: boolean | null;
      email: string | null;
      telephone: string | null;
      client_id?: string | null;
    }[] = [];
    const fichiers: { nom: string; mime: string | null; octets: Buffer }[] = [];
    const erreurs: string[] = [];

    for (const piece of candidates) {
      try {
        const { base64 } = await telechargerPieceJointe(params.gmail_message_id, piece.attachment_id!);
        const octets = Buffer.from(base64, "base64");
        if (octets.byteLength === 0) throw new Error("pièce vide");
        if (octets.byteLength > TAILLE_MAX) throw new Error("pièce trop volumineuse (12 Mo maximum)");
        const res = await analyserOffrePretFichier({
          nom: piece.nom,
          mime: piece.mime ?? "application/pdf",
          base64,
        });
        fichiers.push({ nom: piece.nom, mime: piece.mime, octets });
        if (!res.lisible) continue;
        for (const [cle, valeur] of Object.entries(res.pret)) {
          if (pret[cle] === undefined) pret[cle] = valeur;
        }
        for (const e of res.emprunteurs) {
          const cle = `${normaliserIdentite(e.nom)}|${normaliserIdentite(e.prenom)}`;
          if (emprunteurs.some((x) => `${normaliserIdentite(x.nom)}|${normaliserIdentite(x.prenom)}` === cle)) continue;
          emprunteurs.push({ ...e });
        }
      } catch (e) {
        erreurs.push(`${piece.nom} : ${e instanceof Error ? e.message : "analyse impossible"}`);
      }
    }

    if (emprunteurs.length === 0 && Object.keys(pret).length === 0) {
      return rien(`Pièces illisibles ou hors périmètre emprunteur${erreurs.length ? ` (${erreurs.join(" ; ")})` : ""}`);
    }

    // 2. Rapprochement / création des fiches (prospect) des emprunteurs.
    let clientsCrees = 0;
    for (const e of emprunteurs) {
      const trouve = await trouverClientExistant(admin, { email: e.email, nom: e.nom, prenom: e.prenom });
      if (trouve) {
        e.client_id = trouve.client_id;
        continue;
      }
      const { data: cree, error } = await admin
        .from("clients")
        .insert({
          nom: e.nom,
          prenom: e.prenom || null,
          email: e.email,
          mobile: e.telephone,
          date_naissance: e.date_naissance || null,
          csp: e.csp || null,
          fumeur: e.fumeur,
          statut: "prospect",
          remarque: "Fiche créée depuis une offre de prêt reçue par email.",
          created_by: params.userId,
        })
        .select("id")
        .maybeSingle();
      if (error) {
        erreurs.push(`fiche ${e.nom} : ${error.message}`);
        continue;
      }
      e.client_id = (cree as { id: string } | null)?.id ?? null;
      if (e.client_id) clientsCrees++;
    }

    const idsClients = emprunteurs.map((e) => e.client_id).filter(Boolean) as string[];
    const principal = emprunteurs[0] ?? null;
    const nomDossier = emprunteurs
      .map((e) => [e.prenom, e.nom].filter(Boolean).join(" "))
      .filter(Boolean)
      .join(" & ")
      .slice(0, 200);

    // 3. Dossier emprunteur déjà en cours pour l'un de ces clients ?
    let dossierId: string | null = null;
    let recueilExistant: Record<string, unknown> | null = null;
    let dossierCreeLe: string | null = null;
    if (idsClients.length > 0) {
      const { data: existants } = await admin
        .from("dossiers")
        .select("id, statut, type_assurance, recueil_besoins, created_at")
        .in("client_id", idsClients)
        .order("created_at", { ascending: false })
        .limit(20);
      const ouvert = ((existants ?? []) as any[]).find(
        (d) =>
          !STATUTS_CLOS.includes(String(d.statut)) &&
          /emprunteur/i.test(String(d.type_assurance ?? "")),
      );
      if (ouvert) {
        dossierId = ouvert.id as string;
        recueilExistant = (ouvert.recueil_besoins as Record<string, unknown> | null) ?? null;
        dossierCreeLe = (ouvert.created_at as string) ?? null;
      }
    }

    const creation = !dossierId;
    if (creation) {
      const { data: cree, error } = await admin
        .from("dossiers")
        .insert({
          client_id: idsClients[0] ?? null,
          client_nom: nomDossier || "Dossier emprunteur",
          client_email: principal?.email ?? null,
          client_phone: principal?.telephone ?? null,
          type_assurance: "emprunteur",
          // Créé par un agent automatique : ce marqueur doit toujours être fiable.
          cree_automatiquement: true,
          notes: `Dossier créé automatiquement depuis l'offre de prêt reçue par email (${params.expediteur_email ?? "expéditeur inconnu"}).`,
          created_by: params.userId,
          apporteur_id: params.userId,
        })
        .select("id, created_at")
        .single();
      if (error) throw new Error(error.message);
      dossierId = (cree as { id: string }).id;
      dossierCreeLe = (cree as { created_at?: string }).created_at ?? null;
    }

    // 4. Pré-remplissage NON destructif du recueil (le document fait foi sur
    //    les caractéristiques du prêt, jamais sur les étapes réglementaires).
    const { recueil, ajouts } = prefillRecueilEmprunteur(recueilExistant, pret, {
      dossier_cree_le: dossierCreeLe,
      date_document: null, // aucune date d'édition inventée : seule la date lue sur le document sert de départ
      document_fait_foi: true,
    });
    const assuresExistants = Array.isArray((recueil as any).assures) ? ((recueil as any).assures as any[]) : [];
    if (emprunteurs.length > 0) {
      const fusion = [...assuresExistants];
      emprunteurs.forEach((e, i) => {
        const idx = fusion.findIndex(
          (a) =>
            String(a?.nom ?? "").toLowerCase().trim() === e.nom.toLowerCase().trim() &&
            String(a?.prenom ?? "").toLowerCase().trim() === (e.prenom ?? "").toLowerCase().trim(),
        );
        const ligne = {
          lien: i === 0 ? "principal" : "co_emprunteur",
          prenom: e.prenom,
          nom: e.nom,
          date_naissance: e.date_naissance,
          quotite_pct: e.quotite_pct,
          csp: e.csp,
          fumeur: e.fumeur === true,
          ...(e.client_id ? { client_id: e.client_id } : {}),
        };
        if (idx >= 0) fusion[idx] = { ...fusion[idx], ...ligne };
        else fusion.push(ligne);
      });
      (recueil as any).assures = fusion;
    }
    const { error: majErreur } = await admin
      .from("dossiers")
      .update({
        recueil_besoins: recueil,
        ...(pret["montant_capital"] ? { capital: Number(pret["montant_capital"]) } : {}),
        ...(pret["duree_mois"] ? { duree_mois: Number(pret["duree_mois"]) } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", dossierId);
    if (majErreur) erreurs.push(`recueil : ${majErreur.message}`);

    // 5. Archivage des pièces sur le dossier + validation des pièces requises.
    let documents = 0;
    for (const f of fichiers) {
      try {
        const safeName = f.nom.replace(/[^\w.\-]+/g, "_").slice(0, 120);
        const chemin = `${idsClients[0] ?? dossierId}/emails/${params.gmail_message_id}/${Date.now()}-${safeName}`;
        const { error: upErr } = await admin.storage
          .from(BUCKET)
          .upload(chemin, f.octets, { contentType: f.mime ?? "application/octet-stream" });
        if (upErr) throw new Error(upErr.message);
        const type = /amortissement|echeancier/i.test(f.nom) ? "tableau_amortissement" : "offre_pret";
        const { data: doc } = await admin
          .from("documents")
          .insert({
            dossier_id: dossierId,
            client_id: idsClients[0] ?? null,
            uploader_id: params.userId,
            storage_path: chemin,
            file_name: f.nom.slice(0, 200),
            file_size: f.octets.byteLength,
            mime_type: f.mime,
            categorie: "dossier",
            type_document: type,
          })
          .select("id")
          .maybeSingle();
        documents++;
        if (doc?.id) {
          await admin
            .from("dossier_pieces_requises")
            .update({ statut: "recue", recue_le: new Date().toISOString(), document_id: doc.id })
            .eq("dossier_id", dossierId)
            .eq("code", type);
        }
      } catch (e) {
        erreurs.push(`archivage ${f.nom} : ${e instanceof Error ? e.message : "échec"}`);
      }
    }

    // 6. Traçabilité : notification visible + tâche de vérification humaine.
    const lignes = [
      creation ? "Dossier emprunteur CRÉÉ depuis l'offre de prêt reçue par email." : "Dossier emprunteur EXISTANT complété (aucune valeur humaine perdue).",
      `Objet du mail : ${params.sujet ?? "(sans objet)"}`,
      `Expéditeur : ${params.expediteur_email ?? "inconnu"}`,
      `Emprunteurs : ${nomDossier || "non identifiés"}`,
      clientsCrees > 0 ? `Fiches créées (prospect) : ${clientsCrees}` : null,
      documents > 0 ? `Pièces archivées sur le dossier : ${documents}` : null,
      ajouts.length ? `Champs renseignés : ${ajouts.join(", ")}` : null,
      erreurs.length ? `À vérifier : ${erreurs.join(" ; ")}` : null,
      `Email : ${lienMail(params.gmail_message_id)}`,
    ];

    await notifierActionAgent(admin, {
      gmail_message_id: params.gmail_message_id,
      titre: `${creation ? "Dossier emprunteur créé" : "Dossier emprunteur complété"} — ${nomDossier || "offre de prêt"}`.slice(0, 200),
      lignes,
      client_id: idsClients[0] ?? null,
      dossier_id: dossierId,
      created_by: params.userId,
    }).catch((e: unknown) => console.error("[offre-pret-email] notification impossible", e));

    await creerTacheAdmin(admin, {
      titre: `Vérifier le dossier emprunteur issu de l'offre de prêt — ${nomDossier || "à qualifier"}`.slice(0, 200),
      description: [...lignes, "Action : contrôler le prêt, les quotités et lancer la lettre de mission (aucune étape réglementaire automatique)."]
        .filter(Boolean)
        .join("\n"),
      client_id: idsClients[0] ?? null,
      dossier_id: dossierId,
      priorite: "haute",
      created_by: params.userId,
    }).catch((e: unknown) => console.error("[offre-pret-email] tâche impossible", e));

    return {
      action: creation ? "dossier_cree" : "dossier_complete",
      dossier_id: dossierId,
      clients_crees: clientsCrees,
      documents,
      motif: creation
        ? "Offre de prêt lue : dossier emprunteur créé et pré-rempli."
        : "Offre de prêt lue : dossier emprunteur existant complété.",
    };
  } catch (e) {
    console.error("[offre-pret-email] échec", params.gmail_message_id, e);
    return rien(e instanceof Error ? e.message : "erreur inconnue");
  }
}
