/**
 * CD-SI-001-B — LOT 2 : INTÉGRATION GEMINI EXTRACTION (couche serveur).
 *
 * Responsabilités, dans cet ordre strict :
 *  1. appel Gemini (via la passerelle IA déjà utilisée dans le projet) ;
 *  2. validation du JSON par le validateur du LOT 1 ;
 *  3. construction du contexte au statut DETECTED ;
 *  4. persistance dans `public.crm_emails.ai_context` uniquement.
 *
 * AUCUNE résolution métier, AUCUNE écriture de FK (`client_id`, `dossier_id`,
 * `contrat_id`…), AUCUNE création de prospect / contrat / produit / tâche.
 * `triage_ia` et `triage_le` ne sont ni lus pour décider, ni modifiés.
 */
import { geminiFetch } from "@/lib/gemini-gateway.server";
import {
  MODELES_EXTRACTION,
  TEMPERATURE_EXTRACTION,
  TIMEOUT_EXTRACTION_MS,
  SCHEMA_EXTRACTION_GEMINI,
  consigneExtraction,
  construireContexteDetecte,
  contexteEchecExtraction,
  extraireJsonTexte,
  normaliserExtractionGemini,
  type EmailAExtraire,
  type MotifEchecExtraction,
} from "./email-context-extraction";
import { lireContexteEmail } from "./email-context-schema";
import type { EmailContext } from "./email-context-types";

const GATEWAY = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

export interface ResultatExtractionContexte {
  contexte: EmailContext;
  ok: boolean;
  motif?: MotifEchecExtraction;
  modele?: string | null;
  detail?: string | null;
}

export interface OptionsExtraction {
  /** Injection de dépendance pour les tests. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  modeles?: readonly string[];
  cleApi?: string | null;
  analyseLe?: string;
}

/** Appel Gemini + validation + construction du contexte DETECTED. */
export async function analyserContexteEmail(
  email: EmailAExtraire,
  options: OptionsExtraction = {},
): Promise<ResultatExtractionContexte> {
  const cle = options.cleApi ?? process.env["GEMINI_API_KEY"] ?? null;
  if (!cle) {
    return echec("cle_absente", null, "GEMINI_API_KEY absente", options.analyseLe);
  }

  const appel = options.fetchImpl ?? geminiFetch;
  const modeles = options.modeles ?? MODELES_EXTRACTION;
  const timeout = options.timeoutMs ?? TIMEOUT_EXTRACTION_MS;

  let motif: MotifEchecExtraction = "erreur_api";
  let detail: string | null = null;
  let dernierModele: string | null = null;

  for (const modele of modeles) {
    dernierModele = modele;
    const controleur = new AbortController();
    const minuteur = setTimeout(() => controleur.abort(), timeout);
    try {
      const res = await appel(GATEWAY, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${cle}` },
        signal: controleur.signal,
        body: JSON.stringify({
          model: modele,
          temperature: TEMPERATURE_EXTRACTION,
          messages: [{ role: "user", content: consigneExtraction(email) }],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "extraction_contexte_email",
              strict: true,
              schema: SCHEMA_EXTRACTION_GEMINI,
            },
          },
        }),
      });

      if (!res.ok) {
        motif = "erreur_api";
        detail = `${res.status} ${await res.text().catch(() => "")}`.slice(0, 300);
        if (res.status === 429 || res.status === 402 || res.status === 403) break;
        continue;
      }

      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const contenu = json.choices?.[0]?.message?.content ?? "";
      if (!contenu.trim()) {
        motif = "reponse_vide";
        detail = "réponse Gemini vide";
        continue;
      }

      const brut = extraireJsonTexte(contenu);
      if (brut === null || typeof brut !== "object") {
        motif = "json_invalide";
        detail = "JSON illisible";
        continue;
      }

      const extraction = normaliserExtractionGemini(brut);
      if (!extraction) {
        motif = "json_invalide";
        detail = "structure d'extraction inexploitable";
        continue;
      }

      const contexte = construireContexteDetecte(extraction, {
        modele,
        email,
        analyseLe: options.analyseLe,
      });

      // Validation runtime LOT 1 — aucun second schéma.
      const valide = lireContexteEmail(contexte);
      if (!valide) {
        motif = "schema_non_conforme";
        detail = "contexte non conforme au JSON Schema";
        continue;
      }
      return { contexte: valide, ok: true, modele };
    } catch (e) {
      const abandon = e instanceof Error && e.name === "AbortError";
      motif = abandon ? "timeout" : "erreur_api";
      detail = e instanceof Error ? e.message : "erreur inconnue";
    } finally {
      clearTimeout(minuteur);
    }
  }

  console.error("[email-context] extraction indisponible", motif, detail);
  return echec(motif, dernierModele, detail, options.analyseLe);
}

function echec(
  motif: MotifEchecExtraction,
  modele: string | null,
  detail: string | null,
  analyseLe?: string,
): ResultatExtractionContexte {
  return {
    contexte: contexteEchecExtraction(motif, { modele, detail, analyseLe }),
    ok: false,
    motif,
    modele,
    detail,
  };
}

/**
 * IDEMPOTENCE / PROTECTION HUMAINE — un contexte existant n'est jamais écrasé
 * lorsqu'il porte une validation humaine (`validated_at`/`validated_by`,
 * statut `CONFIRMED`, provenance `humain`) ou lorsqu'une extraction DETECTED
 * a déjà été produite (sauf `force`).
 */
export function peutEcrireContexte(
  existant: unknown,
  options: { force?: boolean } = {},
): { autorise: boolean; raison?: string } {
  const courant = lireContexteEmail(existant);
  const analyse = courant?.analyse;
  if (analyse) {
    if (analyse.validated_at || analyse.validated_by) {
      return { autorise: false, raison: "validation_humaine_existante" };
    }
    if (analyse.statut === "CONFIRMED" || analyse.statut === "PROPOSED") {
      return { autorise: false, raison: "contexte_deja_qualifie" };
    }
    if (analyse.provenance?.source === "humain") {
      return { autorise: false, raison: "contexte_saisi_par_humain" };
    }
    if (!options.force && analyse.statut === "DETECTED") {
      return { autorise: false, raison: "extraction_deja_effectuee" };
    }
  }
  return { autorise: true };
}

export interface ResultatPersistanceContexte {
  ecrit: boolean;
  raison?: string;
  contexte?: EmailContext;
}

/**
 * Écrit le contexte dans `crm_emails.ai_context` — et RIEN d'autre :
 * aucune FK, aucun statut métier, aucune colonne `triage_*`.
 */
export async function persisterContexteEmail(
  emailId: string,
  contexte: EmailContext,
  options: { force?: boolean } = {},
): Promise<ResultatPersistanceContexte> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data, error } = await supabaseAdmin
    .from("crm_emails")
    .select("id, ai_context")
    .eq("id", emailId)
    .maybeSingle();
  if (error || !data) {
    return { ecrit: false, raison: error?.message ?? "email_introuvable" };
  }

  const garde = peutEcrireContexte(data.ai_context, options);
  if (!garde.autorise) return { ecrit: false, raison: garde.raison };

  const { error: erreurEcriture } = await supabaseAdmin
    .from("crm_emails")
    .update({ ai_context: contexte as unknown as never })
    .eq("id", emailId);
  if (erreurEcriture) return { ecrit: false, raison: erreurEcriture.message };

  return { ecrit: true, contexte };
}

/** Orchestration LOT 2 : extraction puis persistance du contexte DETECTED. */
export async function extraireEtEnregistrerContexteEmail(
  emailId: string,
  email: EmailAExtraire,
  options: OptionsExtraction & { force?: boolean } = {},
): Promise<ResultatExtractionContexte & ResultatPersistanceContexte> {
  const resultat = await analyserContexteEmail(email, options);
  const persistance = await persisterContexteEmail(emailId, resultat.contexte, {
    force: options.force,
  });
  return { ...resultat, ...persistance };
}
