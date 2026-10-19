import { geminiFetch } from "@/lib/gemini-gateway.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { varianteCapital } from "@/lib/variante-capital";

const GATEWAY = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const MODELES = ["gemini-3.6-flash", "gemini-2.5-flash"];

export type LigneClassement = {
  dossier_devis_id: string;
  rang: number;
  justification: string;
};

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
  if (!cle) throw new Error("Classement indisponible : clé IA absente du projet.");

  let derniere = "";
  for (const modele of MODELES) {
    const res = await geminiFetch(GATEWAY, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cle}` },
      body: JSON.stringify({ model: modele, messages: [{ role: "user", content: prompt }] }),
    });
    if (res.ok) {
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const contenu = json.choices?.[0]?.message?.content ?? "";
      if (!contenu) throw new Error("Réponse IA vide");
      return { modele, brut: extraireJson(contenu) };
    }
    derniere = `${res.status} ${await res.text()}`;
    if (res.status === 429) throw new Error("Classement IA momentanément saturé.");
    if (res.status !== 400 && res.status !== 404) break;
  }
  throw new Error(`Classement IA impossible : ${derniere}`);
}

function consigne(ctx: { branche: string | null; recueil: unknown; devis: unknown[] }) {
  return [
    "Tu es analyste technique dans un cabinet de courtage en assurances français (ACPR / DDA).",
    "On te transmet les devis comparés d'un dossier et le recueil des besoins du client.",
    "Ta mission : CLASSER ces devis du plus adapté au moins adapté au regard des besoins exprimés",
    "(niveaux de garanties souhaités, postes prioritaires, budget indiqué), avec pour chacun une",
    "justification courte (2 phrases maximum), concrète, qui explique le rang et l'écart avec le besoin.",
    "",
    `Branche d'assurance : ${ctx.branche ?? "non précisée"}`,
    "Recueil des besoins (JSON) :",
    JSON.stringify(ctx.recueil ?? {}).slice(0, 6000),
    "Devis saisis (JSON) :",
    JSON.stringify(ctx.devis).slice(0, 6000),
    "",
    "Chaque devis porte un champ 'compagnie_tier_favori' : 1, 2 ou 3 si la compagnie est une compagnie",
    "favorite du cabinet (1 = préférence la plus forte), null sinon.",
    "",
    "Règles :",
    "- Classe TOUS les devis fournis, une seule fois chacun, rangs 1..N sans doublon.",
    "- Reprends exactement les identifiants 'id' fournis dans le champ dossier_devis_id.",
    "- Si une compagnie favorite (tier 1, 2 ou 3) figure parmi les devis, elle doit être positionnée en priorité dans le classement, même si son tarif n'est pas le plus bas, tant que ses garanties répondent aux besoins exprimés. N'affiche pas comme mieux classé un devis moins cher qu'une offre favorite retenue en rang 1, sauf si l'offre favorite ne couvre pas les besoins prioritaires exprimés — dans ce cas, explique-le clairement dans la justification. Si plusieurs compagnies favorites figurent parmi les devis, elles sont classées normalement entre elles selon l'adéquation aux besoins, sans réordonnancement forcé selon leur tier interne.",
    "- N'invente aucune garantie ni aucun tarif absent des devis fournis.",
    "- Si une information manque, dis-le explicitement dans la justification.",
    "- Tu classes et tu justifies : tu ne décides pas de l'offre retenue.",
    "",
    'Réponds STRICTEMENT en JSON : {"classement":[{"dossier_devis_id":"...","rang":1,"justification":"..."}]}',
  ].join("\n");
}


/**
 * Classement IA des devis comparés d'un dossier. Le résultat est enregistré en
 * statut 'propose' : le staff reste seul décideur de l'offre retenue.
 */
export async function classerDevisDossier(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  dossierId: string,
  userId: string,
) {
  const { data: dossier, error: dErr } = await supabase
    .from("dossiers")
    .select("id, type_assurance, recueil_besoins, mode_recommandation")
    .eq("id", dossierId)
    .maybeSingle();
  if (dErr || !dossier) throw new Error("Dossier introuvable ou accès refusé");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dos = dossier as any;
  const branche = String(dos.type_assurance ?? "");

  const { data: devisRows, error: devErr } = await supabase
    .from("dossier_devis")
    .select(
      "id, cotisation_mensuelle, garanties_resume, source, assureur_porteur, compagnies:compagnie_id(nom, tier_favori), produits:produit_id(id, nom, assureur_porteur, contrat_star), produit_formules:formule_id(nom)",
    )
    .eq("dossier_id", dossierId)
    .order("created_at", { ascending: true });
  if (devErr) throw new Error(devErr.message);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let devis = (devisRows ?? []) as any[];

  // EMPRUNTEUR : la base de calcul du moteur est restreinte aux contrats stars
  // du cabinet. Les devis rattachés à un produit hors stars sont écartés du
  // classement (et signalés au conseiller).
  let horsStars = 0;
  if (branche === "emprunteur") {
    const retenus = devis.filter((d) => d.produits?.contrat_star === true);
    horsStars = devis.length - retenus.length;
    if (retenus.length === 0) {
      throw new Error(
        "Aucun devis rattaché aux contrats stars du cabinet : le classement emprunteur se calcule uniquement sur cette base. Rattachez les devis aux produits stars du catalogue.",
      );
    }
    devis = retenus;
  }

  // Le classement doit produire un TOP 3 : 3 devis minimum, SAUF si le catalogue
  // actif du cabinet ne contient qu'un seul produit pour cette branche (niche à
  // un seul partenaire). Dans ce cas, le classement se fait avec l'unique devis.
  const { catalogueOffreUnique } = await import("./catalogue-branche.server");
  const offreUnique = await catalogueOffreUnique(supabase, dos.type_assurance ?? null);
  if (devis.length < 3 && !offreUnique) {
    throw new Error(
      horsStars > 0
        ? `Seuls ${devis.length} devis sur les contrats stars sont exploitables (${horsStars} devis hors stars écartés) : il en faut 3 pour lancer le classement.`
        : "Saisissez au moins 3 devis pour lancer le classement IA (TOP 3 exigé).",
    );
  }
  if (devis.length === 0) throw new Error("Aucun devis saisi sur ce dossier.");

  const payload = devis.map((d) => ({
    id: d.id as string,
    compagnie: d.compagnies?.nom ?? null,
    compagnie_tier_favori: d.compagnies?.tier_favori ?? null,
    produit: d.produits?.nom ?? null,
    formule: d.produit_formules?.nom ?? null,
    cotisation_mensuelle: d.cotisation_mensuelle,
    garanties_resume: d.garanties_resume,
  }));

  let modele: string | null = null;
  let classement: LigneClassement[] = [];
  let route: "A" | "B" | null = null;
  let profils: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let scores: any = null;

  if (branche === "emprunteur") {
    const { routeRecommandation } = await import("./emprunteur-notebook");
    const { classerRouteA, classerRouteB, consigneRouteB } = await import("./emprunteur-recommandation.server");
    const decision = routeRecommandation(dos.recueil_besoins ?? null, dos.mode_recommandation ?? "auto");
    route = decision.route;
    profils = decision.profils;

    if (decision.route === "A") {
      // Route A : aucune spécificité déclarée → classement par prix croissant,
      // déterministe, sans appel IA.
      classement = classerRouteA(payload);
      modele = "route-a-prix-croissant";
    } else {
      const rep = await appelerIa(
        consigneRouteB({ profils: decision.profils, devis: payload, recueil: dos.recueil_besoins ?? null }),
      );
      modele = rep.modele;
      const objB = (rep.brut ?? {}) as Record<string, unknown>;
      const brutesB = Array.isArray(objB["analyses"]) ? (objB["analyses"] as Record<string, unknown>[]) : [];
      const analyses = brutesB.map((a) => ({
        dossier_devis_id: String(a["dossier_devis_id"] ?? ""),
        criteres_valides: Array.isArray(a["criteres_valides"]) ? (a["criteres_valides"] as unknown[]).map(String) : [],
        commentaire: String(a["commentaire"] ?? "").slice(0, 400),
      }));
      const res = classerRouteB(decision.profils, payload, analyses);
      classement = res.classement;
      scores = { profils: decision.profils, devis: res.scores };
    }
  } else {
    const rep = await appelerIa(
      consigne({ branche: dos.type_assurance ?? null, recueil: dos.recueil_besoins ?? null, devis: payload }),
    );
    modele = rep.modele;
    const obj = (rep.brut ?? {}) as Record<string, unknown>;
    const brutes = Array.isArray(obj["classement"]) ? (obj["classement"] as Record<string, unknown>[]) : [];
    const ids = new Set(payload.map((p) => p.id));
    const vues = new Set<string>();
    for (const l of brutes) {
      const id = String(l["dossier_devis_id"] ?? "");
      if (!ids.has(id) || vues.has(id)) continue;
      vues.add(id);
      classement.push({
        dossier_devis_id: id,
        rang: classement.length + 1,
        justification: String(l["justification"] ?? "").slice(0, 1500) || "Justification non fournie.",
      });
    }
    // Les devis oubliés par l'IA sont ajoutés en fin de classement, sans jugement inventé.
    for (const p of payload) {
      if (vues.has(p.id)) continue;
      classement.push({
        dossier_devis_id: p.id,
        rang: classement.length + 1,
        justification: "Non classé par l'analyse : informations insuffisantes dans le devis saisi.",
      });
    }
  }

  // Un nouveau classement remplace l'ancien 'propose' non traité (pas d'accumulation).
  await supabase
    .from("dossier_devis_classements")
    .delete()
    .eq("dossier_id", dossierId)
    .eq("statut", "propose");

  const { data: inserted, error: iErr } = await supabase
    .from("dossier_devis_classements")
    .insert({
      dossier_id: dossierId,
      modele_ia: modele,
      classement,
      statut: "propose",
      created_by: userId,
      genere_le: new Date().toISOString(),
      route,
      profils_specifiques: profils.length > 0 ? profils : null,
      scores,
    })
    .select("id")
    .single();

  if (iErr || !inserted) throw new Error(iErr?.message ?? "Enregistrement du classement impossible");

  // Agent commercial : sélection automatique dans le TOP 3.
  // - santé / prévoyance : l'offre la plus adaptée (rang 1 du classement IA).
  // - emprunteur : la moins chère du TOP 3, priorité au tarif automatique (API)
  //   à égalité de prix, sauf si un même assureur porteur est disponible via un
  //   autre canal de distribution (dans ce cas, arbitrage humain).
  let auto: { devis_id: string; devoir_id: string | null } | null = null;
  const top3 = classement.slice(0, 3);
  const parId = new Map(devis.map((d) => [d.id as string, d]));



  let choisi: string | null = top3[0]?.dossier_devis_id ?? null;
  let blocage: string | null = null;

  if (branche === "emprunteur" && top3.length > 0) {
    const candidats = top3
      .map((l) => parId.get(l.dossier_devis_id))
      .filter(Boolean)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((d) => d as any);

    // Doublon d'assureur porteur : le même risque est peut-être distribué par un
    // autre grossiste, à un tarif différent. Deux sources sont vérifiées — le
    // produit du catalogue rattaché au devis, et la valeur renseignée par le
    // connecteur API sur le devis lui-même (produit_id vide).
    const porteurDevis = (d: any): string | null =>
      (d.produits?.assureur_porteur as string | null)?.trim() ||
      (d.assureur_porteur as string | null)?.trim() ||
      null;
    const porteurs = Array.from(
      new Set(candidats.map(porteurDevis).filter((v): v is string => !!v)),
    );
    const produitsTop = new Set(candidats.map((d) => d.produits?.id as string).filter(Boolean));
    const alternatives: string[] = [];
    /** Canaux (compagnies du catalogue) où le même assureur porteur est distribuable. */
    const canauxParPorteur = new Map<string, Set<string>>();
    for (const porteur of porteurs) {
      const { data: autres } = await supabase
        .from("produits")
        .select("id, nom, assureur_porteur, statut, compagnies:compagnie_id(nom)")
        .eq("statut", "actif")
        .ilike("assureur_porteur", porteur);
      // Variantes d'assiette présentes au comparatif pour ce porteur (CI / CRD).
      const variantesTop = new Set(
        candidats
          .filter((d) => porteurDevis(d) === porteur)
          .map((d) => varianteCapital((d.produits?.nom as string | null) ?? null)),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const a of ((autres ?? []) as any[])) {
        if (produitsTop.has(a.id as string)) continue;
        // CI et CRD sont deux produits distincts, avec des tarifications distinctes :
        // une fiche CRD n'est pas une alternative à une fiche CI du même porteur.
        const va = varianteCapital(a.nom as string);
        if (va !== null && variantesTop.size > 0 && !variantesTop.has(va)) continue;
        alternatives.push(`${porteur} — ${a.nom}${a.compagnies?.nom ? ` (${a.compagnies.nom})` : ""}`);
        if (a.compagnies?.nom) {
          const set = canauxParPorteur.get(porteur) ?? new Set<string>();
          set.add(a.compagnies.nom as string);
          canauxParPorteur.set(porteur, set);
        }
      }
    }

    if (alternatives.length > 0) {
      choisi = null;
      blocage = alternatives.join(" ; ");
      const { creerTacheAdmin } = await import("./agent-taches.server");
      const { data: dosInfo } = await supabase
        .from("dossiers")
        .select("reference, client_id")
        .eq("id", dossierId)
        .maybeSingle();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const di = dosInfo as any;

      // Un canal Kereis existe-t-il pour ce porteur, sans devis Kereis déjà au comparatif ?
      const { data: devisDossier } = await supabase
        .from("dossier_devis")
        .select("compagnies:compagnie_id(nom)")
        .eq("dossier_id", dossierId);
      const kereisDejaAuComparatif = ((devisDossier ?? []) as { compagnies?: { nom?: string } }[]).some((d) =>
        /kereis/i.test(d.compagnies?.nom ?? ""),
      );
      const porteurKereis = [...canauxParPorteur.entries()].find(([, canaux]) =>
        [...canaux].some((c) => /kereis/i.test(c)),
      );
      const actionKereis = porteurKereis && !kereisDejaAuComparatif ? porteurKereis[0] : null;
      const lienDossier = `/espace/dossiers/${dossierId}#section-devis`;

      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await creerTacheAdmin(supabaseAdmin, {
        titre: actionKereis
          ? `Faire un devis chez Kereis pour ${actionKereis} et l'ajouter au comparatif de ce dossier avant de retenir une offre`
          : `Même assureur porteur (${porteurs.join(", ")}) disponible via un autre canal — comparer les tarifs avant de retenir une offre`,
        description: [
          `Dossier ${di?.reference ?? dossierId} (assurance emprunteur).`,
          ...(actionKereis
            ? [
                `Assureur porteur ${actionKereis} également distribué par Kereis, sans devis Kereis dans ce dossier.`,
                `Saisissez le tarif obtenu dans le bloc devis du dossier : ${lienDossier}`,
              ]
            : [`Bloc devis du dossier : ${lienDossier}`]),
          `Autres produits du même assureur porteur : ${blocage}`,
          "Devis du TOP 3 concernés :",
          ...candidats.map(
            (d) =>
              `- ${d.compagnies?.nom ?? "compagnie ?"} / ${d.produits?.nom ?? d.garanties_resume ?? "produit ?"} : ` +
              `${d.cotisation_mensuelle == null ? "tarif non renseigné" : `${Number(d.cotisation_mensuelle)} € / mois`}` +
              `${porteurDevis(d) ? ` — porteur ${porteurDevis(d)}` : ""}` +
              `${d.source === "api" ? " — tarif automatique (API)" : ""}`,
          ),
        ].join("\n"),
        client_id: (di?.client_id as string | null) ?? null,
        created_by: userId,
      });
    } else if (route === "B") {
      // Route B : le classement est technique, le rang 1 prime sur le tarif.
      choisi = top3[0]?.dossier_devis_id ?? null;
    } else {

      const tarifes = candidats.filter((d) => d.cotisation_mensuelle != null);
      const tri = (tarifes.length > 0 ? tarifes : candidats).sort((a, b) => {
        const pa = a.cotisation_mensuelle == null ? Infinity : Number(a.cotisation_mensuelle);
        const pb = b.cotisation_mensuelle == null ? Infinity : Number(b.cotisation_mensuelle);
        if (pa !== pb) return pa - pb;
        const aApi = a.source === "api" ? 0 : 1;
        const bApi = b.source === "api" ? 0 : 1;
        return aApi - bApi;
      });
      choisi = (tri[0]?.id as string | undefined) ?? null;
    }

  }

  if (choisi) {
    try {
      const res = await retenirDevisDossier(supabase, inserted.id as string, choisi, userId, { auto: true });
      auto = { devis_id: choisi, devoir_id: res.devoir_id ?? null };
    } catch (e) {
      console.error("[agent-commercial] sélection automatique impossible", e);
      const { creerTacheAdmin } = await import("./agent-taches.server");
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await creerTacheAdmin(supabaseAdmin, {
        titre: "Sélection automatique de l'offre impossible — à traiter manuellement",
        description: `Dossier ${dossierId} : ${e instanceof Error ? e.message : "erreur inconnue"}`,
        created_by: userId,
      });
    }
  }

  return { classement_id: inserted.id as string, classement, auto, arbitrage_requis: blocage };
}


/**
 * Le staff retient une offre : la compagnie / le produit du devis choisi sont
 * reportés sur le dossier, le classement est marqué traité et le devoir de
 * conseil est généré en BROUILLON (aucun envoi automatique au client).
 */
export async function retenirDevisDossier(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  classementId: string,
  devisId: string,
  userId: string,
  options?: { auto?: boolean },
) {
  const { data: cls, error: cErr } = await supabase
    .from("dossier_devis_classements")
    .select("id, dossier_id, statut")
    .eq("id", classementId)
    .maybeSingle();
  if (cErr || !cls) throw new Error("Classement introuvable ou accès refusé");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = cls as any;

  const { data: devis, error: dErr } = await supabase
    .from("dossier_devis")
    .select("id, dossier_id, compagnie_id, produit_id, cotisation_mensuelle, montant_total_saisi")
    .eq("id", devisId)
    .maybeSingle();
  if (dErr || !devis) throw new Error("Devis introuvable");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = devis as any;
  if (d.dossier_id !== c.dossier_id) throw new Error("Ce devis n'appartient pas au dossier du classement");
  if (!d.compagnie_id || !d.produit_id) throw new Error("Ce devis n'a pas de compagnie / produit renseigné");

  // Économie réalisée : coût restant de l'assurance bancaire (du mois prévu de
  // substitution à la fin du crédit) moins le coût du devis recommandé. Rien
  // n'est écrit si l'une des deux données manque.
  const maj: Record<string, unknown> = { compagnie_id: d.compagnie_id, produit_id: d.produit_id };
  const { data: dosRow } = await supabase
    .from("dossiers")
    .select("type_assurance, recueil_besoins")
    .eq("id", c.dossier_id)
    .maybeSingle();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dos = dosRow as any;
  if (dos?.type_assurance === "emprunteur") {
    const { assuranceInitialeDepuisRecueil, economieDevis } = await import("./assurance-initiale");
    const recueil = (dos.recueil_besoins ?? {}) as Record<string, unknown>;
    const initiale = assuranceInitialeDepuisRecueil(recueil, null);
    const coutDevis =
      d.montant_total_saisi != null
        ? Number(d.montant_total_saisi)
        : d.cotisation_mensuelle != null && initiale.moisRestants
          ? Number(d.cotisation_mensuelle) * initiale.moisRestants
          : null;
    const eco = economieDevis(initiale.coutRestant, coutDevis);
    if (eco && eco.economie > 0) maj["economie_estimee"] = Math.round(eco.economie);
  }

  const { error: upErr } = await supabase.from("dossiers").update(maj as never).eq("id", c.dossier_id);
  if (upErr) throw new Error(upErr.message);

  // Sélection automatique : le classement reste 'propose' pour que le staff
  // puisse encore retenir une autre offre avant l'envoi.
  await supabase
    .from("dossier_devis_classements")
    .update({ statut: options?.auto ? "propose" : "traite", devis_retenu_id: devisId })
    .eq("id", classementId);

  const { genererDevoirConseilAuto } = await import("./devoir-conseil.server");
  const res = await genererDevoirConseilAuto(supabase, c.dossier_id, userId, { sansEnvoi: true });

  return { dossier_id: c.dossier_id as string, devoir_id: res.id, envoye: false };
}

/**
 * Devis saisi manuellement retenu DIRECTEMENT, sans comparatif IA : cas d'un
 * contrat déjà validé par la compagnie (import rétroactif) ou d'une compagnie
 * sans API de tarification dont l'offre a déjà été acceptée par le client.
 * Une trace de classement est créée (rang 1 + motif) pour la preuve ACPR, puis
 * le devoir de conseil est généré en brouillon.
 */
export async function retenirDevisManuel(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  devisId: string,
  userId: string,
  motif: string,
) {
  const { data: devis, error: dErr } = await supabase
    .from("dossier_devis")
    .select("id, dossier_id")
    .eq("id", devisId)
    .maybeSingle();
  if (dErr || !devis) throw new Error("Devis introuvable ou accès refusé");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = devis as any;

  const classement: LigneClassement[] = [
    { dossier_devis_id: devisId, rang: 1, justification: `Offre retenue sans comparatif IA — ${motif}` },
  ];

  const { data: inserted, error: iErr } = await supabase
    .from("dossier_devis_classements")
    .insert({
      dossier_id: d.dossier_id,
      modele_ia: null,
      classement,
      statut: "propose",
      created_by: userId,
    })
    .select("id")
    .single();
  if (iErr || !inserted) throw new Error(iErr?.message ?? "Trace de sélection impossible");

  return retenirDevisDossier(supabase, (inserted as { id: string }).id, devisId, userId);
}




/**
 * Produit à tarification FIXE : le devis est construit depuis la formule et les
 * options du produit (aucun appel IA, une seule tarification connue), devient la
 * seule offre du dossier, et le devoir de conseil est généré en BROUILLON.
 */
export async function creerDevisTarifFixe(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  params: { dossierId: string; formuleId: string; optionIds: string[] },
  userId: string,
) {
  const { data: dossier, error: dErr } = await supabase
    .from("dossiers")
    .select("id, produit_id, compagnie_id")
    .eq("id", params.dossierId)
    .maybeSingle();
  if (dErr || !dossier) throw new Error("Dossier introuvable ou accès refusé");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dos = dossier as any;
  if (!dos.produit_id) throw new Error("Sélectionnez d'abord le produit du dossier.");

  const { data: produit, error: pErr } = await supabase
    .from("produits")
    .select("id, nom, compagnie_id, mode_tarification")
    .eq("id", dos.produit_id)
    .maybeSingle();
  if (pErr || !produit) throw new Error("Produit introuvable");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prod = produit as any;
  if (prod.mode_tarification !== "fixe") throw new Error("Ce produit n'est pas en tarification fixe.");

  const { data: formule, error: fErr } = await supabase
    .from("produit_formules")
    .select("id, nom, produit_id, tarif_fixe, actif")
    .eq("id", params.formuleId)
    .maybeSingle();
  if (fErr || !formule) throw new Error("Formule introuvable");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const form = formule as any;
  if (form.produit_id !== prod.id) throw new Error("Cette formule n'appartient pas au produit du dossier.");
  if (form.tarif_fixe == null) throw new Error(`Aucun tarif fixe renseigné sur la formule ${form.nom}.`);

  let options: { nom: string; tarif_fixe: number | null }[] = [];
  if (params.optionIds.length > 0) {
    const { data: opts, error: oErr } = await supabase
      .from("produit_options")
      .select("id, nom, tarif_fixe, produit_id, actif")
      .in("id", params.optionIds)
      .eq("produit_id", prod.id)
      .eq("actif", true);
    if (oErr) throw new Error(oErr.message);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    options = ((opts ?? []) as any[]).map((o) => ({ nom: o.nom as string, tarif_fixe: o.tarif_fixe }));
  }

  const total =
    Number(form.tarif_fixe) + options.reduce((s, o) => s + (o.tarif_fixe == null ? 0 : Number(o.tarif_fixe)), 0);

  const resume = [
    `Formule ${form.nom} : ${Number(form.tarif_fixe).toLocaleString("fr-FR")} € / mois`,
    ...options.map(
      (o) =>
        `Option ${o.nom} : ${o.tarif_fixe == null ? "tarif non renseigné" : `${Number(o.tarif_fixe).toLocaleString("fr-FR")} € / mois`}`,
    ),
    `Total : ${total.toLocaleString("fr-FR")} € / mois`,
  ].join("\n");

  // Tarif fixe : une seule tarification connue, donc une seule offre active au
  // dossier. Traçabilité ACPR : les offres précédentes sont archivées, jamais supprimées.
  await supabase
    .from("dossier_devis")
    .update({ archive_le: new Date().toISOString() })
    .eq("dossier_id", params.dossierId)
    .is("archive_le", null);

  const { data: devis, error: iErr } = await supabase
    .from("dossier_devis")
    .insert({
      dossier_id: params.dossierId,
      compagnie_id: prod.compagnie_id,
      produit_id: prod.id,
      formule_id: form.id,
      cotisation_mensuelle: total,
      garanties_resume: resume,
      source: "manuel",
      saisi_par: userId,
    })
    .select("id")
    .single();
  if (iErr || !devis) throw new Error(iErr?.message ?? "Enregistrement du devis impossible");

  if (dos.compagnie_id !== prod.compagnie_id) {
    const { error: upErr } = await supabase
      .from("dossiers")
      .update({ compagnie_id: prod.compagnie_id, produit_id: prod.id })
      .eq("id", params.dossierId);
    if (upErr) throw new Error(upErr.message);
  }

  const { genererDevoirConseilAuto } = await import("./devoir-conseil.server");
  const res = await genererDevoirConseilAuto(supabase, params.dossierId, userId, { sansEnvoi: true });

  return { devis_id: devis.id as string, total, devoir_id: res.id, envoye: false };
}
