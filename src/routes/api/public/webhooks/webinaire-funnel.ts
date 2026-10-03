import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

/**
 * Lot G — Alimentation du funnel webinaire depuis la plateforme webinaire et les
 * formulaires : inscription, présence, formulaire commencé/terminé, etc.
 * Sécurité : jeton partagé WEBINAIRE_WEBHOOK_TOKEN (header `x-webinaire-token`
 * ou query `?token=`). Idempotent (upsert participant sur session_id + email ;
 * l'étape n'avance que vers l'avant).
 */
const schema = z.object({
  sessionId: z.string().uuid(),
  email: z.string().email(),
  etape: z.enum([
    "inscription",
    "presence",
    "clic",
    "formulaire_debut",
    "formulaire_fin",
    "etude",
    "fic",
    "signature",
    "contrat",
    "ca",
  ]),
  nom: z.string().trim().max(160).optional().nullable(),
  telephone: z.string().trim().max(40).optional().nullable(),
  source: z.string().trim().max(120).optional().nullable(),
  audience: z.string().trim().max(120).optional().nullable(),
  campagneId: z.string().trim().max(120).optional().nullable(),
});

export const Route = createFileRoute("/api/public/webhooks/webinaire-funnel")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env["WEBINAIRE_WEBHOOK_TOKEN"];
        if (!expected) return new Response("Webhook non configuré", { status: 503 });

        const url = new URL(request.url);
        const token = request.headers.get("x-webinaire-token") ?? url.searchParams.get("token");
        if (token !== expected) return new Response("Unauthorized", { status: 401 });

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return new Response("JSON invalide", { status: 400 });
        }
        const parsed = schema.safeParse(body);
        if (!parsed.success) {
          return new Response(JSON.stringify({ error: parsed.error.flatten() }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
        const p = parsed.data;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { enregistrerEtapeFunnel } = await import("@/lib/webinaires.server");

        try {
          const res = await enregistrerEtapeFunnel(supabaseAdmin, p);
          if (!res.ok) return new Response("Étape invalide", { status: 400 });
          return new Response(JSON.stringify({ ok: true, participant_id: res.participantId }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        } catch (err) {
          return new Response(err instanceof Error ? err.message : "Erreur", { status: 500 });
        }
      },
    },
  },
});
