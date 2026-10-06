import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/**
 * Agent Service Partenaire — volet « développement du réseau ».
 *
 * Un email de partenaire (connu ou inconnu de l'annuaire) n'est JAMAIS de la
 * publicité quand il contient une information exploitable par le cabinet :
 *   - codes courtier / convention de distribution / contrat de partenariat,
 *   - offre de partenariat avec une nouvelle compagnie et de nouveaux produits,
 *   - mise à jour d'un produit déjà référencé (garanties, tarifs, commissions),
 *   - invitation à un événement, un challenge ou un incentive partenaire.
 *
 * Règles retenues par le cabinet :
 *   - la compagnie inconnue est créée en statut « inactif »,
 *   - les produits sont créés en statut « en_test » (donc hors comparateur),
 *   - une tâche récapitule ce qui a été ajouté (notification),
 *   - une mise à jour produit ne modifie jamais la base : elle produit une
 *     tâche « avant / après » à valider par un administrateur,
 *   - un événement ou un challenge produit une tâche avec la date et la date
 *     limite d'inscription.
 */

type Admin = SupabaseClient<Database>;

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODELES = ["google/gemini-3.6-flash", "google/gemini-2.5-flash"];

export type CategorieOffre =
  | "codes_courtier"
  | "offre_partenariat"
  | "mise_a_jour_produit"
  | "evenement"
  | "aucune";

export interface ProduitDetecte {
  nom: string;
  famille: string | null;
  description: string | null;
  code_produit: string | null;
  commission_taux: number | null;
  assureur_porteur: string | null;
}

export interface MiseAJourDetectee {
  produit: string;
  champ: string;
  avant: string | null;
  apres: string | null;
}

export interface EvenementDetecte {
  intitule: string;
  nature: string | null;
  date: string | null;
  lieu: string | null;
  date_limite_inscription: string | null;
  dotation: string | null;
}

export interface AnalyseOffre {
  categorie: CategorieOffre;
  compagnie: string | null;
  site_web: string | null;
  contact_email: string | null;
  codes_courtier: string[];
  produits: ProduitDetecte[];
  mises_a_jour: MiseAJourDetectee[];
  evenement: EvenementDetecte | null;
  confiance: number;
  resume: string;
}

export interface EmailOffre {
  sujet: string | null;
  expediteur_nom: string | null;
  expediteur_email: string | null;
  texte: string | null;
  pieces_jointes: { nom: string; mime: string | null }[];
}

const FAMILLES_CONNUES = [
  "emprunteur",
  "auto",
  "moto",
  "mrh",
  "sante",
  "prevoyance",
  "pro",
  "risques_divers",
  "epargne",
  "edpm",
  "animaux",
];

function extraireJson(texte: string): Record<string, unknown> | null {
  const nettoye = texte.replace(/```json/gi, "").replace(/```/g, "").trim();
  try {
    return JSON.parse(nettoye) as Record<string, unknown>;
  } catch {
    const debut = nettoye.indexOf("{");
    const fin = nettoye.lastIndexOf("}");
    if (debut === -1 || fin <= debut) return null;
    try {
      return JSON.parse(nettoye.slice(debut, fin + 1)) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

const texteOuNull = (v: unknown, max = 200): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t || t.toLowerCase() === "null") return null;
  return t.slice(0, max);
};

const nombreOuNull = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v.replace(",", ".").replace(/[^\d.-]/g, "")) : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const listeTexte = (v: unknown, max = 10): string[] =>
  Array.isArray(v) ? v.map((x) => texteOuNull(x, 120)).filter((x): x is string => !!x).slice(0, max) : [];

function consigne(email: EmailOffre): string {
  return [
    "Tu assistes un cabinet de courtage en assurances français (EJ Partners).",
    "On te transmet un email reçu d'une compagnie, d'un courtier grossiste ou d'une plateforme.",
    "Détermine sa catégorie, UNIQUEMENT parmi :",
    '- "codes_courtier" : transmission de codes courtier, identifiants d\'accès, convention/contrat de',
    "  distribution ou de partenariat signé, protocole de commissions.",
    '- "offre_partenariat" : proposition de partenariat, présentation d\'une gamme ou de produits que le',
    "  cabinet ne distribue pas encore.",
    '- "mise_a_jour_produit" : évolution d\'un produit (garanties, tarifs, commissionnement, conditions).',
    '- "evenement" : invitation à un événement, un challenge, un incentive, un webinaire, une convention.',
    '- "aucune" : rien d\'exploitable (relance commerciale creuse, newsletter sans information produit).',
    "Extrais aussi, sans jamais rien inventer (null si absent) :",
    "- compagnie : nom de la compagnie ou du grossiste émetteur,",
    "- site_web, contact_email,",
    "- codes_courtier : codes/identifiants courtier cités tels quels,",
    `- produits : [{nom, famille, description, code_produit, commission_taux, assureur_porteur}] ; famille parmi ${FAMILLES_CONNUES.join(", ")} sinon null,`,
    "- mises_a_jour : [{produit, champ, avant, apres}] pour chaque évolution décrite (avant = valeur actuelle citée),",
    "- evenement : {intitule, nature, date, lieu, date_limite_inscription, dotation} (dates au format AAAA-MM-JJ),",
    "- confiance : 0 à 1, resume : 2 phrases maximum.",
    "",
    `Expéditeur : ${email.expediteur_nom ?? ""} <${email.expediteur_email ?? ""}>`,
    `Objet : ${email.sujet ?? "(sans objet)"}`,
    `Pièces jointes : ${email.pieces_jointes.map((p) => p.nom).join(", ") || "aucune"}`,
    "Corps :",
    (email.texte ?? "").slice(0, 8000),
    "",
    'Réponds STRICTEMENT en JSON : {"categorie":"...","compagnie":null,"site_web":null,"contact_email":null,',
    '"codes_courtier":[],"produits":[],"mises_a_jour":[],"evenement":null,"confiance":0.0,"resume":""}',
  ].join("\n");
}

/** Analyse IA d'un email partenaire (offre, codes, mise à jour, événement). */
export async function analyserOffrePartenaire(email: EmailOffre): Promise<AnalyseOffre | null> {
  const cle = process.env["LOVABLE_API_KEY"];
  if (!cle) return null;

  let contenu = "";
  for (const modele of MODELES) {
    try {
      const res = await fetch(GATEWAY, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${cle}` },
        body: JSON.stringify({ model: modele, messages: [{ role: "user", content: consigne(email) }] }),
      });
      if (!res.ok) {
        if (res.status === 400 || res.status === 404) continue;
        return null;
      }
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      contenu = json.choices?.[0]?.message?.content ?? "";
      break;
    } catch (e) {
      console.error("[partenaires-offres] analyse IA impossible", e);
      return null;
    }
  }
  const brut = contenu ? extraireJson(contenu) : null;
  if (!brut) return null;

  const cat = String(brut["categorie"] ?? "aucune").toLowerCase();
  const connues: readonly string[] = ["codes_courtier", "offre_partenariat", "mise_a_jour_produit", "evenement"];
  const categorie: CategorieOffre = connues.includes(cat) ? (cat as CategorieOffre) : "aucune";


  const produitsBrut = Array.isArray(brut["produits"]) ? (brut["produits"] as Record<string, unknown>[]) : [];
  const produits: ProduitDetecte[] = produitsBrut
    .map((p) => ({
      nom: texteOuNull(p["nom"], 160) ?? "",
      famille: (() => {
        const f = texteOuNull(p["famille"], 40)?.toLowerCase() ?? null;
        return f && FAMILLES_CONNUES.includes(f) ? f : null;
      })(),
      description: texteOuNull(p["description"], 1500),
      code_produit: texteOuNull(p["code_produit"], 80),
      commission_taux: nombreOuNull(p["commission_taux"]),
      assureur_porteur: texteOuNull(p["assureur_porteur"], 160),
    }))
    .filter((p) => p.nom.length > 1)
    .slice(0, 15);

  const majBrut = Array.isArray(brut["mises_a_jour"]) ? (brut["mises_a_jour"] as Record<string, unknown>[]) : [];
  const mises_a_jour: MiseAJourDetectee[] = majBrut
    .map((m) => ({
      produit: texteOuNull(m["produit"], 160) ?? "",
      champ: texteOuNull(m["champ"], 120) ?? "",
      avant: texteOuNull(m["avant"], 600),
      apres: texteOuNull(m["apres"], 600),
    }))
    .filter((m) => m.produit && m.champ)
    .slice(0, 20);

  const evBrut = (brut["evenement"] ?? null) as Record<string, unknown> | null;
  const evenement: EvenementDetecte | null =
    evBrut && texteOuNull(evBrut["intitule"], 240)
      ? {
          intitule: texteOuNull(evBrut["intitule"], 240)!,
          nature: texteOuNull(evBrut["nature"], 80),
          date: texteOuNull(evBrut["date"], 30),
          lieu: texteOuNull(evBrut["lieu"], 160),
          date_limite_inscription: texteOuNull(evBrut["date_limite_inscription"], 30),
          dotation: texteOuNull(evBrut["dotation"], 300),
        }
      : null;

  return {
    categorie,
    compagnie: texteOuNull(brut["compagnie"], 160),
    site_web: texteOuNull(brut["site_web"], 200),
    contact_email: texteOuNull(brut["contact_email"], 200),
    codes_courtier: listeTexte(brut["codes_courtier"]),
    produits,
    mises_a_jour,
    evenement,
    confiance: Math.max(0, Math.min(1, Number(brut["confiance"]) || 0)),
    resume: texteOuNull(brut["resume"], 600) ?? "",
  };
}

const slugifier = (v: string) =>
  v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);

const normaliser = (v: string) =>
  v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/** Compagnie existante (par nom) ou création en statut « inactif ». */
async function trouverOuCreerCompagnie(
  admin: Admin,
  params: { nom: string; site_web: string | null; contact_email: string | null; userId: string; resume: string },
): Promise<{ id: string; nom: string; creee: boolean } | null> {
  const { data: existantes } = await admin.from("compagnies").select("id, nom");
  const cible = normaliser(params.nom);
  // Rapprochement tolérant : « Kereis Solutions » ne doit pas doubler « Kereis ».
  const trouvee =
    (existantes ?? []).find((c) => normaliser(c.nom) === cible) ??
    (existantes ?? []).find((c) => {
      const n = normaliser(c.nom);
      if (n.length < 4 || cible.length < 4) return false;
      return n.startsWith(`${cible} `) || cible.startsWith(`${n} `);
    });
  if (trouvee) return { id: trouvee.id, nom: trouvee.nom, creee: false };

  const { data: cree, error } = await admin
    .from("compagnies")
    .insert({
      nom: params.nom.slice(0, 160),
      slug: slugifier(params.nom) || `partenaire-${Date.now()}`,
      site_web: params.site_web,
      contact_email: params.contact_email,
      statut: "inactif",
      notes: `Créée automatiquement par l'agent Service Partenaire depuis un email entrant.\n${params.resume}`,
      created_by: params.userId,
    })
    .select("id, nom")
    .single();
  if (error || !cree) {
    console.error("[partenaires-offres] création compagnie impossible", error?.message);
    return null;
  }
  return { id: cree.id, nom: cree.nom, creee: true };
}

async function familleParDefaut(admin: Admin, code: string | null): Promise<string | null> {
  const { data } = await admin.from("produit_familles").select("id, code");
  const familles = data ?? [];
  const cible = code ? familles.find((f) => f.code === code) : null;
  return (cible ?? familles.find((f) => f.code === "risques_divers") ?? familles[0])?.id ?? null;
}

export interface ResultatOffre {
  action:
    | "ignore"
    | "codes_courtier"
    | "compagnie_creee"
    | "produits_ajoutes"
    | "mise_a_jour_a_valider"
    | "evenement";
  categorie: CategorieOffre;
  compagnie_id: string | null;
  compagnie_nom: string | null;
  compagnie_creee: boolean;
  produits_crees: string[];
  produits_deja_connus: string[];
  mises_a_jour: MiseAJourDetectee[];
  evenement: EvenementDetecte | null;
  resume: string;
}

/**
 * Traite un email partenaire : référencement compagnie / produits, tâche de
 * validation « avant / après » pour une mise à jour, tâche d'arbitrage pour un
 * événement ou des codes courtier. Ne crée jamais de fiche client.
 */
export async function traiterEmailPartenaireOffre(
  admin: Admin,
  params: {
    email: EmailOffre;
    gmail_message_id: string;
    recu_le?: string | null;
    userId: string;
    /** Compagnie déjà identifiée par l'annuaire des domaines, si connue. */
    compagnie_connue?: { id: string | null; nom: string } | null;
  },
): Promise<ResultatOffre> {
  const { email, userId } = params;
  const vide: ResultatOffre = {
    action: "ignore",
    categorie: "aucune",
    compagnie_id: params.compagnie_connue?.id ?? null,
    compagnie_nom: params.compagnie_connue?.nom ?? null,
    compagnie_creee: false,
    produits_crees: [],
    produits_deja_connus: [],
    mises_a_jour: [],
    evenement: null,
    resume: "",
  };

  const analyse = await analyserOffrePartenaire(email);
  if (!analyse || analyse.categorie === "aucune") return vide;

  const { creerTacheAdmin } = await import("@/lib/agent-taches.server");
  const lien = `https://mail.google.com/mail/u/0/#all/${params.gmail_message_id}`;

  // Compagnie : celle de l'annuaire si connue, sinon celle citée par l'IA.
  let compagnieId = params.compagnie_connue?.id ?? null;
  let compagnieNom = params.compagnie_connue?.nom ?? null;
  let compagnieCreee = false;
  const nomIa = analyse.compagnie;
  if (!compagnieId && nomIa) {
    const c = await trouverOuCreerCompagnie(admin, {
      nom: nomIa,
      site_web: analyse.site_web,
      contact_email: analyse.contact_email ?? email.expediteur_email ?? null,
      userId,
      resume: analyse.resume,
    });
    if (c) {
      compagnieId = c.id;
      compagnieNom = c.nom;
      compagnieCreee = c.creee;
    }
  }
  compagnieNom = compagnieNom ?? nomIa;

  // Produits : création en statut « en_test » (hors comparateur) si inconnus.
  const produitsCrees: string[] = [];
  const produitsConnus: string[] = [];
  if (compagnieId && analyse.produits.length && analyse.categorie !== "mise_a_jour_produit") {
    const { data: dejaLa } = await admin.from("produits").select("id, nom").eq("compagnie_id", compagnieId);
    const noms = new Set((dejaLa ?? []).map((p) => normaliser(p.nom)));
    for (const p of analyse.produits) {
      if (noms.has(normaliser(p.nom))) {
        produitsConnus.push(p.nom);
        continue;
      }
      const familleId = await familleParDefaut(admin, p.famille);
      if (!familleId) break;
      const { error } = await admin.from("produits").insert({
        compagnie_id: compagnieId,
        famille_id: familleId,
        nom: p.nom.slice(0, 160),
        code_produit: p.code_produit,
        description: p.description,
        assureur_porteur: p.assureur_porteur,
        commission_taux: p.commission_taux,
        statut: "en_test",
        created_by: userId,
      });
      if (error) {
        console.error("[partenaires-offres] création produit impossible", p.nom, error.message);
        continue;
      }
      produitsCrees.push(p.nom);
      noms.add(normaliser(p.nom));
    }
  }

  // Mise à jour produit : jamais appliquée automatiquement — tâche avant/après.
  if (analyse.categorie === "mise_a_jour_produit" && analyse.mises_a_jour.length) {
    const lignes = analyse.mises_a_jour.map(
      (m) => `• ${m.produit} — ${m.champ}\n   AVANT : ${m.avant ?? "non précisé"}\n   APRÈS : ${m.apres ?? "non précisé"}`,
    );
    await creerTacheAdmin(admin, {
      idempotency_key: `partenaire_offre:mise_a_jour_produit:${params.gmail_message_id}`,
      source: "partenaires-offres",
      source_event_id: params.gmail_message_id,
      titre: `Mise à jour produit à valider — ${compagnieNom ?? "partenaire"}`.slice(0, 200),
      description: [
        `Objet de la demande : ${email.sujet ?? "(sans objet)"}`,
        `Motif : le partenaire annonce une évolution produit (garanties, tarifs ou commissionnement).`,
        `Compagnie concernée : ${compagnieNom ?? "non identifiée"}`,
        "",
        "Comparatif avant / après :",
        ...lignes,
        "",
        `Ce qui bloque : aucune modification n'est appliquée automatiquement au catalogue produit.`,
        `Conseil : vérifier chaque ligne ci-dessus, puis reporter les nouvelles valeurs dans la fiche produit (garanties, tarifs, taux de commission) et archiver le document reçu.`,
        `Email : ${lien}`,
      ].join("\n"),
      priorite: "haute",
      created_by: userId,
    });
  }

  // Événement / challenge / incentive : information à ne jamais perdre.
  if (analyse.categorie === "evenement" && analyse.evenement) {
    const ev = analyse.evenement;
    await creerTacheAdmin(admin, {
      idempotency_key: `partenaire_offre:evenement:${params.gmail_message_id}`,
      source: "partenaires-offres",
      source_event_id: params.gmail_message_id,
      titre: `Invitation partenaire — ${ev.intitule}`.slice(0, 200),
      description: [
        `Objet de la demande : ${email.sujet ?? "(sans objet)"}`,
        `Motif : invitation ${ev.nature ?? "événement / challenge"} d'un partenaire.`,
        `Partenaire : ${compagnieNom ?? "non identifié"}`,
        `Date : ${ev.date ?? "non précisée"}`,
        `Lieu : ${ev.lieu ?? "non précisé"}`,
        `Date limite d'inscription : ${ev.date_limite_inscription ?? "non précisée"}`,
        ev.dotation ? `Dotation / récompense : ${ev.dotation}` : null,
        `Ce qui bloque : la participation est une décision de direction (agenda, intérêt commercial).`,
        `Conseil : arbitrer la participation avant la date limite ; si le challenge porte sur la production, définir l'objectif à suivre pour le cabinet.`,
        `Email : ${lien}`,
      ]
        .filter(Boolean)
        .join("\n"),
      priorite: "normale",
      created_by: userId,
    });
  }

  // Codes courtier / convention : information contractuelle structurante.
  if (analyse.categorie === "codes_courtier") {
    await creerTacheAdmin(admin, {
      idempotency_key: `partenaire_offre:codes_courtier:${params.gmail_message_id}`,
      source: "partenaires-offres",
      source_event_id: params.gmail_message_id,
      titre: `Codes courtier / convention reçus — ${compagnieNom ?? "partenaire"}`.slice(0, 200),
      description: [
        `Objet de la demande : ${email.sujet ?? "(sans objet)"}`,
        `Motif : le partenaire transmet des codes courtier, des accès ou une convention de distribution.`,
        `Compagnie : ${compagnieNom ?? "non identifiée"}${compagnieCreee ? " (fiche créée en statut inactif)" : ""}`,
        analyse.codes_courtier.length ? `Codes / références cités : ${analyse.codes_courtier.join(", ")}` : null,
        email.pieces_jointes.length
          ? `Pièces jointes : ${email.pieces_jointes.map((p) => p.nom).join(", ")}`
          : "Pièces jointes : aucune",
        produitsCrees.length ? `Produits créés (statut en test) : ${produitsCrees.join(", ")}` : null,
        `Ce qui bloque : les codes doivent être conservés hors mail et la fiche compagnie activée manuellement.`,
        `Conseil : enregistrer les codes sur la fiche compagnie, classer la convention dans les documents de la compagnie, puis passer la compagnie en « actif » et les produits en « actif » une fois le partenariat opérationnel.`,
        `Email : ${lien}`,
      ]
        .filter(Boolean)
        .join("\n"),
      priorite: "haute",
      created_by: userId,
    });
  }

  // Notification de référencement (compagnie et/ou produits ajoutés).
  if (compagnieCreee || produitsCrees.length) {
    await creerTacheAdmin(admin, {
      titre: [
        compagnieCreee ? `Nouvelle compagnie référencée : ${compagnieNom}` : `Nouveaux produits : ${compagnieNom}`,
      ]
        .join("")
        .slice(0, 200),
      description: [
        `Objet de la demande : ${email.sujet ?? "(sans objet)"}`,
        `Motif : offre partenaire reçue par email — référencement automatique au catalogue.`,
        compagnieCreee
          ? `Compagnie ajoutée : ${compagnieNom} (statut inactif — à activer après signature du partenariat)`
          : `Compagnie existante : ${compagnieNom}`,
        produitsCrees.length
          ? `Produits ajoutés (statut « en test », donc hors comparateur) : ${produitsCrees.join(", ")}`
          : "Aucun nouveau produit ajouté.",
        produitsConnus.length ? `Produits déjà connus (ignorés) : ${produitsConnus.join(", ")}` : null,
        analyse.resume ? `Analyse : ${analyse.resume}` : null,
        `Ce qui bloque : les fiches sont incomplètes (garanties, tarifs, documents contractuels).`,
        `Conseil : compléter les fiches produit (famille, garanties, tarifs, commissionnement), joindre CG/IPID, puis activer si le partenariat est retenu.`,
        `Email : ${lien}`,
      ]
        .filter(Boolean)
        .join("\n"),
      priorite: "normale",
      created_by: userId,
    });
  }

  const action: ResultatOffre["action"] =
    analyse.categorie === "codes_courtier"
      ? "codes_courtier"
      : analyse.categorie === "mise_a_jour_produit"
        ? "mise_a_jour_a_valider"
        : analyse.categorie === "evenement"
          ? "evenement"
          : compagnieCreee
            ? "compagnie_creee"
            : produitsCrees.length
              ? "produits_ajoutes"
              : "ignore";

  const resultat: ResultatOffre = {
    action,
    categorie: analyse.categorie,
    compagnie_id: compagnieId,
    compagnie_nom: compagnieNom,
    compagnie_creee: compagnieCreee,
    produits_crees: produitsCrees,
    produits_deja_connus: produitsConnus,
    mises_a_jour: analyse.mises_a_jour,
    evenement: analyse.evenement,
    resume: analyse.resume,
  };

  if (action === "ignore") return resultat;

  await admin.from("crm_emails").upsert(
    {
      gmail_message_id: params.gmail_message_id,
      direction: "entrant",
      recu_le: params.recu_le ?? null,
      compagnie_id: compagnieId,
      notes: `Agent Service Partenaire — ${analyse.categorie}`,
      triage_ia: JSON.parse(JSON.stringify({ agent: "partenaire-offre", ...resultat })),
      triage_le: new Date().toISOString(),
      created_by: userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "gmail_message_id" },
  );

  return resultat;
}

/**
 * Rattrapage : réanalyse des mails classés « A_Ignorer » (publicité présumée).
 * Ceux qui portent en réalité une information exploitable (codes courtier,
 * offre, mise à jour produit, challenge) sont référencés puis remis en
 * « Service Partenaire/A_Traiter ».
 */
export async function reprendreMailsIgnores(
  admin: Admin,
  userId: string,
  maxMessages = 150,
): Promise<{
  examines: number;
  recuperes: number;
  compagnies_creees: number;
  produits_crees: number;
  erreurs: number;
  details: { id: string; categorie: CategorieOffre; compagnie: string | null; sujet: string | null }[];
}> {
  const { listerParLabel, lireMessage, poserLabelCabinet } = await import("@/lib/gmail.server");
  const { LABELS_CABINET } = await import("@/lib/gmail-labels");

  const messages = await listerParLabel(LABELS_CABINET.a_ignorer, maxMessages).catch((e) => {
    console.error("[partenaires-offres] lecture du label A_Ignorer impossible", e);
    return [];
  });

  const { chargerAnnuairePartenaires, compagnieDeExpediteur } = await import("@/lib/partenaires-emails.server");
  const annuaire = await chargerAnnuairePartenaires(admin);

  let recuperes = 0;
  let compagnies = 0;
  let produits = 0;
  let erreurs = 0;
  const details: { id: string; categorie: CategorieOffre; compagnie: string | null; sujet: string | null }[] = [];

  for (const m of messages) {
    try {
      const detail = await lireMessage(m.id);
      const resultat = await traiterEmailPartenaireOffre(admin, {
        email: {
          sujet: detail.sujet ?? m.sujet ?? null,
          expediteur_nom: detail.expediteur_nom ?? null,
          expediteur_email: detail.expediteur_email ?? m.expediteur_email ?? null,
          texte: detail.texte ?? detail.snippet ?? null,
          pieces_jointes: detail.pieces_jointes.map((p) => ({ nom: p.nom, mime: p.mime })),
        },
        gmail_message_id: m.id,
        recu_le: m.date ?? detail.date ?? null,
        userId,
        compagnie_connue: compagnieDeExpediteur(annuaire, detail.expediteur_email ?? m.expediteur_email),
      });
      if (resultat.action === "ignore") continue;
      await poserLabelCabinet(m.id, "sp_a_traiter", { retirer: ["a_ignorer"] });
      recuperes++;
      if (resultat.compagnie_creee) compagnies++;
      produits += resultat.produits_crees.length;
      details.push({
        id: m.id,
        categorie: resultat.categorie,
        compagnie: resultat.compagnie_nom,
        sujet: detail.sujet ?? m.sujet ?? null,
      });
    } catch (e) {
      erreurs++;
      console.error("[partenaires-offres] rattrapage impossible", m.id, e);
    }
  }

  return {
    examines: messages.length,
    recuperes,
    compagnies_creees: compagnies,
    produits_crees: produits,
    erreurs,
    details,
  };
}
