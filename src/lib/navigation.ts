/**
 * Arborescence de navigation du logiciel :
 * DOMAINE OPÉRATIONNEL → MODULE → SOUS-MODULE.
 *
 * Les 9 domaines sont une couche d'organisation : ils ne fusionnent aucun
 * module. Les entrées `soon: true` décrivent le périmètre fonctionnel cible
 * (affichées désactivées, aucune route associée).
 *
 * Source unique utilisée par le rail des domaines et la colonne des modules.
 */
import {
  IconAddressBook,
  IconBriefcase,
  IconBuildingBank,
  IconCoin,
  IconShieldCheck,
  IconChartHistogram,
  IconLifebuoy,
  IconRobot,
  IconSettings,
  IconUsersGroup,
  type Icon,
} from "@tabler/icons-react";

export type AppRole = "admin" | "mandataire" | "client" | "prescripteur";

export type NavLeaf = {
  label: string;
  /** Chemin réel ; absent lorsque le sous-module est au périmètre cible. */
  to?: string;
  /** Correspondance exacte du pathname (utile pour « / »). */
  exact?: boolean;
  /** Périmètre cible non développé : affiché désactivé. */
  soon?: boolean;
  roles?: AppRole[];
};

export type NavModule = {
  /** Module fonctionnel de référence (l'une des 11 unités). */
  module: string;
  items: NavLeaf[];
};

export type NavDomain = {
  key: string;
  /** Libellé court affiché dans le rail. */
  short: string;
  label: string;
  icon: Icon;
  modules: NavModule[];
};

const STAFF: AppRole[] = ["admin", "mandataire"];

export const NAV_DOMAINS: NavDomain[] = [
  {
    key: "relation",
    short: "Relation",
    label: "Relation client & dossiers",
    icon: IconAddressBook,
    modules: [
      {
        module: "CRM",
        items: [
          { label: "Tableau de bord", to: "/espace", exact: true, roles: STAFF },
          { label: "Clients", to: "/espace/clients", roles: STAFF },
          { label: "Dossiers", to: "/espace/dossiers", roles: STAFF },
          { label: "Relation client", to: "/espace/relation-client", roles: STAFF },
          { label: "Tâches", to: "/espace/taches", roles: STAFF },
          { label: "Prescripteurs", to: "/espace/prescripteurs", roles: STAFF },
          { label: "Agenda partagé", soon: true, roles: STAFF },
          { label: "Segmentation avancée", soon: true, roles: STAFF },
          { label: "GED — recherche documentaire", soon: true, roles: STAFF },
        ],
      },
    ],
  },
  {
    key: "conformite",
    short: "Conf.",
    label: "Conformité & sécurité réglementaire",
    icon: IconShieldCheck,
    modules: [
      {
        module: "Conformité",
        items: [
          { label: "Tableau de conformité", to: "/espace/conformite", roles: STAFF },
          { label: "DER (modèle)", to: "/espace/der-modele", roles: STAFF },
          { label: "Journal d'audit", to: "/espace/audit-logs", roles: ["admin"] },
          { label: "Screening PPE / LCB-FT", soon: true, roles: STAFF },
          { label: "Réclamations & délais ACPR", soon: true, roles: STAFF },
          { label: "Calendrier réglementaire", soon: true, roles: STAFF },
          { label: "Registre RGPD & consentements", soon: true, roles: STAFF },
        ],
      },
    ],
  },
  {
    key: "portails",
    short: "Portails",
    label: "Portails & écosystème partenaires",
    icon: IconUsersGroup,
    modules: [
      {
        module: "Portail clients et espace partenaires",
        items: [
          { label: "Mon espace", to: "/espace/mon-espace", roles: ["client"] },
          { label: "Mes recommandations", to: "/espace/mes-recommandations", roles: ["prescripteur"] },
          { label: "Accès des clients", to: "/espace/clients", roles: STAFF },
          { label: "Portail entreprise", soon: true, roles: STAFF },
          { label: "Espace co-courtage", soon: true, roles: STAFF },
          { label: "Espace apporteurs", soon: true, roles: STAFF },
        ],
      },
    ],
  },
  {
    key: "souscription",
    short: "OAV",
    label: "Souscription & distribution",
    icon: IconBriefcase,
    modules: [
      {
        module: "OAV et parcours de souscription",
        items: [
          { label: "Néoliane (API)", to: "/espace/neoliane", roles: STAFF },
          { label: "Recueil des besoins", soon: true, roles: STAFF },
          { label: "Recommandations & propositions", soon: true, roles: STAFF },
          { label: "Suivi du parcours", soon: true, roles: STAFF },
        ],
      },
    ],
  },
  {
    key: "produits",
    short: "Produits",
    label: "Produits & contrats",
    icon: IconBuildingBank,
    modules: [
      {
        module: "Gestion des produits et configurateur",
        items: [
          { label: "Compagnies & produits", to: "/espace/compagnies", roles: STAFF },
          { label: "Grilles de garanties", to: "/espace/grilles-garanties", roles: STAFF },
          { label: "Bibliothèque CG clients", to: "/espace/bibliotheque-cg", roles: STAFF },
          { label: "Configurateur d'offres", soon: true, roles: STAFF },
          { label: "Tarifs & règles", soon: true, roles: STAFF },
        ],
      },
      {
        module: "Suivi des contrats",
        items: [
          { label: "Portefeuille de contrats", to: "/espace/contrats", exact: true, roles: STAFF },
          { label: "Échéances & renouvellements", soon: true, roles: STAFF },
          { label: "Avenants & résiliations", soon: true, roles: STAFF },
        ],
      },
    ],
  },
  {
    key: "finance",
    short: "Finance",
    label: "Finance & commissions",
    icon: IconCoin,
    modules: [
      {
        module: "Commissions et rétrocessions",
        items: [
          { label: "Commissions", to: "/espace/commissions", roles: STAFF },
          { label: "Comptabilité", to: "/espace/comptabilite", roles: STAFF },
          { label: "Diagnostic contrats & finance", to: "/espace/diagnostic", roles: STAFF },
          { label: "Fournisseurs", to: "/espace/fournisseurs", roles: STAFF },
          { label: "Bordereaux — import", soon: true, roles: STAFF },
          { label: "Rapprochement & écarts", soon: true, roles: STAFF },
          { label: "Rétrocessions", soon: true, roles: STAFF },
        ],
      },
    ],
  },
  {
    key: "sinistres",
    short: "Sinistres",
    label: "Sinistres & demandes",
    icon: IconLifebuoy,
    modules: [
      {
        module: "Gestion des sinistres",
        items: [
          { label: "Sinistres", to: "/espace/sinistres", roles: STAFF },
          { label: "Prévention", soon: true, roles: STAFF },
        ],
      },
      {
        module: "Gestion des demandes",
        items: [
          { label: "Demandes clients", soon: true, roles: STAFF },
          { label: "Affectation & SLA", soon: true, roles: STAFF },
        ],
      },
    ],
  },
  {
    key: "pilotage",
    short: "Pilotage",
    label: "Pilotage & reporting",
    icon: IconChartHistogram,
    modules: [
      {
        module: "Reporting et analyses",
        items: [
          { label: "Vision direction", to: "/espace/pilotage", roles: STAFF },
          { label: "Webinaires & funnel", to: "/espace/webinaires", roles: STAFF },
          { label: "Production & transformation", soon: true, roles: STAFF },
          { label: "Portefeuille", soon: true, roles: STAFF },
          { label: "Finance", soon: true, roles: STAFF },
          { label: "Conformité", soon: true, roles: STAFF },
        ],
      },
    ],
  },
  {
    key: "ia",
    short: "IA",
    label: "Automatisation & Intelligence Artificielle",
    icon: IconRobot,
    modules: [
      {
        module: "Automatisation et Intelligence Artificielle",
        items: [
          { label: "Traitement des emails", to: "/espace/relation-client", roles: STAFF },
          { label: "Extraction & classification", soon: true, roles: STAFF },
          { label: "Génération de réponses", soon: true, roles: STAFF },
          { label: "Automatisation documentaire", soon: true, roles: STAFF },
        ],
      },
    ],
  },
];

/** Réglages : hors domaines opérationnels, ancré en bas du rail. */
export const NAV_SETTINGS: NavDomain = {
  key: "reglages",
  short: "Réglages",
  label: "Réglages & administration",
  icon: IconSettings,
  modules: [
    {
      module: "Administration",
      items: [
        { label: "Utilisateurs", to: "/espace/utilisateurs", roles: ["admin"] },
        { label: "Paramètres", to: "/espace/parametres" },
      ],
    },
  ],
};

/** Filtre l'arborescence selon le rôle courant (modules et domaines vides retirés). */
export function filtrerDomaine(domaine: NavDomain, role: AppRole | null): NavDomain | null {
  const modules = domaine.modules
    .map((m) => ({ ...m, items: m.items.filter((i) => !i.roles || (role && i.roles.includes(role))) }))
    .filter((m) => m.items.length > 0);
  return modules.length ? { ...domaine, modules } : null;
}

export function domainesVisibles(role: AppRole | null): NavDomain[] {
  return NAV_DOMAINS.map((d) => filtrerDomaine(d, role)).filter((d): d is NavDomain => d !== null);
}

/** Premier sous-module réellement navigable d'un domaine. */
export function premierLien(domaine: NavDomain): string | undefined {
  for (const m of domaine.modules) {
    const leaf = m.items.find((i) => i.to && !i.soon);
    if (leaf?.to) return leaf.to;
  }
  return undefined;
}

/** Domaine correspondant au pathname courant (le lien le plus spécifique gagne). */
export function domaineActif(pathname: string, role: AppRole | null): NavDomain | null {
  const candidats = [...domainesVisibles(role), NAV_SETTINGS];
  let meilleur: { domaine: NavDomain; longueur: number } | null = null;
  for (const d of candidats) {
    for (const m of d.modules) {
      for (const i of m.items) {
        if (!i.to) continue;
        const ok = i.exact ? pathname === i.to : pathname === i.to || pathname.startsWith(i.to + "/");
        if (ok && (!meilleur || i.to.length > meilleur.longueur)) {
          meilleur = { domaine: d, longueur: i.to.length };
        }
      }
    }
  }
  return meilleur?.domaine ?? null;
}
