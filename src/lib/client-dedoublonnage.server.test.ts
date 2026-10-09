import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { normaliserTelephone, trouverClientExistant } from "./client-dedoublonnage.server";

type LigneClient = {
  id: string;
  nom?: string;
  prenom?: string | null;
  date_naissance?: string | null;
  mobile?: string | null;
  mobile2?: string | null;
  telephone?: string | null;
  telephone2?: string | null;
  created_at?: string;
};

function fauxAdmin(options: {
  email?: { id: string } | null;
  telephones?: LigneClient[];
  noms?: LigneClient[];
  appels?: string[];
}): SupabaseClient<Database> {
  return {
    from: () => {
      let recherche = "email";
      const query: Record<string, unknown> = {};
      const builder = {
        select: () => builder,
        eq: () => builder,
        ilike: () => {
          recherche = "nom";
          options.appels?.push("nom");
          return builder;
        },
        or: () => {
          recherche = "telephone";
          options.appels?.push("telephone");
          return builder;
        },
        order: () => builder,
        limit: () => builder,
        maybeSingle: async () => {
          options.appels?.push("email");
          return { data: options.email ?? null, error: null };
        },
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve({
            data: recherche === "telephone" ? (options.telephones ?? []) : (options.noms ?? []),
            error: null,
          }).then(resolve, reject),
      };
      Object.assign(query, builder);
      return query;
    },
  } as unknown as SupabaseClient<Database>;
}

describe("trouverClientExistant", () => {
  it("conserve le rapprochement email utilisé par le traitement des emails", async () => {
    const appels: string[] = [];
    const admin = fauxAdmin({ email: { id: "client-email" }, appels });

    const resultat = await trouverClientExistant(admin, {
      email: "JEAN@example.fr",
      nom: "Dupont",
      prenom: "Jean",
    });

    expect(resultat).toEqual({ client_id: "client-email", via: "email" });
    expect(appels).toEqual(["email"]);
  });

  it("rapproche un téléphone en ignorant les séparateurs et le préfixe français", async () => {
    const admin = fauxAdmin({
      telephones: [{ id: "client-mobile", mobile: "+33 6 12 34 56 78" }],
    });

    const resultat = await trouverClientExistant(admin, { mobile: "06.12.34.56.78" });

    expect(normaliserTelephone("+33 6 12 34 56 78")).toBe("612345678");
    expect(resultat).toEqual({ client_id: "client-mobile", via: "telephone" });
  });

  it("exige aussi la date de naissance lorsque cette donnée est fournie", async () => {
    const admin = fauxAdmin({
      noms: [{ id: "autre-date", nom: "DUPONT", prenom: "Jeanne", date_naissance: "1988-04-13" }],
    });

    const resultat = await trouverClientExistant(admin, {
      nom: "Dupont",
      prenom: "Jeanne",
      date_naissance: "1988-04-12",
    });

    expect(resultat).toBeNull();
  });

  it("reconnaît la combinaison normalisée nom, prénom et date de naissance", async () => {
    const admin = fauxAdmin({
      noms: [
        { id: "client-identite", nom: "DUPONT", prenom: "Jeanne", date_naissance: "1988-04-12" },
      ],
    });

    const resultat = await trouverClientExistant(admin, {
      nom: "Dupont",
      prenom: "Jeanne",
      date_naissance: "1988-04-12",
    });

    expect(resultat).toEqual({ client_id: "client-identite", via: "nom_prenom_date_naissance" });
  });

  it("garde l'ancien rapprochement nom/prénom quand aucune date n'est transmise", async () => {
    const admin = fauxAdmin({ noms: [{ id: "client-legacy", nom: "Dupont", prenom: "Jeanne" }] });

    const resultat = await trouverClientExistant(admin, { nom: "Dupont", prenom: "Jeanne" });

    expect(resultat).toEqual({ client_id: "client-legacy", via: "nom_prenom" });
  });

  it("n'utilise pas le rapprochement nom/prénom sans date de naissance dans le parcours rapide", async () => {
    const admin = fauxAdmin({ noms: [{ id: "client-legacy", nom: "Dupont", prenom: "Jeanne" }] });

    const resultat = await trouverClientExistant(admin, {
      nom: "Dupont",
      prenom: "Jeanne",
      exigerDateNaissancePourNom: true,
    });

    expect(resultat).toBeNull();
  });
});
