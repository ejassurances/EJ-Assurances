import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { appliquerValeursPret, filtrerValeursPret } from "./import-pret-verification";

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
      .select("recueil_besoins,analyse_ia,type_assurance,capital,duree_mois")
      .eq("id", data.dossierId)
      .single();
    if (error || dossier.type_assurance !== "emprunteur")
      throw new Error("Dossier emprunteur indisponible.");
    const base =
      dossier.recueil_besoins &&
      typeof dossier.recueil_besoins === "object" &&
      !Array.isArray(dossier.recueil_besoins)
        ? dossier.recueil_besoins
        : {};
    const audit =
      dossier.analyse_ia &&
      typeof dossier.analyse_ia === "object" &&
      !Array.isArray(dossier.analyse_ia)
        ? dossier.analyse_ia
        : {};
    const precedent = Array.isArray(audit["imports_pret_verifies"])
      ? audit["imports_pret_verifies"]
      : [];
    const valeurs = filtrerValeursPret(data.valeurs);
    const recueil = appliquerValeursPret(base, valeurs);
    const { error: save } = await context.supabase
      .from("dossiers")
      .update({
        recueil_besoins: recueil as never,
        capital:
          Number(recueil["capital"]) > 0
            ? Number(recueil["capital"])
            : dossier.capital,
        duree_mois:
          Number.isInteger(Number(recueil["duree_mois"])) &&
          Number(recueil["duree_mois"]) > 0 &&
          Number(recueil["duree_mois"]) <= 600
            ? Number(recueil["duree_mois"])
            : dossier.duree_mois,
        analyse_ia: {
          ...audit,
          imports_pret_verifies: [
            ...precedent,
            {
              confirme_par: context.userId,
              confirme_le: new Date().toISOString(),
              valeurs,
              lectures: data.lectures.map((l) => ({
                ...l,
                valeurs: filtrerValeursPret(l.valeurs),
              })),
            },
          ],
        } as never,
      })
      .eq("id", data.dossierId);
    if (save) throw new Error(save.message);
    return { ok: true };
  });
