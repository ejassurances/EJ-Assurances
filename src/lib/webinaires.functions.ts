/**
 * Lot G — server function des statistiques funnel webinaire (lecture seule).
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type FunnelSessionStat = {
  sessionId: string;
  webinaire: string;
  session: string;
  occurrenceAt: string | null;
  cumul: Record<string, number>;
  tauxInscriptionCa: number;
};

export const funnelStatsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<{ etapes: readonly string[]; sessions: FunnelSessionStat[] }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { FUNNEL_ETAPES, compterFunnelCumulatif, tauxConversion } = await import("./webinaires");

    const [{ data: sessions }, { data: parts }] = await Promise.all([
      supabaseAdmin
        .from("webinaire_sessions")
        .select("id, occurrence_at, titre_public, webinaires:webinaire_id(titre)")
        .order("occurrence_at", { ascending: false }),
      supabaseAdmin.from("webinaire_participants").select("session_id, etape_courante"),
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parParticipants = new Map<string, string[]>();
    for (const p of ((parts as any[]) ?? [])) {
      const arr = parParticipants.get(p.session_id) ?? [];
      arr.push(p.etape_courante);
      parParticipants.set(p.session_id, arr);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: FunnelSessionStat[] = ((sessions as any[]) ?? []).map((s) => {
      const cumul = compterFunnelCumulatif(parParticipants.get(s.id) ?? []);
      return {
        sessionId: s.id,
        webinaire: s.webinaires?.titre ?? "—",
        session: s.titre_public ?? "Session",
        occurrenceAt: s.occurrence_at ?? null,
        cumul,
        tauxInscriptionCa: tauxConversion(cumul, "inscription", "ca"),
      };
    });

    return { etapes: FUNNEL_ETAPES, sessions: rows };
  });
