import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assurerChemin,
  telechargerFichier,
  urlDossierDrive,
} from "@/lib/google-drive.server";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Client = SupabaseClient<any, any, any>;

/** Les nouveaux PDF produit sont stockés dans le bucket privé Supabase. */

/**
 * Dossier Drive officiel des conditions générales / notices compagnies :
 * https://drive.google.com/drive/folders/108XLOGY9ARGIHHQ2_fxxDqrD4_swCP9W
 * Les documents y sont rangés par Compagnie puis par Branche.
 */
export const DRIVE_DOSSIER_CG_ID = "108XLOGY9ARGIHHQ2_fxxDqrD4_swCP9W";

function segment(valeur: string | null | undefined, defaut: string) {
  const nettoye = (valeur ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\\/]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return nettoye || defaut;
}

/** Chemin Drive normalisé d'une branche d'une compagnie. */
export function cheminDrivePartenaire(compagnie: string | null, branche: string | null) {
  return [segment(compagnie, "Compagnie_inconnue"), segment(branche, "Divers")];
}

/** Crée (ou retrouve) le dossier Drive d'une branche de compagnie, sous le dossier CG officiel. */
export async function assurerDossierPartenaire(compagnie: string | null, branche: string | null) {
  const chemin = cheminDrivePartenaire(compagnie, branche);
  const folderId = await assurerChemin(chemin, DRIVE_DOSSIER_CG_ID);
  return { folder_id: folderId, chemin: chemin.join("/"), url: urlDossierDrive(folderId) };
}

/** Extrait l'identifiant Drive d'une URL de partage (/file/d/<id>/… ou ?id=<id>). */
export function idFichierDepuisUrlDrive(url: string | null | undefined): string | null {
  if (!url) return null;
  const m =
    url.match(/\/(?:file|d)\/(?:d\/)?([A-Za-z0-9_-]{10,})/) ??
    url.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  return m?.[1] ?? null;
}

/**
 * Contenu binaire d'un document produit, quelle que soit sa source :
 * Supabase Storage (nouveaux dépôts) ou Google Drive (documents historiques).
 */
export async function contenuDocumentProduit(
  supabase: Client,
  doc: {
    nom?: string | null;
    storage_path?: string | null;
    drive_file_id?: string | null;
    drive_url?: string | null;
  },
): Promise<Buffer> {
  // Les anciens documents Drive restent lisibles à partir de leur identifiant ou URL.
  const fileId = doc.drive_file_id ?? idFichierDepuisUrlDrive(doc.drive_url);
  if (fileId) {
    const bytes = await telechargerFichier(fileId);
    return Buffer.from(bytes);
  }
  if (!doc.storage_path) {
    throw new Error(`Aucun fichier rattaché : ${doc.nom ?? "document"}`);
  }
  const { data: blob, error } = await supabase.storage
    .from("produits-documents")
    .download(doc.storage_path);
  if (error || !blob) throw new Error(`Téléchargement impossible : ${doc.nom ?? "document"}`);
  return Buffer.from(await blob.arrayBuffer());
}
