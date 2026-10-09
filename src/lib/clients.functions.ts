import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ORIGINE_KEYS } from "@/lib/crm-origines";
import { SITE } from "@/lib/site";
import { z } from "zod";

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
    const { data: cree, error } = await context.supabase
      .from("clients")
      .insert({
        civilite: data.civilite || null,
        prenom: data.prenom || null,
        nom: data.nom,
        email: data.email || null,
        mobile: data.mobile || null,
        ville: data.ville || null,
        origine: data.origine as never,
        client_origine_id:
          data.origine === "parrainage" || data.origine === "recommandation"
            ? (data.client_origine_id ?? null)
            : null,
        marque: data.marque,
        created_by: context.userId,
        commercial_id: SITE.defaultConseiller.id,
      })

      .select("id")
      .single();
    if (error || !cree) throw new Error(error?.message ?? "Création de la fiche impossible");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { lancerAutomatisationsNouveauClient } = await import("@/lib/client-creation-automatisations.server");
    await lancerAutomatisationsNouveauClient(supabaseAdmin, {
      id: cree.id,
      nom: data.nom,
      prenom: data.prenom ?? null,
    });

    return { id: cree.id };
  });
