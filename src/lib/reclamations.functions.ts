/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * Module réclamations — consultation par le cabinet et actions manuelles.
 * La solution proposée n'est JAMAIS envoyée automatiquement : le staff la
 * valide (et peut la reformuler) avant tout envoi au client ou à la compagnie.
 */

const CABINET = "EJ Partners Assurances";

const LISTE_SELECT =
  "id, client_id, contrat_id, compagnie_id, statut, concerne, resume, solution_proposee, date_ouverture, date_accuse_reception, date_cloture, gmail_message_id, clients(nom, prenom, email), contrats(numero, assureur, produit, compagnie_id), compagnies(nom, email_reclamations)";

async function exigerStaff(supabase: any, userId: string) {
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  const roles = ((data ?? []) as { role: string }[]).map((r) => r.role);
  if (!roles.includes("admin") && !roles.includes("mandataire")) throw new Error("Accès réservé au cabinet.");
}

function nomClient(c: any): string {
  return [c?.prenom, c?.nom].filter(Boolean).join(" ") || "Madame, Monsieur";
}

async function chargerReclamation(supabase: any, id: string) {
  const { data, error } = await supabase.from("reclamations").select(LISTE_SELECT).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Réclamation introuvable.");
  return data as any;
}

export const listeReclamations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ statut: z.string().optional().nullable() }).parse(input ?? {}))
  .handler(async ({ data, context }) => {
    await exigerStaff(context.supabase, context.userId);
    let requete = (context.supabase as any)
      .from("reclamations")
      .select(LISTE_SELECT)
      .order("date_ouverture", { ascending: false })
      .limit(200);
    if (data.statut) requete = requete.eq("statut", data.statut);
    const { data: rows, error } = await requete;
    if (error) throw new Error(error.message);
    return { reclamations: (rows ?? []) as any[] };
  });

/** Validation par le staff de la solution proposée : envoi au client. */
export const envoyerSolutionReclamation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid(), solution: z.string().trim().min(10).max(6000) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await exigerStaff(context.supabase, context.userId);
    const r = await chargerReclamation(context.supabase, data.id);
    const destinataire: string | null = r.clients?.email ?? null;
    if (!destinataire) throw new Error("Aucune adresse email sur la fiche client.");

    const { sendTemplateEmail } = await import("@/lib/email-templates/send-email");
    await sendTemplateEmail("relation-client-reponse", destinataire, {
      templateData: {
        clientName: nomClient(r.clients),
        cabinetName: CABINET,
        titre: "Réponse à votre réclamation",
        paragraphes: data.solution
          .split(/\n{2,}/)
          .map((p) => p.trim())
          .filter(Boolean),
      },
      liens: { client_id: r.client_id ?? null, contrat_id: r.contrat_id ?? null },
    });

    const maintenant = new Date().toISOString();
    const { error } = await (context.supabase as any)
      .from("reclamations")
      .update({ solution_proposee: data.solution, statut: "en_attente_reponse", updated_at: maintenant })
      .eq("id", r.id);
    if (error) throw new Error(error.message);

    await (context.supabase as any).from("activites").insert({
      client_id: r.client_id,
      type: "email",
      titre: "Réponse à réclamation validée par le cabinet et envoyée au client",
      contenu: data.solution.slice(0, 6000),
      created_by: context.userId,
    });
    return { ok: true };
  });

/** Validation par le staff de l'escalade : transmission à la compagnie, client en copie. */
export const transmettreReclamationCompagnie = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid(), message: z.string().trim().min(10).max(6000) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await exigerStaff(context.supabase, context.userId);
    const r = await chargerReclamation(context.supabase, data.id);
    const compagnieId: string | null = r.compagnie_id ?? r.contrats?.compagnie_id ?? null;
    if (!compagnieId)
      throw new Error("Aucune compagnie rattachée à cette réclamation : assignez-en une depuis la liste.");

    const { data: comp } = await (context.supabase as any)
      .from("compagnies")
      .select("nom, email_reclamations")
      .eq("id", compagnieId)
      .maybeSingle();
    const destinataire: string | null = (comp as any)?.email_reclamations ?? null;
    if (!destinataire)
      throw new Error("Adresse email dédiée aux réclamations absente de la fiche compagnie : à renseigner.");

    const { envoyerMessage } = await import("@/lib/gmail.server");
    const html = data.message
      .split(/\n/)
      .map((l) => `<p style="margin:0 0 12px">${l.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p>`)
      .join("");
    await envoyerMessage({
      to: destinataire,
      cc: r.clients?.email ?? null,
      sujet: `Réclamation client — ${nomClient(r.clients)}${r.contrats?.numero ? ` — contrat ${r.contrats.numero}` : ""}`.slice(
        0,
        200,
      ),
      html,
    });

    const maintenant = new Date().toISOString();
    const { error } = await (context.supabase as any)
      .from("reclamations")
      .update({ statut: "en_attente_reponse", updated_at: maintenant })
      .eq("id", r.id);
    if (error) throw new Error(error.message);

    await (context.supabase as any).from("activites").insert({
      client_id: r.client_id,
      type: "email",
      titre: `Réclamation transmise à la compagnie ${(comp as any)?.nom ?? ""}`.trim(),
      contenu: `Destinataire : ${destinataire}\nClient en copie : ${r.clients?.email ?? "—"}\n\n${data.message}`.slice(0, 6000),
      created_by: context.userId,
    });
    return { ok: true };
  });

/** Assignation/changement de la compagnie concernée (staff), y compris sans contrat rattaché. */
export const assignerCompagnieReclamation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid(), compagnie_id: z.string().uuid().nullable() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await exigerStaff(context.supabase, context.userId);
    const r = await chargerReclamation(context.supabase, data.id);
    const { error } = await (context.supabase as any)
      .from("reclamations")
      .update({ compagnie_id: data.compagnie_id, updated_at: new Date().toISOString() })
      .eq("id", r.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Liste des compagnies actives pour l'assignation (staff). */
export const listeCompagniesPourReclamation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await exigerStaff(context.supabase, context.userId);
    const { data: rows, error } = await (context.supabase as any)
      .from("compagnies")
      .select("id, nom, type_partenaire")
      .eq("statut", "actif")
      .order("nom");
    if (error) throw new Error(error.message);
    return { compagnies: (rows ?? []) as { id: string; nom: string; type_partenaire: string | null }[] };
  });

/** Clôture manuelle du dossier de réclamation (label Gmail → Archive). */
export const cloturerReclamation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await exigerStaff(context.supabase, context.userId);
    const r = await chargerReclamation(context.supabase, data.id);
    const maintenant = new Date().toISOString();
    const { error } = await (context.supabase as any)
      .from("reclamations")
      .update({ statut: "clos", date_cloture: maintenant, updated_at: maintenant })
      .eq("id", r.id);
    if (error) throw new Error(error.message);

    if (r.gmail_message_id) {
      const { poserLabelCabinet } = await import("@/lib/gmail.server");
      await poserLabelCabinet(r.gmail_message_id, "rec_archive", {
        retirer: ["rec_a_traiter", "rec_attente_validation"],
      });
    }
    return { ok: true };
  });
