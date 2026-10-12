import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const schema = z.object({
  nom: z.string().trim().min(1).max(200),
  prenom: z.string().trim().max(200).optional(),
  email: z.string().trim().email().max(255),
  telephone: z.string().trim().max(30).optional(),
  situation_familiale: z.string().max(100).optional(),
  situation_professionnelle: z.string().max(100).optional(),
  revenus_mensuels: z.string().max(20).optional(),
  charges_mensuelles: z.string().max(20).optional(),
  epargne_disponible: z.string().max(20).optional(),
  experience_placements: z.string().max(200).optional(),
  objectif_principal: z.string().max(200).optional(),
  horizon_placement: z.string().max(100).optional(),
  tolerance_risque: z.string().max(200).optional(),
  origine_fonds: z.string().max(200).optional(),
  commentaire: z.string().max(2000).optional(),
  /** Si fourni (lien envoyé depuis un dossier déjà créé, ex. suite au devoir
   *  de conseil emprunteur) : le profil complète ce dossier existant plutôt
   *  que d'en créer un nouveau, pour éviter tout doublon client/dossier. */
  dossier_id: z.string().uuid().optional(),
});

const nb = (v?: string) => (v && v.trim() !== "" ? Number(v) : null);

/**
 * Formulaire public (brouillon, à compléter) de profil épargne — assurance
 * vie. Pas d'authentification requise (page ouverte à un prospect externe,
 * via le site vitrine ou une conférence) : crée une fiche client prospect
 * et un dossier, avec le profil complet conservé dans recueil_besoins pour
 * que le devoir de conseil dédié puisse s'appuyer dessus.
 *
 * Réutilise la branche epargne_retraite existante en l'absence d'une
 * branche « vie » dédiée — décision à trancher plus tard si besoin d'une
 * séparation plus fine.
 */
export const creerProfilAssuranceVie = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => schema.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const profil = {
      profil_dda_vie: {
        situation_familiale: data.situation_familiale ?? null,
        situation_professionnelle: data.situation_professionnelle ?? null,
        revenus_mensuels: nb(data.revenus_mensuels),
        charges_mensuelles: nb(data.charges_mensuelles),
        epargne_disponible: nb(data.epargne_disponible),
        experience_placements: data.experience_placements ?? null,
        objectif_principal: data.objectif_principal ?? null,
        horizon_placement: data.horizon_placement ?? null,
        tolerance_risque: data.tolerance_risque ?? null,
        origine_fonds: data.origine_fonds ?? null,
        commentaire: data.commentaire ?? null,
      },
    };

    if (data.dossier_id) {
      const { data: existant, error: errLire } = await supabaseAdmin
        .from("dossiers")
        .select("id, reference, client_id, recueil_besoins")
        .eq("id", data.dossier_id)
        .maybeSingle();
      if (errLire || !existant) throw new Error("Dossier introuvable");

      const { error: errMaj } = await supabaseAdmin
        .from("dossiers")
        .update({ recueil_besoins: { ...(existant.recueil_besoins as object), ...profil } })
        .eq("id", data.dossier_id);
      if (errMaj) throw new Error(errMaj.message);

      const { data: client } = existant.client_id
        ? await supabaseAdmin
            .from("clients")
            .select("reference")
            .eq("id", existant.client_id)
            .maybeSingle()
        : { data: null };

      return {
        client_id: existant.client_id,
        client_reference: client?.reference ?? "",
        dossier_id: existant.id,
        dossier_reference: existant.reference,
      };
    }

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
        recueil_besoins: profil,
      })
      .select("id, reference")
      .single();
    if (errDossier || !dossier) throw new Error(errDossier?.message ?? "Création du dossier impossible");

    return {
      client_id: client.id,
      client_reference: client.reference,
      dossier_id: dossier.id,
      dossier_reference: dossier.reference,
    };
  });
