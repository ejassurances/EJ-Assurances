/**
 * Accès direct à l'API Google Drive via OAuth (serveur uniquement).
 */

const DRIVE_API_URL = "https://www.googleapis.com";
const FOLDER_MIME = "application/vnd.google-apps.folder";

async function headers() {
  const { obtenirJetonGoogle } = await import("@/lib/google-oauth.server");
  return {
    Authorization: `Bearer ${await obtenirJetonGoogle()}`,
  };
}

async function driveFetch(path: string, init?: RequestInit & { json?: unknown }) {
  const { json, ...rest } = init ?? {};
  const res = await fetch(`${DRIVE_API_URL}${path}`, {
    ...rest,
    headers: {
      ...(await headers()),
      ...(json ? { "Content-Type": "application/json" } : {}),
      ...(rest.headers as Record<string, string> | undefined),
    },
    body: json ? JSON.stringify(json) : rest.body,
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`[drive] ${path} → ${res.status} ${text.slice(0, 500)}`);
    throw new Error(`Google Drive ${res.status} : ${text.slice(0, 300)}`);
  }
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

function escapeQuery(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/** Recherche un dossier par nom dans un parent donné (racine par défaut). */
export async function trouverDossier(nom: string, parentId?: string | null): Promise<string | null> {
  const clauses = [
    `mimeType='${FOLDER_MIME}'`,
    `name='${escapeQuery(nom)}'`,
    "trashed=false",
    `'${parentId ?? "root"}' in parents`,
  ];
  const params = new URLSearchParams({
    q: clauses.join(" and "),
    fields: "files(id,name)",
    pageSize: "10",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  const data = (await driveFetch(`/drive/v3/files?${params}`)) as { files?: { id: string }[] };
  return data.files?.[0]?.id ?? null;
}

/** Retourne l'ID du dossier, en le créant s'il n'existe pas encore. */
export async function assurerDossier(nom: string, parentId?: string | null): Promise<string> {
  const existant = await trouverDossier(nom, parentId);
  if (existant) return existant;
  const cree = (await driveFetch("/drive/v3/files?supportsAllDrives=true&fields=id", {
    method: "POST",
    json: { name: nom, mimeType: FOLDER_MIME, parents: [parentId ?? "root"] },
  })) as { id: string };
  return cree.id;
}

/** Crée (ou retrouve) une arborescence complète et renvoie l'ID du dernier niveau. */
export async function assurerChemin(segments: string[], parentId?: string | null): Promise<string> {
  let courant = parentId ?? "root";
  for (const segment of segments) {
    courant = await assurerDossier(segment, courant);
  }
  return courant;
}

/** Nom actuel d'un dossier/fichier Drive (null si introuvable). */
export async function nomDrive(fileId: string): Promise<string | null> {
  try {
    const data = (await driveFetch(
      `/drive/v3/files/${fileId}?fields=name&supportsAllDrives=true`,
    )) as { name?: string };
    return data.name ?? null;
  } catch {
    return null;
  }
}

/** Renomme un dossier/fichier Drive. */
export async function renommerDrive(fileId: string, nom: string): Promise<void> {
  await driveFetch(`/drive/v3/files/${fileId}?supportsAllDrives=true&fields=id`, {
    method: "PATCH",
    json: { name: nom },
  });
}

export function urlDossierDrive(folderId: string) {
  return `https://drive.google.com/drive/folders/${folderId}`;
}


function toBase64(bytes: Uint8Array) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Dépose un fichier binaire (PDF) dans un dossier Drive.
 * Le contenu est envoyé en multipart/related (upload simple).
 */
export async function deposerFichier(params: {
  folderId: string;
  nom: string;
  contenu: Uint8Array;
  mimeType?: string;
}): Promise<{ id: string; webViewLink: string | null }> {
  const boundary = `ejp-${crypto.randomUUID()}`;
  const mime = params.mimeType ?? "application/pdf";
  const metadata = JSON.stringify({ name: params.nom, parents: [params.folderId] });
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
    `--${boundary}\r\nContent-Type: ${mime}\r\nContent-Transfer-Encoding: base64\r\n\r\n` +
    `${toBase64(params.contenu)}\r\n--${boundary}--\r\n`;

  const res = await fetch(
    `${DRIVE_API_URL}/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink`,
    {
      method: "POST",
      headers: { ...(await headers()), "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    },
  );
  const text = await res.text();
  if (!res.ok) {
    console.error(`[drive] upload ${params.nom} → ${res.status} ${text.slice(0, 500)}`);
    throw new Error(`Google Drive upload ${res.status} : ${text.slice(0, 300)}`);
  }
  const data = JSON.parse(text) as { id: string; webViewLink?: string };
  return { id: data.id, webViewLink: data.webViewLink ?? null };
}

/** Télécharge le contenu binaire d'un fichier Drive (analyse IA, archivage). */
export async function telechargerFichier(fileId: string): Promise<Uint8Array> {
  const res = await fetch(
    `${DRIVE_API_URL}/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
    { headers: await headers() },
  );
  if (!res.ok) {
    const text = await res.text();
    console.error(`[drive] download ${fileId} → ${res.status} ${text.slice(0, 300)}`);
    throw new Error(`Google Drive download ${res.status}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

/** Lien de consultation directe d'un fichier Drive. */
export function urlFichierDrive(fileId: string) {
  return `https://drive.google.com/file/d/${fileId}/view`;
}

/** Liste les enfants directs d'un dossier Drive (dossiers et fichiers). */
export async function listerEnfantsDrive(
  parentId: string,
): Promise<{ id: string; name: string; mimeType: string }[]> {
  const resultats: { id: string; name: string; mimeType: string }[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      q: `'${escapeQuery(parentId)}' in parents and trashed=false`,
      fields: "nextPageToken, files(id,name,mimeType)",
      pageSize: "200",
      orderBy: "name",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const data = (await driveFetch(`/drive/v3/files?${params}`)) as {
      files?: { id: string; name: string; mimeType: string }[];
      nextPageToken?: string;
    };
    resultats.push(...(data.files ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return resultats;
}

/** Vrai si l'élément Drive est un dossier. */
export function estDossierDrive(mimeType: string) {
  return mimeType === FOLDER_MIME;
}

/** Recherche un fichier (non dossier) par nom exact dans un dossier parent. */
export async function trouverFichier(nom: string, parentId: string): Promise<string | null> {
  const params = new URLSearchParams({
    q: [
      `name='${escapeQuery(nom)}'`,
      `mimeType!='${FOLDER_MIME}'`,
      "trashed=false",
      `'${escapeQuery(parentId)}' in parents`,
    ].join(" and "),
    fields: "files(id,name)",
    pageSize: "10",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  const data = (await driveFetch(`/drive/v3/files?${params}`)) as { files?: { id: string }[] };
  return data.files?.[0]?.id ?? null;
}

const GDOC_MIME = "application/vnd.google-apps.document";

/** Recherche récursive d'un fichier par nom exact dans un dossier et ses sous-dossiers. */
export async function trouverFichierRecursif(
  nom: string,
  parentId: string,
  profondeurMax = 3,
): Promise<{ id: string; name: string; mimeType: string } | null> {
  const enfants = await listerEnfantsDrive(parentId);
  const direct = enfants.find((e) => !estDossierDrive(e.mimeType) && e.name === nom);
  if (direct) return direct;
  if (profondeurMax <= 0) return null;
  for (const dossier of enfants.filter((e) => estDossierDrive(e.mimeType))) {
    const trouve = await trouverFichierRecursif(nom, dossier.id, profondeurMax - 1);
    if (trouve) return trouve;
  }
  return null;
}

/**
 * Recherche d'un fichier par nom exact dans tout le Drive accessible
 * (utile quand le cabinet déplace/recrée un document ailleurs).
 */
export async function trouverFichierParNomGlobal(
  nom: string,
): Promise<{ id: string; name: string; mimeType: string } | null> {
  const params = new URLSearchParams({
    q: [`name='${escapeQuery(nom)}'`, "trashed=false"].join(" and "),
    fields: "files(id,name,mimeType,modifiedTime)",
    pageSize: "10",
    orderBy: "modifiedTime desc",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  const data = (await driveFetch(`/drive/v3/files?${params}`)) as {
    files?: { id: string; name: string; mimeType: string }[];
  };
  const fichiers = (data.files ?? []).filter((f) => f.mimeType !== FOLDER_MIME);
  return fichiers[0] ?? null;
}


/**
 * Contenu texte d'un fichier Drive, qu'il s'agisse d'un fichier texte brut ou
 * d'un Google Doc natif (exporté en text/plain).
 */
export async function lireTexteFichier(fileId: string, mimeType?: string): Promise<string> {
  const mime = mimeType ?? (await mimeDrive(fileId));
  if (mime === GDOC_MIME) {
    const res = await fetch(
      `${DRIVE_API_URL}/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=text%2Fplain&supportsAllDrives=true`,
      { headers: await headers() },
    );
    const texte = await res.text();
    if (!res.ok) {
      console.error(`[drive] export ${fileId} → ${res.status} ${texte.slice(0, 300)}`);
      throw new Error(`Google Drive export ${res.status}`);
    }
    return texte.replace(/^\uFEFF/, "");
  }
  const octets = await telechargerFichier(fileId);
  return new TextDecoder().decode(octets);
}

/** Type MIME d'un fichier Drive (null si introuvable). */
export async function mimeDrive(fileId: string): Promise<string | null> {
  try {
    const data = (await driveFetch(
      `/drive/v3/files/${encodeURIComponent(fileId)}?fields=mimeType&supportsAllDrives=true`,
    )) as { mimeType?: string };
    return data.mimeType ?? null;
  } catch {
    return null;
  }
}


/** Remplace le contenu texte d'un fichier Drive existant. */
export async function remplacerTexteFichier(fileId: string, contenu: string): Promise<void> {
  const res = await fetch(
    `${DRIVE_API_URL}/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=media&supportsAllDrives=true&fields=id`,
    {
      method: "PATCH",
      headers: { ...(await headers()), "Content-Type": "text/plain; charset=UTF-8" },
      body: contenu,
    },
  );
  if (!res.ok) {
    const text = await res.text();
    console.error(`[drive] maj texte ${fileId} → ${res.status} ${text.slice(0, 300)}`);
    throw new Error(`Google Drive maj ${res.status}`);
  }
}

/**
 * Retourne l'ID d'un fichier texte, en le créant avec un contenu initial s'il
 * n'existe pas encore dans le dossier cible.
 */
export async function assurerFichierTexte(params: {
  nom: string;
  parentId: string;
  contenuInitial: string;
}): Promise<{ id: string; cree: boolean }> {
  const existant = await trouverFichier(params.nom, params.parentId);
  if (existant) return { id: existant, cree: false };
  const depot = await deposerFichier({
    folderId: params.parentId,
    nom: params.nom,
    contenu: new TextEncoder().encode(params.contenuInitial),
    mimeType: "text/plain",
  });
  return { id: depot.id, cree: true };
}

