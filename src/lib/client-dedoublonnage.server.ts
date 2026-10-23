import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/**
 * Dédoublonnage des fiches clients à la création automatique.
 *
 * Un email partenaire (suivi, substitution, gestion) cite très souvent le nom
 * du client sans utiliser son adresse email. Chercher uniquement par email
 * créait alors une seconde fiche pour un client déjà connu. On cherche donc :
 *   1. par email exact (preuve la plus forte) ;
 *   2. par nom + prénom normalisés (sans accents, sans casse, sans tirets),
 *      y compris si les deux champs ont été inversés à la saisie.
 */

export function normaliserIdentite(valeur: string | null | undefined): string {
  if (!valeur) return "";
  return valeur
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export type ClientExistant = {
  client_id: string;
  via: "email" | "telephone" | "nom_prenom_date_naissance" | "nom_prenom" | "nom";
};

export function normaliserTelephone(valeur: string | null | undefined): string {
  if (!valeur) return "";
  const chiffres = valeur.replace(/\D/g, "");
  return chiffres.length > 9 ? chiffres.slice(-9) : chiffres;
}

/**
 * Lecture seule : retourne la fiche client déjà connue correspondant à ces
 * éléments d'identité, ou null si aucun rapprochement fiable.
 */
export async function trouverClientExistant(
  admin: SupabaseClient<Database>,
  params: {
    email?: string | null;
    mobile?: string | null;
    telephone?: string | null;
    nom?: string | null;
    prenom?: string | null;
    date_naissance?: string | null;
    exigerDateNaissancePourNom?: boolean;
  },
): Promise<ClientExistant | null> {
  const email = params.email?.toLowerCase().trim() || null;
  if (email) {
    const { data } = await admin.from("clients").select("id").ilike("email", email).limit(1).maybeSingle();
    if (data?.id) return { client_id: data.id, via: "email" };
  }

  const telephones = [...new Set([params.mobile, params.telephone].map(normaliserTelephone))].filter(
    (n) => n.length >= 6,
  );
  if (telephones.length > 0) {
    const suffixes = [...new Set(telephones.map((n) => (n.length > 9 ? n.slice(-9) : n)))];
    const filtres = suffixes.flatMap((suffixe) =>
      ["mobile", "mobile2", "telephone", "telephone2"].map((champ) => `${champ}.ilike.%${suffixe}`),
    );
    const { data: candidatsTelephone } = await admin
      .from("clients")
      .select("id, mobile, mobile2, telephone, telephone2, created_at")
      .or(filtres.join(","))
      .order("created_at", { ascending: false })
      .limit(100);

    const cible = new Set(telephones);
    const correspondant = (candidatsTelephone ?? []).find((client) =>
      [client.mobile, client.mobile2, client.telephone, client.telephone2].some((numero) =>
        cible.has(normaliserTelephone(numero)),
      ),
    );
    if (correspondant) return { client_id: correspondant.id, via: "telephone" };
  }

  const nom = normaliserIdentite(params.nom);
  if (!nom || nom.length < 3) return null;
  const prenom = normaliserIdentite(params.prenom);
  if (params.exigerDateNaissancePourNom && (!prenom || !params.date_naissance)) return null;

  const valeursNom = [...new Set([params.nom, params.prenom].map((v) => v?.trim()).filter(Boolean))] as string[];
  const recherches = await Promise.all(
    valeursNom.map((valeur) =>
      admin
        .from("clients")
        .select("id, nom, prenom, date_naissance, created_at")
        .ilike("nom", `%${valeur}%`)
        .order("created_at", { ascending: false })
        .limit(100),
    ),
  );
  const candidats = recherches.flatMap(({ data }) => data ?? []);
  const lignes = [...new Map(candidats.map((c) => [c.id, c])).values()].filter((c) => {
    const nomExistant = normaliserIdentite(c.nom);
    const prenomExistant = normaliserIdentite(c.prenom);
    return nomExistant === nom || (Boolean(prenom) && nomExistant === prenom && prenomExistant === nom);
  });
  if (lignes.length === 0) return null;

  if (prenom) {
    if (params.date_naissance) {
      const exact = lignes.find((c) => {
        const prenomExistant = normaliserIdentite(c.prenom);
        const ordreNormal = normaliserIdentite(c.nom) === nom && prenomExistant === prenom;
        const ordreInverse = normaliserIdentite(c.nom) === prenom && prenomExistant === nom;
        return (ordreNormal || ordreInverse) && c.date_naissance === params.date_naissance;
      });
      return exact ? { client_id: exact.id, via: "nom_prenom_date_naissance" } : null;
    }

    const exact = lignes.find((c) => {
      const prenomExistant = normaliserIdentite(c.prenom);
      return (
        (normaliserIdentite(c.nom) === nom && prenomExistant === prenom) ||
        (normaliserIdentite(c.nom) === prenom && prenomExistant === nom)
      );
    });
    if (exact) return { client_id: exact.id, via: "nom_prenom" };
    // Le nom correspond mais le prénom diffère : homonymie possible, on ne
    // rapproche pas automatiquement (une fiche distincte est légitime).
    const sansPrenom = lignes.find((c) => !normaliserIdentite(c.prenom));
    return sansPrenom ? { client_id: sansPrenom.id, via: "nom" } : null;
  }

  // Aucun prénom détecté : rapprochement uniquement si le nom est unique.
  return lignes.length === 1 ? { client_id: lignes[0]!.id, via: "nom" } : null;
}

/**
 * Dossier déjà ouvert (non clos / non perdu) du client pour cette branche.
 * Évite d'ouvrir un second dossier sur un suivi partenaire.
 */
export async function trouverDossierOuvert(
  admin: SupabaseClient<Database>,
  params: { client_id: string; type_assurance?: string | null },
): Promise<string | null> {
  let requete = admin
    .from("dossiers")
    .select("id, created_at")
    .eq("client_id", params.client_id)
    .not("statut", "in", "(cloture,perdu)")
    .order("created_at", { ascending: false })
    .limit(1);
  if (params.type_assurance) requete = requete.eq("type_assurance", params.type_assurance as never);
  const { data } = await requete.maybeSingle();
  return data?.id ?? null;
}
