import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { estEmailInterne, estAdresseAutomatique } from "@/lib/domaines-internes";


/**
 * Agent commercial — analyse IA d'un email entrant non rattaché à un client
 * existant : s'agit-il d'une demande de devis / de contact assurance, sur
 * quelle branche, et au nom de qui ? Si la classification est confiante, le
 * prospect, son dossier et la lettre de mission sont créés automatiquement.
 */

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODELES = ["google/gemini-3.6-flash", "google/gemini-2.5-flash"];

/**
 * Branches réellement gérées par le CRM aujourd'hui (valeurs des recueils des
 * besoins). Les libellés commerciaux courants (GAV, PJ, animaux/pet, nomade)
 * sont acceptés en entrée et normalisés via ALIAS_BRANCHES.
 */
export const BRANCHES_AUTO = [
  "emprunteur",
  "sante",
  "prevoyance",
  "accidents_vie",
  "juridique",
  "animaux",
  "expatrie",
] as const;
export type BrancheAuto = (typeof BRANCHES_AUTO)[number];

/** Synonymes tolérés dans la réponse IA → valeur de branche du CRM. */
const ALIAS_BRANCHES: Record<string, BrancheAuto> = {
  gav: "accidents_vie",
  accident_vie: "accidents_vie",
  accidents_de_la_vie: "accidents_vie",
  pj: "juridique",
  protection_juridique: "juridique",
  pet: "animaux",
  animal: "animaux",
  sante_animale: "animaux",
  nomade: "expatrie",
  nomades: "expatrie",
  expatries: "expatrie",
  expat: "expatrie",
  sante_internationale: "expatrie",
};

/** Normalise une branche renvoyée par l'IA (alias inclus). */
export function normaliserBranche(valeur: string | null): BrancheAuto | null {
  if (!valeur) return null;
  const v = valeur
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s-]+/g, "_");
  if ((BRANCHES_AUTO as readonly string[]).includes(v)) return v as BrancheAuto;
  return ALIAS_BRANCHES[v] ?? null;
}


export interface TriageEmail {
  sujet: string | null;
  expediteur_nom: string | null;
  expediteur_email: string | null;
  texte: string | null;
  pieces_jointes: { nom: string; mime: string | null }[];
}

export interface TriageResultat {
  /** "publicite" = newsletter, prospection commerciale ou spam : aucun traitement CRM. */
  prospect: "oui" | "non" | "incertain" | "publicite";
  branche: BrancheAuto | null;
  nom: string | null;
  prenom: string | null;
  telephone: string | null;
  capital_restant_du: number | null;
  mois_restants: number | null;
  piece_pret: string | null;
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

function consigne(email: TriageEmail): string {
  return [
    "Tu es assistant commercial dans un cabinet de courtage en assurances français.",
    "On te transmet un email entrant reçu sur la boîte du cabinet, qui ne correspond à aucun client connu.",
    "Détermine :",
    "1. La nature du message :",
    '   - "publicite" : newsletter, campagne marketing, prospection commerciale entrante, offre de service,',
    "     démarchage de fournisseur, notification automatique promotionnelle ou spam. Aucun besoin client réel.",
    '   - "oui" : un prospect demande un devis, une étude ou une prise de contact en assurance.',
    '   - "non" : message qui n\'est ni de la publicité ni une demande d\'assurance (administratif, personnel…).',
    '   - "incertain" : demande d\'assurance probable mais branche ou identité indéterminée.',
    "2. La branche demandée, UNIQUEMENT parmi :",
    "   - emprunteur : assurance de prêt / crédit immobilier",
    "   - sante : complémentaire santé, mutuelle",
    "   - prevoyance : arrêt de travail, décès, invalidité",
    "   - accidents_vie : garantie des accidents de la vie (GAV)",
    "   - juridique : protection juridique (PJ)",
    "   - animaux : santé animale, chien ou chat (assurance « pet »)",
    "   - expatrie : santé à l'étranger, expatriés, nomades, digital nomades",
    "   Si le besoin porte sur autre chose (auto, habitation, trottinette, risques professionnels, etc.) ou si",
    "   plusieurs branches sont possibles, réponds prospect = \"incertain\" et branche = null.",
    "3. Le nom et le prénom si identifiables dans le corps du message ou la signature, sinon null.",
    "4. Si la branche est emprunteur ET qu'une pièce jointe ressemble à un tableau d'amortissement ou une offre",
    "   de prêt (d'après son nom de fichier) ou que le corps du mail donne ces chiffres : extrais le capital",
    "   restant dû (en euros, nombre) et la durée restante en mois (nombre). Sinon null.",
    "N'invente jamais un nom, un chiffre ou une branche : dans le doute, null et prospect = \"incertain\".",
    "",
    `Expéditeur : ${email.expediteur_nom ?? ""} <${email.expediteur_email ?? ""}>`,
    `Objet : ${email.sujet ?? "(sans objet)"}`,
    `Pièces jointes : ${email.pieces_jointes.map((p) => p.nom).join(", ") || "aucune"}`,
    "Corps du message :",
    (email.texte ?? "").slice(0, 6000),
    "",
    'Réponds STRICTEMENT en JSON : {"prospect":"oui|non|incertain|publicite",',
    '"branche":"emprunteur|sante|prevoyance|accidents_vie|juridique|animaux|expatrie|null",',
    '"nom":"...|null","prenom":"...|null","telephone":"...|null","capital_restant_du":null,"mois_restants":null,',
    '"piece_pret":"nom du fichier|null","confiance":0.0,"resume":"une phrase"}',

  ].join("\n");
}

function nombreOuNull(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v.replace(/[^\d.,-]/g, "").replace(",", ".")) : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function texteOuNull(v: unknown, max = 120): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t || t.toLowerCase() === "null") return null;
  return t.slice(0, max);
}

/** Analyse IA d'un email entrant. */
export async function analyserEmailProspect(email: TriageEmail): Promise<TriageResultat> {
  const cle = process.env["LOVABLE_API_KEY"];
  if (!cle) throw new Error("Analyse indisponible : clé IA absente du projet.");

  let derniere = "";
  for (const modele of MODELES) {
    const res = await fetch(GATEWAY, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cle}` },
      body: JSON.stringify({ model: modele, messages: [{ role: "user", content: consigne(email) }] }),
    });
    if (res.ok) {
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const contenu = json.choices?.[0]?.message?.content ?? "";
      if (!contenu) throw new Error("Réponse IA vide");
      const brut = extraireJson(contenu);

      const prospectBrut = String(brut["prospect"] ?? "incertain")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
      const prospect: TriageResultat["prospect"] =
        prospectBrut === "oui"
          ? "oui"
          : prospectBrut === "non"
            ? "non"
            : prospectBrut.startsWith("public") || prospectBrut === "spam" || prospectBrut === "marketing"
              ? "publicite"
              : "incertain";
      const branche = normaliserBranche(texteOuNull(brut["branche"], 40));


      return {
        prospect,
        branche,
        nom: texteOuNull(brut["nom"]),
        prenom: texteOuNull(brut["prenom"]),
        telephone: texteOuNull(brut["telephone"], 30),
        capital_restant_du: nombreOuNull(brut["capital_restant_du"]),
        mois_restants: nombreOuNull(brut["mois_restants"]),
        piece_pret: texteOuNull(brut["piece_pret"], 200),
        confiance: Math.max(0, Math.min(1, Number(brut["confiance"]) || 0)),
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

/** La classification est-elle assez sûre pour créer le dossier sans intervention ? */
export function classificationConfiante(r: TriageResultat): boolean {
  return r.prospect === "oui" && !!r.branche && !!r.nom && r.confiance >= 0.7;
}

/** Publicité / newsletter / spam : le mail est simplement marqué comme traité. */
export function estPublicite(r: TriageResultat): boolean {
  return r.prospect === "publicite";
}

/**
 * Publicité détectée : on n'ouvre aucune fiche client et aucune tâche. Le mail
 * est enregistré comme traité afin de ne plus être analysé à chaque synchro.
 */
export async function marquerEmailPublicite(
  admin: SupabaseClient<Database>,
  params: {
    email: TriageEmail;
    triage: TriageResultat;
    gmail_message_id: string;
    gmail_thread_id?: string | null;
    recu_le?: string | null;
    userId: string;
  },
) {
  const { email, triage } = params;
  await admin.from("crm_emails").upsert(
    {
      gmail_message_id: params.gmail_message_id,
      gmail_thread_id: params.gmail_thread_id ?? null,
      direction: "entrant",
      recu_le: params.recu_le ?? null,
      notes: "Publicité / newsletter — aucun traitement CRM",
      triage_ia: JSON.parse(JSON.stringify({ agent: "commercial", ...triage })),
      triage_le: new Date().toISOString(),
      created_by: params.userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "gmail_message_id" },
  );
  return { publicite: true as const };
}


/**
 * Création automatique complète depuis un email entrant : prospect (contrôle
 * LCB-FT déclenché par la création de la fiche), dossier de la branche détectée
 * avec recueil des besoins pré-rempli, puis lettre de mission envoyée.
 */
export async function creerDossierDepuisEmail(
  admin: SupabaseClient<Database>,
  params: {
    email: TriageEmail;
    triage: TriageResultat;
    gmail_message_id: string;
    gmail_thread_id?: string | null;
    recu_le?: string | null;
    userId: string;
  },
) {
  const { triage, email } = params;
  if (!email.expediteur_email) throw new Error("Email expéditeur manquant");
  if (estEmailInterne(email.expediteur_email)) throw new Error("Expéditeur interne au cabinet — aucune fiche client créée");
  if (estAdresseAutomatique(email.expediteur_email))
    throw new Error("Expéditeur automatique (no-reply / notification) — aucune fiche client créée");

  // Garde-fou : jamais de fiche client pour une compagnie, un fournisseur ou
  // une adresse technique (service résiliation, no-reply, notifications…).
  {
    const { verifierExpediteurClientPossible } = await import("@/lib/expediteur-non-client.server");
    const verdict = await verifierExpediteurClientPossible(admin, email.expediteur_email);
    if (!verdict.client_possible)
      throw new Error(`Expéditeur non client (${verdict.motif}) — aucune fiche créée : ${verdict.detail}`);
  }

  if (!classificationConfiante(triage)) throw new Error("Classification insuffisante");

  // Dédoublonnage : le client est peut-être déjà connu (email OU nom + prénom
  // cités dans le corps du mail, cas des suivis partenaires / substitutions).
  const { trouverClientExistant, trouverDossierOuvert } = await import("@/lib/client-dedoublonnage.server");
  const deja = await trouverClientExistant(admin, {
    email: email.expediteur_email,
    nom: triage.nom,
    prenom: triage.prenom,
  });

  let clientId: string;
  if (deja) {
    clientId = deja.client_id;
    // Un dossier ouvert existe déjà pour cette branche : on ne duplique pas,
    // l'email est rattaché et une tâche de suivi est déposée.
    const dossierOuvert = await trouverDossierOuvert(admin, {
      client_id: clientId,
      type_assurance: triage.branche ?? null,
    });
    if (dossierOuvert) {
      const { creerTacheAdmin } = await import("@/lib/agent-taches.server");
      await creerTacheAdmin(admin, {
        idempotency_key: `email_triage:dossier_existant:${params.gmail_message_id}`,
        source: "email-triage",
        source_event_id: params.gmail_message_id,
        titre: `Email entrant sur un dossier existant — ${triage.nom ?? email.expediteur_email}`,
        description: [
          `Objet du mail : ${email.sujet ?? "(sans objet)"}`,
          `Rapprochement automatique (${deja.via}) — aucun nouveau dossier créé.`,
          triage.resume,
        ]
          .filter(Boolean)
          .join("\n"),
        client_id: clientId,
        created_by: params.userId,
      });
      await admin.from("crm_emails").upsert(
        {
          gmail_message_id: params.gmail_message_id,
          gmail_thread_id: params.gmail_thread_id ?? null,
          direction: "entrant",
          recu_le: params.recu_le ?? null,
          client_id: clientId,
          dossier_id: dossierOuvert,
          notes: `Rattaché au dossier existant (rapprochement ${deja.via}) — aucun doublon créé`,
          triage_ia: JSON.parse(JSON.stringify({ agent: "commercial", ...triage })),
          triage_le: new Date().toISOString(),
          created_by: params.userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "gmail_message_id" },
      );
      return {
        client_id: clientId,
        dossier_id: dossierOuvert,
        dossier_reference: null as string | null,
        lettre_envoyee: false,
        rapproche: deja.via,
      };
    }
  } else {
    const { data: cree, error } = await admin
      .from("clients")
      .insert({
        nom: triage.nom!,
        prenom: triage.prenom,
        email: email.expediteur_email,
        mobile: triage.telephone,
        statut: "prospect",
        origine: "internet",
        etiquettes: ["email-entrant", "agent-commercial"],
        created_by: params.userId,
      })
      .select("id")
      .single();
    if (error || !cree) throw new Error(error?.message ?? "Création de la fiche impossible");
    clientId = cree.id;

    // Contrôle LCB-FT / OpenSanctions automatique sur toute nouvelle fiche.
    const { lancerLcbAutomatique } = await import("@/lib/dossier-automation.server");
    await lancerLcbAutomatique(admin, { client_id: clientId, nom: triage.nom!, prenom: triage.prenom });
  }


  const { creerDossierAutomatique } = await import("@/lib/dossier-automation.server");
  const dossier = await creerDossierAutomatique(admin, {
    client_id: clientId,
    nom: triage.nom!,
    prenom: triage.prenom,
    email: email.expediteur_email,
    telephone: triage.telephone,
    type_assurance: triage.branche!,
    notes: `Créé automatiquement depuis un email entrant : ${email.sujet ?? "(sans objet)"}\n${triage.resume}`,
    admin_id: params.userId,
    origin: "agent-commercial-email",
  });

  // Recueil des besoins vide (à compléter), pré-rempli pour l'emprunteur si le
  // mail ou une pièce jointe donne le capital restant dû et la durée restante.
  const recueil: Record<string, number> = {};
  if (triage.branche === "emprunteur") {
    if (triage.capital_restant_du != null) recueil["capital_restant_du"] = triage.capital_restant_du;
    if (triage.mois_restants != null) recueil["mois_restants"] = triage.mois_restants;
  }
  await admin
    .from("dossiers")
    .update({ client_id: clientId, recueil_besoins: recueil })
    .eq("id", dossier.id);

  // La lettre de mission n'est envoyée automatiquement que si le recueil des
  // besoins est complet ; sinon une tâche est déposée pour l'admin.
  const { recueilComplet, champsManquantsRecueil } = await import("@/lib/recueil-besoins-schemas");
  const { creerTacheAdmin } = await import("@/lib/agent-taches.server");
  const complet = recueilComplet(triage.branche!, recueil);

  let lettreEnvoyee = false;
  let lettreErreur: string | null = null;
  if (!complet) {
    const manquants = champsManquantsRecueil(triage.branche!, recueil)
      .map((f) => f.label)
      .slice(0, 20);
    lettreErreur = "Recueil des besoins incomplet — envoi manuel requis.";
    await creerTacheAdmin(admin, {
      titre: `Recueil incomplet — lettre de mission à valider et envoyer manuellement — ${dossier.reference}`,
      description: [
        `Dossier ${dossier.reference} créé automatiquement depuis un email entrant.`,
        `Branche : ${triage.branche}`,
        manquants.length ? `Champs obligatoires manquants : ${manquants.join(", ")}` : null,
        triage.resume,
      ]
        .filter(Boolean)
        .join("\n"),
      client_id: clientId,
      created_by: params.userId,
    });
  } else {
    try {
      const { envoyerLettreMission, dateReferenceDer } = await import("@/lib/lettres-mission.server");
      const { etatDelaiLettreMission } = await import("@/lib/lettre-mission-delai");
      const { APP_URL } = await import("@/lib/app-url");
      // Délai fixe de 8 h après le DER : sinon l'envoi est différé et repris
      // par le job /api/public/lettres-mission-envois.
      const derLe = await dateReferenceDer(admin, clientId ?? null);
      const etat = etatDelaiLettreMission(derLe);
      if (!etat.autorise) {
        lettreErreur = etat.motif ?? "Envoi de la lettre de mission différé.";
      } else {
        await envoyerLettreMission(admin, dossier.id, params.userId, APP_URL);
        lettreEnvoyee = true;
      }

    } catch (e) {
      lettreErreur = e instanceof Error ? e.message : "Envoi de la lettre de mission impossible";
      await creerTacheAdmin(admin, {
        titre: `Lettre de mission non envoyée — ${dossier.reference}`,
        description: `Erreur technique lors de l'envoi automatique : ${lettreErreur}`,
        client_id: clientId,
        created_by: params.userId,
      });
    }
  }

  await admin.from("crm_emails").upsert(
    {
      gmail_message_id: params.gmail_message_id,
      gmail_thread_id: params.gmail_thread_id ?? null,
      direction: "entrant",
      recu_le: params.recu_le ?? null,
      client_id: clientId,
      dossier_id: dossier.id,
      notes: "Dossier créé automatiquement (agent commercial)",
      triage_ia: JSON.parse(JSON.stringify({ agent: "commercial", ...triage })),
      triage_le: new Date().toISOString(),
      created_by: params.userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "gmail_message_id" },
  );

  await admin.from("activites").insert({
    client_id: clientId,
    type: "systeme",
    titre: "Dossier créé automatiquement depuis un email entrant",
    contenu: [
      `Branche détectée : ${triage.branche}`,
      `Dossier : ${dossier.reference}`,
      `Objet du mail : ${email.sujet ?? "(sans objet)"}`,
      triage.resume,
      lettreEnvoyee
        ? "Lettre de mission générée et envoyée au client."
        : `Lettre de mission non envoyée : ${lettreErreur ?? "erreur inconnue"}`,
    ]
      .filter(Boolean)
      .join("\n"),
    created_by: params.userId,
  });

  return {
    client_id: clientId,
    dossier_id: dossier.id,
    dossier_reference: dossier.reference,
    lettre_envoyee: lettreEnvoyee,
  };
}

/**
 * Classification incertaine : on crée uniquement la fiche prospect (avec le
 * contrôle LCB-FT automatique) et une tâche humaine de qualification. Aucun
 * dossier n'est créé.
 */
export async function creerFicheProspectIncertaine(
  admin: SupabaseClient<Database>,
  params: {
    email: TriageEmail;
    triage: TriageResultat;
    gmail_message_id: string;
    gmail_thread_id?: string | null;
    recu_le?: string | null;
    userId: string;
  },
) {
  const { triage, email } = params;
  if (!email.expediteur_email) throw new Error("Email expéditeur manquant");

  const { creerTacheAdmin } = await import("@/lib/agent-taches.server");
  const nom = triage.nom ?? email.expediteur_nom ?? email.expediteur_email;

  // Garde-fou : compagnie, fournisseur, groupement, interne ou adresse
  // technique → aucune fiche client, seulement une tâche de qualification.
  const { verifierExpediteurClientPossible } = await import("@/lib/expediteur-non-client.server");
  const verdict = await verifierExpediteurClientPossible(admin, email.expediteur_email);
  if (!verdict.client_possible) {
    await creerTacheAdmin(admin, {
      idempotency_key: `email_triage:non_client:${params.gmail_message_id}`,
      source: "email-triage",
      source_event_id: params.gmail_message_id,
      titre: `Email entrant à qualifier (non client) — ${nom}`,
      description: [
        `Objet du mail : ${email.sujet ?? "(sans objet)"}`,
        `Expéditeur : ${email.expediteur_email}`,
        `Aucune fiche client créée — ${verdict.detail} (${verdict.motif}).`,
        `Analyse IA : ${triage.resume || "aucun résumé"}`,
      ].join("\n"),
      created_by: params.userId,
    });
    await admin.from("crm_emails").upsert(
      {
        gmail_message_id: params.gmail_message_id,
        gmail_thread_id: params.gmail_thread_id ?? null,
        direction: "entrant",
        recu_le: params.recu_le ?? null,
        notes: `Expéditeur non client (${verdict.motif}) — aucune fiche créée`,
        triage_ia: JSON.parse(JSON.stringify({ agent: "commercial", ...triage })),
        triage_le: new Date().toISOString(),
        created_by: params.userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "gmail_message_id" },
    );
    return { client_id: null as string | null, non_client: verdict.motif };
  }

  // Fiche déjà existante (email OU nom + prénom cités) : on ne duplique pas.
  const { trouverClientExistant } = await import("@/lib/client-dedoublonnage.server");
  const existant = await trouverClientExistant(admin, {
    email: email.expediteur_email,
    nom: triage.nom,
    prenom: triage.prenom,
  });

  let clientId = existant?.client_id ?? null;
  if (!clientId) {
    const { data: cree, error } = await admin
      .from("clients")
      .insert({
        nom,
        prenom: triage.prenom,
        email: email.expediteur_email,
        mobile: triage.telephone,
        statut: "prospect",
        origine: "internet",
        etiquettes: ["email-entrant", "agent-commercial", "a-qualifier"],
        created_by: params.userId,
      })
      .select("id")
      .single();
    if (error || !cree) throw new Error(error?.message ?? "Création de la fiche impossible");
    clientId = cree.id;

    const { lancerLcbAutomatique } = await import("@/lib/dossier-automation.server");
    await lancerLcbAutomatique(admin, { client_id: clientId, nom, prenom: triage.prenom });
  }

  await creerTacheAdmin(admin, {
    idempotency_key: `email_triage:ambigu:${params.gmail_message_id}`,
    source: "email-triage",
    source_event_id: params.gmail_message_id,
    titre: `Email entrant ambigu à qualifier — ${nom}`,
    description: [
      `Objet du mail : ${email.sujet ?? "(sans objet)"}`,
      `Analyse IA : ${triage.resume || "aucun résumé"}`,
      `Branche détectée : ${triage.branche ?? "indéterminée"} (confiance ${Math.round(triage.confiance * 100)} %)`,
      `Fiche client : ${appUrlFiche(clientId)}`,
    ].join("\n"),
    client_id: clientId,
    created_by: params.userId,
  });

  await admin.from("crm_emails").upsert(
    {
      gmail_message_id: params.gmail_message_id,
      gmail_thread_id: params.gmail_thread_id ?? null,
      direction: "entrant",
      recu_le: params.recu_le ?? null,
      client_id: clientId,
      notes: "Fiche prospect créée automatiquement — qualification humaine requise",
      triage_ia: JSON.parse(JSON.stringify({ agent: "commercial", ...triage })),
      triage_le: new Date().toISOString(),
      created_by: params.userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "gmail_message_id" },
  );

  return { client_id: clientId };
}

function appUrlFiche(clientId: string): string {
  return `/espace/clients/${clientId}`;
}
