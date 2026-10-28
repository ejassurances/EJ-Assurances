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

/** Destinations réellement admises par le recueil emprunteur en base. */
export const CORRESPONDANCES_PRET: Partial<Record<ChampImportPret, string>> = {
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

export function fusionnerRecueilPret(
  actuel: Record<string, unknown>,
  entrant: Record<string, unknown>,
) {
  const fusion = { ...entrant };
  for (const [cle, valeur] of Object.entries(actuel)) {
    if (valeur != null && valeur !== "" && !(Array.isArray(valeur) && valeur.length === 0))
      fusion[cle] = valeur;
  }
  return fusion;
}

/** Même représentation pour la confirmation serveur et la réouverture. */
export function preparerConfirmationPret(
  dossier: {
    recueil_besoins: unknown;
    analyse_ia: unknown;
    capital: number | null;
    duree_mois: number | null;
  },
  valeurs: LecturePret["valeurs"],
  lectures: LecturePret[],
  confirmation: { confirme_par: string; confirme_le: string },
) {
  const objet = (v: unknown): Record<string, unknown> =>
    v && typeof v === "object" && !Array.isArray(v) ? { ...v } : {};
  const base = objet(dossier.recueil_besoins);
  // Les colonnes connues priment aussi lorsqu'un ancien recueil est vide.
  if (base["capital"] == null || base["capital"] === "") base["capital"] = dossier.capital;
  if (base["duree_mois"] == null || base["duree_mois"] === "") base["duree_mois"] = dossier.duree_mois;
  const recueil = appliquerValeursPret(base, valeurs);
  const audit = objet(dossier.analyse_ia);
  const precedents = Array.isArray(audit["imports_pret_verifies"]) ? audit["imports_pret_verifies"] : [];
  const nombre = (v: unknown) => {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  return {
    recueil_besoins: recueil,
    capital: dossier.capital ?? nombre(recueil["capital"]),
    duree_mois: dossier.duree_mois ?? nombre(recueil["duree_mois"]),
    analyse_ia: {
      ...audit,
      imports_pret_verifies: [...precedents, {
        ...confirmation,
        valeurs: filtrerValeursPret(valeurs),
        lectures: lectures.map((l) => ({ ...l, valeurs: filtrerValeursPret(l.valeurs) })),
      }],
    },
  };
}

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
  const recueil = { ...base };
  for (const [cle, valeur] of Object.entries(filtrerValeursPret(valeurs))) {
    const destination = CORRESPONDANCES_PRET[cle as ChampImportPret];
    if (destination && (recueil[destination] == null || recueil[destination] === ""))
      recueil[destination] = valeur;
  }
  return recueil;
}
