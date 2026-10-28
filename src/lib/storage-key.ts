/**
 * Produit un nom de fichier sûr pour une clé d'objet Storage.
 * Le nom d'origine doit rester stocké séparément pour l'affichage utilisateur.
 */
export function normaliserNomFichierPourStockage(nom: string): string {
  const nomSansChemin = nom.split(/[\\/]/).pop() ?? "";
  const ascii = nomSansChemin.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const safe = ascii
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 160);

  return safe || "document";
}
