import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { preparerConfirmationPret } from "./import-pret-verification";

export const confirmerPretDossier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        dossierId: z.string().uuid(),
        valeurs: z.record(z.string(), z.unknown()),
        lectures: z
          .array(
            z.object({
              source: z.string().max(200),
              nature: z.enum(["offre_pret", "tableau_amortissement"]),
              confiance: z.number().min(0).max(1),
              valeurs: z.record(z.string(), z.unknown()),
            }),
          )
          .max(2),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: acces } = await context.supabase.rpc("can_access_dossier", {
      _dossier_id: data.dossierId,
    });
    if (acces !== true) throw new Error("Accès au dossier refusé.");
    let autorise = false;
    for (const role of ["admin", "mandataire", "prescripteur"] as const) {
      const { data: ok } = await context.supabase.rpc("has_role", {
        _user_id: context.userId,
        _role: role,
      });
      if (ok === true) autorise = true;
    }
    if (!autorise) throw new Error("Modification non autorisée.");
    const { data: dossier, error } = await context.supabase
      .from("dossiers")
      .select("recueil_besoins,analyse_ia,type_assurance,capital,duree_mois,updated_at")
      .eq("id", data.dossierId)
      .single();
    if (error || dossier.type_assurance !== "emprunteur")
      throw new Error("Dossier emprunteur indisponible.");
    const modification = preparerConfirmationPret(dossier, data.valeurs, data.lectures, {
      confirme_par: context.userId,
      confirme_le: new Date().toISOString(),
    });
    const { data: enregistre, error: save } = await context.supabase
      .from("dossiers")
      .update(modification as never)
      .eq("id", data.dossierId)
      .eq("updated_at", dossier.updated_at)
      .select("id")
      .maybeSingle();
    if (save) throw new Error(save.message);
    if (!enregistre)
      throw new Error("Le dossier a changé. Rechargez-le avant de confirmer les valeurs.");
    return { ok: true };
  });
