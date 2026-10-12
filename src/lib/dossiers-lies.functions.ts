import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { withPendingSchema } from "@/lib/pending-schema-client";

const lierSchema = z.object({
  dossier_id_a: z.string().uuid(),
  dossier_id_b: z.string().uuid(),
  motif: z.string().max(500).optional(),
});

/**
 * Crée un lien symétrique entre deux dossiers (ex. assurance vie créée depuis
 * les économies d'un dossier assurance emprunteur). L'ordre des deux ids
 * n'a pas d'importance côté appelant — la contrainte d'ordre canonique en
 * base est gérée ici pour éviter le doublon inverse.
 */
export const lierDossiers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => lierSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const supabase = withPendingSchema(context.supabase);
    if (data.dossier_id_a === data.dossier_id_b) throw new Error("Un dossier ne peut pas être lié à lui-même");

    const [id1, id2] = [data.dossier_id_a, data.dossier_id_b].sort();
    const { error } = await supabase.from("dossiers_lies").insert({
      dossier_id_1: id1,
      dossier_id_2: id2,
      motif: data.motif ?? null,
      created_by: userId,
    });
    // Contrainte unique implicite (clé primaire logique id1/id2) : si le lien
    // existe déjà, on ne le considère pas comme une erreur bloquante.
    if (error && !error.message.includes("duplicate")) throw new Error(error.message);
    return { ok: true };
  });

/** Liste les dossiers liés à un dossier donné, avec leurs informations d'affichage. */
export const listerDossiersLies = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ dossier_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const supabase = withPendingSchema(context.supabase);
    const { data: liens } = await supabase
      .from("dossiers_lies")
      .select("id, motif, dossier_id_1, dossier_id_2")
      .or(`dossier_id_1.eq.${data.dossier_id},dossier_id_2.eq.${data.dossier_id}`);
    if (!liens || liens.length === 0) return [];

    const autresIds = liens.map((l) => (l.dossier_id_1 === data.dossier_id ? l.dossier_id_2 : l.dossier_id_1));
    const { data: dossiers } = await supabase
      .from("dossiers")
      .select("id, reference, client_nom, type_assurance, statut")
      .in("id", autresIds);

    return liens.map((l) => {
      const autreId = l.dossier_id_1 === data.dossier_id ? l.dossier_id_2 : l.dossier_id_1;
      const d = (dossiers ?? []).find((x) => x.id === autreId);
      return {
        lien_id: l.id,
        motif: l.motif,
        dossier_id: autreId,
        reference: d?.reference ?? null,
        client_nom: d?.client_nom ?? null,
        type_assurance: d?.type_assurance ?? null,
        statut: d?.statut ?? null,
      };
    });
  });
