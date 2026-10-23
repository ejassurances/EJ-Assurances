import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { classerPiece, piecesRequisesPour } from "@/lib/pieces-requises";
import { executerRechercheLCB } from "@/lib/lcb-ft.server";
import { appUrl } from "@/lib/app-url";

/**
 * Automatisation complète du traitement d'un lead :
 * dossier + checklist des pièces + classement automatique des fichiers reçus
 * + contrôle LCB-FT + création de l'espace client (mot de passe provisoire).
 */

type Admin = SupabaseClient<Database>;

export interface PieceJointeEntrante {
  nom: string;
  type?: string | null;
  taille?: number | null;
  contenu_base64?: string | null;
}

export interface AutomationInput {
  client_id: string;
  nom: string;
  prenom?: string | null;
  email?: string | null;
  telephone?: string | null;
  type_assurance: string;
  notes?: string | null;
  capital?: number | null;
  duree_mois?: number | null;
  age?: number | null;
  fumeur?: boolean | null;
  economie_estimee?: number | null;
  recueil_besoins?: Record<string, unknown> | null;
  pieces_jointes?: PieceJointeEntrante[];
  admin_id?: string | null;
  origin: string;
}

export function genererMotDePasseProvisoire(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = new Uint8Array(14);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `${out}!7`;
}

function decodeBase64(b64: string): Uint8Array {
  const clean = b64.includes(",") ? b64.slice(b64.indexOf(",") + 1) : b64;
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Crée le dossier et sa checklist de pièces requises. */
export async function creerDossierAutomatique(admin: Admin, input: AutomationInput) {
  const { data: dossier, error } = await admin
    .from("dossiers")
    .insert({
      client_nom: `${input.prenom ?? ""} ${input.nom}`.trim(),
      client_email: input.email ?? null,
      client_phone: input.telephone ?? null,
      type_assurance: input.type_assurance,
      statut: "nouveau",
      capital: input.capital ?? null,
      duree_mois: input.duree_mois ?? null,
      age: input.age ?? null,
      fumeur: input.fumeur ?? null,
      economie_estimee: input.economie_estimee ?? null,
      recueil_besoins: (input.recueil_besoins ?? null) as never,
      notes: input.notes ?? null,
      cree_automatiquement: true,
      created_by: input.admin_id ?? null,
    })
    .select("id, reference")
    .single();
  if (error || !dossier) throw new Error(error?.message ?? "Création du dossier impossible");

  const attendues = piecesRequisesPour(input.type_assurance);
  await admin.from("dossier_pieces_requises").insert(
    attendues.map((p) => ({
      dossier_id: dossier.id,
      client_id: input.client_id,
      code: p.code,
      libelle: p.libelle,
      categorie: p.categorie,
      obligatoire: p.obligatoire,
      statut: "manquante",
    })),
  );

  return dossier;
}

/**
 * Classe automatiquement les fichiers reçus : les pièces KYC vont dans le
 * dossier de conformité du client, les autres dans les documents du dossier.
 * Les fichiers non identifiables sont enregistrés en catégorie « à qualifier ».
 */
export async function classerPiecesJointes(
  admin: Admin,
  params: {
    client_id: string;
    dossier_id: string;
    type_assurance: string;
    admin_id?: string | null;
    pieces: PieceJointeEntrante[];
  },
) {
  const resultats: { nom: string; code: string | null; categorie: string }[] = [];

  for (const piece of params.pieces) {
    const classement = classerPiece(piece.nom, params.type_assurance);
    const safeName = piece.nom.replace(/[^\w.\-]+/g, "_").slice(0, 120);
    const path = `${params.client_id}/${Date.now()}-${safeName}`;

    let uploaded = false;
    if (piece.contenu_base64) {
      const bucket = classement.categorie === "kyc" ? "conformite-documents" : "dossier-documents";
      const { error: upErr } = await admin.storage
        .from(bucket)
        .upload(path, decodeBase64(piece.contenu_base64), {
          contentType: piece.type || "application/octet-stream",
          upsert: true,
        });
      uploaded = !upErr;
    }

    if (classement.categorie === "kyc" && classement.kyc_type && uploaded) {
      const { data: kyc } = await admin
        .from("client_kyc_documents")
        .insert({
          client_id: params.client_id,
          type: classement.kyc_type,
          nom: piece.nom,
          storage_path: path,
          statut: "a_valider",
          uploaded_by: params.admin_id ?? null,
          notes: "Classé automatiquement depuis le formulaire web",
        })
        .select("id")
        .single();
      if (kyc) {
        await admin
          .from("dossier_pieces_requises")
          .update({ statut: "recue", recue_le: new Date().toISOString(), kyc_document_id: kyc.id })
          .eq("dossier_id", params.dossier_id)
          .eq("code", classement.code!);
      }
    } else if (params.admin_id && uploaded) {
      const { data: doc } = await admin
        .from("documents")
        .insert({
          dossier_id: params.dossier_id,
          client_id: params.client_id,
          uploader_id: params.admin_id,
          storage_path: path,
          file_name: piece.nom,
          file_size: piece.taille ?? null,
          mime_type: piece.type ?? null,
          categorie: classement.categorie,
        })
        .select("id")
        .single();

      if (doc && classement.code) {
        await admin
          .from("dossier_pieces_requises")
          .update({ statut: "recue", recue_le: new Date().toISOString(), document_id: doc.id })
          .eq("dossier_id", params.dossier_id)
          .eq("code", classement.code);
      } else if (doc) {
        // Fichier non identifiable : on crée une ligne « à qualifier »
        await admin.from("dossier_pieces_requises").insert({
          dossier_id: params.dossier_id,
          client_id: params.client_id,
          code: `a_qualifier_${doc.id.slice(0, 8)}`,
          libelle: piece.nom,
          categorie: "a_qualifier",
          obligatoire: false,
          statut: "recue",
          recue_le: new Date().toISOString(),
          document_id: doc.id,
        });
      }
    }

    resultats.push({ nom: piece.nom, code: classement.code, categorie: classement.categorie });
  }

  return resultats;
}

/**
 * Contrôle LCB-FT automatique (sanctions + PPE).
 * L'API OpenSanctions n'est appelée QUE si nom, prénom ET date de naissance
 * sont renseignés (indispensables à une vérification fiable). Sinon, une
 * vérification « en_attente_infos » est enregistrée sur la fiche client pour
 * que le manque soit visible, et le contrôle devra être relancé manuellement
 * depuis l'onglet Conformité une fois l'information complétée.
 */
export async function lancerLcbAutomatique(
  admin: Admin,
  params: { client_id: string; nom: string; prenom?: string | null; date_naissance?: string | null },
) {
  const manquants: string[] = [];
  if (!params.nom?.trim()) manquants.push("nom");
  if (!params.prenom?.trim()) manquants.push("prénom");
  if (!params.date_naissance) manquants.push("date de naissance");

  if (manquants.length > 0) {
    try {
      await admin.from("client_lcb_verifications").insert({
        client_id: params.client_id,
        type: "combined",
        fournisseur: "opensanctions",
        requete: {
          nom: params.nom ?? null,
          prenom: params.prenom ?? null,
          date_naissance: params.date_naissance ?? null,
          informations_manquantes: manquants,
        },
        resultats: [],
        nb_correspondances: 0,
        score_correspondance: null,
        statut: "en_attente_infos",
        notes: `Vérification LCB-FT non lancée : ${manquants.join(", ")} manquant(s). Complétez la fiche puis relancez la vérification depuis l'onglet Conformité.`,
        verifie_par: null,
      });
    } catch (e) {
      console.error("[LCB-FT] trace « en attente d'informations » non enregistrée", params.client_id, e);
    }
    return null;
  }

  try {
    return await executerRechercheLCB(admin, {
      client_id: params.client_id,
      nom: params.nom,
      prenom: params.prenom ?? null,
      date_naissance: params.date_naissance ?? null,
      verifie_par: null,
    });
  } catch (e) {
    // Ne bloque jamais la création de la fiche, mais laisse une trace exploitable.
    console.error("[LCB-FT] contrôle automatique échoué", params.client_id, e);
    return null;
  }
}

/**
 * Envoie le DER au client et marque l'envoi correspondant comme « envoyé ».
 * Ne lève jamais : retourne le motif d'échec pour journalisation.
 */
export async function envoyerDerAuClient(
  admin: Admin,
  params: { client_id: string; email: string; clientName: string },
): Promise<{ sent: boolean; error?: string }> {
  try {
    const { data: modele } = await admin.from("der_modele").select("id").eq("actif", true).maybeSingle();
    if (!modele) return { sent: false, error: "Aucun modèle DER actif" };

    const { sendTemplateEmail } = await import("@/lib/email-templates/send-email");
    const res = await sendTemplateEmail("der-envoi", params.email, {
      templateData: {
        clientName: params.clientName,
        cabinetName: "EJ Partners Assurances",
        link: appUrl("/espace/signer-der"),
      },
      liens: { client_id: params.client_id },
    });
    if (!res.sent) return { sent: false, error: "Adresse en liste de suppression" };

    const { data: existing } = await admin
      .from("client_der_envois")
      .select("id, statut")
      .eq("client_id", params.client_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!existing || existing.statut === "signe") {
      await admin.from("client_der_envois").insert({
        client_id: params.client_id,
        der_modele_id: modele.id,
        email_destinataire: params.email,
        statut: "envoye",
        envoye_le: new Date().toISOString(),
      });
    } else {
      await admin
        .from("client_der_envois")
        .update({
          statut: "envoye",
          envoye_le: new Date().toISOString(),
          email_destinataire: params.email,
        })
        .eq("id", existing.id);
    }
    return { sent: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erreur inconnue";
    console.error(`[email] DER non envoyé client=${params.client_id}: ${message}`);
    return { sent: false, error: message };
  }
}

/**
 * Crée l'espace client avec un mot de passe provisoire et envoie l'e-mail
 * d'accès. Le changement de mot de passe est ensuite obligatoire.
 */
export async function creerEspaceClient(
  admin: Admin,
  params: { client_id: string; email: string; nom: string; prenom?: string | null; origin: string },
) {
  const { data: existing } = await admin.from("profiles").select("id").eq("email", params.email).maybeSingle();

  if (existing) {
    await admin.from("clients").update({ user_id: existing.id }).eq("id", params.client_id).is("user_id", null);
    return {
      created: false,
      email_sent: false,
      user_id: existing.id,
      email_error: "Un compte existe déjà pour cette adresse : aucun accès provisoire renvoyé.",
      der_sent: false,
    };
  }

  const password = genererMotDePasseProvisoire();
  const { data: created, error } = await admin.auth.admin.createUser({
    email: params.email,
    password,
    email_confirm: true,
    user_metadata: { full_name: `${params.prenom ?? ""} ${params.nom}`.trim() },
  });
  if (error || !created.user) {
    return {
      created: false,
      email_sent: false,
      user_id: null,
      email_error: error?.message ?? "Création du compte impossible",
      der_sent: false,
    };
  }

  await admin.from("profiles").update({ must_change_password: true }).eq("id", created.user.id);
  await admin.from("clients").update({ user_id: created.user.id }).eq("id", params.client_id).is("user_id", null);

  const clientName = `${params.prenom ?? ""} ${params.nom}`.trim();
  let emailSent = false;
  let emailError: string | undefined;
  try {
    const { sendTemplateEmail } = await import("@/lib/email-templates/send-email");
    const res = await sendTemplateEmail("compte-client-cree", params.email, {
      templateData: {
        clientName,
        email: params.email,
        motDePasseProvisoire: password,
        link: appUrl("/auth"),
      },
      idempotencyKey: `compte-client-${created.user.id}`,
      liens: { client_id: params.client_id },
    });
    emailSent = res.sent;
    if (!res.sent) {
      emailError = "Adresse en liste de suppression";
      await signalerEchecEmailAcces(admin, params.client_id, params.email, emailError);
    }
  } catch (e) {
    emailSent = false;
    emailError = e instanceof Error ? e.message : "Erreur d'envoi inconnue";
    console.error(`[email] accès espace client non envoyé (${params.email}): ${emailError}`);
    await signalerEchecEmailAcces(admin, params.client_id, params.email, emailError);
  }

  // Envoi réglementaire du DER dès la création de l'espace client.
  const der = await envoyerDerAuClient(admin, {
    client_id: params.client_id,
    email: params.email,
    clientName,
  });

  return {
    created: true,
    email_sent: emailSent,
    email_error: emailError,
    der_sent: der.sent,
    der_error: der.error,
    user_id: created.user.id,
  };
}

/**
 * Réinitialise l'accès d'un espace client existant : nouveau mot de passe
 * provisoire, changement obligatoire à la prochaine connexion, e-mail d'accès.
 */
export async function reinitialiserAccesEspaceClient(
  admin: Admin,
  params: {
    client_id: string;
    user_id: string;
    email: string;
    nom: string;
    prenom?: string | null;
    origin: string;
  },
) {
  const password = genererMotDePasseProvisoire();
  const { error } = await admin.auth.admin.updateUserById(params.user_id, {
    password,
    email_confirm: true,
  });
  if (error) return { email_sent: false, email_error: error.message };

  await admin.from("profiles").update({ must_change_password: true }).eq("id", params.user_id);
  await admin.from("clients").update({ user_id: params.user_id }).eq("id", params.client_id).is("user_id", null);

  try {
    const { sendTemplateEmail } = await import("@/lib/email-templates/send-email");
    const res = await sendTemplateEmail("lien-connexion", params.email, {
      templateData: {
        clientName: `${params.prenom ?? ""} ${params.nom}`.trim(),
        email: params.email,
        motDePasseProvisoire: password,
        link: appUrl("/auth"),
      },
      idempotencyKey: `acces-client-${params.user_id}-${Date.now()}`,
      liens: { client_id: params.client_id },
    });
    if (!res.sent) {
      await signalerEchecEmailAcces(admin, params.client_id, params.email, "Adresse en liste de suppression Brevo");
    }
    return { email_sent: res.sent, email_error: res.sent ? undefined : "Adresse en liste de suppression" };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erreur d'envoi inconnue";
    console.error(`[email] réinitialisation accès non envoyée (${params.email}): ${message}`);
    await signalerEchecEmailAcces(admin, params.client_id, params.email, message);
    return { email_sent: false, email_error: message };
  }
}

/**
 * Trace visible dans le CRM (fil d'activité de la fiche client) lorsqu'un
 * e-mail d'accès à l'espace client n'a pas pu être envoyé.
 */
async function signalerEchecEmailAcces(admin: Admin, clientId: string, email: string, raison: string) {
  await admin
    .from("activites")
    .insert({
      client_id: clientId,
      type: "systeme",
      titre: "⚠ E-mail d'accès à l'espace client NON envoyé",
      contenu: `Destinataire : ${email}\nCause : ${raison}\nAction : vérifier l'adresse puis relancer « Renvoyer le lien de connexion ».`,
    })
    .then(
      () => undefined,
      (e: unknown) => console.error("[email] trace échec non enregistrée:", e),
    );
}

