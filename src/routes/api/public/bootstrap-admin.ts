import { createFileRoute } from "@tanstack/react-router";

// Initial admin bootstrap is intentionally disabled after cabinet initialization.
// Keeping this public endpoint non-operational prevents remote account takeover.
export const Route = createFileRoute("/api/public/bootstrap-admin")({
  server: {
    handlers: {
      POST: async () =>
        Response.json(
          { ok: false, error: "bootstrap_disabled" },
          { status: 410 },
        ),
    },
  },
});
