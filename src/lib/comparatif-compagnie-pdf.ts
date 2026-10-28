import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import {
  COUVERTURE_LABEL,
  grillePourFamille,
  groupesGrille,
  type ValeurGarantie,
} from "@/lib/garanties-grille";

export type ProduitComparatif = {
  id: string;
  familleCode: string | null;
  familleNom: string;
  champsStandards: { code: string; label: string; unit?: string; options?: string[] }[];
  nom: string;
  code_produit: string | null;
  assureur_porteur: string | null;
  description: string | null;
  statut: string;
  caracteristiques: Record<string, unknown>;
  points_forts: string | null;
  points_vigilance: string | null;
  cible: string | null;
};

export type GrilleProduitComparatif = {
  produit_id: string;
  famille_code: string;
  grille_version: number;
  statut: string;
  valide_le: string | null;
  valeurs: Record<string, ValeurGarantie>;
};

export type FormuleComparatif = {
  id: string;
  produit_id: string;
  nom: string;
  ordre: number;
  base_calcul: string;
  tarif_fixe: number | null;
};

export type GrilleFormuleComparatif = {
  formule_id: string;
  grille_version: number;
  statut: string;
  valeurs: Record<string, ValeurGarantie>;
};

type LigneComparatif =
  | { type: "section"; libelle: string }
  | { type: "donnee"; libelle: string; valeur: (produit: ProduitComparatif) => string };

const PAGE = { width: 842, height: 595 };
const MARGE = 28;
const LARGEUR_LIBELLE = 158;
const HAUTEUR_ENTETE_TABLEAU = 38;
const LIMITE_BAS = 72;
const INTERLIGNE = 9.2;
const TAILLE_TEXTE = 7.1;
const NB_LIGNES_FRAGMENT = 12;
const NAVY = rgb(0.039, 0.098, 0.184);
const GOLD = rgb(0.725, 0.608, 0.247);
const GREY = rgb(0.43, 0.46, 0.5);
const LINE = rgb(0.83, 0.85, 0.88);
const LIGHT = rgb(0.96, 0.97, 0.98);
const STATUT_PRODUIT: Record<string, string> = {
  actif: "Actif",
  en_test: "En test",
  retire: "Retiré",
};
const BASE_CALCUL: Record<string, string> = {
  ci: "capital initial",
  crd: "capital restant dû",
  ci_crd: "capital initial ou restant dû",
};

function textePdf(value: unknown): string {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u2022/g, "-")
    .replace(/\u0152/g, "OE")
    .replace(/\u0153/g, "oe")
    .replace(/\u20AC/g, " EUR")
    .replace(/\u00A0/g, " ")
    .replace(/[\u0080-\u009F]/g, "?")
    .replace(/[^\x20-\x7E\u00A0-\u00FF]/g, "?");
}

function couperMot(mot: string, largeur: number, font: PDFFont, taille: number): string[] {
  const morceaux: string[] = [];
  let morceau = "";
  for (const caractere of mot) {
    const prochain = morceau + caractere;
    if (morceau && font.widthOfTextAtSize(prochain, taille) > largeur) {
      morceaux.push(morceau);
      morceau = caractere;
    } else morceau = prochain;
  }
  if (morceau) morceaux.push(morceau);
  return morceaux;
}

function lignesPourTexte(texte: string, largeur: number, font: PDFFont, taille: number): string[] {
  const lignes: string[] = [];
  for (const paragraphe of textePdf(texte || "—").split(/\r?\n/)) {
    const mots = paragraphe.trim().split(/\s+/).filter(Boolean);
    if (mots.length === 0) {
      lignes.push("");
      continue;
    }
    let courante = "";
    for (const mot of mots) {
      const morceaux =
        font.widthOfTextAtSize(mot, taille) <= largeur
          ? [mot]
          : couperMot(mot, largeur, font, taille);
      for (const morceau of morceaux) {
        const candidate = courante ? `${courante} ${morceau}` : morceau;
        if (courante && font.widthOfTextAtSize(candidate, taille) > largeur) {
          lignes.push(courante);
          courante = morceau;
        } else courante = candidate;
      }
    }
    if (courante) lignes.push(courante);
  }
  return lignes.length ? lignes : ["—"];
}

function valeurChamp(
  produit: ProduitComparatif,
  champ: ProduitComparatif["champsStandards"][number],
): string {
  const valeur = produit.caracteristiques?.[champ.code];
  if (valeur === null || valeur === undefined || valeur === "") return "Non renseigné";
  if (typeof valeur === "boolean") return valeur ? "Oui" : "Non";
  if (Array.isArray(valeur))
    return valeur.map((item) => textePdf(item)).join(", ") || "Non renseigné";
  if (typeof valeur === "object") return textePdf(JSON.stringify(valeur));
  const affichage = String(valeur);
  return champ.unit && affichage ? `${affichage} ${champ.unit}` : affichage;
}

function valeurGarantie(valeur: ValeurGarantie | undefined): string {
  if (!valeur) return "Non renseigné";
  const couverture = COUVERTURE_LABEL[valeur.couverture] ?? COUVERTURE_LABEL.inconnu;
  const details = [
    valeur.plafond ? `Plafond : ${valeur.plafond}` : null,
    valeur.franchise ? `Franchise : ${valeur.franchise}` : null,
    valeur.delai_carence ? `Carence : ${valeur.delai_carence}` : null,
    valeur.conditions ? `Conditions : ${valeur.conditions}` : null,
  ].filter(Boolean);
  return [couverture, ...details].join("\n");
}

function estValidee(
  grille: { statut: string; grille_version: number } | null | undefined,
  version: number,
) {
  return grille?.statut === "valide" && grille.grille_version === version;
}

function estGrilleProduitValidee(
  grille: GrilleProduitComparatif | undefined,
  familleCode: string | null,
  version: number,
): grille is GrilleProduitComparatif {
  return Boolean(grille && grille.famille_code === familleCode && estValidee(grille, version));
}

function construireLignes(
  produits: ProduitComparatif[],
  grillesProduit: GrilleProduitComparatif[],
  formules: FormuleComparatif[],
  grillesFormule: GrilleFormuleComparatif[],
): LigneComparatif[] {
  const familleCode = produits[0]?.familleCode ?? null;
  const grille = grillePourFamille(familleCode);
  const grilleParProduit = new Map(grillesProduit.map((item) => [item.produit_id, item]));
  const formulesParProduit = new Map<string, FormuleComparatif[]>();
  const grilleParFormule = new Map(grillesFormule.map((item) => [item.formule_id, item]));

  for (const formule of formules) {
    const liste = formulesParProduit.get(formule.produit_id) ?? [];
    liste.push(formule);
    formulesParProduit.set(formule.produit_id, liste);
  }
  for (const liste of formulesParProduit.values()) liste.sort((a, b) => a.ordre - b.ordre);
  const utiliseFormulesPourGaranties =
    (familleCode === "sante" || familleCode === "emprunteur") &&
    produits.some((produit) => (formulesParProduit.get(produit.id)?.length ?? 0) > 0);

  const lignes: LigneComparatif[] = [
    { type: "section", libelle: "Fiche produit" },
    { type: "donnee", libelle: "Référence", valeur: (p) => p.code_produit || "—" },
    { type: "donnee", libelle: "Assureur porteur", valeur: (p) => p.assureur_porteur || "—" },
    {
      type: "donnee",
      libelle: "Statut",
      valeur: (p) => STATUT_PRODUIT[p.statut] ?? p.statut,
    },
    { type: "donnee", libelle: "Description", valeur: (p) => p.description || "—" },
    { type: "donnee", libelle: "Public visé", valeur: (p) => p.cible || "—" },
    { type: "donnee", libelle: "Points forts", valeur: (p) => p.points_forts || "—" },
    { type: "donnee", libelle: "Points de vigilance", valeur: (p) => p.points_vigilance || "—" },
  ];

  const champs = produits[0]?.champsStandards ?? [];
  if (champs.length > 0) {
    lignes.push({ type: "section", libelle: "Caractéristiques standardisées" });
    for (const champ of champs) {
      lignes.push({
        type: "donnee",
        libelle: champ.label,
        valeur: (p) => valeurChamp(p, champ),
      });
    }
  }

  if (!grille) {
    lignes.push({ type: "section", libelle: "Garanties" });
    lignes.push({
      type: "donnee",
      libelle: "Grille standardisée",
      valeur: () => "Aucune grille définie pour cette famille.",
    });
    return lignes;
  }

  lignes.push({ type: "section", libelle: "Garanties — données validées uniquement" });

  if (formules.length > 0) {
    lignes.push({
      type: "donnee",
      libelle: "Formules actives et tarifs",
      valeur: (produit) => {
        const liste = formulesParProduit.get(produit.id) ?? [];
        if (liste.length === 0) return "Aucune formule active";
        return liste
          .map((formule) => {
            const fg = grilleParFormule.get(formule.id);
            const statut = !grille
              ? "formule active"
              : estValidee(fg, grille.version)
                ? "grille validée"
                : "grille à valider";
            const base =
              formule.base_calcul && formule.base_calcul !== "na"
                ? `; base : ${BASE_CALCUL[formule.base_calcul] ?? formule.base_calcul}`
                : "";
            const tarif =
              formule.tarif_fixe === null
                ? ""
                : `; tarif fixe : ${formule.tarif_fixe.toLocaleString("fr-FR")} EUR/mois`;
            return `${formule.nom} — ${statut}${base}${tarif}`;
          })
          .join("\n");
      },
    });
  }

  if (utiliseFormulesPourGaranties) {
    for (const groupe of groupesGrille(grille)) {
      if (groupe.groupe) lignes.push({ type: "section", libelle: groupe.groupe });
      for (const garantie of groupe.garanties) {
        lignes.push({
          type: "donnee",
          libelle: garantie.libelle,
          valeur: (produit) => {
            const liste = formulesParProduit.get(produit.id) ?? [];
            if (liste.length === 0) {
              if (familleCode === "emprunteur") {
                const gp = grilleParProduit.get(produit.id);
                return estGrilleProduitValidee(gp, familleCode, grille.version)
                  ? `Grille produit : ${valeurGarantie(gp.valeurs[garantie.code])}`
                  : "Aucune formule active ; grille produit à valider";
              }
              return "Aucune formule active";
            }
            return liste
              .map((formule) => {
                const fg = grilleParFormule.get(formule.id);
                if (!fg || !estValidee(fg, grille.version))
                  return `${formule.nom} : grille à valider`;
                return `${formule.nom} : ${valeurGarantie(fg.valeurs[garantie.code])}`;
              })
              .join("\n");
          },
        });
      }
    }
    return lignes;
  }

  lignes.push({
    type: "donnee",
    libelle: "État de la grille",
    valeur: (produit) => {
      const gp = grilleParProduit.get(produit.id);
      if (!gp) return "Non renseignée";
      return estValidee(gp, grille.version) && gp.famille_code === familleCode
        ? "Validée"
        : gp.statut === "a_revoir"
          ? "À revoir"
          : "À valider";
    },
  });

  for (const groupe of groupesGrille(grille)) {
    if (groupe.groupe) lignes.push({ type: "section", libelle: groupe.groupe });
    for (const garantie of groupe.garanties) {
      lignes.push({
        type: "donnee",
        libelle: garantie.libelle,
        valeur: (produit) => {
          const gp = grilleParProduit.get(produit.id);
          if (!estGrilleProduitValidee(gp, familleCode, grille.version)) return "—";
          return valeurGarantie(gp.valeurs[garantie.code]);
        },
      });
    }
  }

  return lignes;
}

function dessinerEntetePage(
  page: PDFPage,
  font: PDFFont,
  bold: PDFFont,
  compagnieNom: string,
  familleNom: string,
  debut: number,
  fin: number,
  total: number,
): number {
  page.drawText("EJ PARTNERS ASSURANCES", {
    x: MARGE,
    y: PAGE.height - 31,
    size: 10,
    font: bold,
    color: NAVY,
  });
  const etiquette = "COMPARATIF INTERNE";
  page.drawText(etiquette, {
    x: PAGE.width - MARGE - font.widthOfTextAtSize(etiquette, 7.5),
    y: PAGE.height - 30,
    size: 7.5,
    font,
    color: GREY,
  });
  page.drawRectangle({
    x: MARGE,
    y: PAGE.height - 44,
    width: PAGE.width - MARGE * 2,
    height: 1.2,
    color: GOLD,
  });
  page.drawText(textePdf(`Comparatif des produits — ${compagnieNom}`), {
    x: MARGE,
    y: PAGE.height - 68,
    size: 14,
    font: bold,
    color: NAVY,
    maxWidth: PAGE.width - MARGE * 2,
  });
  page.drawText(textePdf(`${familleNom} · Produits ${debut + 1} à ${fin} sur ${total}`), {
    x: MARGE,
    y: PAGE.height - 84,
    size: 8,
    font,
    color: GREY,
    maxWidth: PAGE.width - MARGE * 2,
  });
  page.drawText(`Données du ${new Date().toLocaleDateString("fr-FR")}`, {
    x: MARGE,
    y: PAGE.height - 97,
    size: 7,
    font,
    color: GREY,
  });
  return PAGE.height - 112;
}

function dessinerEnteteTableau(
  page: PDFPage,
  produits: ProduitComparatif[],
  top: number,
  font: PDFFont,
  bold: PDFFont,
): number {
  const largeurTotale = PAGE.width - MARGE * 2;
  const largeurProduit = (largeurTotale - LARGEUR_LIBELLE) / produits.length;
  const xCellules = [MARGE, MARGE + LARGEUR_LIBELLE];
  for (let i = 1; i < produits.length; i += 1)
    xCellules.push(MARGE + LARGEUR_LIBELLE + largeurProduit * i);
  const largeurs = [LARGEUR_LIBELLE, ...produits.map(() => largeurProduit)];
  const bas = top - HAUTEUR_ENTETE_TABLEAU;
  for (let i = 0; i < largeurs.length; i += 1) {
    const x = xCellules[i]!;
    const width = largeurs[i]!;
    page.drawRectangle({
      x,
      y: bas,
      width,
      height: HAUTEUR_ENTETE_TABLEAU,
      color: NAVY,
      borderColor: rgb(1, 1, 1),
      borderWidth: 0.4,
    });
    const libelle = i === 0 ? "Critère" : produits[i - 1]!.nom;
    const lignes = lignesPourTexte(libelle, width - 10, bold, i === 0 ? 7.5 : 8);
    lignes.slice(0, 3).forEach((ligne, index) => {
      page.drawText(ligne, {
        x: x + 5,
        y: top - 12 - index * 9,
        size: i === 0 ? 7.5 : 8,
        font: bold,
        color: rgb(1, 1, 1),
      });
    });
  }
  return bas;
}

function fragmentsLigne(
  ligne: LigneComparatif,
  produits: ProduitComparatif[],
  largeurProduit: number,
  font: PDFFont,
  bold: PDFFont,
) {
  if (ligne.type === "section") return [{ type: "section" as const, libelle: ligne.libelle }];
  const libelles = [ligne.libelle, ...produits.map((produit) => ligne.valeur(produit))];
  const largeurs = [LARGEUR_LIBELLE - 12, ...produits.map(() => largeurProduit - 12)];
  const lignes = libelles.map((libelle, index) =>
    lignesPourTexte(libelle, largeurs[index]!, index === 0 ? bold : font, TAILLE_TEXTE),
  );
  const max = Math.max(...lignes.map((items) => items.length));
  const morceaux: { type: "donnee"; cellules: string[][] }[] = [];
  for (let debut = 0; debut < max; debut += NB_LIGNES_FRAGMENT) {
    const cellules = lignes.map((items) => items.slice(debut, debut + NB_LIGNES_FRAGMENT));
    if (debut > 0) cellules[0] = [`${ligne.libelle} (suite)`];
    morceaux.push({ type: "donnee", cellules });
  }
  return morceaux;
}

function dessinerLigne(
  page: PDFPage,
  top: number,
  ligne: { type: "section"; libelle: string } | { type: "donnee"; cellules: string[][] },
  produits: ProduitComparatif[],
  font: PDFFont,
  bold: PDFFont,
  alternance: number,
): number {
  const largeurTotale = PAGE.width - MARGE * 2;
  const largeurProduit = (largeurTotale - LARGEUR_LIBELLE) / produits.length;
  if (ligne.type === "section") {
    const hauteur = 18;
    page.drawRectangle({
      x: MARGE,
      y: top - hauteur,
      width: largeurTotale,
      height: hauteur,
      color: rgb(0.91, 0.93, 0.95),
    });
    page.drawText(textePdf(ligne.libelle), {
      x: MARGE + 6,
      y: top - 12.5,
      size: 7.2,
      font: bold,
      color: NAVY,
    });
    return hauteur;
  }

  const nbLignes = Math.max(1, ...ligne.cellules.map((cellule) => cellule.length));
  const hauteur = nbLignes * INTERLIGNE + 8;
  const fondValeur = alternance % 2 === 0 ? rgb(1, 1, 1) : LIGHT;
  const cellules = [
    { x: MARGE, width: LARGEUR_LIBELLE },
    ...produits.map((_, index) => ({
      x: MARGE + LARGEUR_LIBELLE + largeurProduit * index,
      width: largeurProduit,
    })),
  ];
  cellules.forEach((cellule, index) => {
    page.drawRectangle({
      x: cellule.x,
      y: top - hauteur,
      width: cellule.width,
      height: hauteur,
      color:
        index === 0
          ? alternance % 2 === 0
            ? rgb(0.95, 0.96, 0.97)
            : rgb(0.91, 0.93, 0.95)
          : fondValeur,
      borderColor: LINE,
      borderWidth: 0.35,
    });
    const cellLines = ligne.cellules[index] ?? ["—"];
    cellLines.forEach((texte, lineIndex) => {
      page.drawText(textePdf(texte || " "), {
        x: cellule.x + 6,
        y: top - 7 - TAILLE_TEXTE - lineIndex * INTERLIGNE,
        size: TAILLE_TEXTE,
        font: index === 0 ? bold : font,
        color: index === 0 ? NAVY : rgb(0.16, 0.19, 0.22),
      });
    });
  });
  return hauteur;
}

export async function genererComparatifCompagniePdf(args: {
  compagnieNom: string;
  produits: ProduitComparatif[];
  grillesProduit: GrilleProduitComparatif[];
  formules: FormuleComparatif[];
  grillesFormule: GrilleFormuleComparatif[];
}): Promise<Blob> {
  if (args.produits.length === 0)
    throw new Error("Aucun produit disponible dans le catalogue à comparer.");
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const familles = new Map<string, ProduitComparatif[]>();
  for (const produit of args.produits) {
    const key = produit.familleCode ?? `sans-famille:${produit.familleNom}`;
    const liste = familles.get(key) ?? [];
    liste.push(produit);
    familles.set(key, liste);
  }

  for (const produitsFamille of familles.values()) {
    const familleNom = produitsFamille[0]?.familleNom ?? "Famille non définie";
    const lignes = construireLignes(
      produitsFamille,
      args.grillesProduit,
      args.formules,
      args.grillesFormule,
    );
    for (let debut = 0; debut < produitsFamille.length; debut += 3) {
      const produits = produitsFamille.slice(debut, debut + 3);
      const largeurProduit = (PAGE.width - MARGE * 2 - LARGEUR_LIBELLE) / produits.length;
      let page: PDFPage | null = null;
      let y = 0;
      const nouvellePage = () => {
        page = document.addPage([PAGE.width, PAGE.height]);
        const top = dessinerEntetePage(
          page,
          font,
          bold,
          args.compagnieNom,
          familleNom,
          debut,
          Math.min(debut + produits.length, produitsFamille.length),
          produitsFamille.length,
        );
        y = dessinerEnteteTableau(page, produits, top, font, bold) - 1;
      };
      nouvellePage();
      let alternance = 0;
      for (const ligne of lignes) {
        for (const fragment of fragmentsLigne(ligne, produits, largeurProduit, font, bold)) {
          const hauteur =
            fragment.type === "section"
              ? 18
              : Math.max(1, ...fragment.cellules.map((cellule) => cellule.length)) * INTERLIGNE + 8;
          if (y - hauteur < LIMITE_BAS) {
            nouvellePage();
            alternance = 0;
          }
          const consommee = dessinerLigne(page!, y, fragment, produits, font, bold, alternance);
          y -= consommee;
          if (fragment.type === "donnee") alternance += 1;
        }
      }
    }
  }

  const pages = document.getPages();
  pages.forEach((page, index) => {
    page.drawRectangle({
      x: MARGE,
      y: 48,
      width: PAGE.width - MARGE * 2,
      height: 0.7,
      color: GOLD,
    });
    page.drawText(
      "Document interne établi depuis le catalogue de la compagnie. Les grilles non validées ne sont pas présentées comme acquises ; les documents contractuels en vigueur font foi.",
      {
        x: MARGE,
        y: 34,
        size: 5.8,
        font,
        color: GREY,
        maxWidth: PAGE.width - MARGE * 2 - 45,
      },
    );
    const pagination = `${index + 1}/${pages.length}`;
    page.drawText(pagination, {
      x: PAGE.width - MARGE - font.widthOfTextAtSize(pagination, 6.5),
      y: 34,
      size: 6.5,
      font,
      color: GREY,
    });
  });

  const octets = await document.save();
  const buffer = new ArrayBuffer(octets.byteLength);
  new Uint8Array(buffer).set(octets);
  return new Blob([buffer], { type: "application/pdf" });
}
