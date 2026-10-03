/**
 * Lot J — Cockpit CA : comparatif de l'encaissé (année N vs N-1, mois vs mois-1).
 * Lecture seule. Réutilise la définition d'encaissé des commissions (statut « versee »).
 */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { IconCoins } from "@tabler/icons-react";

import { PageHeader } from "@/components/page-header";
import { cockpitCaFn } from "@/lib/cockpit-ca.functions";
import type { ComparatifCa } from "@/lib/cockpit-ca";

export const Route = createFileRoute("/_authenticated/espace/cockpit-ca")({
  head: () => ({ meta: [{ title: "Cockpit CA — EJ Partners Assurances" }] }),
  component: CockpitCaPage,
});

function euros(n: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n);
}

function Variation({ v }: { v: number | null }) {
  if (v === null) return <span className="text-ink-muted">—</span>;
  const positif = v >= 0;
  return (
    <span className={positif ? "text-emerald-600" : "text-red-600"}>
      {positif ? "▲" : "▼"} {Math.abs(v)} %
    </span>
  );
}

function Carte({ label, value, sub }: { label: string; value: string; sub?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <p className="text-[11px] uppercase tracking-wide text-ink-muted">{label}</p>
      <p className="mt-1 font-serif text-2xl text-ink">{value}</p>
      {sub && <p className="mt-1 text-xs text-ink-muted">{sub}</p>}
    </div>
  );
}

function CockpitCaPage() {
  const charger = useServerFn(cockpitCaFn);
  const [ca, setCa] = useState<ComparatifCa | null>(null);
  const [loading, setLoading] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    let annule = false;
    (async () => {
      try {
        const res = (await charger()) as ComparatifCa;
        if (!annule) setCa(res);
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
        eyebrow="Pilotage"
        title="Cockpit CA"
        description="Comparatif de la commission réellement encaissée : année en cours vs année précédente, mois en cours vs mois précédent."
        icon={IconCoins}
      />

      {loading && <p className="text-sm text-ink-muted">Calcul en cours…</p>}
      {erreur && (
        <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">Erreur : {erreur}</p>
      )}

      {ca && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Carte
              label={`Encaissé ${ca.annee}`}
              value={euros(ca.encaisseAnnee)}
              sub={<>vs {ca.annee - 1} : <Variation v={ca.variationAnnuellePct} /></>}
            />
            <Carte label={`Encaissé ${ca.annee - 1}`} value={euros(ca.encaisseAnneePrecedente)} />
            <Carte
              label="Évolution annuelle"
              value=""
              sub={<span className="text-base"><Variation v={ca.variationAnnuellePct} /></span>}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Carte
              label={`Encaissé ${ca.moisCourant}`}
              value={euros(ca.encaisseMoisCourant)}
              sub={<>vs {ca.moisPrecedent} : <Variation v={ca.variationMensuellePct} /></>}
            />
            <Carte label={`Encaissé ${ca.moisPrecedent}`} value={euros(ca.encaisseMoisPrecedent)} />
            <Carte
              label="Évolution mensuelle"
              value=""
              sub={<span className="text-base"><Variation v={ca.variationMensuellePct} /></span>}
            />
          </div>

          <p className="text-[11px] text-ink-muted">
            « Encaissé » = commissions au statut « versée », regroupées par date de versement. Lecture
            seule. (Les états CA signé / facturé / prévisionnel pluriannuel restent à compléter.)
          </p>
        </>
      )}
    </div>
  );
}
