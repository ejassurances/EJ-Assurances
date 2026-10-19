import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const schema = z.object({
  nom: z.string().trim().min(1).max(200),
  prenom: z.string().trim().max(200).optional(),
  email: z.string().trim().email().max(255),
  telephone: z.string().trim().max(30).optional(),
  motif: z.string().max(2000).optional(),
});

/**
 * Formulaire public « information générique » assurance vie — 3e cas de
 * figure, sans lien avec un dossier emprunteur ni une situation de
 * coparentalité. Contenu de lettre de mission / devoir de conseil pour ce
 * cas encore à valider avec Erwan avant construction (plus générique que
 * les deux autres) — ce formulaire crée seulement le client et le dossier.
 */
export const creerDemandeInfoVie = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => schema.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: client, error: errClient } = await supabaseAdmin
      .from("clients")
      .insert({
        nom: data.nom,
        prenom: data.prenom ?? null,
        email: data.email.toLowerCase(),
        telephone: data.telephone ?? null,
        statut: "prospect",
      })
      .select("id, reference")
      .single();
    if (errClient || !client) throw new Error(errClient?.message ?? "Création du client impossible");

    const nomComplet = [data.prenom, data.nom].filter(Boolean).join(" ");
    const { data: dossier, error: errDossier } = await supabaseAdmin
      .from("dossiers")
      .insert({
        client_id: client.id,
        client_nom: nomComplet,
        client_email: data.email.toLowerCase(),
        client_phone: data.telephone ?? null,
        type_assurance: "epargne_retraite",
        statut: "nouveau",
        recueil_besoins: {
          profil_info_generique: {
            type: "info_generique",
            motif: data.motif ?? null,
          },
        },
      })
      .select("id, reference")
      .single();
    if (errDossier || !dossier) throw new Error(errDossier?.message ?? "Création du dossier impossible");

    await supabaseAdmin.from("taches").insert({
      dossier_id: dossier.id,
      client_id: client.id,
      type: "demande_info_vie",
      statut: "a_faire",
      priorite: "normale",
      titre: `Demande d'information assurance vie — à recontacter (${dossier.reference})`,
    });

    return {
      client_id: client.id,
      client_reference: client.reference,
      dossier_id: dossier.id,
      dossier_reference: dossier.reference,
    };
  });
