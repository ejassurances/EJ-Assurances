import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ORIGINE_KEYS } from "@/lib/crm-origines";
import { withPendingSchema } from "@/lib/pending-schema-client";
import { z } from "zod";

export type ClientCandidatCreationManuelle = {
  client_id: string;
  reference: string;
  prenom: string | null;
  nom: string;
  email: string | null;
  mobile: string | null;
  telephone: string | null;
  via: "email" | "telephone" | "nom_prenom";
};

type ResultatCreationClientManuel =
  | { status: "created"; id: string }
  | { status: "duplicate_required"; candidate: ClientCandidatCreationManuelle }
  | { status: "invalid_confirmation" };

const creerClientSchema = z.object({
  civilite: z.string().trim().max(20).optional().nullable(),
  prenom: z.string().trim().max(120).optional().nullable(),
  nom: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(255).optional().nullable().or(z.literal("")),
  mobile: z.string().trim().max(30).optional().nullable(),
  ville: z.string().trim().max(120).optional().nullable(),
  origine: z.enum(ORIGINE_KEYS),
  client_origine_id: z.string().uuid().optional().nullable(),
  marque: z.string().trim().max(60),
  confirmer_doublon_id: z.string().uuid().optional().nullable(),
});


/**
 * Création manuelle d'une fiche client depuis le CRM.
 * Déclenche systématiquement le contrôle LCB-FT / OpenSanctions
 * (la date de naissance n'est pas connue à ce stade : facultative).
 */
export const creerClientManuel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => creerClientSchema.parse(input))
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
    if (!autorise) throw new Error("Création de fiche client non autorisée.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rawResultat, error } = await withPendingSchema(supabaseAdmin).rpc(
      "creer_client_manuel_securise",
      {
        p_client: {
          civilite: data.civilite || null,
          prenom: data.prenom || null,
          nom: data.nom,
          email: data.email?.toLowerCase().trim() || null,
          mobile: data.mobile || null,
          ville: data.ville || null,
          origine: data.origine,
          client_origine_id:
            data.origine === "parrainage" || data.origine === "recommandation"
              ? (data.client_origine_id ?? null)
              : null,
          marque: data.marque,
          commercial_id: context.userId,
        },
        p_user_id: context.userId,
        p_confirmed_duplicate_id: data.confirmer_doublon_id ?? null,
      },
    );
    if (error) throw new Error(`Création de la fiche impossible : ${error.message}`);

    const resultat = rawResultat as unknown as ResultatCreationClientManuel;
    if (resultat.status === "duplicate_required" || resultat.status === "invalid_confirmation") {
      return resultat;
    }
    if (resultat.status !== "created" || !resultat.id) {
      throw new Error("La création de la fiche n’a pas renvoyé de résultat valide.");
    }

    const { lancerAutomatisationsNouveauClient } = await import("@/lib/client-creation-automatisations.server");
    await lancerAutomatisationsNouveauClient(supabaseAdmin, {
      id: resultat.id,
      nom: data.nom,
      prenom: data.prenom ?? null,
    });

    return resultat;
  });
