/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * File d'attente de l'agent relation client : réponses niveau 2 préparées en
 * brouillon, validées / éditées / envoyées manuellement par le cabinet.
 */

async function exigerStaff(supabase: any, userId: string) {
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  const roles = ((data ?? []) as { role: string }[]).map((r) => r.role);
  if (!roles.includes("admin") && !roles.includes("mandataire")) throw new Error("Accès réservé au cabinet.");
}

const SELECT =
  "id, client_id, contrat_id, gmail_message_id, email_sujet, categorie, intention, confiance, resume, destinataire, objet, corps, statut, motif, created_at, envoye_le, clients(nom, prenom, email)";

/** Réponses en attente de validation (toutes, ou celles d'un client). */
export const reponsesEnAttente = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ client_id: z.string().uuid().optional().nullable() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    await exigerStaff(context.supabase, context.userId);
    let requete = (context.supabase as any)
      .from("client_reponses_ia")
      .select(SELECT)
      .eq("statut", "brouillon")
      .order("created_at", { ascending: false })
      .limit(50);
    if (data.client_id) requete = requete.eq("client_id", data.client_id);
    const { data: rows, error } = await requete;
    if (error) throw new Error(error.message);
    return { reponses: (rows ?? []) as any[] };
  });

/** Édition du brouillon (objet et corps) avant envoi. */
export const modifierReponse = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        objet: z.string().trim().min(1).max(300),
        corps: z.string().trim().min(1).max(20000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await exigerStaff(context.supabase, context.userId);
    const { error } = await (context.supabase as any)
      .from("client_reponses_ia")
      .update({ objet: data.objet, corps: data.corps })
      .eq("id", data.id)
      .eq("statut", "brouillon");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Envoi manuel du brouillon validé par le cabinet. */
export const envoyerReponseValidee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await exigerStaff(context.supabase, context.userId);
    const { data: row, error } = await (context.supabase as any)
      .from("client_reponses_ia")
      .select("id, client_id, destinataire, objet, corps, statut, gmail_message_id, clients(nom, prenom, email)")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const r = row as any;
    if (!r || r.statut !== "brouillon") throw new Error("Cette réponse n'est plus en brouillon.");
    const destinataire: string | null = r.destinataire ?? r.clients?.email ?? null;
    if (!destinataire) throw new Error("Aucune adresse email sur la fiche client.");

    const { sendTemplateEmail } = await import("@/lib/email-templates/send-email");
    const paragraphes = String(r.corps ?? "")
      .split(/\n{2,}/)
      .map((p: string) => p.trim())
      .filter(Boolean);
    await sendTemplateEmail("relation-client-reponse", destinataire, {
      templateData: {
        clientName: [r.clients?.prenom, r.clients?.nom].filter(Boolean).join(" "),
        titre: r.objet ?? "Votre demande",
        paragraphes,
      },
      liens: { client_id: r.client_id ?? null, contrat_id: r.contrat_id ?? null },
    });

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await (supabaseAdmin as any)
      .from("client_reponses_ia")
      .update({ statut: "envoye", envoye_le: new Date().toISOString(), envoye_par: context.userId })
      .eq("id", r.id);
    // Service Client : brouillon validé et envoyé → Archive.
    if (r.gmail_message_id) {
      const { poserLabelCabinet } = await import("@/lib/gmail.server");
      await poserLabelCabinet(r.gmail_message_id, "sc_archive", {
        retirer: ["sc_a_traiter", "sc_attente_validation"],
      });
    }
    await (supabaseAdmin as any).from("activites").insert({
      client_id: r.client_id,
      type: "email",
      titre: "Réponse validée par le cabinet et envoyée au client",
      contenu: `Objet : ${r.objet ?? ""}\n\n${r.corps ?? ""}`,
      created_by: context.userId,
    });
    return { ok: true };
  });

/** Abandon du brouillon (traité autrement). */
export const abandonnerReponse = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await exigerStaff(context.supabase, context.userId);
    const { error } = await (context.supabase as any)
      .from("client_reponses_ia")
      .update({ statut: "abandonne" })
      .eq("id", data.id)
      .eq("statut", "brouillon");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Signalement d'une réponse automatique (niveau 1) comme incorrecte.
 * Traçabilité seule : la réponse est marquée et une tâche admin est créée,
 * aucune action corrective automatique n'est déclenchée.
 */
export const signalerReponseIncorrecte = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        client_id: z.string().uuid(),
        activite_le: z.string().min(1),
        activite_titre: z.string().max(300).optional().nullable(),
        motif: z.string().trim().min(3).max(2000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await exigerStaff(context.supabase, context.userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Réponse automatique la plus proche (envoyée avant l'activité journalisée).
    const borne = new Date(new Date(data.activite_le).getTime() + 60_000).toISOString();
    const { data: rows } = await (supabaseAdmin as any)
      .from("client_reponses_ia")
      .select("id, objet, categorie, intention, envoye_le")
      .eq("client_id", data.client_id)
      .eq("statut", "envoye")
      .lte("envoye_le", borne)
      .order("envoye_le", { ascending: false })
      .limit(1);
    const reponse = ((rows ?? []) as any[])[0] as { id: string; intention: string | null } | undefined;

    if (reponse) {
      await (supabaseAdmin as any)
        .from("client_reponses_ia")
        .update({
          signalee_incorrecte: true,
          motif_signalement: data.motif,
          signalee_le: new Date().toISOString(),
          signalee_par: context.userId,
        })
        .eq("id", reponse.id);
    }

    const { data: cli } = await (supabaseAdmin as any)
      .from("clients")
      .select("nom, prenom")
      .eq("id", data.client_id)
      .maybeSingle();
    const nom = [(cli as any)?.prenom, (cli as any)?.nom].filter(Boolean).join(" ") || "Client";

    const { creerTacheAdmin } = await import("@/lib/agent-taches.server");
    await creerTacheAdmin(supabaseAdmin as never, {
      titre: `Réponse automatique signalée incorrecte — ${nom}`,
      description: [
        `Activité : ${data.activite_titre ?? "réponse automatique"}`,
        `Date de la réponse : ${new Date(data.activite_le).toLocaleString("fr-FR")}`,
        reponse ? `Réponse concernée : ${reponse.id} (intention ${reponse.intention ?? "—"})` : "Réponse d'origine non retrouvée en base.",
        "",
        `Motif du signalement : ${data.motif}`,
      ].join("\n"),
      client_id: data.client_id,
      priorite: "haute",
      created_by: context.userId,
    });

    await (supabaseAdmin as any).from("activites").insert({
      client_id: data.client_id,
      type: "systeme",
      titre: "Réponse automatique signalée comme incorrecte",
      contenu: `Motif : ${data.motif}`,
      created_by: context.userId,
    });

    return { ok: true, reponse_id: reponse?.id ?? null };
  });
