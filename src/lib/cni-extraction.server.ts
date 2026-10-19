import { geminiFetch } from "@/lib/gemini-gateway.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { creerTacheAdmin } from "@/lib/agent-taches.server";

/**
 * Bouclage LCB-FT : lecture IA de la pièce d'identité déposée par le prospect,
 * complétion de la date de naissance sur la fiche client, puis relance
 * automatique du contrôle LCB-FT resté « en attente d'informations ».
 */

type Admin = SupabaseClient<Database>;

const GATEWAY = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const MODELES = ["gemini-3.6-flash", "gemini-2.5-flash"];
const BUCKETS = ["conformite-documents", "dossier-documents"];
const TAILLE_MAX = 12 * 1024 * 1024;

const PROMPT = [
  "Tu lis une pièce d'identité (CNI, passeport ou titre de séjour).",
  "Extrais uniquement les informations d'état civil du titulaire.",
  "",
  "Réponds STRICTEMENT en JSON, sans texte autour, au format :",
  '{"civilite":"M."|"Mme"|null,"nom":"","prenom":"","date_naissance":"AAAA-MM-JJ","lieu_naissance":"","pays_naissance":"","nationalite":"","date_expiration":"AAAA-MM-JJ","fiable":true}',
  "",
  "Règles :",
  "- Les dates au format ISO AAAA-MM-JJ. Si illisible ou absente, mets null.",
  "- `nom` = nom de naissance / nom de famille ; `prenom` = premier prénom.",
  "- `civilite` = « M. » ou « Mme » selon le sexe indiqué, sinon null.",
  "- `lieu_naissance` = ville de naissance si visible, sinon null ; `pays_naissance` = pays si visible.",
  "- `nationalite` en français (ex. « Française »), sinon null.",
  "- `date_expiration` = date de fin de validité de la pièce, sinon null.",
  "- `fiable` = false si le document est illisible, tronqué, ou si tu n'es pas certain des valeurs.",
  "- N'invente jamais une valeur.",
].join("\n");

type Extraction = {
  civilite: string | null;
  nom: string | null;
  prenom: string | null;
  date_naissance: string | null;
  lieu_naissance: string | null;
  pays_naissance: string | null;
  nationalite: string | null;
  date_expiration: string | null;
  fiable: boolean;
};

function champ(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function extraireJson(texte: string): unknown {
  const nettoye = texte.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(nettoye);
  } catch {
    const debut = nettoye.indexOf("{");
    const fin = nettoye.lastIndexOf("}");
    if (debut === -1 || fin <= debut) throw new Error("Réponse IA illisible (JSON attendu)");
    return JSON.parse(nettoye.slice(debut, fin + 1));
  }
}

async function appelerBrut(
  fichier: { nom: string; mime: string; base64: string },
  prompt: string,
): Promise<Record<string, unknown>> {
  const cle = process.env["GEMINI_API_KEY"];
  if (!cle) throw new Error("Lecture indisponible : clé IA absente du projet.");

  const contenu = [
    { type: "text", text: prompt },
    { type: "file", file: { filename: fichier.nom, file_data: `data:${fichier.mime};base64,${fichier.base64}` } },
  ];

  let derniere = "";
  for (const modele of MODELES) {
    const res = await geminiFetch(GATEWAY, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cle}` },
      body: JSON.stringify({ model: modele, messages: [{ role: "user", content: contenu }] }),
    });
    if (res.ok) {
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const texte = json.choices?.[0]?.message?.content ?? "";
      if (!texte) throw new Error("Réponse IA vide");
      return extraireJson(texte) as Record<string, unknown>;
    }
    derniere = `${res.status} ${await res.text()}`;
    if (res.status === 429) throw new Error("Lecture IA momentanément saturée, réessayez dans une minute.");
    if (res.status !== 400 && res.status !== 404) break;
  }
  throw new Error(`Lecture IA impossible : ${derniere}`);
}

async function appelerIa(fichier: { nom: string; mime: string; base64: string }): Promise<Extraction> {
  const brut = await appelerBrut(fichier, PROMPT);
  return {
    civilite: champ(brut["civilite"]),
    nom: champ(brut["nom"]),
    prenom: champ(brut["prenom"]),
    date_naissance: champ(brut["date_naissance"]),
    lieu_naissance: champ(brut["lieu_naissance"]),
    pays_naissance: champ(brut["pays_naissance"]),
    nationalite: champ(brut["nationalite"]),
    date_expiration: champ(brut["date_expiration"]),
    fiable: brut["fiable"] !== false,
  };
}

/** Justificatif de domicile : adresse postale du titulaire. */
const PROMPT_DOMICILE = [
  "Tu lis un justificatif de domicile (facture d'électricité, de gaz, d'eau, de téléphone/internet,",
  "quittance de loyer, avis d'imposition ou attestation d'assurance habitation).",
  "Extrais uniquement le nom du titulaire et son adresse postale de résidence.",
  "",
  "Réponds STRICTEMENT en JSON, sans texte autour, au format :",
  '{"nom":"","prenom":"","adresse":"","complement_adresse":"","code_postal":"","ville":"","pays":"","fiable":true}',
  "",
  "Règles :",
  "- `adresse` = numéro et nom de voie uniquement (ex. « 12 rue des Lilas »), sans code postal ni ville.",
  "- `complement_adresse` = bâtiment, étage, appartement, lieu-dit si visible, sinon null.",
  "- `code_postal` = 5 chiffres pour la France, sinon la valeur telle qu'elle apparaît.",
  "- Prends l'adresse de résidence du titulaire, jamais l'adresse du fournisseur ou de l'expéditeur.",
  "- `pays` en français (ex. « France ») si visible, sinon null.",
  "- `fiable` = false si le document est illisible, tronqué, s'il ne s'agit pas d'un justificatif de domicile,",
  "  ou si tu n'es pas certain de l'adresse.",
  "- N'invente jamais une valeur : mets null quand l'information est absente.",
].join("\n");

type ExtractionDomicile = {
  nom: string | null;
  prenom: string | null;
  adresse: string | null;
  complement_adresse: string | null;
  code_postal: string | null;
  ville: string | null;
  pays: string | null;
  fiable: boolean;
};

async function appelerIaDomicile(fichier: {
  nom: string;
  mime: string;
  base64: string;
}): Promise<ExtractionDomicile> {
  const brut = await appelerBrut(fichier, PROMPT_DOMICILE);
  return {
    nom: champ(brut["nom"]),
    prenom: champ(brut["prenom"]),
    adresse: champ(brut["adresse"]),
    complement_adresse: champ(brut["complement_adresse"]),
    code_postal: champ(brut["code_postal"]),
    ville: champ(brut["ville"]),
    pays: champ(brut["pays"]),
    fiable: brut["fiable"] !== false,
  };
}

/** Comparaison souple des noms (accents, casse, tirets, ordre des prénoms composés). */
function normaliser(v: string): string {
  return v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .trim();
}

function concorde(fiche: string | null, extrait: string | null): boolean {
  const a = normaliser(fiche ?? "");
  const b = normaliser(extrait ?? "");
  if (!a || !b) return false;
  if (a === b) return true;
  const motsA = a.split(" ");
  const motsB = b.split(" ");
  return motsA.some((m) => m.length > 2 && motsB.includes(m));
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function dateValide(v: string | null): boolean {
  if (!v || !ISO.test(v)) return false;
  const t = Date.parse(v);
  if (Number.isNaN(t)) return false;
  const annee = Number(v.slice(0, 4));
  return annee >= 1900 && t < Date.now();
}

async function telecharger(admin: Admin, path: string): Promise<{ blob: Blob } | null> {
  for (const bucket of BUCKETS) {
    const { data } = await admin.storage.from(bucket).download(path);
    if (data) return { blob: data };
  }
  return null;
}

export type ResultatCni =
  | { statut: "ignore"; raison: string }
  | { statut: "ecart"; raison: string }
  | { statut: "complete"; date_naissance: string | null; champs: string[]; lcb: string | null };

/**
 * Traite une pièce d'identité déposée : extraction IA, complétion des champs
 * d'état civil encore vides de la fiche client, et relance du contrôle LCB-FT
 * si celui-ci attendait justement ces informations.
 */
export async function traiterPieceIdentiteEtRelancerLcb(
  admin: Admin,
  kycDocumentId: string,
): Promise<ResultatCni> {
  const { data: doc } = await admin
    .from("client_kyc_documents")
    .select("id, client_id, type, nom, storage_path, date_expiration")
    .eq("id", kycDocumentId)
    .maybeSingle();
  if (!doc) return { statut: "ignore", raison: "Document introuvable" };
  const d = doc as {
    client_id: string;
    type: string;
    nom: string | null;
    storage_path: string;
    date_expiration: string | null;
  };
  if (d.type === "justificatif_domicile") return traiterJustificatifDomicile(admin, kycDocumentId, d);
  if (d.type !== "cni") return { statut: "ignore", raison: "Type de document non exploitable" };

  // La relance du contrôle LCB-FT n'a lieu que s'il attendait ces informations.
  const { data: derniere } = await admin
    .from("client_lcb_verifications")
    .select("id, statut")
    .eq("client_id", d.client_id)
    .order("verifie_le", { ascending: false })
    .limit(1)
    .maybeSingle();
  const lcbEnAttente = (derniere as { statut: string } | null)?.statut === "en_attente_infos";

  const { data: client } = await admin
    .from("clients")
    .select(
      "id, civilite, nom, prenom, nom_naissance, date_naissance, lieu_naissance, ville_naissance, pays_naissance, nationalite",
    )
    .eq("id", d.client_id)
    .maybeSingle();
  if (!client) return { statut: "ignore", raison: "Fiche client introuvable" };
  const c = client as {
    id: string;
    civilite: string | null;
    nom: string | null;
    prenom: string | null;
    nom_naissance: string | null;
    date_naissance: string | null;
    lieu_naissance: string | null;
    ville_naissance: string | null;
    pays_naissance: string | null;
    nationalite: string | null;
  };

  let extraction: Extraction;
  try {
    const fichier = await telecharger(admin, d.storage_path);
    if (!fichier) throw new Error("Fichier indisponible dans le stockage");
    const buffer = Buffer.from(await fichier.blob.arrayBuffer());
    if (buffer.byteLength === 0) throw new Error("Fichier vide");
    if (buffer.byteLength > TAILLE_MAX) throw new Error("Fichier trop volumineux (12 Mo maximum)");
    extraction = await appelerIa({
      nom: d.nom || "piece-identite",
      mime: fichier.blob.type || "application/pdf",
      base64: buffer.toString("base64"),
    });
  } catch (e) {
    const raison = e instanceof Error ? e.message : "erreur inconnue";
    await creerTacheAdmin(admin, {
      titre: "Pièce d'identité illisible — LCB-FT en attente",
      description: `La lecture automatique de la pièce d'identité de ${c.prenom ?? ""} ${c.nom ?? ""} a échoué (${raison}).\nAction : saisir manuellement la date de naissance sur la fiche puis relancer le contrôle LCB-FT depuis l'onglet Conformité.`,
      client_id: c.id,
    });
    return { statut: "ecart", raison };
  }

  const ecarts: string[] = [];
  if (!extraction.fiable) ecarts.push("l'IA signale une lecture peu fiable");
  if (!concorde(c.nom, extraction.nom)) {
    ecarts.push(`nom différent (fiche « ${c.nom ?? "—"} » / pièce « ${extraction.nom ?? "—"} »)`);
  }
  if (c.prenom && !concorde(c.prenom, extraction.prenom)) {
    ecarts.push(`prénom différent (fiche « ${c.prenom} » / pièce « ${extraction.prenom ?? "—"} »)`);
  }

  if (ecarts.length > 0) {
    await creerTacheAdmin(admin, {
      titre: "Pièce d'identité — écart avec la fiche client",
      description: `Lecture automatique de la pièce d'identité de ${c.prenom ?? ""} ${c.nom ?? ""} non appliquée.\nÉcarts constatés :\n- ${ecarts.join("\n- ")}\nAction : vérifier la pièce puis corriger la fiche manuellement.`,
      client_id: c.id,
    });
    await admin
      .from("activites")
      .insert({
        client_id: c.id,
        type: "systeme",
        titre: "Lecture automatique de la pièce d'identité non appliquée",
        contenu: `Écarts constatés :\n- ${ecarts.join("\n- ")}`,
      })
      .then(
        () => undefined,
        (e: unknown) => console.error("[CNI] trace écart non enregistrée", e),
      );
    return { statut: "ecart", raison: ecarts.join(" ; ") };
  }

  // Complétion des champs encore vides uniquement : une saisie humaine n'est jamais écrasée.
  const patch: Record<string, unknown> = {};
  const remplis: string[] = [];
  const completer = (colonne: string, actuel: string | null, valeur: string | null, libelle: string) => {
    if (!actuel && valeur) {
      patch[colonne] = valeur;
      remplis.push(`${libelle} : ${valeur}`);
    }
  };

  const dateNaissance = dateValide(extraction.date_naissance) ? (extraction.date_naissance as string) : null;
  completer("date_naissance", c.date_naissance, dateNaissance, "Date de naissance");
  completer("civilite", c.civilite, extraction.civilite, "Civilité");
  completer("prenom", c.prenom, extraction.prenom, "Prénom");
  completer("nom_naissance", c.nom_naissance, extraction.nom, "Nom de naissance");
  completer("lieu_naissance", c.lieu_naissance, extraction.lieu_naissance, "Lieu de naissance");
  completer("ville_naissance", c.ville_naissance, extraction.lieu_naissance, "Ville de naissance");
  completer("pays_naissance", c.pays_naissance, extraction.pays_naissance, "Pays de naissance");
  completer("nationalite", c.nationalite, extraction.nationalite, "Nationalité");

  if (Object.keys(patch).length > 0) {
    const { error: uErr } = await admin.from("clients").update(patch as never).eq("id", c.id);
    if (uErr) {
      await creerTacheAdmin(admin, {
        titre: "État civil non enregistré depuis la pièce d'identité",
        description: `Mise à jour impossible de la fiche de ${c.prenom ?? ""} ${c.nom ?? ""} : ${uErr.message}`,
        client_id: c.id,
      });
      return { statut: "ecart", raison: uErr.message };
    }
  }

  // Date de fin de validité de la pièce (utile aux rappels d'expiration).
  if (!d.date_expiration && extraction.date_expiration && ISO.test(extraction.date_expiration)) {
    await admin
      .from("client_kyc_documents")
      .update({ date_expiration: extraction.date_expiration } as never)
      .eq("id", kycDocumentId)
      .then(
        () => remplis.push(`Validité de la pièce : ${extraction.date_expiration}`),
        (e: unknown) => console.error("[CNI] date d'expiration non enregistrée", e),
      );
  }

  if (remplis.length > 0) {
    await admin
      .from("activites")
      .insert({
        client_id: c.id,
        type: "systeme",
        titre: "État civil complété automatiquement depuis la pièce d'identité",
        contenu: `${remplis.join("\n")}\nSource : ${d.nom ?? "pièce d'identité"} déposée sur la fiche client.${
          lcbEnAttente && dateNaissance ? "\nLe contrôle LCB-FT est relancé automatiquement." : ""
        }`,
      })
      .then(
        () => undefined,
        (e: unknown) => console.error("[CNI] trace complétion non enregistrée", e),
      );
  }

  let statutLcb: string | null = null;
  const dateRetenue = c.date_naissance ?? dateNaissance;
  if (lcbEnAttente && dateRetenue) {
    try {
      const { lancerLcbAutomatique } = await import("@/lib/dossier-automation.server");
      const res = await lancerLcbAutomatique(admin, {
        client_id: c.id,
        nom: c.nom ?? extraction.nom ?? "",
        prenom: c.prenom ?? extraction.prenom ?? null,
        date_naissance: dateRetenue,
      });
      statutLcb = (res as { statut?: string } | null)?.statut ?? null;
    } catch (e) {
      await creerTacheAdmin(admin, {
        titre: "Relance LCB-FT automatique en échec",
        description: `L'état civil a bien été complété, mais le contrôle LCB-FT n'a pas pu être relancé : ${e instanceof Error ? e.message : "erreur inconnue"}.\nAction : relancer le contrôle depuis l'onglet Conformité.`,
        client_id: c.id,
      });
    }
  }

  return { statut: "complete", date_naissance: dateRetenue, champs: remplis, lcb: statutLcb };
}

/**
 * Justificatif de domicile déposé : lecture IA de l'adresse postale et
 * complétion des champs d'adresse encore vides de la fiche client.
 * Une adresse déjà saisie n'est jamais écrasée.
 */
async function traiterJustificatifDomicile(
  admin: Admin,
  kycDocumentId: string,
  d: { client_id: string; nom: string | null; storage_path: string },
): Promise<ResultatCni> {
  const { data: client } = await admin
    .from("clients")
    .select("id, nom, prenom, adresse, complement_adresse, code_postal, ville, pays")
    .eq("id", d.client_id)
    .maybeSingle();
  if (!client) return { statut: "ignore", raison: "Fiche client introuvable" };
  const c = client as {
    id: string;
    nom: string | null;
    prenom: string | null;
    adresse: string | null;
    complement_adresse: string | null;
    code_postal: string | null;
    ville: string | null;
    pays: string | null;
  };

  let extraction: ExtractionDomicile;
  try {
    const fichier = await telecharger(admin, d.storage_path);
    if (!fichier) throw new Error("Fichier indisponible dans le stockage");
    const buffer = Buffer.from(await fichier.blob.arrayBuffer());
    if (buffer.byteLength === 0) throw new Error("Fichier vide");
    if (buffer.byteLength > TAILLE_MAX) throw new Error("Fichier trop volumineux (12 Mo maximum)");
    extraction = await appelerIaDomicile({
      nom: d.nom || "justificatif-domicile",
      mime: fichier.blob.type || "application/pdf",
      base64: buffer.toString("base64"),
    });
  } catch (e) {
    const raison = e instanceof Error ? e.message : "erreur inconnue";
    await creerTacheAdmin(admin, {
      titre: "Justificatif de domicile illisible",
      description: `La lecture automatique du justificatif de domicile de ${c.prenom ?? ""} ${c.nom ?? ""} a échoué (${raison}).\nAction : saisir l'adresse postale manuellement sur la fiche client.`,
      client_id: c.id,
    });
    return { statut: "ecart", raison };
  }

  const ecarts: string[] = [];
  if (!extraction.fiable) ecarts.push("l'IA signale une lecture peu fiable");
  if (!extraction.adresse && !extraction.code_postal && !extraction.ville) {
    ecarts.push("aucune adresse lisible sur le document");
  }
  if (!concorde(c.nom, extraction.nom)) {
    ecarts.push(`nom différent (fiche « ${c.nom ?? "—"} » / justificatif « ${extraction.nom ?? "—"} »)`);
  }

  if (ecarts.length > 0) {
    await creerTacheAdmin(admin, {
      titre: "Justificatif de domicile — écart avec la fiche client",
      description: `Lecture automatique du justificatif de domicile de ${c.prenom ?? ""} ${c.nom ?? ""} non appliquée.\nÉcarts constatés :\n- ${ecarts.join("\n- ")}\nAction : vérifier le document puis saisir l'adresse manuellement.`,
      client_id: c.id,
    });
    await admin
      .from("activites")
      .insert({
        client_id: c.id,
        type: "systeme",
        titre: "Lecture automatique du justificatif de domicile non appliquée",
        contenu: `Écarts constatés :\n- ${ecarts.join("\n- ")}`,
      })
      .then(
        () => undefined,
        (e: unknown) => console.error("[Domicile] trace écart non enregistrée", e),
      );
    return { statut: "ecart", raison: ecarts.join(" ; ") };
  }

  const patch: Record<string, unknown> = {};
  const remplis: string[] = [];
  const completer = (colonne: string, actuel: string | null, valeur: string | null, libelle: string) => {
    if (!actuel && valeur) {
      patch[colonne] = valeur;
      remplis.push(`${libelle} : ${valeur}`);
    }
  };

  completer("adresse", c.adresse, extraction.adresse, "Adresse");
  completer("complement_adresse", c.complement_adresse, extraction.complement_adresse, "Complément d'adresse");
  completer("code_postal", c.code_postal, extraction.code_postal, "Code postal");
  completer("ville", c.ville, extraction.ville, "Ville");
  completer("pays", c.pays, extraction.pays, "Pays");

  if (Object.keys(patch).length > 0) {
    const { error: uErr } = await admin.from("clients").update(patch as never).eq("id", c.id);
    if (uErr) {
      await creerTacheAdmin(admin, {
        titre: "Adresse non enregistrée depuis le justificatif de domicile",
        description: `Mise à jour impossible de la fiche de ${c.prenom ?? ""} ${c.nom ?? ""} : ${uErr.message}`,
        client_id: c.id,
      });
      return { statut: "ecart", raison: uErr.message };
    }
    await admin
      .from("activites")
      .insert({
        client_id: c.id,
        type: "systeme",
        titre: "Adresse postale complétée automatiquement depuis le justificatif de domicile",
        contenu: `${remplis.join("\n")}\nSource : ${d.nom ?? "justificatif de domicile"} déposé sur la fiche client.`,
      })
      .then(
        () => undefined,
        (e: unknown) => console.error("[Domicile] trace complétion non enregistrée", e),
      );
  }

  return { statut: "complete", date_naissance: null, champs: remplis, lcb: null };
}
