import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Réinitialisation de mot de passe envoyée par Brevo (et non par l'envoi natif
 * d'authentification), avec les variables canoniques du pipeline :
 * PRENOM et LIEN_ACTION (lien de définition du nouveau mot de passe, qui
 * connecte automatiquement l'utilisateur le temps de la définition).
 *
 * La réponse est volontairement identique que le compte existe ou non
 * (pas d'énumération d'adresses).
 */
export const demanderReinitialisationMotDePasse = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ email: z.string().email().max(255) }).parse(input))
  .handler(async ({ data }) => {
    const email = data.email.trim().toLowerCase();
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { appUrl } = await import("./app-url");
      const { sendTemplateEmail } = await import("./email-templates/send-email");
      const { SITE } = await import("./site");

      // Lien de récupération : la redirection ouvre /reset-password avec une
      // session temporaire, d'où la connexion automatique une fois le mot de
      // passe défini.
      const { data: link, error } = await supabaseAdmin.auth.admin.generateLink({
        type: "recovery",
        email,
        options: { redirectTo: appUrl("/reset-password") },
      });
      if (error) {
        // Keep the response generic to prevent account enumeration, but record
        // the Auth error so failed redirect allow-list checks are diagnosable.
        console.error("[auth-reset] Supabase recovery link generation failed", {
          code: error.code,
          status: error.status,
          message: error.message,
        });
        return { ok: true };
      }
      if (!link?.properties?.action_link) {
        console.error("[auth-reset] Supabase returned no recovery action link");
        return { ok: true };
      }

      let prenom = "";
      const { data: client } = await supabaseAdmin
        .from("clients")
        .select("prenom, nom")
        .ilike("email", email)
        .maybeSingle();
      if (client) {
        prenom = (client as { prenom: string | null; nom: string }).prenom ?? "";
      }
      if (!prenom) {
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("full_name")
          .ilike("email", email)
          .maybeSingle();
        const full = (profile as { full_name: string | null } | null)?.full_name ?? "";
        prenom = full.trim().split(" ")[0] ?? "";
      }

      const lienAction = link.properties.action_link;

      await sendTemplateEmail("mot-de-passe-reinitialisation", email, {
        templateData: { prenom, link: lienAction, cabinetName: SITE.shortName },
        brevoParams: { PRENOM: prenom, LIEN_ACTION: lienAction },
        idempotencyKey: `reset-${email}-${Date.now()}`,
      });
    } catch (e) {
      console.error("Envoi du mail de réinitialisation impossible", e);
    }
    return { ok: true };
  });
