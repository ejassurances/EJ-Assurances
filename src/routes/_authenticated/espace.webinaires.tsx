/**
 * Lot G — Webinaires & acquisition : analytics du funnel par session.
 * Lecture seule : inscriptions → présence → clic → … → CA, et taux de conversion.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { IconChartHistogram } from "@tabler/icons-react";

import { PageHeader } from "@/components/page-header";
import { funnelStatsFn, type FunnelSessionStat } from "@/lib/webinaires.functions";
import { FUNNEL_ETAPES, FUNNEL_ETAPE_LABEL, type FunnelEtape } from "@/lib/webinaires";

export const Route = createFileRoute("/_authenticated/espace/webinaires")({
  head: () => ({ meta: [{ title: "Webinaires & acquisition — EJ Partners Assurances" }] }),
  component: WebinairesPage,
});

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

function WebinairesPage() {
  const charger = useServerFn(funnelStatsFn);
  const [sessions, setSessions] = useState<FunnelSessionStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    let annule = false;
    (async () => {
      try {
        const res = (await charger()) as { sessions: FunnelSessionStat[] };
        if (!annule) setSessions(res.sessions);
      } catch (e) {
        if (!annule) setErreur(e instanceof Error ? e.message : String(e));
      } finally {
        if (!annule) setLoading(false);
      }
    })();
    return () => {
      annule = true;
    };
  }, [charger]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Acquisition"
        title="Webinaires & funnel"
        description="Suivi du funnel par session : inscription → présence → clic → formulaire → étude → FIC → signature → contrat → CA."
        icon={IconChartHistogram}
      />

      {loading && <p className="text-sm text-ink-muted">Chargement du funnel…</p>}
      {erreur && (
        <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">Erreur : {erreur}</p>
      )}

      {!loading && !erreur && sessions.length === 0 && (
        <p className="text-sm text-ink-muted">
          Aucune donnée de funnel pour l'instant. Les participants apparaîtront dès que la plateforme
          webinaire / les formulaires enverront les événements (route `/api/public/webhooks/webinaire-funnel`).
        </p>
      )}

      {sessions.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full min-w-[920px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-muted">
                <th className="p-3">Webinaire / session</th>
                {FUNNEL_ETAPES.map((e) => (
                  <th key={e} className="p-3 text-center">{FUNNEL_ETAPE_LABEL[e as FunnelEtape]}</th>
                ))}
                <th className="p-3 text-center">Insc.→CA</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.sessionId} className="border-b border-line/60 last:border-0">
                  <td className="p-3">
                    <p className="font-medium text-ink">{s.webinaire}</p>
                    <p className="text-[11px] text-ink-muted">
                      {s.session}
                      {s.occurrenceAt ? ` · ${new Date(s.occurrenceAt).toLocaleDateString("fr-FR")}` : ""}
                    </p>
                  </td>
                  {FUNNEL_ETAPES.map((e) => (
                    <td key={e} className="p-3 text-center tabular-nums">{s.cumul[e] ?? 0}</td>
                  ))}
                  <td className="p-3 text-center font-medium text-ink">{pct(s.tauxInscriptionCa)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-ink-muted">
        Compte cumulatif : chaque colonne indique le nombre de participants ayant au moins atteint
        l'étape. Lecture seule.
      </p>
    </div>
  );
}
