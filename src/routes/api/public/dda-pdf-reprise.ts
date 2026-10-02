import { createFileRoute } from "@tanstack/react-router";
import { authorizePublicJob } from "@/lib/public-job-auth";

/**
 * Reprise automatique des PDF DDA manquants : lettres de mission signées sans
 * PDF archivé (ou sans dépôt Drive abouti) et devoirs de conseil signés/refusés
 * dont le document définitif n'a jamais été généré. Idempotent — appelé chaque
 * nuit par le planificateur avec l'en-tête `apikey` (clé publiable) ou
 * `x-relance-token`.
 */
export const Route = createFileRoute("/api/public/dda-pdf-reprise")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const anon =
          process.env["SUPABASE_PUBLISHABLE_KEY"] || process.env["VITE_SUPABASE_PUBLISHABLE_KEY"] || null;
        if (!(await authorizePublicJob(request))) return new Response("Unauthorized", { status: 401 });

        const { reparerPdfDdaManquants } = await import("@/lib/dda-pdf-repair.server");
        try {
          return Response.json({ ok: true, ...(await reparerPdfDdaManquants()) });
        } catch (e) {
          return Response.json({ error: e instanceof Error ? e.message : "erreur" }, { status: 500 });
        }
      },
    },
  },
});
