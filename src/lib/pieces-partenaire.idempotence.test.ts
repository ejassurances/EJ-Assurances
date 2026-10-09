/**
 * Tests de répétition : un même mail partenaire retraité plusieurs fois
 * (relecture par le tri toutes les 15 min, retry, webhook dupliqué) ne doit
 * produire qu'UNE tâche humaine et UN dépôt de fichier.
 *
 * Contexte : avant ce correctif, 29 mails avaient produit 5 987 tâches et
 * 2 874 copies de fichiers (décision « clé anti-doublon » du 06/10/2026).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const telecharger = vi.fn();
vi.mock("@/lib/gmail.server", () => ({ telechargerPieceJointe: (...a: unknown[]) => telecharger(...a) }));
vi.mock("@/lib/rattachement-documentaire.server", () => ({
  rattacherDocument: async () => ({ dossier_id: null, contrat_id: null }),
}));
vi.mock("@/lib/agent-notifications.server", () => ({ notifierActionAgent: async () => true }));

import { traiterPiecesJointesPartenaire } from "./pieces-partenaire.server";

type Ligne = Record<string, unknown>;

/** Client Supabase minimal en mémoire : tables + stockage. */
function fauxAdmin() {
  const tables: Record<string, Ligne[]> = {
    taches: [],
    documents: [],
    activites: [],
    clients: [],
    contrats: [],
    user_roles: [{ user_id: "admin-1", role: "admin" }],
  };
  const stockage: string[] = [];
  const uploads: string[] = [];

  const requete = (table: string) => {
    let lignes = [...(tables[table] ??= [])];
    let aInserer: Ligne | null = null;
    const q: any = {
      select: () => q,
      eq: (col: string, v: unknown) => ((lignes = lignes.filter((l) => l[col] === v)), q),
      in: (col: string, vs: unknown[]) => ((lignes = lignes.filter((l) => vs.includes(l[col]))), q),
      ilike: (col: string, motif: string) => {
        const re = new RegExp(
          "^" + motif.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*") + "$",
          "i",
        );
        lignes = lignes.filter((l) => re.test(String(l[col] ?? "")));
        return q;
      },
      limit: () => q,
      insert: (l: Ligne) => {
        aInserer = l;
        return q;
      },
      maybeSingle: async () => {
        if (aInserer) {
          const cle = aInserer["idempotency_key"];
          if (table === "taches" && cle && tables.taches.some((t) => t["idempotency_key"] === cle)) {
            return { data: null, error: { code: "23505", message: "duplicate key" } };
          }
          const ligne = { id: `${table}-${tables[table].length + 1}`, ...aInserer };
          tables[table].push(ligne);
          return { data: { id: ligne.id }, error: null };
        }
        return { data: lignes[0] ?? null, error: null };
      },
      then: (ok: (r: unknown) => unknown) => {
        if (aInserer) {
          tables[table].push({ id: `${table}-${tables[table].length + 1}`, ...aInserer });
          return Promise.resolve({ data: null, error: null }).then(ok);
        }
        return Promise.resolve({ data: lignes, error: null }).then(ok);
      },
    };
    return q;
  };

  const admin = {
    from: requete,
    storage: {
      from: () => ({
        list: async (prefixe: string) => ({
          data: stockage
            .filter((c) => c.startsWith(`${prefixe}/`))
            .map((c) => ({ name: c.slice(prefixe.length + 1) })),
          error: null,
        }),
        upload: async (chemin: string) => {
          stockage.push(chemin);
          uploads.push(chemin);
          return { error: null };
        },
      }),
    },
  };
  return { admin, tables, uploads };
}

const parametres = {
  gmail_message_id: "msg-123",
  sujet: "Relevé de commissions",
  texte: null,
  compagnie: "April",
  pieces_jointes: [{ nom: "releve_commission.pdf", mime: "application/pdf", attachment_id: "att-1" }],
  userId: "admin-1",
};

beforeEach(() => {
  telecharger.mockReset();
  process.env["LOVABLE_API_KEY"] = "cle-test";
  // L'IA ne reconnaît aucun titulaire connu du CRM → pièce « à classer ».
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"nom":"Inconnu","prenom":null,"numero_contrat":null,"nature":"relevé","confidence":0.4,"justification":"x"}' } }],
        }),
        { status: 200 },
      ),
    ),
  );
});

describe("pièces partenaires — idempotence", () => {
  it("cas « à classer » : 3 passages du même mail → 1 tâche, 1 dépôt", async () => {
    telecharger.mockResolvedValue({ base64: Buffer.from("pdf").toString("base64") });
    const { admin, tables, uploads } = fauxAdmin();

    const r1 = await traiterPiecesJointesPartenaire(admin as never, parametres);
    const r2 = await traiterPiecesJointesPartenaire(admin as never, parametres);
    const r3 = await traiterPiecesJointesPartenaire(admin as never, parametres);

    expect(r1.details[0]!.statut).toBe("a_classer");
    expect(r2.details[0]!.statut).toBe("deja_traite");
    expect(r3.details[0]!.statut).toBe("deja_traite");
    expect(tables.taches).toHaveLength(1);
    expect(tables.taches[0]!["idempotency_key"]).toBe("piece_partenaire:a_classer:msg-123:releve_commission.pdf");
    expect(tables.taches[0]!["source"]).toBe("pieces-partenaire");
    expect(uploads).toHaveLength(1);
    expect(telecharger).toHaveBeenCalledTimes(1);
  });

  it("cas « échec » : 3 passages du même mail → 1 tâche, aucun nouveau téléchargement", async () => {
    telecharger.mockRejectedValue(new Error("Gmail indisponible"));
    const { admin, tables, uploads } = fauxAdmin();

    const r1 = await traiterPiecesJointesPartenaire(admin as never, parametres);
    const r2 = await traiterPiecesJointesPartenaire(admin as never, parametres);
    const r3 = await traiterPiecesJointesPartenaire(admin as never, parametres);

    expect(r1.details[0]!.statut).toBe("echec");
    expect(r2.details[0]!.statut).toBe("deja_traite");
    expect(r3.details[0]!.statut).toBe("deja_traite");
    expect(tables.taches).toHaveLength(1);
    expect(tables.taches[0]!["idempotency_key"]).toBe("piece_partenaire:echec:msg-123:releve_commission.pdf");
    expect(uploads).toHaveLength(0);
    expect(telecharger).toHaveBeenCalledTimes(1);
  });

  it("deux pièces différentes du même mail → deux tâches distinctes", async () => {
    telecharger.mockResolvedValue({ base64: Buffer.from("pdf").toString("base64") });
    const { admin, tables } = fauxAdmin();
    const deuxPieces = {
      ...parametres,
      pieces_jointes: [
        { nom: "releve.pdf", mime: "application/pdf", attachment_id: "a1" },
        { nom: "detail.csv", mime: "text/csv", attachment_id: "a2" },
      ],
    };

    await traiterPiecesJointesPartenaire(admin as never, deuxPieces);
    await traiterPiecesJointesPartenaire(admin as never, deuxPieces);

    expect(tables.taches).toHaveLength(2);
  });
});
