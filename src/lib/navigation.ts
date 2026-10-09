import {
  IconAddressBook,
  IconBriefcase,
  IconBuildingBank,
  IconChartHistogram,
  IconChecklist,
  IconCoin,
  IconFileText,
  IconFolder,
  IconHome2,
  IconLifebuoy,
  IconMail,
  IconRobot,
  IconSettings,
  IconShieldCheck,
  IconUserPlus,
  IconUsersGroup,
  type Icon,
} from "@tabler/icons-react";

export type AppRole = "admin" | "mandataire" | "client" | "prescripteur";

export type NavItem = {
  label: string;
  to: string;
  icon: Icon;
  exact?: boolean;
  roles?: AppRole[];
};

export type NavGroup = {
  key: "principal" | "commercial" | "pilotage" | "administration";
  label: string;
  icon: Icon;
  items: NavItem[];
};

const STAFF: AppRole[] = ["admin", "mandataire"];
const MANDATAIRE_ADMIN: AppRole[] = ["admin", "mandataire"];

/** Une seule source de vérité : toutes les entrées pointent vers des pages existantes. */
export const NAV_GROUPS: NavGroup[] = [
  {
    key: "principal",
    label: "Principal",
    icon: IconHome2,
    items: [
      { label: "Accueil", to: "/espace", exact: true, icon: IconHome2, roles: STAFF },
      { label: "Clients", to: "/espace/clients", icon: IconUsersGroup, roles: STAFF },
      { label: "Dossiers", to: "/espace/dossiers", icon: IconFolder, roles: STAFF },
      { label: "Tâches", to: "/espace/taches", icon: IconChecklist, roles: STAFF },
      { label: "Emails", to: "/espace/relation-client", icon: IconMail, roles: STAFF },
      { label: "Mon espace", to: "/espace/mon-espace", icon: IconAddressBook, roles: ["client"] },
      {
        label: "Mes recommandations",
        to: "/espace/mes-recommandations",
        icon: IconBriefcase,
        roles: ["prescripteur"],
      },
    ],
  },
  {
    key: "commercial",
    label: "Commercial",
    icon: IconBriefcase,
    items: [
      {
        label: "Préqualification",
        to: "/espace/prequalification",
        icon: IconUserPlus,
        roles: STAFF,
      },
      { label: "Prescripteurs", to: "/espace/prescripteurs", icon: IconAddressBook, roles: STAFF },
      { label: "Sinistres", to: "/espace/sinistres", icon: IconLifebuoy, roles: STAFF },
      {
        label: "Compagnies & produits",
        to: "/espace/compagnies",
        icon: IconBuildingBank,
        roles: STAFF,
      },
      {
        label: "Grilles de garanties",
        to: "/espace/grilles-garanties",
        icon: IconChecklist,
        roles: STAFF,
      },
      { label: "Bibliothèque CG", to: "/espace/bibliotheque-cg", icon: IconFileText, roles: STAFF },
      { label: "Contrats", to: "/espace/contrats", icon: IconFolder, roles: STAFF },
      { label: "Souscription Néoliane", to: "/espace/neoliane", icon: IconRobot, roles: STAFF },
    ],
  },
  {
    key: "pilotage",
    label: "Pilotage",
    icon: IconChartHistogram,
    items: [
      { label: "Vision direction", to: "/espace/pilotage", icon: IconChartHistogram, roles: STAFF },
      {
        label: "Webinaires & funnel",
        to: "/espace/webinaires",
        icon: IconUsersGroup,
        roles: STAFF,
      },
      { label: "Cockpit CA", to: "/espace/cockpit-ca", icon: IconCoin, roles: STAFF },
      {
        label: "CA prévisionnel",
        to: "/espace/ca-paliers",
        icon: IconChartHistogram,
        roles: STAFF,
      },
      { label: "Commissions", to: "/espace/commissions", icon: IconCoin, roles: STAFF },
      {
        label: "Diagnostic contrats & finance",
        to: "/espace/diagnostic",
        icon: IconShieldCheck,
        roles: STAFF,
      },
    ],
  },
  {
    key: "administration",
    label: "Administration",
    icon: IconSettings,
    items: [
      { label: "Paramètres", to: "/espace/parametres", icon: IconSettings },
      { label: "Utilisateurs", to: "/espace/utilisateurs", icon: IconUsersGroup, roles: ["admin"] },
      { label: "Conformité", to: "/espace/conformite", icon: IconShieldCheck, roles: STAFF },
      { label: "Modèle DER", to: "/espace/der-modele", icon: IconFileText, roles: STAFF },
      { label: "Journal d’audit", to: "/espace/audit-logs", icon: IconFileText, roles: ["admin"] },
      { label: "Comptabilité", to: "/espace/comptabilite", icon: IconCoin, roles: STAFF },
      { label: "Fournisseurs", to: "/espace/fournisseurs", icon: IconBuildingBank, roles: STAFF },
      { label: "Contrôle Gmail", to: "/espace/gmail-controle", icon: IconMail, roles: STAFF },
      {
        label: "Espace mandataire",
        to: "/espace/mon-espace-mandataire",
        icon: IconAddressBook,
        roles: MANDATAIRE_ADMIN,
      },
    ],
  },
];

export function groupesVisibles(role: AppRole | null): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) => !item.roles || (role !== null && item.roles.includes(role)),
    ),
  })).filter((group) => group.items.length > 0);
}

function correspond(pathname: string, item: NavItem): boolean {
  return item.exact
    ? pathname === item.to
    : pathname === item.to || pathname.startsWith(`${item.to}/`);
}

/** Le lien le plus spécifique gagne pour les routes de détail et sous-parcours. */
export function itemActif(pathname: string, groups: NavGroup[]): NavItem | null {
  let actif: NavItem | null = null;
  for (const group of groups) {
    for (const item of group.items) {
      if (correspond(pathname, item) && (!actif || item.to.length > actif.to.length)) actif = item;
    }
  }
  return actif;
}

export function groupeActif(pathname: string, groups: NavGroup[]): NavGroup | null {
  const item = itemActif(pathname, groups);
  return groups.find((group) => group.items.includes(item!)) ?? null;
}

export function libelleRouteActive(
  pathname: string,
  groups: NavGroup[],
): { group: string; item: string } | null {
  const item = itemActif(pathname, groups);
  if (!item) return null;
  const group = groups.find((candidate) => candidate.items.includes(item));
  return group ? { group: group.label, item: item.label } : null;
}
