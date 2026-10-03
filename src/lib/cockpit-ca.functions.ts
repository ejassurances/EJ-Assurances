/**
 * Lot J — server function du comparatif CA encaissé (lecture seule).
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { CommissionVersee } from "./cockpit-ca";

export const cockpitCaFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { comparatifCa } = await import("./cockpit-ca");

    const { data } = await supabaseAdmin
      .from("commissions")
      .select("statut, date_versement, montant")
      .eq("statut", "versee");

    return comparatifCa((data as CommissionVersee[]) ?? []);
  });
