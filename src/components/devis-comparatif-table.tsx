/**
 * Tableau de rapprochement des devis importés (étape « Étude et devis »).
 *
 * Deux lectures dans un seul tableau, une colonne par devis :
 *  1. rapprochement chiffré avec le prêt (coût total, 8 ans, économie, quotité) ;
 *  2. comparatif garantie par garantie sur la grille standardisée de la branche.
 *
 * Source des valeurs de garanties : uniquement les grilles VALIDÉES du CRM
 * (`produit_garanties`). À défaut, la valeur lue sur le devis importé est
 * affichée comme telle, signalée « lu sur le devis, non validé », et jamais
 * consolidée dans le comparatif validé.
 */
import { Fragment, useState } from "react";
import {
  COUVERTURE_LABEL,
  grillePourFamille,
  groupesGrille,
  type ValeursGrille,
} from "@/lib/garanties-grille";

type DevisColonne = {
  id: string;
  produit_id: string | null;
  compagnie_id: string | null;
  source: string;
  assure_rang: number | null;
  quotite_pct: number | null;
  cotisation_mensuelle: number | null;
  montant_total_saisi: number | null;
  type_cotisation: "CI" | "CRD" | null;
  garanties_resume: string | null;
};

const ND = <span className="text-ink-muted">non disponible</span>;

function euro(n: number | null) {
  return n == null ? null : `${Math.round(n).toLocaleString("fr-FR")} €`;
}

export function DevisComparatifTable({
  familleCode = "emprunteur",
  devis,
  nomCompagnie,
  nomProduit,
  grillesProduits,
  coutTotal,
  coutHuitAns,
  economie,
  estRetenu,
  pret,
  labelAssure,
}: {
  familleCode?: string;
  devis: DevisColonne[];
  nomCompagnie: (id: string | null) => string;
  nomProduit: (id: string | null) => string;
  grillesProduits: Record<string, ValeursGrille>;
  coutTotal: (d: DevisColonne) => number | null;
  coutHuitAns: (d: DevisColonne) => number | null;
  economie: (d: DevisColonne) => { economie: number; pourcentage: number } | null;
  estRetenu: (d: DevisColonne) => boolean;
  pret?: { moisRestants: number | null; crd: number | null; coutBanque: number | null };
  labelAssure: (rang: number | null) => string;
}) {
  const grille = grillePourFamille(familleCode);
  const estEmprunteur = familleCode === "emprunteur";
  const [voirToutesGaranties, setVoirToutesGaranties] = useState(false);
  const garantiesPrincipales = new Set(["deces", "ptia", "itt", "ipt", "ipp"]);
  const nbGarantiesDetail = grille ? grille.garanties.filter((g) => !garantiesPrincipales.has(g.code)).length : 0;
  if (devis.length === 0) return null;

  const valeurs = (d: DevisColonne): ValeursGrille | null =>
    (d.produit_id ? grillesProduits[d.produit_id] : null) ?? null;

  /** Cotisation annuelle : total annuel saisi, à défaut 12 × la cotisation mensuelle. */
  const coutAnnuel = (d: DevisColonne): number | null => {
    if (d.montant_total_saisi != null) return Number(d.montant_total_saisi);
    if (d.cotisation_mensuelle != null) return Number(d.cotisation_mensuelle) * 12;
    return null;
  };

  const th = "border-b border-line px-2 py-2 text-left align-bottom";
  const td = "border-b border-line/70 px-2 py-1.5 align-top";
  const lbl = td + " text-ink-muted";

  return (
    <section className="mt-4 rounded-2xl border border-line bg-surface-elevated">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-3">
        <div>
          <h4 className="font-serif text-base text-ink">Rapprochement des devis importés</h4>
          {estEmprunteur && pret ? (
            <p className="text-xs text-ink-muted">
              Prêt : {pret.crd != null ? `capital restant dû ${euro(pret.crd)}` : "capital restant dû non disponible"}
              {" · "}
              {pret.moisRestants ? `${pret.moisRestants} mois restants` : "durée restante non disponible"}
              {" · "}
              {pret.coutBanque != null
                ? `assurance bancaire actuelle ${euro(pret.coutBanque)}`
                : "coût bancaire actuel non disponible"}
            </p>
          ) : (
            <p className="text-xs text-ink-muted">
              {devis.length} devis comparés sur la grille de garanties de la branche du dossier.
            </p>
          )}
        </div>
        <p className="text-[11px] text-ink-soft">
          Garanties issues des grilles validées du CRM. À défaut, la valeur lue sur le devis est signalée.
        </p>
      </header>


      <div className="overflow-x-auto p-4">
        <table className="w-full min-w-[640px] border-collapse text-xs">
          <thead>
            <tr>
              <th className={th + " w-56 text-ink-muted"}>Élément comparé</th>
              {devis.map((d) => (
                <th key={d.id} className={th}>
                  <span className="block font-serif text-sm text-ink">{nomCompagnie(d.compagnie_id)}</span>
                  <span className="block text-[11px] text-ink-soft">{nomProduit(d.produit_id)}</span>
                  <span className="mt-1 block text-[11px] text-ink-muted">{labelAssure(d.assure_rang)}</span>
                  <span className="mt-1 flex flex-wrap gap-1">
                    {estRetenu(d) && (
                      <span className="rounded-full bg-[color:var(--crm-gold)]/20 px-2 py-0.5 text-[10px] text-ink">
                        Retenu
                      </span>
                    )}
                    <span className="rounded-full border border-line px-2 py-0.5 text-[10px] text-ink-muted">
                      {d.source === "pdf" ? "Devis importé" : d.source === "api" ? "Tarif API" : "Saisie manuelle"}
                    </span>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className={lbl}>Cotisation</td>
              {devis.map((d) => (
                <td key={d.id} className={td + " text-ink"}>
                  {d.cotisation_mensuelle != null
                    ? `${Number(d.cotisation_mensuelle).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} € / mois`
                    : ND}
                  {estEmprunteur && d.type_cotisation && (
                    <span className="block text-[11px] text-ink-muted">
                      {d.type_cotisation === "CI" ? "constante (capital initial)" : "dégressive (capital restant dû)"}
                    </span>
                  )}
                </td>
              ))}
            </tr>
            {estEmprunteur ? (
              <>
                <tr>
                  <td className={lbl}>Quotité assurée</td>
                  {devis.map((d) => (
                    <td key={d.id} className={td + " text-ink"}>
                      {d.quotite_pct != null ? `${d.quotite_pct} %` : ND}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className={lbl}>Coût total jusqu'à la fin du prêt</td>
                  {devis.map((d) => (
                    <td key={d.id} className={td + " text-ink"}>
                      {euro(coutTotal(d)) ?? ND}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className={lbl}>Coût sur 8 ans</td>
                  {devis.map((d) => (
                    <td key={d.id} className={td + " text-ink"}>
                      {euro(coutHuitAns(d)) ?? ND}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className={lbl}>Économie face à la banque</td>
                  {devis.map((d) => {
                    const e = economie(d);
                    return (
                      <td key={d.id} className={td + " text-ink"}>
                        {e ? `${euro(e.economie)} (${e.pourcentage} %)` : ND}
                      </td>
                    );
                  })}
                </tr>
              </>
            ) : (
              <tr>
                <td className={lbl}>Cotisation annuelle</td>
                {devis.map((d) => (
                  <td key={d.id} className={td + " text-ink"}>
                    {euro(coutAnnuel(d)) ?? ND}
                  </td>
                ))}
              </tr>
            )}


            {grille ? (
              groupesGrille(grille).map((sec) => {
                const garantiesAffichees =
                  estEmprunteur && !voirToutesGaranties
                    ? sec.garanties.filter((g) => garantiesPrincipales.has(g.code))
                    : sec.garanties;
                if (garantiesAffichees.length === 0) return null;

                return (
                  <Fragment key={sec.groupe ?? "garanties"}>
                    <tr>
                      <td
                        className="border-b border-line bg-surface px-2 py-1.5 font-serif text-[11px] uppercase tracking-wide text-ink-muted"
                        colSpan={devis.length + 1}
                      >
                        {sec.groupe ?? "Garanties"}
                      </td>
                    </tr>
                    {garantiesAffichees.map((g) => (
                      <tr key={g.code}>
                        <td className={lbl}>
                          {g.libelle}
                          {g.obligatoire && (
                            <span className="ml-1 text-[color:var(--crm-gold)]">•</span>
                          )}
                        </td>
                        {devis.map((d) => {
                          const v = valeurs(d)?.[g.code];
                          if (!v) {
                            return (
                              <td key={d.id} className={td}>
                                {ND}
                              </td>
                            );
                          }
                          const detail = [
                            v.plafond ? `plafond ${v.plafond}` : null,
                            v.franchise ? `franchise ${v.franchise}` : null,
                            v.delai_carence ? `carence ${v.delai_carence}` : null,
                          ]
                            .filter(Boolean)
                            .join(" · ");
                          return (
                            <td key={d.id} className={td + " text-ink"}>
                              {COUVERTURE_LABEL[v.couverture]}
                              {detail && (
                                <span className="block text-[11px] text-ink-soft">{detail}</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </Fragment>
                );
              })
            ) : (
              <tr>
                <td className={lbl} colSpan={devis.length + 1}>
                  Aucune grille standardisée pour cette branche : comparatif de garanties non disponible.
                </td>
              </tr>
            )}

            <tr>
              <td className={lbl}>Garanties lues sur le devis</td>
              {devis.map((d) => (
                <td key={d.id} className={td}>
                  {d.garanties_resume ? (
                    <>
                      <span className="whitespace-pre-wrap text-ink-soft">
                        {d.garanties_resume}
                      </span>
                      <span className="mt-1 block rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-800">
                        lu sur le devis, non validé
                      </span>
                    </>
                  ) : (
                    ND
                  )}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
        {estEmprunteur && grille && nbGarantiesDetail > 0 && (
          <button
            type="button"
            onClick={() => setVoirToutesGaranties((value) => !value)}
            className="mt-3 rounded-full border border-line px-3 py-2 text-xs font-medium text-ink hover:bg-surface"
            aria-expanded={voirToutesGaranties}
          >
            {voirToutesGaranties
              ? "Masquer les détails techniques"
              : "Voir les " +
                nbGarantiesDetail +
                " autres critères : franchises, exclusions, options et conditions"}
          </button>
        )}
        {devis.some((d) => !d.produit_id || !grillesProduits[d.produit_id]) && (
          <p className="mt-3 text-[11px] text-ink-muted">
            Les colonnes sans grille validée affichent « non disponible » sur les lignes de garanties :
            seules les valeurs validées dans le CRM sont comparables.
          </p>
        )}
      </div>
    </section>
  );
}
