import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { filtrerValeursPret } from "./import-pret-verification";

const fichier = z.object({
  nom: z.string().min(1).max(200),
  nature: z.enum(["offre_pret", "tableau_amortissement"]),
  mime: z.enum(["application/pdf", "image/jpeg", "image/png", "image/webp"]),
  base64: z
    .string()
    .min(4)
    .max(16777216)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/),
});

export const lirePiecesPret = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ fichiers: z.array(fichier).max(2) }).parse(input))
  .handler(async ({ data, context }) => {
    let autorise = false;
    for (const role of ["admin", "mandataire", "prescripteur"] as const) {
      const { data: ok } = await context.supabase.rpc("has_role", {
        _user_id: context.userId,
        _role: role,
      });
      if (ok === true) autorise = true;
    }
    if (!autorise) throw new Error("Analyse de prêt non autorisée.");
    const { analyserOffrePretFichier } = await import("./offre-pret-analyse.server");
    const lectures = [];
    for (const f of data.fichiers) {
      try {
        const bytes = Buffer.from(f.base64, "base64");
        if (!bytes.length || bytes.length > 12 * 1024 * 1024)
          throw new Error("Fichier vide ou supérieur à 12 Mo.");
        const signature =
          f.mime === "application/pdf"
            ? bytes.subarray(0, 5).toString() === "%PDF-"
            : f.mime === "image/png"
              ? bytes.subarray(0, 4).equals(Buffer.from([137, 80, 78, 71]))
              : f.mime === "image/jpeg"
                ? bytes[0] === 255 && bytes[1] === 216
                : bytes.subarray(0, 4).toString() === "RIFF" &&
                  bytes.subarray(8, 12).toString() === "WEBP";
        if (!signature) throw new Error("Le contenu ne correspond pas au format déclaré.");
        const r = await analyserOffrePretFichier({ nom: f.nom, mime: f.mime, base64: f.base64 });
        lectures.push({
          source: f.nom,
          nature: f.nature,
          confiance: r.confidence,
          valeurs: filtrerValeursPret(r.pret),
        });
      } catch {
        lectures.push({
          source: f.nom,
          nature: f.nature,
          confiance: 0,
          valeurs: {},
          erreur: "Analyse indisponible ou document inexploitable ; saisie manuelle possible.",
        });
      }
    }
    return lectures;
  });
