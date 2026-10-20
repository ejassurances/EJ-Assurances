import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const analyserCatalogueProduitsCompagnie = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        compagnie_id: z.string().uuid(),
        storage_path: z.string().min(1).max(500),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: roles } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    if (!((roles ?? []) as { role: string }[]).some((item) => item.role === "admin")) {
      throw new Error("L’import du catalogue est réservé aux administrateurs.");
    }

    const { analyserCatalogueProduits } = await import("./produit-catalogue-import.server");
    return analyserCatalogueProduits(context.supabase, data.compagnie_id, data.storage_path);
  });
