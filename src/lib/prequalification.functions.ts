import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { SITE } from "@/lib/site";

const schema = z.object({
  nom: z.string().min(1).max(200),
  prenom: z.string().min(1).max(200).optional(),
  email: z.string().email(),
});

/**
 * Pré-qualification rapide : à partir d'un simple nom/prénom/email (obtenu
 * par exemple par WhatsApp ou en direct), crée une fiche client prospect et
 * un dossier assurance emprunteur, puis envoie le mail de pré-qualification
 * — objet avec la référence du dossier, pour un suivi optimal des réponses.
 */
export const creerPrequalificationEmprunteur = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => schema.parse(input))
  .handler(async ({ data, context }) => {
    const { sendTemplateEmail } = await import("@/lib/email-templates/send-email");
    const { supabase, userId } = context;

    const { data: client, error: errClient } = await supabase
      .from("clients")
      .insert({
        nom: data.nom,
        prenom: data.prenom ?? null,
        email: data.email,
        statut: "prospect",
        created_by: userId,
      })
      .select("id, reference, nom, prenom")
      .single();
    if (errClient || !client)
      throw new Error(errClient?.message ?? "Création du client impossible");

    const nomComplet = [client.prenom, client.nom].filter(Boolean).join(" ");
    const { data: dossier, error: errDossier } = await supabase
      .from("dossiers")
      .insert({
        client_id: client.id,
        client_nom: nomComplet,
        client_email: data.email,
        type_assurance: "emprunteur",
        statut: "nouveau",
        created_by: userId,
      })
      .select("id, reference")
      .single();
    if (errDossier || !dossier)
      throw new Error(errDossier?.message ?? "Création du dossier impossible");

    const result = await sendTemplateEmail("prequalification-emprunteur", data.email, {
      templateData: {
        prenom: data.prenom ?? "",
        cabinetName: SITE.shortName,
        reference: dossier.reference,
      },
      brevoParams: {
        PRENOM: data.prenom ?? "",
      },
      liens: {
        client_id: client.id,
        dossier_id: dossier.id,
      },
    });

    return {
      client_id: client.id,
      client_reference: client.reference,
      dossier_id: dossier.id,
      dossier_reference: dossier.reference,
      email_envoye: result.sent,
    };
  });
