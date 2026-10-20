/** Déclenche le téléchargement d'un PDF renvoyé en base64 par une server function. */
export function telechargerPdfBase64(base64: string, nomFichier: string) {
  const binaire = atob(base64);
  const octets = new Uint8Array(binaire.length);
  for (let i = 0; i < binaire.length; i += 1) octets[i] = binaire.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([octets], { type: "application/pdf" }));
  const lien = document.createElement("a");
  lien.href = url;
  lien.download = nomFichier;
  document.body.appendChild(lien);
  lien.click();
  lien.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Déclenche le téléchargement d'un PDF généré dans le navigateur. */
export function telechargerPdfBlob(blob: Blob, nomFichier: string) {
  const url = URL.createObjectURL(blob);
  const lien = document.createElement("a");
  lien.href = url;
  lien.download = nomFichier;
  document.body.appendChild(lien);
  lien.click();
  lien.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Téléchargement d'un fichier texte (CSV, FEC…). */
export function telechargerTexte(
  contenu: string,
  nomFichier: string,
  mime = "text/plain;charset=utf-8",
) {
  const url = URL.createObjectURL(new Blob(["\uFEFF" + contenu], { type: mime }));
  const lien = document.createElement("a");
  lien.href = url;
  lien.download = nomFichier;
  document.body.appendChild(lien);
  lien.click();
  lien.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
