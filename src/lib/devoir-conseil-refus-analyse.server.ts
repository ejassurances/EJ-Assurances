import { geminiFetch } from "@/lib/gemini-gateway.server";
import type { SupabaseClient } from "@supabase/supabase-js";

const GATEWAY = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const MODELES = ["gemini-3.6-flash", "gemini-2.5-flash"];

type Recommandation = "contre_proposition" | "cloture_perdue";

function extraireJson(texte: string): unknown {
  const nettoye = texte.replace(/```json/gi, "").replace(/```/g, "").trim();
  try {
    return JSON.parse(nettoye);
  } catch {
    const debut = nettoye.indexOf("{");
    const fin = nettoye.lastIndexOf("}");
    if (debut === -1 || fin <= debut) throw new Error("Réponse IA illisible (JSON attendu)");
    return JSON.parse(nettoye.slice(debut, fin + 1));
  }
}

async function appelerIa(prompt: string) {
  const cle = process.env["GEMINI_API_KEY"];
  if (!cle) throw new Error("Analyse indisponible : clé IA absente du projet.");

  let derniere = "";
  for (const modele of MODELES) {
    const res = await geminiFetch(GATEWAY, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cle}` },
      body: JSON.stringify({
        model: modele,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (res.ok) {
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const contenu = json.choices?.[0]?.message?.content ?? "";
      if (!contenu) throw new Error("Réponse IA vide");
      return { modele, brut: extraireJson(contenu) };
    }
    derniere = `${res.status} ${await res.text()}`;
    if (res.status === 429) throw new Error("Analyse IA momentanément saturée.");
    if (res.status !== 400 && res.status !== 404) break;
  }
  throw new Error(`Analyse IA impossible : ${derniere}`);
}

function consigne(ctx: {
  motif: string;
  devoir: Record<string, unknown>;
  offres: unknown;
  recueil: unknown;
  branche: string | null;
  devisDossier: unknown;
}) {
  return [
    "Tu es analyste conformité dans un cabinet de courtage en assurances français (ACPR / DDA).",
    "Un client vient de REFUSER le devoir de conseil qui lui a été présenté.",
    "Ton rôle : déterminer s'il est pertinent de préparer une CONTRE-PROPOSITION commerciale adaptée,",
    "ou s'il faut CLÔTURER le dossier en « perdu » (refus de principe, client injoignable, projet abandonné,",
    "besoin hors de notre champ, refus non travaillable).",
    "",
    `Branche d'assurance : ${ctx.branche ?? "non précisée"}`,
    `Motif de refus exprimé par le client : ${ctx.motif}`,
    "",
    "Devoir de conseil refusé (JSON) :",
    JSON.stringify(ctx.devoir).slice(0, 6000),
    "Offres comparées (JSON) :",
    JSON.stringify(ctx.offres ?? []).slice(0, 4000),
    "Recueil des besoins du dossier (JSON) :",
    JSON.stringify(ctx.recueil ?? {}).slice(0, 6000),
    "Devis DÉJÀ enregistrés sur ce dossier (JSON, avec leur id) :",
    JSON.stringify(ctx.devisDossier ?? []).slice(0, 4000),
    "",
    "Règles :",
    "- Si le motif porte sur le prix, une garantie, une compagnie, un délai ou un malentendu : recommande 'contre_proposition'.",
    "- Si le motif exprime un abandon du projet, un refus définitif, une souscription ailleurs déjà signée",
    "  ou une inéligibilité : recommande 'cloture_perdue'.",
    "- La suggestion doit être concrète et actionnable pour le courtier (compagnie/produit à envisager,",
    "  ajustement de cotisation ou de quotité, garantie à revoir, argument à reprendre), sans promesse commerciale chiffrée fausse.",
    "- N'invente aucun tarif précis : parle en axes d'ajustement.",
    "",
    "QUALIFICATION DU NIVEAU (obligatoire) :",
    "- 'niveau_1' UNIQUEMENT si la contre-proposition tient entièrement dans l'un ou les deux cas suivants :",
    "  (a) retenir un AUTRE devis déjà présent dans la liste ci-dessus (renseigne alors devis_alternatif_id",
    "      avec son id exact, et rien d'autre), et/ou",
    "  (b) réduire les frais de courtage de ce dossier de 15 % MAXIMUM (renseigne reduction_courtage_pct,",
    "      nombre entre 0 et 15), et/ou",
    "  (c) 'ajustement_quotite' : la demande porte sur la QUOTITÉ ASSURÉE (branche emprunteur uniquement).",
    "      Renseigne alors quotite_demandee (nombre entre 1 et 100) avec la nouvelle quotité souhaitée.",
    "      S'il y a plusieurs assurés sur le prêt, renseigne quotite_assure_lien avec l'assuré visé :",
    "      'principal' ou 'co_emprunteur'. Si le client ne l'indique pas clairement, laisse null : la",
    "      modification sera appliquée à l'assuré principal et l'ambiguïté doit être signalée dans",
    "      niveau_justification.",
    "- IMPORTANT : la quotité et les frais de courtage sont deux leviers DIFFÉRENTS. La quotité modifie le",
    "  montant du risque assuré, donc le prix payé par le client ; les frais de courtage ne modifient que",
    "  notre marge sans changer le prix. Une demande de baisse (ou de hausse) de quotité doit être qualifiée",
    "  'ajustement_quotite' avec quotite_demandee, JAMAIS en reduction_courtage_pct.",
    "- Ces deux catégories ne se combinent JAMAIS dans la même réponse : si quotite_demandee est renseignée,",
    "  reduction_courtage_pct doit être null, et inversement.",
    "- 'niveau_2' dans TOUS les autres cas : réduction supérieure à 15 %, aucun devis existant ne répond",
    "  à la demande, changement de garantie non tarifé, ou le moindre doute réglementaire.",
    "- niveau_justification : explique en une ou deux phrases pourquoi ce niveau.",
    "",
    'Réponds STRICTEMENT en JSON : {"recommandation":"contre_proposition|cloture_perdue","synthese":"...","suggestion_contre_proposition":"...","niveau":"niveau_1|niveau_2","niveau_justification":"...","devis_alternatif_id":null,"reduction_courtage_pct":null,"quotite_demandee":null,"quotite_assure_lien":null}',
  ].join("\n");
}


/**
 * Analyse IA du motif de refus d'un devoir de conseil et enregistrement
 * d'une recommandation à destination du cabinet (validation humaine obligatoire).
 */
export async function analyserRefusDevoirConseil(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  devoirId: string,
) {
  const { data: devoir, error } = await supabase
    .from("devoirs_conseil")
    .select("*")
    .eq("id", devoirId)
    .maybeSingle();
  if (error || !devoir) throw new Error("Devoir de conseil introuvable");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = devoir as any;
  const motif = String(d.refus_motif ?? "").trim();
  if (!motif) throw new Error("Aucun motif de refus à analyser");

  const { data: dossier } = await supabase
    .from("dossiers")
    .select("id, type_assurance, recueil_besoins")
    .eq("id", d.dossier_id)
    .maybeSingle();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dos = dossier as any;

  const { devisDuDossier, executerModificationNiveau1, REDUCTION_COURTAGE_MAX_PCT } = await import(
    "./modification-client-niveau1.server"
  );
  const devisDossier = await devisDuDossier(supabase, d.dossier_id);

  const { modele, brut } = await appelerIa(
    consigne({
      motif,
      devoir: {
        recommandation: d.recommandation,
        motifs: d.motifs,
        mises_en_garde: d.mises_en_garde,
        compagnie: d.compagnie,
        produit: d.produit,
        cotisation_mensuelle: d.cotisation_mensuelle,
        frais_dossier: d.frais_dossier,
        frais_souscription: d.frais_souscription,
        economie_estimee: d.economie_estimee,
        garanties: d.garanties,
        exigences_client: d.exigences_client,
      },
      offres: d.offres,
      recueil: dos?.recueil_besoins ?? null,
      branche: dos?.type_assurance ?? null,
      devisDossier,
    }),
  );

  const obj = (brut ?? {}) as Record<string, unknown>;
  const reco: Recommandation =
    String(obj["recommandation"] ?? "") === "cloture_perdue" ? "cloture_perdue" : "contre_proposition";
  const synthese = String(obj["synthese"] ?? "").slice(0, 4000) || "Analyse indisponible.";
  const suggestion =
    reco === "contre_proposition" && obj["suggestion_contre_proposition"]
      ? String(obj["suggestion_contre_proposition"]).slice(0, 4000)
      : null;

  // Qualification du périmètre d'action automatique (niveau 1) — vérifiée côté serveur.
  const devisAltBrut = obj["devis_alternatif_id"];
  const devisAlt =
    typeof devisAltBrut === "string" && devisDossier.some((v) => v.id === devisAltBrut)
      ? devisAltBrut
      : null;
  const quotiteBrut = Number(obj["quotite_demandee"] ?? NaN);
  // Quotité assurée : levier de prix (emprunteur), jamais confondu avec les frais de courtage.
  const quotiteDemandee =
    Number.isFinite(quotiteBrut) && quotiteBrut > 0 && quotiteBrut <= 100
      ? Math.round(quotiteBrut * 100) / 100
      : null;
  const lienBrut = String(obj["quotite_assure_lien"] ?? "");
  const quotiteAssureLien =
    lienBrut === "principal" || lienBrut === "co_emprunteur" ? lienBrut : null;
  const reducBrut = quotiteDemandee !== null ? NaN : Number(obj["reduction_courtage_pct"] ?? NaN);
  const reduction =
    Number.isFinite(reducBrut) && reducBrut > 0 && reducBrut <= REDUCTION_COURTAGE_MAX_PCT
      ? Math.round(reducBrut * 100) / 100
      : null;
  const reductionHorsPerimetre = Number.isFinite(reducBrut) && reducBrut > REDUCTION_COURTAGE_MAX_PCT;
  const niveau: "niveau_1" | "niveau_2" =
    reco === "contre_proposition" &&
    String(obj["niveau"] ?? "") === "niveau_1" &&
    !reductionHorsPerimetre &&
    (devisAlt !== null || reduction !== null || quotiteDemandee !== null)
      ? "niveau_1"
      : "niveau_2";
  const niveauJustification = obj["niveau_justification"]
    ? String(obj["niveau_justification"]).slice(0, 2000)
    : null;

  const { data: inserted, error: iErr } = await supabase
    .from("devoir_conseil_refus_analyses")
    .insert({
      devoir_id: devoirId,
      dossier_id: d.dossier_id,
      motif_client: motif.slice(0, 4000),
      recommandation_ia: reco,
      synthese,
      suggestion_contre_proposition: suggestion,
      modele_ia: modele,
      statut: "en_attente",
      niveau,
      niveau_justification: niveauJustification,
      devis_alternatif_id: niveau === "niveau_1" ? devisAlt : null,
      reduction_courtage_pct: niveau === "niveau_1" ? reduction : null,
    } as never)
    .select("id")
    .single();
  if (iErr || !inserted) throw new Error(iErr?.message ?? "Enregistrement de l'analyse impossible");

  const analyseId = (inserted as { id: string }).id;

  // Niveau 1 : exécution automatique bornée, devoir de conseil régénéré en brouillon.
  let executionAuto: { devoir_id: string | null; actions: string[] } | null = null;
  if (niveau === "niveau_1") {
    try {
      const res = await executerModificationNiveau1(
        supabase,
        {
          id: analyseId,
          dossier_id: d.dossier_id as string,
          motif_client: motif,
          synthese,
          suggestion_contre_proposition: suggestion,
          devis_alternatif_id: devisAlt,
          reduction_courtage_pct: reduction,
          quotite_demandee: quotiteDemandee,
          quotite_assure_lien: quotiteAssureLien,
          niveau_justification: niveauJustification,
        },
        null,
      );
      executionAuto = res ? { devoir_id: res.devoir_id, actions: res.actions } : null;
    } catch (e) {
      console.error("[agent-commercial] modification niveau 1 non appliquée", e);
      const { creerTacheAdmin } = await import("./agent-taches.server");
      await creerTacheAdmin(supabase as unknown as Parameters<typeof creerTacheAdmin>[0], {
        titre: "Modification client niveau 1 non appliquée — à traiter manuellement",
        description: `Dossier ${d.dossier_id} : ${e instanceof Error ? e.message : "erreur inconnue"}`,
        created_by: null,
      });
    }
  }

  return { analyse_id: analyseId, recommandation: reco, synthese, suggestion, niveau, executionAuto };
}

