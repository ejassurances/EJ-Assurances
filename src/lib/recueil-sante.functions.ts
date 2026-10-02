import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { calculerBesoins, REGLES_SANTE, type RecueilSante } from "@/lib/recueil-sante-config";

const besoin = z.enum(["faible", "modere", "fort", "oui", "non"]);

export const lireRecueilSante = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ dossier_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: d, error } = await context.supabase
      .from("dossiers")
      .select("id, reference, client_nom, type_assurance, recueil_besoins")
      .eq("id", data.dossier_id)
      .maybeSingle();
    if (error || !d) throw new Error(error?.message ?? "Dossier introuvable");
    const rb = (d.recueil_besoins ?? {}) as Record<string, unknown>;
    return {
      reference: d.reference as string,
      client_nom: (d.client_nom ?? "") as string,
      type_assurance: d.type_assurance as string,
      recueil: (rb["recueil_sante"] ?? null) as RecueilSante | null,
    };
  });

export const enregistrerRecueilSante = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      dossier_id: z.string().uuid(),
      reponses: z.record(z.string().max(60), z.string().max(60)),
      ajustements: z.record(z.string().max(40), besoin).default({}),
      terminer: z.boolean().default(false),
      a_revoir: z.boolean().default(false),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { data: d, error } = await context.supabase
      .from("dossiers").select("recueil_besoins").eq("id", data.dossier_id).maybeSingle();
    if (error || !d) throw new Error(error?.message ?? "Dossier introuvable");
    const rb = (d.recueil_besoins ?? {}) as Record<string, unknown>;
    const maintenant = new Date().toISOString();
    const nb = Object.keys(data.reponses).length;
    const recueil: RecueilSante = {
      statut: data.a_revoir ? "a_revoir" : data.terminer ? "termine" : nb === 0 ? "commence" : "en_cours",
      reponses: data.reponses,
      besoins: calculerBesoins(data.reponses),
      ajustements: data.ajustements as RecueilSante["ajustements"],
      regles: { version: REGLES_SANTE.version, calcule_le: maintenant },
      resultats: null,
      maj_le: maintenant,
    };
    const { error: e2 } = await context.supabase
      .from("dossiers")
      .update({ recueil_besoins: { ...rb, recueil_sante: recueil } as never })
      .eq("id", data.dossier_id);
    if (e2) throw new Error(e2.message);
    return recueil;
  });
