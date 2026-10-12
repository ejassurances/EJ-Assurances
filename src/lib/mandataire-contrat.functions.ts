import { createServerFn } from "@tanstack/react-start";
import { createHash } from "node:crypto";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getRequestHeader, getRequestIP } from "@tanstack/react-start/server";
import { withPendingSchema } from "@/lib/pending-schema-client";

async function estAdmin(supabase: any, userId: string) {
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId).eq("role", "admin");
  return (data ?? []).length > 0;
}

/**
 * Le cabinet crée et envoie le contrat interne d'un mandataire. Les
 * variables (taux, zone) sont figées dans contenu au moment de l'envoi —
 * un changement ultérieur du profil ne modifie jamais un contrat déjà
 * envoyé, il faut en générer un nouveau (avenant).
 */
export const creerContratMandataire = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ mandataire_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (!(await estAdmin(supabase, userId))) {
      return { ok: false as const, error: "Action réservée aux administrateurs." };
    }

    const { supabaseAdmin: generatedAdmin } = await import("@/integrations/supabase/client.server");
    const supabaseAdmin = withPendingSchema(generatedAdmin);
    const { data: profilM } = await supabaseAdmin
      .from("mandataires_profils")
      .select("user_id, taux_commission, zone_non_concurrence")
      .eq("user_id", data.mandataire_id)
      .maybeSingle();
    const { data: profil } = await supabaseAdmin
      .from("profiles")
      .select("full_name")
      .eq("id", data.mandataire_id)
      .maybeSingle();
    const { SITE } = await import("@/lib/site");

    const variables = {
      cabinetNom: SITE.shortName,
      cabinetOrias: SITE.orias,
      mandataireNom: (profil as { full_name: string | null } | null)?.full_name ?? "",
      tauxCommission: (profilM as { taux_commission: number | null } | null)?.taux_commission ?? null,
      zoneNonConcurrence: (profilM as { zone_non_concurrence: string | null } | null)?.zone_non_concurrence ?? null,
    };

    const { count } = await supabaseAdmin
      .from("mandataires_contrats")
      .select("id", { count: "exact", head: true })
      .eq("user_id", data.mandataire_id);
    const reference = `CM-${new Date().getFullYear()}-${data.mandataire_id.slice(0, 8)}-${(count ?? 0) + 1}`;

    const hash = createHash("sha256").update(JSON.stringify(variables)).digest("hex");

    const { data: contrat, error } = await supabaseAdmin
      .from("mandataires_contrats")
      .insert({
        user_id: data.mandataire_id,
        reference,
        contenu: variables,
        hash,
        created_by: userId,
      })
      .select("id")
      .single();
    if (error || !contrat) return { ok: false as const, error: error?.message ?? "Création impossible." };

    let emailSent = false;
    if (profil && (profil as { full_name: string | null }).full_name) {
      const { data: userRow } = await supabaseAdmin.auth.admin.getUserById(data.mandataire_id);
      const email = userRow.user?.email;
      if (email) {
        try {
          const { sendTemplateEmail } = await import("@/lib/email-templates/send-email");
          const { appUrl } = await import("@/lib/app-url");
          const res = await sendTemplateEmail("invitation-signature-contrat-mandataire", email, {
            templateData: {
              prenom: variables.mandataireNom.split(" ")[0] ?? "",
              cabinetName: SITE.shortName,
              reference,
              lien: appUrl("/espace/signer-contrat-mandataire"),
            },
          });
          emailSent = res.sent;
        } catch {
          emailSent = false;
        }
      }
    }

    return { ok: true as const, contrat_id: contrat.id, reference, email_sent: emailSent };
  });

/** Le contrat en attente de signature du mandataire connecté. */
export const monContratAttente = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const supabase = withPendingSchema(context.supabase);
    const { data } = await supabase
      .from("mandataires_contrats")
      .select("id, reference, contenu, statut, envoye_le")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data ?? null;
  });

const signerSchema = z.object({
  contrat_id: z.string().uuid(),
  signature_png: z.string().min(100).max(500_000),
});

export const signerContratMandataire = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => signerSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const supabase = withPendingSchema(context.supabase);
    const { error } = await supabase
      .from("mandataires_contrats")
      .update({
        statut: "signe",
        signature_png: data.signature_png,
        signed_at: new Date().toISOString(),
        signed_ip: getRequestIP({ xForwardedFor: true }) ?? null,
        signed_ua: getRequestHeader("user-agent") ?? null,
      })
      .eq("id", data.contrat_id)
      .eq("user_id", userId)
      .eq("statut", "envoye");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Génère le PDF à la volée (contrat signé ou non) — jamais stocké tel quel, régénéré à chaque demande. */
export const pdfContratMandataire = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ contrat_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const supabase = withPendingSchema(context.supabase);
    const { data: contrat, error } = await supabase
      .from("mandataires_contrats")
      .select("reference, contenu, hash, signature_png, signed_at, signed_ip")
      .eq("id", data.contrat_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !contrat) throw new Error("Contrat introuvable.");

    const { genererPdfContratMandataire } = await import("@/lib/mandataire-contrat-pdf.server");
    const bytes = await genererPdfContratMandataire({
      reference: contrat.reference,
      variables: contrat.contenu as never,
      signature_png: contrat.signature_png,
      signed_at: contrat.signed_at,
      signed_ip: contrat.signed_ip,
      document_hash: contrat.hash,
    });
    return { base64: Buffer.from(bytes).toString("base64") };
  });
