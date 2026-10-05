import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  executerCreationRapide,
  composerNotesDossierRapide,
  type ClientCandidatCreationRapide,
  type EntreeCreationRapide,
  type ResultatEcritureAtomique,
} from "@/lib/creation-rapide-client-dossier";
import { BRANCHES_CREATION } from "@/lib/recueil-besoins-schemas";
import { piecesRequisesPour } from "@/lib/pieces-requises";
import { SITE } from "@/lib/site";

const champOptionnel = (max: number) => z.string().trim().max(max).optional().nullable();

const schema = z.object({
  client: z.object({
    civilite: champOptionnel(20),
    prenom: champOptionnel(120),
    nom: z.string().trim().min(1, "Le nom du client est obligatoire.").max(120),
    date_naissance: z.iso.date().optional().nullable().or(z.literal("")),
    email: z.string().trim().email().max(255).optional().nullable().or(z.literal("")),
    mobile: champOptionnel(30),
    telephone: champOptionnel(30),
    adresse: champOptionnel(255),
    code_postal: champOptionnel(20),
    ville: champOptionnel(120),
  }),
  dossier: z.object({
    type_assurance: z.string().refine((value) => BRANCHES_CREATION.some((b) => b.value === value), {
      message: "Choisissez un type d’assurance proposé par le CRM.",
    }),
    intitule: z.string().trim().min(1, "L’intitulé du dossier est obligatoire.").max(160),
    besoin: champOptionnel(3000),
    commentaire_initial: champOptionnel(3000),
  }),
  confirmer_client_id: z.string().uuid().optional().nullable(),
});

export const creerClientDossierRapide = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => schema.parse(input))
  .handler(async ({ data, context }) => {
    let autorise = false;
    for (const role of ["admin", "mandataire", "prescripteur"] as const) {
      const { data: aLeRole } = await context.supabase.rpc("has_role", {
        _user_id: context.userId,
        _role: role,
      });
      if (aLeRole === true) {
        autorise = true;
        break;
      }
    }
    if (!autorise) throw new Error("Création de dossier non autorisée.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { trouverClientExistant } = await import("@/lib/client-dedoublonnage.server");

    const entree: EntreeCreationRapide = {
      client: {
        civilite: data.client.civilite || null,
        prenom: data.client.prenom || null,
        nom: data.client.nom,
        date_naissance: data.client.date_naissance || null,
        email: data.client.email?.toLowerCase().trim() || null,
        mobile: data.client.mobile || null,
        telephone: data.client.telephone || null,
        adresse: data.client.adresse || null,
        code_postal: data.client.code_postal || null,
        ville: data.client.ville || null,
      },
      dossier: {
        type_assurance: data.dossier.type_assurance,
        intitule: data.dossier.intitule,
        besoin: data.dossier.besoin || null,
        commentaire_initial: data.dossier.commentaire_initial || null,
      },
      confirmer_client_id: data.confirmer_client_id ?? null,
    };

    return executerCreationRapide(entree, {
      trouverCorrespondance: async (identite) => {
        const correspondance = await trouverClientExistant(supabaseAdmin, {
          ...identite,
          exigerDateNaissancePourNom: true,
        });
        if (!correspondance) return null;

        const { data: fiche, error } = await supabaseAdmin
          .from("clients")
          .select("id, nom, prenom, email, mobile, telephone, date_naissance")
          .eq("id", correspondance.client_id)
          .maybeSingle();
        if (error)
          throw new Error(`Recherche du client correspondant impossible : ${error.message}`);
        if (!fiche) return null;

        return {
          client_id: fiche.id,
          nom: fiche.nom,
          prenom: fiche.prenom,
          email: fiche.email,
          mobile: fiche.mobile,
          telephone: fiche.telephone,
          date_naissance: fiche.date_naissance,
          via: correspondance.via,
        } satisfies ClientCandidatCreationRapide;
      },
      creerAtomiquement: async (payload, clientConfirmeId) => {
        const pieces = piecesRequisesPour(payload.dossier.type_assurance).map(
          ({ code, libelle, categorie, obligatoire }) => ({
            code,
            libelle,
            categorie,
            obligatoire,
          }),
        );
        const { data: resultat, error } = await supabaseAdmin.rpc("creer_client_dossier_rapide", {
          p_client: {
            ...payload.client,
            marque: "ej_assurances",
            commercial_id: SITE.defaultConseiller.id,
          },
          p_dossier: {
            type_assurance: payload.dossier.type_assurance,
            intitule: payload.dossier.intitule,
            projet_type: "nouveau",
            projet_contexte: null,
            notes: composerNotesDossierRapide(payload.dossier),
          },
          p_piece_rows: pieces,
          p_user_id: context.userId,
          p_confirmed_client_id: clientConfirmeId,
        });
        if (error)
          throw new Error(`Création du client et du dossier impossible : ${error.message}`);
        return resultat as unknown as ResultatEcritureAtomique;
      },
      apresCreationClient: async (resultat) => {
        const { lancerAutomatisationsNouveauClient } =
          await import("@/lib/client-creation-automatisations.server");
        await lancerAutomatisationsNouveauClient(supabaseAdmin, {
          id: resultat.client_id,
          nom: entree.client.nom,
          prenom: entree.client.prenom,
        });
      },
      journaliserErreurAutomatisation: (erreur) => {
        console.error("[création rapide] automatisations du nouveau client échouées", erreur);
      },
    });
  });
