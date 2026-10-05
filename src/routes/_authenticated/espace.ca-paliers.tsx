/**
 * Lot 5 — CA prévisionnel par paliers : zone sécurisée (vert, 100 %) vs zone
 * probabilisée (orange, 70 %), par année, jusqu'à la dernière échéance connue.
 * Lecture seule. Couvre toutes les familles : emprunteur & AV/épargne (8 ans)
 * et tacite reconduction (base 1 an, extensible quand les reconductions seront
 * enregistrées).
 */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { IconChartAreaLine } from "@tabler/icons-react";

import { PageHeader } from "@/components/page-header";
import { caPaliersFn } from "@/lib/ca-paliers.functions";
import type { LignePalierAnnee } from "@/lib/ca-paliers";

export const Route = createFileRoute("/_authenticated/espace/ca-paliers")({
  head: () => ({ meta: [{ title: "CA prévisionnel — paliers — EJ Partners Assurances" }] }),
  component: CaPaliersPage,
});

type Donnees = {
  lignes: LignePalierAnnee[];
  totaux: { securise: number; probabilise: number; total: number };
  nbContratsReconductionBase: number;
};

function euros(n: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(n);
}

function Carte({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <p className="text-[11px] uppercase tracking-wide text-ink-muted">{label}</p>
      <p className={"mt-1 font-serif text-2xl " + (accent ?? "text-ink")}>{value}</p>
    </div>
  );
}

function CaPaliersPage() {
  const charger = useServerFn(caPaliersFn);
  const [d, setD] = useState<Donnees | null>(null);
  const [loading, setLoading] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    let annule = false;
    (async () => {
      try {
        const res = (await charger()) as Donnees;
        if (!annule) setD(res);
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

  const maxTotal = d ? Math.max(1, ...d.lignes.map((l) => l.total)) : 1;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Pilotage"
        title="CA prévisionnel — paliers"
        description="CA sécurisé (vert, 100 %) et CA probabilisé (orange, 70 %), par année, jusqu'à la fin du contrat le plus lointain."
        icon={IconChartAreaLine}
      />

      {loading && <p className="text-sm text-ink-muted">Calcul en cours…</p>}
      {erreur && (
        <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          Erreur : {erreur}
        </p>
      )}

      {d && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Carte
              label="CA sécurisé (vert)"
              value={euros(d.totaux.securise)}
              accent="text-emerald-600"
            />
            <Carte
              label="CA probabilisé (orange, ×0,7)"
              value={euros(d.totaux.probabilise)}
              accent="text-amber-600"
            />
            <Carte label="Total prévisionnel" value={euros(d.totaux.total)} />
          </div>

          <div className="flex items-center gap-4 text-xs text-ink-muted">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm bg-emerald-500" /> Sécurisé 100 %
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm bg-amber-500" /> Probabilisé 70 %
            </span>
          </div>

          {d.lignes.length === 0 ? (
            <p className="rounded-lg border border-line bg-surface p-4 text-sm text-ink-muted">
              Aucune échéance exploitable pour l'instant (contrats emprunteur / AV sans échéancier
              chiffré).
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-line bg-surface">
              <table className="w-full text-sm">
                <thead className="border-b border-line bg-background/50 text-left text-xs uppercase tracking-wide text-ink-muted">
                  <tr>
                    <th className="px-4 py-2">Année</th>
                    <th className="px-4 py-2">Répartition</th>
                    <th className="px-4 py-2 text-right">Sécurisé</th>
                    <th className="px-4 py-2 text-right">Probabilisé</th>
                    <th className="px-4 py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {d.lignes.map((l) => (
                    <tr key={l.annee} className="border-b border-line last:border-0">
                      <td className="px-4 py-2 font-medium text-ink">{l.annee}</td>
                      <td className="px-4 py-2">
                        <div
                          className="flex h-4 w-full overflow-hidden rounded-sm bg-background"
                          title={`${euros(l.securise)} sécurisé · ${euros(l.probabilise)} probabilisé`}
                        >
                          <div
                            className="h-full bg-emerald-500"
                            style={{ width: `${(l.securise / maxTotal) * 100}%` }}
                          />
                          <div
                            className="h-full bg-amber-500"
                            style={{ width: `${(l.probabilise / maxTotal) * 100}%` }}
                          />
                        </div>
                      </td>
                      <td className="px-4 py-2 text-right text-emerald-700">{euros(l.securise)}</td>
                      <td className="px-4 py-2 text-right text-amber-700">
                        {euros(l.probabilise)}
                      </td>
                      <td className="px-4 py-2 text-right font-medium">{euros(l.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {d.nbContratsReconductionBase > 0 && (
            <p className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
              {d.nbContratsReconductionBase} contrat(s) à tacite reconduction (santé, prévoyance,
              MRH, auto…) sont projetés avec la règle de base : 1ʳᵉ année sécurisée, puis
              probabilisé. Leur zone verte s'étendra automatiquement dès que les reconductions
              seront enregistrées (brique « événements de contrat » à mettre en place).
            </p>
          )}

          <p className="text-[11px] text-ink-muted">
            Règle (Notion « CRM Assurance ») : emprunteur & assurance-vie/épargne — 8 premières
            années sécurisées (100 %) ; tacite reconduction — 1ʳᵉ année sécurisée tant qu'aucune
            reconduction n'est enregistrée ; au-delà, probabilisé à 70 %. Lecture seule.
          </p>
        </>
      )}
    </div>
  );
}
