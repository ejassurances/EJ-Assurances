import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { sendTemplateEmail } from "@/lib/email-templates/send-email";
import { SITE } from "@/lib/site";
import { appUrl } from "@/lib/app-url";
import { withPendingSchema } from "@/lib/pending-schema-client";

const schema = z.object({
  devoir_id: z.string().uuid(),
});

/**
 * Le client signale, au moment de signer le devoir de conseil emprunteur,
 * qu'il est intéressé par la mise en place d'une assurance vie avec les
 * économies réalisées. Pas d'authentification staff requise : appelée
 * depuis la page de signature du client lui-même (client_id vérifié via le
 * devoir_id, comme le reste de cette page).
 *
 * Crée un dossier assurance vie lié au dossier emprunteur (même client,
 * jamais dupliqué), une tâche pour le cabinet (proposer le rendez-vous
 * téléphonique de mise en place), et envoie le lien du profil DDA déjà
 * pré-rattaché à ce nouveau dossier.
 */
export const signalerInteretAssuranceVie = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => schema.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin: generatedAdmin } = await import("@/integrations/supabase/client.server");
    const supabaseAdmin = withPendingSchema(generatedAdmin);

    const { data: devoir, error: errDevoir } = await supabaseAdmin
      .from("devoirs_conseil")
      .select("id, dossier_id, client_id")
      .eq("id", data.devoir_id)
      .maybeSingle();
    if (errDevoir || !devoir) throw new Error("Devoir de conseil introuvable");

    const { data: dossierEmprunteur, error: errDoe } = await supabaseAdmin
      .from("dossiers")
      .select("id, reference, client_id, client_nom, client_email, client_phone")
      .eq("id", devoir.dossier_id)
      .maybeSingle();
    if (errDoe || !dossierEmprunteur) throw new Error("Dossier introuvable");

    // Idempotence : si un dossier vie est déjà lié à ce dossier emprunteur,
    // ne pas en recréer un second (double-clic, rechargement de page...).
    const { data: liens } = await supabaseAdmin
      .from("dossiers_lies")
      .select("dossier_id_1, dossier_id_2")
      .or(`dossier_id_1.eq.${dossierEmprunteur.id},dossier_id_2.eq.${dossierEmprunteur.id}`);
    if (liens && liens.length > 0) {
      const autresIds = liens.map((l) => (l.dossier_id_1 === dossierEmprunteur.id ? l.dossier_id_2 : l.dossier_id_1));
      const { data: existants } = await supabaseAdmin
        .from("dossiers")
        .select("id, reference")
        .in("id", autresIds)
        .eq("type_assurance", "epargne_retraite");
      if (existants && existants.length > 0) {
        return { deja_existant: true, dossier_vie_id: existants[0].id, dossier_vie_reference: existants[0].reference };
      }
    }

    const { data: dossierVie, error: errVie } = await supabaseAdmin
      .from("dossiers")
      .insert({
        client_id: dossierEmprunteur.client_id,
        client_nom: dossierEmprunteur.client_nom,
        client_email: dossierEmprunteur.client_email,
        client_phone: dossierEmprunteur.client_phone,
        type_assurance: "epargne_retraite",
        statut: "nouveau",
      })
      .select("id, reference")
      .single();
    if (errVie || !dossierVie) throw new Error(errVie?.message ?? "Création du dossier assurance vie impossible");

    const [id1, id2] = [dossierEmprunteur.id, dossierVie.id].sort();
    await supabaseAdmin.from("dossiers_lies").insert({
      dossier_id_1: id1,
      dossier_id_2: id2,
      motif: "Économies de l'assurance emprunteur réinvesties en assurance vie",
    });

    await supabaseAdmin.from("taches").insert({
      dossier_id: dossierVie.id,
      client_id: dossierEmprunteur.client_id,
      type: "assurance_vie_interet",
      statut: "a_faire",
      priorite: "haute",
      titre: `Proposer un rendez-vous téléphonique — mise en place assurance vie (économies emprunteur, dossier lié ${dossierEmprunteur.reference})`,
    });

    if (dossierEmprunteur.client_email) {
      await sendTemplateEmail("invitation-profil-vie", dossierEmprunteur.client_email, {
        templateData: {
          prenom: String(dossierEmprunteur.client_nom ?? "").split(" ")[0] ?? "",
          cabinetName: SITE.shortName,
          reference: dossierVie.reference,
          lien: appUrl(`/assurance-vie-profil?dossier_id=${dossierVie.id}`),
        },
        liens: {
          client_id: dossierEmprunteur.client_id,
          dossier_id: dossierVie.id,
        },
      });
    }

    return { deja_existant: false, dossier_vie_id: dossierVie.id, dossier_vie_reference: dossierVie.reference };
  });

/** Le client se dit non intéressé — aucune donnée créée, juste tracé côté devoir de conseil si besoin plus tard. */
export const signalerNonInteretAssuranceVie = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => schema.parse(input))
  .handler(async () => ({ ok: true }));
