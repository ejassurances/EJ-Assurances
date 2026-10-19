import { createFileRoute } from "@tanstack/react-router";

/** Ancien endpoint de prévisualisation d'e-mail, désormais désactivé. */
export const Route = createFileRoute("/lovable/email/auth/preview")({
  server: {
    handlers: {
      POST: () => new Response(null, { status: 404 }),
    },
  },
});
