import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Recueil des besoins emprunteur rempli par le client depuis son espace,
 * pour un dossier EMP déjà ouvert (demande d'étude du site public).
 *
 * Les réponses ne sont écrites dans le dossier qu'à l'envoi final : la lettre
 * de mission, qui reprend le recueil, n'est préparée que pour un recueil
 * complet (voir `envoyerLettresMissionDues`).
 */

const MAX_RECUEIL_BYTES = 200_000;

async function maFiche(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("id, nom, prenom")
    .eq("user_id", userId)
    .maybeSingle();
  return { supabaseAdmin, client };
}

/** Dossiers emprunteur du client dont le recueil n'est pas encore transmis. */
export const mesRecueilsAFaire = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin, client } = await maFiche(context.userId);
    if (!client) return { dossiers: [] as { id: string; reference: string }[] };
    const { data } = await supabaseAdmin
      .from("dossiers")
      .select("id, reference, recueil_besoins")
      .eq("client_id", client.id)
      .eq("type_assurance", "emprunteur")
      .in("statut", ["nouveau", "en_cours"])
      .order("created_at", { ascending: false });
    const dossiers = (data ?? [])
      .filter((d) => {
        const r = d.recueil_besoins as Record<string, unknown> | null;
        return !r || Object.keys(r).length === 0;
      })
      .map((d) => ({ id: d.id, reference: d.reference }));
    return { dossiers };
  });

export const envoyerMonRecueil = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        dossier_id: z.string().uuid(),
        recueil: z.record(z.string(), z.unknown()),
        message: z.string().trim().max(2000).optional().nullable(),
      })
      .refine(
        (v) => JSON.stringify(v.recueil).length <= MAX_RECUEIL_BYTES,
        "Réponses trop volumineuses.",
      )
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin, client } = await maFiche(context.userId);
    if (!client) throw new Error("Aucune fiche client rattachée à votre compte.");

    const { data: dossier } = await supabaseAdmin
      .from("dossiers")
      .select("id, reference, client_id, type_assurance")
      .eq("id", data.dossier_id)
      .maybeSingle();
    if (!dossier || dossier.client_id !== client.id || dossier.type_assurance !== "emprunteur") {
      throw new Error("Dossier introuvable.");
    }

    const { assurePrincipalEmprunteur, ageDepuisDateNaissance } =
      await import("@/lib/recueil-besoins-schemas");
    const principal = assurePrincipalEmprunteur(data.recueil["assures"]);
    const { error } = await supabaseAdmin
      .from("dossiers")
      .update({
        recueil_besoins: data.recueil,
        capital: Number(data.recueil["capital"]) || null,
        duree_mois: Number(data.recueil["duree_mois"]) || null,
        age: principal ? ageDepuisDateNaissance(principal.date_naissance) : null,
        fumeur: principal ? principal.fumeur === true : null,
        prochaine_action: "Contrôler le recueil reçu ; la lettre de mission part automatiquement",
        prochaine_action_le: new Date().toISOString().slice(0, 10),
      } as never)
      .eq("id", dossier.id);
    if (error) throw new Error("Enregistrement impossible. Réessayez dans quelques instants.");

    // Contrôle LCB-FT (gel des avoirs, PPE) de chaque assuré dont l'identité est complète.
    const { lancerLcbAutomatique } = await import("@/lib/dossier-automation.server");
    const assures = Array.isArray(data.recueil["assures"])
      ? (data.recueil["assures"] as Record<string, unknown>[])
      : [];
    for (const a of assures) {
      const nom = typeof a["nom"] === "string" ? a["nom"].trim() : "";
      const prenom = typeof a["prenom"] === "string" ? a["prenom"].trim() : "";
      const dateNaissance = typeof a["date_naissance"] === "string" ? a["date_naissance"] : null;
      if (!nom) continue;
      await lancerLcbAutomatique(supabaseAdmin, {
        client_id: client.id,
        nom,
        prenom,
        date_naissance: dateNaissance,
      });
    }

    const { data: admins } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin")
      .limit(1);
    const contenu = [
      `Recueil des besoins emprunteur envoyé par le client depuis son espace (dossier ${dossier.reference}).`,
      `Contrôle LCB-FT lancé pour ${assures.length} assuré(s).`,
      data.message ? `Précisions du client :\n${data.message}` : null,
    ]
      .filter(Boolean)
      .join("\n\n");
    await supabaseAdmin.from("activites").insert({
      client_id: client.id,
      type: "note",
      titre: "Recueil des besoins reçu (espace client)",
      contenu,
    } as never);
    await supabaseAdmin.from("taches").insert({
      client_id: client.id,
      dossier_id: dossier.id,
      titre: "Contrôler le recueil des besoins reçu",
      description: contenu,
      echeance: new Date().toISOString().slice(0, 10),
      priorite: "haute",
      statut: "a_faire",
      assignee_id: admins?.[0]?.user_id ?? null,
    } as never);

    return { ok: true as const, reference: dossier.reference };
  });
