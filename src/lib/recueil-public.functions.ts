import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Recueil des besoins emprunteur ouvert par lien sécurisé, sans compte client.
 *
 * Le formulaire public (site ej-assurances.fr) appelle `submit_public_intake`,
 * qui crée la fiche client, le dossier EMP et une ligne `contact_requests`
 * portant l'empreinte SHA-256 d'un jeton à usage de suivi (valable 30 jours).
 * Le jeton en clair n'est transmis qu'au prospect, par e-mail. Ici, on retrouve
 * le dossier à partir de l'empreinte et on n'expose que le strict nécessaire.
 */

const tokenSchema = z.string().trim().regex(/^[a-f0-9]{48}$/, "Lien invalide.");
const MAX_RECUEIL_BYTES = 200_000;

async function empreinteJeton(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

type DossierLie = {
  contactId: string;
  clientId: string | null;
  dossierId: string;
  reference: string | null;
  prenom: string | null;
  recueil: Record<string, unknown> | null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function retrouverDossier(admin: any, token: string): Promise<DossierLie> {
  const hash = await empreinteJeton(token);
  const { data: demande, error } = await admin
    .from("contact_requests")
    .select("id, first_name, client_id, dossier_id, dossier_reference, followup_token_expires_at")
    .eq("followup_token_hash", hash)
    .maybeSingle();
  if (error) throw new Error("Lien indisponible pour le moment. Réessayez plus tard.");
  if (!demande || !demande.dossier_id) throw new Error("Ce lien n'est pas valide.");
  if (demande.followup_token_expires_at && new Date(demande.followup_token_expires_at) < new Date()) {
    throw new Error("Ce lien a expiré. Répondez à notre e-mail pour en recevoir un nouveau.");
  }

  const { data: dossier, error: dossierError } = await admin
    .from("dossiers")
    .select("id, reference, type_assurance, recueil_besoins")
    .eq("id", demande.dossier_id)
    .maybeSingle();
  if (dossierError || !dossier) throw new Error("Dossier introuvable.");
  if (dossier.type_assurance !== "emprunteur") throw new Error("Ce lien ne concerne pas un recueil emprunteur.");

  return {
    contactId: demande.id,
    clientId: demande.client_id ?? null,
    dossierId: dossier.id,
    reference: dossier.reference ?? demande.dossier_reference ?? null,
    prenom: demande.first_name ?? null,
    recueil: (dossier.recueil_besoins as Record<string, unknown> | null) ?? null,
  };
}

export const chargerRecueilPublic = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ token: tokenSchema }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const d = await retrouverDossier(supabaseAdmin, data.token);
    // Le recueil est transmis sérialisé : sa forme dépend du schéma de branche.
    return { prenom: d.prenom, reference: d.reference, recueilJson: JSON.stringify(d.recueil ?? {}) };
  });

export const enregistrerRecueilPublic = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        token: tokenSchema,
        recueil: z.record(z.string(), z.unknown()),
        final: z.boolean(),
        message: z.string().trim().max(2000).optional().nullable(),
      })
      .refine((v) => JSON.stringify(v.recueil).length <= MAX_RECUEIL_BYTES, "Réponses trop volumineuses.")
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { isRateLimited } = await import("@/lib/rate-limit");
    if (isRateLimited(`recueil-public:${data.token}`, 60, 10 * 60 * 1000)) {
      throw new Error("Trop d'enregistrements rapprochés. Patientez quelques minutes.");
    }

    const d = await retrouverDossier(supabaseAdmin, data.token);
    const { assurePrincipalEmprunteur, ageDepuisDateNaissance } = await import("@/lib/recueil-besoins-schemas");

    // Champs de compatibilité emprunteur, calculés comme dans l'espace client.
    const principal = assurePrincipalEmprunteur(data.recueil["assures"]);
    const maj: Record<string, unknown> = {
      recueil_besoins: data.recueil,
      capital: Number(data.recueil["capital"]) || null,
      duree_mois: Number(data.recueil["duree_mois"]) || null,
      age: principal ? ageDepuisDateNaissance(principal.date_naissance) : null,
      fumeur: principal ? principal.fumeur === true : null,
    };
    if (data.final) {
      maj["prochaine_action"] = "Contrôler le recueil des besoins reçu et demander les pièces manquantes";
      maj["prochaine_action_le"] = new Date().toISOString().slice(0, 10);
    }

    const { error } = await supabaseAdmin.from("dossiers").update(maj as never).eq("id", d.dossierId);
    if (error) throw new Error("Enregistrement impossible. Réessayez dans quelques instants.");

    if (data.final) {
      const { data: admins } = await supabaseAdmin.from("user_roles").select("user_id").eq("role", "admin").limit(1);
      const adminId = admins?.[0]?.user_id ?? null;
      const contenu = [
        `Recueil des besoins emprunteur complété par le prospect (dossier ${d.reference ?? d.dossierId}).`,
        data.message ? `Précisions du prospect :\n${data.message}` : null,
      ]
        .filter(Boolean)
        .join("\n\n");

      if (d.clientId) {
        await supabaseAdmin.from("activites").insert({
          client_id: d.clientId,
          type: "note",
          titre: "Recueil des besoins reçu (lien sécurisé)",
          contenu,
        } as never);
      }
      // Un nouvel envoi du recueil ne doit pas empiler les tâches de contrôle.
      const { data: dejaOuverte } = await supabaseAdmin
        .from("taches")
        .select("id")
        .eq("dossier_id", d.dossierId)
        .eq("titre", "Contrôler le recueil des besoins reçu")
        .eq("statut", "a_faire")
        .limit(1);
      if (!dejaOuverte || dejaOuverte.length === 0) await supabaseAdmin.from("taches").insert({
        client_id: d.clientId,
        dossier_id: d.dossierId,
        titre: "Contrôler le recueil des besoins reçu",
        description: contenu,
        echeance: new Date().toISOString().slice(0, 10),
        priorite: "haute",
        statut: "a_faire",
        assignee_id: adminId,
      } as never);
    }

    return { ok: true as const, reference: d.reference };
  });
