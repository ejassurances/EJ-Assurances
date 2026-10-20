import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { analyserDocumentsAvecWorkersAi } from "@/lib/workers-ai.server";

const TAILLE_MAX_PDF = 12 * 1024 * 1024;

const produitExtraitSchema = z.object({
  nom: z.string().trim().min(2).max(180),
  code_produit: z.string().trim().max(120).nullable().optional(),
  famille_code: z.string().trim().max(100).nullable().optional(),
  description: z.string().trim().max(800).nullable().optional(),
});

function extraireJson(texte: string): unknown {
  const nettoye = texte
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
  try {
    return JSON.parse(nettoye);
  } catch {
    const debut = nettoye.indexOf("{");
    const fin = nettoye.lastIndexOf("}");
    if (debut < 0 || fin <= debut) throw new Error("Réponse IA invalide");
    return JSON.parse(nettoye.slice(debut, fin + 1));
  }
}

function cleNom(nom: string): string {
  return nom
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleLowerCase("fr-FR")
    .replace(/\s+/g, " ");
}

export async function analyserCatalogueProduits(
  supabase: SupabaseClient,
  compagnieId: string,
  storagePath: string,
) {
  const cheminAttendu = new RegExp(`^catalogue-imports/${compagnieId}/[0-9a-f-]{36}\\.pdf$`, "i");
  if (!cheminAttendu.test(storagePath)) {
    throw new Error("Le fichier temporaire du catalogue n’est pas valide.");
  }

  let resultat: { produits: z.infer<typeof produitExtraitSchema>[]; modele: string } | null = null;
  try {
    const { data: compagnie, error: compagnieError } = await supabase
      .from("compagnies")
      .select("id,nom")
      .eq("id", compagnieId)
      .maybeSingle();
    if (compagnieError) throw new Error(compagnieError.message);
    if (!compagnie) throw new Error("Compagnie introuvable.");

    const { data: familles, error: famillesError } = await supabase
      .from("produit_familles")
      .select("code,nom")
      .order("ordre");
    if (famillesError) throw new Error(famillesError.message);
    const famillesDisponibles = (familles ?? []) as { code: string; nom: string }[];
    if (famillesDisponibles.length === 0) {
      throw new Error("Aucune famille de produits n’est configurée dans le CRM.");
    }

    const { data: fichier, error: fichierError } = await supabase.storage
      .from("produits-documents")
      .download(storagePath);
    if (fichierError || !fichier) {
      throw new Error(fichierError?.message ?? "Le PDF du catalogue est introuvable.");
    }

    if (fichier.size === 0) throw new Error("Le PDF sélectionné est vide.");
    if (fichier.size > TAILLE_MAX_PDF) {
      throw new Error("Le PDF du catalogue ne doit pas dépasser 12 Mo.");
    }

    const buffer = Buffer.from(await fichier.arrayBuffer());
    if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
      throw new Error("Le fichier envoyé n’est pas un PDF valide.");
    }
    const prompt = `Tu extrais la liste complète des produits d’assurance commercialisés par une compagnie à partir de son catalogue.
Compagnie : ${compagnie.nom}

Règles :
- Recense chaque produit d’assurance distinct explicitement présent dans le document, sans en inventer ni en omettre volontairement.
- Conserve le nom commercial tel qu’il apparaît. Ne crée pas un produit distinct pour chaque garantie, niveau, option ou tarif d’un même produit.
- N’extrais pas les noms d’assureurs, les garanties, les mentions légales, les titres de rubrique ou les exemples comme des produits.
- Renseigne le code uniquement s’il apparaît dans le document ; sinon null.
- Renseigne la description uniquement avec des faits explicitement écrits dans le document ; sinon null.
- Associe chaque produit à une seule famille parmi cette liste, en renvoyant son code exact. Si la famille ne peut pas être déterminée, utilise null.
- Retourne les produits dans l’ordre du document et élimine uniquement les doublons évidents.
- Réponds uniquement en JSON conforme à ce schéma : {"produits":[{"nom":"...","code_produit":null,"famille_code":"...","description":null}]}.

Familles disponibles :
${famillesDisponibles.map((famille) => `- ${famille.code} : ${famille.nom}`).join("\n")}`;

    const { texte } = await analyserDocumentsAvecWorkersAi(prompt, [
      {
        nom: storagePath.split("/").at(-1) ?? "catalogue.pdf",
        mime: "application/pdf",
        base64: buffer.toString("base64"),
      },
    ]);
    const reponse = z
      .object({ produits: z.array(produitExtraitSchema).min(1).max(250) })
      .safeParse(extraireJson(texte));
    if (!reponse.success) {
      throw new Error(
        "Je n’ai pas pu extraire une liste exploitable. Vérifiez que le PDF contient bien le catalogue des produits.",
      );
    }

    const codesFamilles = new Set(famillesDisponibles.map((famille) => famille.code));
    const vus = new Set<string>();
    const produits = reponse.data.produits.flatMap((produit) => {
      const nom = produit.nom.trim();
      const cle = cleNom(nom);
      if (!cle || vus.has(cle)) return [];
      vus.add(cle);
      return [
        {
          nom,
          code_produit: produit.code_produit?.trim() || null,
          famille_code:
            produit.famille_code && codesFamilles.has(produit.famille_code)
              ? produit.famille_code
              : null,
          description: produit.description?.trim() || null,
        },
      ];
    });

    if (produits.length === 0) {
      throw new Error("Aucun produit n’a été détecté dans ce PDF.");
    }
    resultat = { produits, modele: "Workers AI" };
  } catch (cause) {
    const { error: suppressionError } = await supabase.storage
      .from("produits-documents")
      .remove([storagePath]);
    if (suppressionError) {
      throw new Error("L’analyse a échoué et le PDF temporaire n’a pas pu être supprimé.");
    }
    throw cause;
  }

  const { error: suppressionError } = await supabase.storage
    .from("produits-documents")
    .remove([storagePath]);
  if (suppressionError) {
    throw new Error("L’analyse est terminée, mais le PDF temporaire n’a pas pu être supprimé.");
  }
  if (!resultat) throw new Error("L’analyse du catalogue n’a retourné aucun résultat.");
  return resultat;
}
