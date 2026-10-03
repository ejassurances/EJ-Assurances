import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

/**
 * Lot G — Webhook de remontée des événements Brevo (ouvertures, clics,
 * désinscriptions, bounces…). Brevo reste le moteur d'envoi ; le CRM n'ingère
 * que les événements utiles pour l'analyse d'acquisition.
 *
 * Sécurité : jeton partagé BREVO_WEBHOOK_TOKEN, attendu dans l'en-tête
 * `x-brevo-token` OU en query `?token=` (Brevo permet de configurer l'URL).
 * Idempotence : chaque événement est dédupliqué via event_uid.
 */
const schema = z
  .object({
    event: z.string().min(1),
    email: z.string().email().optional().nullable(),
    "message-id": z.string().optional().nullable(),
    id: z.union([z.string(), z.number()]).optional().nullable(),
    camp_id: z.union([z.string(), z.number()]).optional().nullable(),
    campaign_name: z.string().optional().nullable(),
    ts: z.union([z.string(), z.number()]).optional().nullable(),
    date: z.string().optional().nullable(),
  })
  .passthrough();

export const Route = createFileRoute("/api/public/webhooks/brevo")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env["BREVO_WEBHOOK_TOKEN"];
        if (!expected) return new Response("Webhook non configuré", { status: 503 });

        const url = new URL(request.url);
        const token = request.headers.get("x-brevo-token") ?? url.searchParams.get("token");
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

        const messageId = (p["message-id"] ?? (p.id != null ? String(p.id) : null)) || null;
        const horodatage = p.ts != null ? String(p.ts) : (p.date ?? "");
        const campagne = p.campaign_name ?? (p.camp_id != null ? String(p.camp_id) : null);
        // Identifiant stable de l'événement pour l'idempotence.
        const eventUid = [p.event, messageId ?? p.email ?? "?", horodatage].join(":");

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { enregistrerEvenementBrevo } = await import("@/lib/webinaires.server");

        try {
          const nouveau = await enregistrerEvenementBrevo(supabaseAdmin, {
            event: p.event,
            email: p.email ?? null,
            campagne,
            messageId,
            eventUid,
            payload: p,
          });
          return new Response(JSON.stringify({ ok: true, nouveau }), {
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
