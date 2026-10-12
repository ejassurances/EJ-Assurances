import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { sendTemplateEmail } from "@/lib/email-templates/send-email";
import { SITE } from "@/lib/site";
import { withPendingSchema } from "@/lib/pending-schema-client";

const schema = z.object({
  nom: z.string().trim().min(1).max(200),
  prenom: z.string().trim().max(200).optional(),
  email: z.string().trim().email().max(255),
  telephone: z.string().trim().max(30).optional(),
  lien_avec_enfant: z.string().max(200).optional(),
  prenom_enfant: z.string().max(200).optional(),
  objectif: z.string().max(300).optional(),
  commentaire: z.string().max(2000).optional(),
  proprietaire_credit_moins_5_ans: z.boolean().optional(),
  souhaite_etude_emprunteur: z.boolean().optional(),
  /** D'où vient la demande : formulaire du site vitrine, ou conférence dédiée. */
  origine: z.string().max(100).optional(),
});

/**
 * Formulaire public « familles modernes » : transmission d'un parent social
 * vers un enfant social (succession, capital au décès). Deux points d'entrée
 * possibles vers ce même formulaire (site vitrine, conférence) — distingués
 * par le champ origine, sans changer le traitement.
 *
 * Cross-sell emprunteur : si la personne est propriétaire avec un crédit de
 * moins de 5 ans ET coche vouloir l'étude de son assurance emprunteur, un
 * second dossier (branche emprunteur) est créé et lié au dossier vie.
 */
export const creerProfilFamillesModernes = createServerFn({ method: "POST" })
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
    const { data: dossierVie, error: errVie } = await supabaseAdmin
      .from("dossiers")
      .insert({
        client_id: client.id,
        client_nom: nomComplet,
        client_email: data.email.toLowerCase(),
        client_phone: data.telephone ?? null,
        type_assurance: "epargne_retraite",
        statut: "nouveau",
        recueil_besoins: {
          profil_familles_modernes: {
            type: "familles_modernes",
            lien_avec_enfant: data.lien_avec_enfant ?? null,
            prenom_enfant: data.prenom_enfant ?? null,
            objectif: data.objectif ?? null,
            commentaire: data.commentaire ?? null,
            origine: data.origine ?? null,
          },
        },
      })
      .select("id, reference")
      .single();
    if (errVie || !dossierVie) throw new Error(errVie?.message ?? "Création du dossier impossible");

    let dossierEmprunteurRef: string | null = null;

    if (data.proprietaire_credit_moins_5_ans && data.souhaite_etude_emprunteur) {
      const { data: dossierEmp, error: errEmp } = await supabaseAdmin
        .from("dossiers")
        .insert({
          client_id: client.id,
          client_nom: nomComplet,
          client_email: data.email.toLowerCase(),
          client_phone: data.telephone ?? null,
          type_assurance: "emprunteur",
          statut: "nouveau",
        })
        .select("id, reference")
        .single();
      if (!errEmp && dossierEmp) {
        dossierEmprunteurRef = dossierEmp.reference;
        const [id1, id2] = [dossierVie.id, dossierEmp.id].sort();
        await withPendingSchema(supabaseAdmin).from("dossiers_lies").insert({
          dossier_id_1: id1,
          dossier_id_2: id2,
          motif: "Étude assurance emprunteur demandée depuis le formulaire familles modernes",
        });
        await supabaseAdmin.from("taches").insert({
          dossier_id: dossierEmp.id,
          client_id: client.id,
          type: "prequalification_emprunteur",
          statut: "a_faire",
          priorite: "normale",
          titre: `Pièces justificatives à demander — étude emprunteur (dossier vie lié ${dossierVie.reference})`,
        });
        await sendTemplateEmail("prequalification-emprunteur", data.email.toLowerCase(), {
          templateData: {
            prenom: data.prenom ?? "",
            cabinetName: SITE.shortName,
            reference: dossierEmp.reference,
          },
          liens: { client_id: client.id, dossier_id: dossierEmp.id },
        });
      }
    }

    return {
      client_id: client.id,
      client_reference: client.reference,
      dossier_id: dossierVie.id,
      dossier_reference: dossierVie.reference,
      dossier_emprunteur_reference: dossierEmprunteurRef,
    };
  });
