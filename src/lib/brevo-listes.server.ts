/* eslint-disable @typescript-eslint/no-explicit-any */
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Listes de contacts Brevo du cabinet : une liste par branche, plus
 * « Clients actifs », « Prospects » et « Prescripteurs ».
 * Les listes sont créées si absentes, puis alimentées depuis le CRM.
 * Aucune suppression de contact n'est effectuée automatiquement.
 */

type Admin = SupabaseClient<any, any, any>;

const BREVO_API_URL = "https://api.brevo.com/v3";
const DOSSIER_BREVO = "CRM EJ Partners";

/** Listes gérées : libellé Brevo → branches CRM qui l'alimentent. */
export const LISTES_BRANCHES: { nom: string; branches: string[] }[] = [
  { nom: "Emprunteur", branches: ["emprunteur"] },
  { nom: "Santé", branches: ["sante", "prevoyance_sante"] },
  { nom: "Prévoyance", branches: ["prevoyance", "prevoyance_sante"] },
  { nom: "GAV", branches: ["accidents_vie"] },
  { nom: "Protection Juridique", branches: ["juridique"] },
  { nom: "Animaux", branches: ["animaux"] },
  { nom: "Épargne/Retraite", branches: ["epargne_retraite", "epargne"] },
];

export const LISTE_CLIENTS_ACTIFS = "Clients actifs";
export const LISTE_PROSPECTS = "Prospects";
export const LISTE_PRESCRIPTEURS = "Prescripteurs";

export const NOMS_LISTES = [
  ...LISTES_BRANCHES.map((l) => l.nom),
  LISTE_CLIENTS_ACTIFS,
  LISTE_PROSPECTS,
  LISTE_PRESCRIPTEURS,
];

function entetes(): Record<string, string> {
  const brevoKey = process.env["BREVO_API_KEY"];
  if (!brevoKey) throw new Error("BREVO_API_KEY is not configured");
  return {
    "Content-Type": "application/json",
    "api-key": brevoKey,
  };
}

async function appel(method: string, chemin: string, body?: unknown): Promise<any> {
  const res = await fetch(`${BREVO_API_URL}${chemin}`, {
    method,
    headers: entetes(),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const texte = await res.text();
  if (!res.ok) {
    console.error(`[brevo-listes] ${method} ${chemin} → ${res.status} ${texte}`);
    throw new Error(`Brevo ${method} ${chemin} [${res.status}]: ${texte}`);
  }
  if (!texte) return null;
  try {
    return JSON.parse(texte);
  } catch {
    return null;
  }
}

async function dossierParDefaut(): Promise<number> {
  const json = await appel("GET", "/contacts/folders?limit=50&offset=0");
  const dossiers = (json?.folders ?? []) as { id: number; name: string }[];
  const existant = dossiers.find((d) => d.name === DOSSIER_BREVO);
  if (existant) return existant.id;
  if (dossiers.length > 0) return dossiers[0]!.id;
  const cree = await appel("POST", "/contacts/folders", { name: DOSSIER_BREVO });
  return Number(cree?.id);
}

/** Crée les listes manquantes et renvoie la correspondance nom → identifiant Brevo. */
export async function assurerListes(): Promise<Record<string, number>> {
  const existantes: { id: number; name: string }[] = [];
  for (let offset = 0; offset < 500; offset += 50) {
    const json = await appel("GET", `/contacts/lists?limit=50&offset=${offset}`);
    const lots = (json?.lists ?? []) as { id: number; name: string }[];
    existantes.push(...lots);
    if (lots.length < 50) break;
  }

  const parNom: Record<string, number> = {};
  for (const l of existantes) parNom[l.name] = l.id;

  let folderId: number | null = null;
  for (const nom of NOMS_LISTES) {
    if (parNom[nom]) continue;
    if (folderId === null) folderId = await dossierParDefaut();
    const cree = await appel("POST", "/contacts/lists", { name: nom, folderId });
    if (cree?.id) parNom[nom] = Number(cree.id);
  }
  return parNom;
}

type Contact = { email: string; prenom: string | null; nom: string | null; listes: Set<string> };

function ajouter(map: Map<string, Contact>, email: string | null, prenom: string | null, nom: string | null, liste: string) {
  const adresse = (email ?? "").trim().toLowerCase();
  if (!adresse || !adresse.includes("@")) return;
  const existant = map.get(adresse) ?? { email: adresse, prenom, nom, listes: new Set<string>() };
  existant.prenom = existant.prenom ?? prenom;
  existant.nom = existant.nom ?? nom;
  existant.listes.add(liste);
  map.set(adresse, existant);
}

/** Synchronise les clients, prospects et prescripteurs du CRM vers les listes Brevo. */
export async function synchroniserListesBrevo(
  admin: Admin,
): Promise<{ listes: number; contacts: number; erreurs: number }> {
  const listes = await assurerListes();

  const { data: clients, error } = await admin
    .from("clients")
    .select("id, nom, prenom, email, statut")
    .not("email", "is", null)
    .limit(5000);
  if (error) throw new Error(error.message);

  const contacts = new Map<string, Contact>();
  const clientsParId = new Map<string, any>();
  for (const c of (clients ?? []) as any[]) {
    clientsParId.set(c.id, c);
    if (c.statut === "actif") ajouter(contacts, c.email, c.prenom, c.nom, LISTE_CLIENTS_ACTIFS);
    if (c.statut === "prospect") ajouter(contacts, c.email, c.prenom, c.nom, LISTE_PROSPECTS);
  }

  // Branches connues du client : dossiers déposés + contrats emprunteur.
  const { data: dossiers } = await admin
    .from("dossiers")
    .select("client_id, type_assurance")
    .not("client_id", "is", null)
    .limit(5000);
  for (const d of (dossiers ?? []) as any[]) {
    const client = clientsParId.get(d.client_id);
    if (!client) continue;
    for (const liste of LISTES_BRANCHES) {
      if (liste.branches.includes(String(d.type_assurance ?? ""))) {
        ajouter(contacts, client.email, client.prenom, client.nom, liste.nom);
      }
    }
  }

  const { data: contratsEmprunteur } = await admin
    .from("contrats")
    .select("client_id")
    .eq("is_emprunteur", true)
    .limit(5000);
  for (const c of (contratsEmprunteur ?? []) as any[]) {
    const client = clientsParId.get(c.client_id);
    if (client) ajouter(contacts, client.email, client.prenom, client.nom, "Emprunteur");
  }

  // Prescripteurs : profils portant le rôle correspondant.
  const { data: roles } = await admin.from("user_roles").select("user_id").eq("role", "prescripteur").limit(1000);
  const ids = ((roles ?? []) as any[]).map((r) => r.user_id);
  if (ids.length > 0) {
    const { data: profils } = await admin.from("profiles").select("id, email, nom, prenom").in("id", ids);
    for (const p of (profils ?? []) as any[]) {
      ajouter(contacts, p.email, p.prenom ?? null, p.nom ?? null, LISTE_PRESCRIPTEURS);
    }
  }

  let erreurs = 0;
  for (const contact of contacts.values()) {
    const listIds = [...contact.listes].map((n) => listes[n]).filter((v): v is number => Number.isFinite(v));
    if (listIds.length === 0) continue;
    try {
      await appel("POST", "/contacts", {
        email: contact.email,
        attributes: {
          PRENOM: contact.prenom ?? "",
          NOM: contact.nom ?? "",
        },
        listIds,
        updateEnabled: true,
      });
    } catch {
      erreurs += 1;
    }
  }

  return { listes: Object.keys(listes).length, contacts: contacts.size, erreurs };
}

/**
 * Synchronisation ciblée d'un seul client vers ses listes Brevo.
 * Best-effort : à appeler sans bloquer l'action métier appelante.
 */
export async function synchroniserContactBrevo(
  admin: Admin,
  clientId: string,
): Promise<{ ok: boolean; listes?: string[]; raison?: string }> {
  const { data: client, error } = await admin
    .from("clients")
    .select("id, nom, prenom, email, statut")
    .eq("id", clientId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const c = client as any;
  const email = (c?.email ?? "").trim().toLowerCase();
  if (!c || !email || !email.includes("@")) return { ok: false, raison: "email absent" };

  const noms = new Set<string>();
  if (c.statut === "actif") noms.add(LISTE_CLIENTS_ACTIFS);
  if (c.statut === "prospect") noms.add(LISTE_PROSPECTS);

  const [{ data: dossiers }, { data: contratsEmprunteur }] = await Promise.all([
    admin.from("dossiers").select("type_assurance").eq("client_id", clientId).limit(200),
    admin.from("contrats").select("id").eq("client_id", clientId).eq("is_emprunteur", true).limit(200),
  ]);
  for (const d of ((dossiers ?? []) as any[])) {
    for (const liste of LISTES_BRANCHES) {
      if (liste.branches.includes(String(d.type_assurance ?? ""))) noms.add(liste.nom);
    }
  }
  if (((contratsEmprunteur ?? []) as any[]).length > 0) noms.add("Emprunteur");

  if (noms.size === 0) return { ok: false, raison: "aucune liste applicable" };

  const listes = await assurerListes();
  const listIds = [...noms].map((n) => listes[n]).filter((v): v is number => Number.isFinite(v));
  if (listIds.length === 0) return { ok: false, raison: "listes Brevo introuvables" };

  await appel("POST", "/contacts", {
    email,
    attributes: { PRENOM: c.prenom ?? "", NOM: c.nom ?? "" },
    listIds,
    updateEnabled: true,
  });
  return { ok: true, listes: [...noms] };
}

/** Variante best-effort : journalise l'erreur sans jamais la propager. */
export async function synchroniserContactBrevoSansEchec(admin: Admin, clientId: string): Promise<void> {
  try {
    await synchroniserContactBrevo(admin, clientId);
  } catch (e) {
    console.error(`[brevo-listes] synchro contact ${clientId} échouée`, e);
  }
}
