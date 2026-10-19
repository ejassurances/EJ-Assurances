import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * Action back-office : crée (ou réinitialise) l'accès espace client et envoie
 * un mot de passe provisoire par e-mail. Réservé admin / mandataire.
 */
export const creerAccesEspaceClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ client_id: z.string().uuid(), origin: z.string().url() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: roles } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    const allowed = (roles ?? []).some((r) => r.role === "admin" || r.role === "mandataire");
    if (!allowed) return { ok: false as const, error: "Action réservée aux administrateurs et mandataires." };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: client } = await supabaseAdmin
      .from("clients")
      .select("id, nom, prenom, email")
      .eq("id", data.client_id)
      .maybeSingle();

    if (!client) return { ok: false as const, error: "Fiche client introuvable." };
    if (!client.email) return { ok: false as const, error: "Cette fiche n'a pas d'adresse e-mail." };

    const email = client.email.toLowerCase();
    const { creerEspaceClient, reinitialiserAccesEspaceClient } = await import("@/lib/dossier-automation.server");

    const { data: existing } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const compte = existing?.users.find((u) => u.email?.toLowerCase() === email);

    if (compte) {
      const res = await reinitialiserAccesEspaceClient(supabaseAdmin, {
        client_id: client.id,
        user_id: compte.id,
        email,
        nom: client.nom,
        prenom: client.prenom,
        origin: data.origin,
      });
      return {
        ok: true as const,
        created: false,
        email_sent: res.email_sent,
        email_error: res.email_error ?? null,
      };
    }

    const res = await creerEspaceClient(supabaseAdmin, {
      client_id: client.id,
      email,
      nom: client.nom,
      prenom: client.prenom,
      origin: data.origin,
    });
    if (!res.user_id) return { ok: false as const, error: res.email_error ?? "Création du compte impossible." };
    return {
      ok: true as const,
      created: res.created,
      email_sent: res.email_sent,
      email_error: res.email_error ?? null,
    };
  });

/**
 * Renvoie uniquement le lien de connexion à un client qui a déjà reçu
 * l'e-mail complet (DER + présentation). Aucun mot de passe n'est modifié.
 */
export const renvoyerLienConnexion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ client_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: roles } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    const allowed = (roles ?? []).some((r) => r.role === "admin" || r.role === "mandataire");
    if (!allowed) return { ok: false as const, error: "Action réservée aux administrateurs et mandataires." };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: client } = await supabaseAdmin
      .from("clients")
      .select("id, nom, prenom, email, user_id")
      .eq("id", data.client_id)
      .maybeSingle();

    if (!client) return { ok: false as const, error: "Fiche client introuvable." };
    if (!client.email) return { ok: false as const, error: "Cette fiche n'a pas d'adresse e-mail." };
    if (!client.user_id) {
      return {
        ok: false as const,
        error: "Aucun espace client existant : utilisez « Créer l'espace client ».",
      };
    }

    const { appUrl } = await import("@/lib/app-url");
    const { sendTemplateEmail } = await import("@/lib/email-templates/send-email");
    try {
      const res = await sendTemplateEmail("lien-connexion", client.email.toLowerCase(), {
        templateData: {
          clientName: `${client.prenom ?? ""} ${client.nom}`.trim(),
          email: client.email.toLowerCase(),
          cabinetName: "EJ Partners Assurances",
          link: appUrl("/auth"),
        },
      });
      if (!res.sent) return { ok: false as const, error: "Adresse en liste de suppression : envoi refusé." };
      return { ok: true as const };
    } catch (e) {
      const message = e instanceof Error ? e.message : "Erreur d'envoi inconnue";
      return { ok: false as const, error: `Envoi impossible : ${message}` };
    }
  });

/** Lève l'obligation de changement de mot de passe après un changement réussi. */
export const validerChangementMotDePasse = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { error } = await context.supabase
      .from("profiles")
      .update({ must_change_password: false })
      .eq("id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Version du texte RGPD/CGU en vigueur. */
export const VERSION_TEXTES_PLATEFORME = "2026-08-13";

/** Enregistre l'acceptation RGPD + CGU du client (IP relevée côté serveur). */
export const enregistrerConsentementsPlateforme = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getRequestHeader, getRequestIP } = await import("@tanstack/react-start/server");
    const ip =
      getRequestIP({ xForwardedFor: true }) ??
      getRequestHeader("x-forwarded-for")?.split(",")[0]?.trim() ??
      null;

    const { data: client, error: clientErr } = await context.supabase
      .from("clients")
      .select("id")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (clientErr) throw new Error(clientErr.message);
    if (!client) throw new Error("Aucune fiche client rattachée à ce compte.");

    const lignes = (["rgpd", "cgu"] as const).map((type) => ({
      client_id: client.id,
      type,
      adresse_ip: ip,
      version_texte: VERSION_TEXTES_PLATEFORME,
    }));

    const { error } = await context.supabase.from("consentements_plateforme").insert(lignes as never);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
