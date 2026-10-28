/** Seuls les champs financiers explicitement visibles sont admis. */
export const CHAMPS_IMPORT_PRET = {
  banque: "Banque",
  montant_capital: "Capital emprunté (€)",
  duree_mois: "Durée totale (mois)",
  taux_nominal: "Taux nominal (%)",
  mensualite: "Mensualité hors assurance (€)",
  taux_assurance: "Taux assurance groupe (%)",
  cotisation_assurance_mensuelle: "Assurance groupe mensuelle (€)",
  cout_assurance_total: "Coût total assurance groupe (€)",
  date_premiere_echeance: "Première échéance",
  date_edition_document: "Date du document",
  capital_restant_du: "Capital restant dû écrit (€)",
  date_capital_restant_du: "Date du capital restant dû",
  date_fin_pret: "Fin du prêt",
  cout_total_pret: "Coût total du prêt (€)",
  objet_pret: "Objet du prêt",
} as const;

export type ChampImportPret = keyof typeof CHAMPS_IMPORT_PRET;
export type LecturePret = {
  source: string;
  nature: "offre_pret" | "tableau_amortissement";
  confiance: number;
  valeurs: Partial<Record<ChampImportPret, string | number>>;
  erreur?: string;
};

export function filtrerValeursPret(brut: Record<string, unknown>): LecturePret["valeurs"] {
  const valeurs: LecturePret["valeurs"] = {};
  const nombres = new Set([
    "montant_capital",
    "duree_mois",
    "taux_nominal",
    "mensualite",
    "taux_assurance",
    "cotisation_assurance_mensuelle",
    "cout_assurance_total",
    "capital_restant_du",
    "cout_total_pret",
  ]);
  for (const cle of Object.keys(CHAMPS_IMPORT_PRET) as ChampImportPret[]) {
    const v = brut[cle];
    if (nombres.has(cle)) {
      if (v == null || v === "") continue;
      const n = typeof v === "number" ? v : Number(String(v).replace(/\s/g, "").replace(",", "."));
      if (Number.isFinite(n) && n >= 0 && (cle !== "duree_mois" || Number.isInteger(n)))
        valeurs[cle] = n;
    } else if (typeof v === "string" && v.trim()) {
      const s = v.trim();
      if (cle.startsWith("date_")) {
        if (
          /^\d{4}-\d{2}-\d{2}$/.test(s) &&
          !Number.isNaN(Date.parse(s)) &&
          new Date(s).toISOString().slice(0, 10) === s
        )
          valeurs[cle] = s;
      } else valeurs[cle] = s.slice(0, 200);
    }
  }
  return valeurs;
}

export function croiserLecturesPret(lectures: LecturePret[]) {
  const valeurs: LecturePret["valeurs"] = {};
  const contradictions: ChampImportPret[] = [];
  const provenance: Partial<
    Record<ChampImportPret, { source: string; confiance: number; valeur: string | number }[]>
  > = {};
  for (const lecture of lectures) {
    for (const [cle, valeur] of Object.entries(filtrerValeursPret(lecture.valeurs))) {
      const champ = cle as ChampImportPret;
      const sources = provenance[champ] ?? [];
      sources.push({ source: lecture.source, confiance: lecture.confiance, valeur });
      provenance[champ] = sources;
    }
  }
  for (const cle of Object.keys(provenance) as ChampImportPret[]) {
    const sources = provenance[cle] ?? [];
    const uniques = new Set(sources.map((s) => String(s.valeur).trim().toLowerCase()));
    if (uniques.size > 1) contradictions.push(cle);
    else if (sources[0]) valeurs[cle] = sources[0].valeur;
  }
  return { valeurs, contradictions, provenance };
}

/** Aucun calcul dérivé, aucune identité ni donnée de santé ; complète seulement les vides. */
export function appliquerValeursPret(
  base: Record<string, unknown>,
  valeurs: LecturePret["valeurs"],
) {
  const correspondances: Partial<Record<ChampImportPret, string>> = {
    banque: "banque",
    montant_capital: "capital",
    duree_mois: "duree_mois",
    taux_nominal: "taux_pret",
    date_premiere_echeance: "date_premiere_echeance",
    taux_assurance: "taux_assurance_banque",
    cotisation_assurance_mensuelle: "assurance_banque_mensuelle",
    cout_assurance_total: "assurance_banque_cout_total",
    capital_restant_du: "capital_restant_du",
    objet_pret: "objet_pret",
  };
  const recueil = { ...base };
  for (const [cle, valeur] of Object.entries(filtrerValeursPret(valeurs))) {
    const destination = correspondances[cle as ChampImportPret];
    if (destination && (recueil[destination] == null || recueil[destination] === ""))
      recueil[destination] = valeur;
  }
  return recueil;
}
