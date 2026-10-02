/**
 * RECUEIL SANTÉ — configuration (questions + règles de normalisation).
 *
 * Séparation des données (stockées dans dossiers.recueil_besoins.recueil_sante) :
 *  A. reponses   : réponses brutes du client, jamais modifiées par le calcul
 *  B. besoins    : besoins normalisés recalculables (faible / modéré / fort, oui / non)
 *  C. regles     : version + pondérations ayant servi au calcul (REGLES_SANTE)
 *  D. resultats  : réservé au futur moteur de comparaison (null à ce stade)
 * Les ajustements manuels de la synthèse sont stockés à part (ajustements).
 */

export type Poste = "soins_courants" | "hospitalisation" | "optique" | "dentaire" | "auditif" | "medecine_douce";
export type Niveau = "faible" | "modere" | "fort";
export type Besoin = Niveau | "oui" | "non";
export type StatutRecueil = "commence" | "en_cours" | "termine" | "a_revoir";

export type OptionQ = { value: string; label: string; aide?: string };
export type QuestionSante = {
  key: string;
  poste: Poste | "general";
  titre: string;
  sousTitre?: string;
  encadre?: string;
  options: OptionQ[];
  /** Affichée uniquement si la condition est remplie. */
  si?: (r: Reponses) => boolean;
};
export type Reponses = Record<string, string>;

export const POSTES: { key: Poste; label: string; binaire?: boolean }[] = [
  { key: "soins_courants", label: "Soins courants" },
  { key: "hospitalisation", label: "Hospitalisation" },
  { key: "optique", label: "Optique" },
  { key: "dentaire", label: "Dentaire" },
  { key: "auditif", label: "Aide auditive" },
  { key: "medecine_douce", label: "Médecine douce", binaire: true },
];

export const QUESTIONS_SANTE: QuestionSante[] = [
  {
    key: "date_souhaitee", poste: "general",
    titre: "À partir de quand souhaitez-vous être couvert ?",
    options: [
      { value: "des_que_possible", label: "Dès que possible" },
      { value: "un_mois", label: "Dans le mois qui vient" },
      { value: "plus_tard", label: "Un peu plus tard, à une date précise" },
      { value: "reflexion", label: "Je ne suis pas encore décidé, je veux d'abord y voir clair" },
    ],
  },
  {
    key: "approche", poste: "general",
    titre: "Comment préférez-vous que l'on avance ?",
    options: [
      { value: "poste_par_poste", label: "Regarder ensemble chaque type de soins", aide: "Quelques questions de plus, une étude plus fine." },
      { value: "essentiel", label: "Aller à l'essentiel", aide: "Nous retiendrons un niveau équilibré, que vous pourrez ajuster." },
    ],
  },
  {
    key: "hosp_etablissement", poste: "hospitalisation",
    titre: "Si vous deviez être hospitalisé, où vous sentiriez-vous le mieux ?",
    encadre: "En clinique privée, certains chirurgiens facturent des dépassements d'honoraires que la Sécurité sociale ne rembourse pas.",
    si: (r) => r["approche"] !== "essentiel",
    options: [
      { value: "public", label: "À l'hôpital public, sans dépassements" },
      { value: "mixte", label: "Public ou privé, avec de légers dépassements" },
      { value: "prive", label: "En clinique privée, même avec des dépassements importants" },
    ],
  },
  {
    key: "hosp_arbitrage", poste: "hospitalisation",
    titre: "Entre une cotisation plus douce et un meilleur remboursement, qu'est-ce qui compte le plus ?",
    si: (r) => r["approche"] !== "essentiel",
    options: [
      { value: "cotisation", label: "Garder une cotisation raisonnable" },
      { value: "equilibre", label: "Un juste milieu" },
      { value: "remboursement", label: "Être bien remboursé, quitte à payer un peu plus" },
    ],
  },
  {
    key: "hosp_chambre", poste: "hospitalisation",
    titre: "Une chambre individuelle est-elle importante pour vous ?",
    si: (r) => r["approche"] !== "essentiel",
    options: [{ value: "oui", label: "Oui, je tiens à mon intimité" }, { value: "non", label: "Non, ce n'est pas une priorité" }],
  },
  {
    key: "soins_specialistes", poste: "soins_courants",
    titre: "Dans votre foyer, comment se passent les rendez-vous médicaux ?",
    si: (r) => r["approche"] !== "essentiel",
    options: [
      { value: "rare", label: "Surtout le médecin traitant, rarement un spécialiste" },
      { value: "parfois", label: "Un spécialiste de temps en temps" },
      { value: "souvent", label: "Des spécialistes régulièrement, parfois avec dépassements" },
    ],
  },
  {
    key: "opt_lunettes", poste: "optique",
    titre: "Portez-vous des lunettes, vous ou un proche à couvrir ?",
    options: [{ value: "oui", label: "Oui" }, { value: "non", label: "Non" }],
  },
  {
    key: "opt_verres", poste: "optique",
    titre: "Quel type de verres ?",
    encadre: "Les verres complexes corrigent les fortes myopies ou la presbytie (verres progressifs).",
    si: (r) => r["opt_lunettes"] === "oui",
    options: [
      { value: "simples", label: "Des verres simples" },
      { value: "complexes", label: "Des verres complexes (progressifs, forte correction)" },
      { value: "tres_complexes", label: "Des verres très complexes" },
    ],
  },
  {
    key: "opt_lentilles", poste: "optique",
    titre: "Utilisez-vous des lentilles ?",
    options: [{ value: "oui", label: "Oui" }, { value: "non", label: "Non" }],
  },
  {
    key: "opt_preference", poste: "optique",
    titre: "Pour vos lunettes, qu'est-ce qui vous ressemble le plus ?",
    si: (r) => r["opt_lunettes"] === "oui" || r["opt_lentilles"] === "oui",
    options: [
      { value: "100_sante", label: "Les montures et verres 100 % Santé me conviennent" },
      { value: "budget", label: "Je choisis ma monture mais garde un budget maîtrisé" },
      { value: "reste_charge", label: "Je veux le moins de reste à charge possible" },
    ],
  },
  {
    key: "opt_chirurgie", poste: "optique",
    titre: "Envisagez-vous une opération des yeux (myopie, laser) ?",
    options: [{ value: "oui", label: "Oui, j'y pense" }, { value: "non", label: "Non" }],
  },
  {
    key: "dent_soins", poste: "dentaire",
    titre: "Côté dentaire, de quoi pensez-vous avoir besoin ?",
    options: [
      { value: "courants", label: "Des soins courants (détartrage, caries)" },
      { value: "specifiques", label: "Aussi des soins plus lourds (couronnes, implants, orthodontie)" },
    ],
  },
  {
    key: "dent_niveau", poste: "dentaire",
    titre: "Pour ces soins plus lourds, quel remboursement souhaitez-vous ?",
    si: (r) => r["dent_soins"] === "specifiques",
    options: [{ value: "base", label: "Un remboursement de base" }, { value: "eleve", label: "Un remboursement élevé" }],
  },
  {
    key: "auditif", poste: "auditif",
    titre: "Et pour l'audition ?",
    options: [
      { value: "aucune", label: "Pas de besoin aujourd'hui" },
      { value: "base", label: "Une prise en charge de base, par précaution" },
      { value: "elevee", label: "Une bonne prise en charge, l'appareillage est envisagé" },
    ],
  },
  {
    key: "medecine_douce", poste: "medecine_douce",
    titre: "Consultez-vous ostéopathe, kiné du sport, acupuncteur… ?",
    options: [{ value: "oui", label: "Oui" }, { value: "non", label: "Non" }],
  },
];

/** C. Règles de normalisation, versionnées. Points par réponse → niveau. */
export const REGLES_SANTE = {
  version: "2026-10-v1",
  seuils: { modere: 2, fort: 4 },
  defautEssentiel: "modere" as Niveau,
  points: {
    hosp_etablissement: { public: 0, mixte: 2, prive: 4 },
    hosp_arbitrage: { cotisation: 0, equilibre: 1, remboursement: 2 },
    hosp_chambre: { oui: 1, non: 0 },
    soins_specialistes: { rare: 0, parfois: 2, souvent: 4 },
    opt_lunettes: { oui: 1, non: 0 },
    opt_verres: { simples: 0, complexes: 2, tres_complexes: 3 },
    opt_lentilles: { oui: 1, non: 0 },
    opt_preference: { "100_sante": 0, budget: 1, reste_charge: 2 },
    opt_chirurgie: { oui: 2, non: 0 },
    dent_soins: { courants: 0, specifiques: 2 },
    dent_niveau: { base: 0, eleve: 2 },
    auditif: { aucune: 0, base: 2, elevee: 4 },
  } as Record<string, Record<string, number>>,
};

export function questionsVisibles(r: Reponses) {
  return QUESTIONS_SANTE.filter((q) => !q.si || q.si(r));
}

/** B. Calcul des besoins normalisés — fonction pure, ne modifie jamais les réponses. */
export function calculerBesoins(r: Reponses, regles = REGLES_SANTE): Record<Poste, Besoin> {
  const visibles = new Set(questionsVisibles(r).map((q) => q.key));
  const total = (poste: Poste) =>
    QUESTIONS_SANTE.filter((q) => q.poste === poste && visibles.has(q.key)).reduce(
      (s, q) => s + (regles.points[q.key]?.[r[q.key] ?? ""] ?? 0), 0);
  const niveau = (p: number): Niveau => (p >= regles.seuils.fort ? "fort" : p >= regles.seuils.modere ? "modere" : "faible");
  const essentiel = r["approche"] === "essentiel";
  return {
    soins_courants: essentiel ? regles.defautEssentiel : niveau(total("soins_courants")),
    hospitalisation: essentiel ? regles.defautEssentiel : niveau(total("hospitalisation")),
    optique: niveau(total("optique")),
    dentaire: niveau(total("dentaire")),
    auditif: niveau(total("auditif")),
    medecine_douce: r["medecine_douce"] === "oui" ? "oui" : "non",
  };
}

export const LABEL_BESOIN: Record<Besoin, string> = {
  faible: "Besoin léger", modere: "Besoin modéré", fort: "Besoin important", oui: "Oui", non: "Non",
};

export const LABEL_STATUT: Record<StatutRecueil, string> = {
  commence: "Commencé", en_cours: "En cours", termine: "Terminé", a_revoir: "À revoir",
};

export type RecueilSante = {
  statut: StatutRecueil;
  reponses: Reponses;
  besoins: Record<Poste, Besoin> | null;
  ajustements: Partial<Record<Poste, Besoin>>;
  regles: { version: string; calcule_le: string } | null;
  resultats: null;
  maj_le: string;
};
