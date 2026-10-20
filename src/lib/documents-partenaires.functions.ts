import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/** Lien du dossier Drive d'une branche de compagnie (consultation directe). */
export const dossierDrivePartenaire = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ compagnie: z.string().nullable(), branche: z.string().nullable() }).parse(input),
  )
  .handler(async ({ data }) => {
    const { assurerDossierPartenaire } = await import("@/lib/documents-partenaires.server");
    return await assurerDossierPartenaire(data.compagnie, data.branche);
  });
