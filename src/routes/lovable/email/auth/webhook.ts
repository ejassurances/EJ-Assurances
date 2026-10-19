import { createFileRoute } from "@tanstack/react-router";

/** Ancien endpoint d'e-mail désactivé ; conservé pour répondre 404 aux appels hérités. */
export const Route = createFileRoute("/lovable/email/auth/webhook")({
  server: {
    handlers: {
      POST: () => new Response(null, { status: 404 }),
    },
  },
});
