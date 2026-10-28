/**
 * Import d'un client déjà en portefeuille depuis une attestation / un certificat.
 * Helpers purs (testés) : nom de fichier de stockage et chemin compatible avec
 * la règle d'accès du stockage `dossier-documents`, qui contrôle
 * can_access_dossier(1er segment) — le 1er segment doit donc être l'id du DOSSIER.
 */

export const TAILLE_MAX_PIECE = 10 * 1024 * 1024;

export type CodePieceImport = "attestation" | "cni" | "justificatif_domicile" | "rib";

/** Pièces KYC obligatoires du parcours, stockées dans client_kyc_documents. */
export const PIECES_KYC_IMPORT = [
  { code: "cni", libelle: "Pièce d'identité (CNI ou passeport)" },
  { code: "justificatif_domicile", libelle: "Justificatif de domicile (moins de 3 mois)" },
  { code: "rib", libelle: "RIB" },
] as const;

/** Clé de stockage ASCII sûre : accents retirés, caractères spéciaux remplacés. */
export function nomFichierStockage(nom: string): string {
  const base = nom
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_.]+|_+$/g, "")
    .slice(0, 120);
  return base || "document";
}

export function cheminPieceImport(
  dossierId: string,
  code: CodePieceImport,
  nomOriginal: string,
  horodatage: number = Date.now(),
): string {
  return `${dossierId}/import-portefeuille/${code}-${horodatage}-${nomFichierStockage(nomOriginal)}`;
}

export type ChampsAttestation = {
  civilite: string | null;
  prenom: string | null;
  nom: string | null;
  date_naissance: string | null;
  email: string | null;
  mobile: string | null;
  adresse: string | null;
  code_postal: string | null;
  ville: string | null;
  assureur: string | null;
  produit: string | null;
  numero_contrat: string | null;
  date_effet: string | null;
  date_fin: string | null;
  cotisation_mensuelle: number | null;
  branche_suggeree: string | null;
};

const CLES_TEXTE = [
  "civilite", "prenom", "nom", "date_naissance", "email", "mobile", "adresse",
  "code_postal", "ville", "assureur", "produit", "numero_contrat", "date_effet",
  "date_fin", "branche_suggeree",
] as const;

/** Normalise la réponse IA : rien d'inventé, absent => null, dates ISO uniquement. */
export function normaliserChampsAttestation(brut: Record<string, unknown>): ChampsAttestation {
  const out = {} as Record<string, unknown>;
  for (const k of CLES_TEXTE) {
    const v = brut[k];
    out[k] = typeof v === "string" && v.trim() ? v.trim() : null;
  }
  for (const k of ["date_naissance", "date_effet", "date_fin"]) {
    if (out[k] && !/^\d{4}-\d{2}-\d{2}$/.test(out[k] as string)) out[k] = null;
  }
  const c = brut["cotisation_mensuelle"];
  const n = typeof c === "number" ? c : typeof c === "string" ? Number(c.replace(",", ".")) : NaN;
  out["cotisation_mensuelle"] = Number.isFinite(n) ? n : null;
  return out as ChampsAttestation;
}
