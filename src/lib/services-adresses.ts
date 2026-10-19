import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { LABELS_CABINET, type LabelCabinet } from "@/lib/gmail-labels";

/**
 * Services du cabinet et adresses réelles de renvoi.
 *
 * La correspondance étiquette métier / adresse / thème reste dans la table
 * historique `config_labels_gmail` : les noms changent régulièrement et doivent
 * pouvoir être corrigés en SQL, sans modification de code. Ce module
 * lit cette table avec un cache court (5 minutes) pour éviter une requête par
 * mail traité.
 *
 * Certains services n'ont PAS d'adresse dédiée (Gestion Commerciale, Direction
 * Juridique et Conformite) : un mail mal aiguillé vers eux reste sur place, aucun
 * renvoi n'est effectué.
 */
export type ServiceCabinet =
  | "gestion_commerciale"
  | "service_client"
  | "service_partenaire"
  | "service_achat"
  | "service_commission"
  | "service_reclamation"
  | "service_conformite";

export interface DefinitionService {
  cle: ServiceCabinet;
  libelle: string;
  /** Étiquette CRM de direction (à plat) du service. */
  label_direction: string;
  /** Adresse réelle de renvoi, ou null si le service n'en a pas. */
  adresse: string | null;
  /** Étiquettes du service (sous-états), clés de LABELS_CABINET. */
  a_traiter: LabelCabinet;
  archive: LabelCabinet;
  /** Thèmes traités, utilisés pour la classification IA. */
  theme: string;
}


/**
 * Sous-états de chaque service : dépendants du code (clés de LABELS_CABINET),
 * ils ne font pas partie de la configuration modifiable en base.
 */
const SOUS_ETATS: Record<ServiceCabinet, { a_traiter: LabelCabinet; archive: LabelCabinet }> = {
  gestion_commerciale: { a_traiter: "gc_a_traiter", archive: "gc_archive" },
  service_client: { a_traiter: "sc_a_traiter", archive: "sc_archive" },
  service_partenaire: { a_traiter: "sp_a_traiter", archive: "sp_archive" },
  service_achat: { a_traiter: "achat_a_traiter", archive: "achat_archive" },
  service_commission: { a_traiter: "commission_a_traiter", archive: "commission_archive" },
  service_reclamation: { a_traiter: "rec_a_traiter", archive: "rec_archive" },
  service_conformite: { a_traiter: "veille_a_traiter", archive: "veille_archive" },
};

export const SERVICES_CLES = Object.keys(SOUS_ETATS) as ServiceCabinet[];

const DUREE_CACHE_MS = 5 * 60 * 1000;
let cache: { services: DefinitionService[]; expire: number } | null = null;

/**
 * Charge la table de correspondance des libellés (services actifs uniquement).
 * Cache mémoire de 5 minutes ; `forcer: true` le contourne.
 */
export async function chargerServices(
  db: SupabaseClient<Database>,
  options?: { forcer?: boolean },
): Promise<DefinitionService[]> {
  if (!options?.forcer && cache && cache.expire > Date.now()) return cache.services;

  const { data, error } = await db
    .from("config_labels_gmail")
    .select("service_cle, libelle, label_direction, adresse, theme, actif")
    .eq("actif", true);
  if (error) throw new Error(`Configuration des étiquettes métier illisible : ${error.message}`);

  const services: DefinitionService[] = [];
  for (const ligne of data ?? []) {
    const cle = ligne.service_cle as ServiceCabinet;
    const sous = SOUS_ETATS[cle];
    if (!sous) {
      console.error(`[config-labels] service inconnu du code, ignoré : ${ligne.service_cle}`);
      continue;
    }
    services.push({
      cle,
      libelle: ligne.libelle,
      label_direction: ligne.label_direction,
      adresse: ligne.adresse?.trim() || null,
      theme: ligne.theme ?? "",
      ...sous,
    });
  }

  cache = { services, expire: Date.now() + DUREE_CACHE_MS };
  return services;
}

/** Vide le cache (après modification de la table). */
export function viderCacheServices(): void {
  cache = null;
}

export function serviceParCle(services: DefinitionService[], cle: ServiceCabinet): DefinitionService | null {
  return services.find((s) => s.cle === cle) ?? null;
}

/**
 * Service d'arrivée d'un message d'après les libellés réellement posés :
 * comparaison exacte sur le libellé de direction (structure à plat).
 */
export function serviceDeEtiquettes(
  services: DefinitionService[],
  etiquettes: string[],
): DefinitionService | null {
  const bas = etiquettes.map((e) => e.trim().toLowerCase());
  for (const s of services) {
    const d = s.label_direction.trim().toLowerCase();
    if (bas.includes(d)) return s;
  }
  return null;
}


/** Adresses de service : jamais considérées comme un client à mettre en copie. */
export function adressesServices(services: DefinitionService[]): string[] {
  return services.map((s) => s.adresse?.toLowerCase()).filter((a): a is string => !!a);
}

export { LABELS_CABINET };
