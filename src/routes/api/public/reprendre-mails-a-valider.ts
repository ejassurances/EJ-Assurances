import { createFileRoute } from "@tanstack/react-router";
import { authorizePublicJob } from "@/lib/public-job-auth";

/**
 * Rattrapage des mails empilés dans « A valider » alors qu'aucune validation
 * humaine n'est réellement attendue (mail de simple suivi, ou transmission de
 * pièces à classer au dossier). Le libellé d'état est retiré : le mail redevient
 * « à traiter » dans la file de son service et les agents le reprennent au
 * passage suivant avec les règles à jour (suivi → archivé, pièces → classées).
 *
 * Aucun mail sensible n'est perdu : un mail qui exige toujours une validation
 * (résiliation, sinistre, réclamation, modification de contrat, brouillon de
 * réponse) est simplement remis en « A valider » par les agents.
 *
 * En-tête attendu : `x-relance-token: <RELANCE_PIECES_TOKEN>` ou
 * `apikey: <clé publiable>`.
 */
export const Route = createFileRoute("/api/public/reprendre-mails-a-valider")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorizePublicJob(request)) return new Response("Unauthorized", { status: 401 });

        const url = new URL(request.url);
        const brut = Number(url.searchParams.get("limite") ?? 50);
        const limite = Number.isFinite(brut) ? Math.min(Math.max(brut, 1), 200) : 50;

        try {
          const { A_VALIDER } = await import("@/lib/gmail-labels");
          const { listerParLabel, retirerEtat } = await import("@/lib/gmail.server");
          const messages = await listerParLabel(A_VALIDER, limite);

          let remisEnFile = 0;
          let erreurs = 0;
          for (const m of messages) {
            try {
              await retirerEtat(m.id);
              remisEnFile += 1;
            } catch (e) {
              erreurs += 1;
              console.error("[reprendre-mails-a-valider] état non retiré", m.id, e);
            }
          }

          return Response.json({ ok: true, examines: messages.length, remis_en_file: remisEnFile, erreurs });
        } catch (e) {
          const message = e instanceof Error ? e.message : "erreur inconnue";
          console.error("[reprendre-mails-a-valider]", e);
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },
  },
});
