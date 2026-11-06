import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Réinitialisation de mot de passe : tentative Brevo avec secours immédiat
 * via l’envoi Auth Supabase si Brevo ou la génération du lien échoue.
 * La réponse reste générique afin de ne pas révéler l’existence d’un compte.
 */
export const demanderReinitialisationMotDePasse = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ email: z.string().email().max(255) }).parse(input))
  .handler(async ({ data }) => {
    const email = data.email.trim().toLowerCase();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { appUrl } = await import("./app-url");
    const redirectTo = appUrl("/reset-password");

    const envoyerSecoursSupabase = async () => {
      const { error } = await supabaseAdmin.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) {
        console.error("[auth-reset] Supabase fallback email failed", {
          code: error.code,
          status: error.status,
          message: error.message,
        });
        return false;
      }
      console.log("[auth-reset] Supabase fallback email accepted");
      return true;
    };

    try {
      const { sendTemplateEmail } = await import("./email-templates/send-email");
      const { SITE } = await import("./site");
      const { data: link, error } = await supabaseAdmin.auth.admin.generateLink({
        type: "recovery",
        email,
        options: { redirectTo },
      });

      if (error || !link?.properties?.action_link) {
        console.error("[auth-reset] Recovery link generation failed", {
          code: error?.code,
          status: error?.status,
          message: error?.message ?? "no action link",
        });
        await envoyerSecoursSupabase();
        return { ok: true };
      }

      let prenom = "";
      const { data: client } = await supabaseAdmin
        .from("clients")
        .select("prenom, nom")
        .ilike("email", email)
        .maybeSingle();
      if (client) prenom = (client as { prenom: string | null }).prenom ?? "";

      if (!prenom) {
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("full_name")
          .ilike("email", email)
          .maybeSingle();
        const full = (profile as { full_name: string | null } | null)?.full_name ?? "";
        prenom = full.trim().split(" ")[0] ?? "";
      }

      try {
        await sendTemplateEmail("mot-de-passe-reinitialisation", email, {
          templateData: {
            prenom,
            link: link.properties.action_link,
            cabinetName: SITE.shortName,
          },
          brevoParams: { PRENOM: prenom, LIEN_ACTION: link.properties.action_link },
          idempotencyKey: `reset-${email}-${Date.now()}`,
        });
      } catch (errorBrevo) {
        console.error("[auth-reset] Brevo failed; using Supabase fallback", errorBrevo);
        await envoyerSecoursSupabase();
      }
    } catch (error) {
      console.error("[auth-reset] unexpected failure; using Supabase fallback", error);
      await envoyerSecoursSupabase();
    }

    return { ok: true };
  });
