/* eslint-disable prettier/prettier -- legacy file formatting debt; keep other lint rules enabled */
import { useCallback, useEffect, useMemo, useState } from "react";
import { LIBELLES_PROFILS, routeRecommandation } from "@/lib/emprunteur-notebook";
import { noterProduitEmprunteur, type NoteProduit } from "@/lib/emprunteur-scoring-produits";
import type { ValeursGrille } from "@/lib/garanties-grille";
import { DevisComparatifTable } from "@/components/devis-comparatif-table";
import { familleCodePourBranche } from "@/lib/bibliotheque-cg";


import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import {
  classerDevisDossierFn,
  retenirDevisDossierFn,
  retenirDevisManuelFn,
  creerDevisTarifFixeFn,
} from "@/lib/devis-classement.functions";
import { assuranceInitialeDepuisRecueil, economieDevis } from "@/lib/assurance-initiale";
import { lireDevisImporte, validerDevisImporte } from "@/lib/devis-import.functions";
import { neolianeTariferDossier } from "@/lib/neoliane.functions";
import { brancheTarifableNeoliane, nbAssuresNeoliane } from "@/lib/neoliane/branches";
import { ugipTariferDossier } from "@/lib/ugip.functions";
import { nbAssuresUgip } from "@/lib/ugip/eligibilite";
import { simulassurTariferDossier } from "@/lib/simulassur.functions";
import { useCommissionBareme } from "@/hooks/use-commission-bareme";
import { commissionDepuisDevis, tauxDefautDevis, type BaseCommission } from "@/lib/commission-devis";
import { LIBELLE_SOURCE } from "@/lib/commissions-bareme";
import { brancheTarifableSimulassur, nbAssuresSimulassur } from "@/lib/simulassur/eligibilite";


/** 1er jour du mois suivant (AAAA-MM-JJ) — date d'effet proposée par défaut. */
function premierDuMoisSuivant(): string {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
}

export type DossierDevis = {
  id: string;
  dossier_id: string;
  compagnie_id: string | null;
  produit_id: string | null;
  formule_id: string | null;
  cotisation_mensuelle: number | null;
  /** Mode de calcul de la cotisation : CI (capital initial, constante) ou CRD (capital restant dû, dégressive). */
  type_cotisation: "CI" | "CRD" | null;
  cotisation_min: number | null;
  cotisation_max: number | null;
  /** Montant total de l'assurance sur la durée du prêt (point d'entrée de la saisie manuelle). */
  montant_total_saisi: number | null;
  source: "manuel" | "api" | "pdf";
  garanties_resume: string | null;
  quotite_pct: number | null;
  /** Taux de commission cabinet (%) applicable à ce devis : repris en comptabilité. */
  taux_commission: number | null;
  /** Assiette du taux : cotisation (prime) ou économie réalisée. */
  commission_base?: string | null;
  /** Origine du taux : « bareme » (défaut compagnie/branche) ou « manuel ». */
  commission_source?: string | null;
  /** Tête assurée visée par ce devis (1 = assuré principal, 2 = co-emprunteur). Un devis = une tête. */
  assure_rang: number | null;
  assureur_porteur: string | null;
  created_at: string;
};

type LigneClassement = { dossier_devis_id: string; rang: number; justification: string };
type Classement = {
  id: string;
  genere_le: string;
  modele_ia: string | null;
  classement: LigneClassement[];
  statut: string;
  route: string | null;
  profils_specifiques: string[] | null;
};


type Ref = { id: string; nom: string };
type ProduitRef = {
  id: string;
  nom: string;
  compagnie_id: string;
  famille_id: string;
  assureur_porteur: string | null;
};

type FormuleRef = { id: string; nom: string; produit_id: string; actif: boolean };
type FormuleFixe = { id: string; nom: string; tarif_fixe: number | null; actif: boolean };
type OptionFixe = { id: string; nom: string; tarif_fixe: number | null; description: string | null };

const inp = "w-full rounded-md border border-line bg-background px-3 py-2 text-sm";
const eur = (n: number) => `${n.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} € / mois`;



/** Devis comparés saisis manuellement par le staff — base du comparatif du devoir de conseil. */
export function DossierDevisPanel({
  dossierId,
  branche,
  userId,
  onChanged,
}: {
  dossierId: string;
  branche?: string | null;
  userId: string;
  onChanged?: () => void;
}) {
  const [devis, setDevis] = useState<DossierDevis[]>([]);
  const [compagnies, setCompagnies] = useState<Ref[]>([]);
  const [produits, setProduits] = useState<ProduitRef[]>([]);
  const [formules, setFormules] = useState<FormuleRef[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [classement, setClassement] = useState<Classement | null>(null);
  const [iaEtat, setIaEtat] = useState<"idle" | "classement" | "selection">("idle");
  const [iaMsg, setIaMsg] = useState<string | null>(null);
  /** Débrayage manuel de la route de recommandation emprunteur (auto / A / B). */
  const [modeReco, setModeReco] = useState<string>("auto");
  const [recueilDossier, setRecueilDossier] = useState<Record<string, unknown>>({});
  const routeEmprunteurPrevue = useMemo(
    () => routeRecommandation(recueilDossier, modeReco),
    [recueilDossier, modeReco],
  );


  const lancerClassement = useServerFn(classerDevisDossierFn);
  const retenirOffre = useServerFn(retenirDevisDossierFn);
  const retenirManuel = useServerFn(retenirDevisManuelFn);
  const lireDevis = useServerFn(lireDevisImporte);
  const validerLectureDevis = useServerFn(validerDevisImporte);
  /** Import d'un devis PDF/photo : lecture IA proposée, validation humaine obligatoire. */
  const [importBusy, setImportBusy] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [importDocId, setImportDocId] = useState<string | null>(null);
  /** Pièces du dossier pouvant être un devis (reçues par e-mail, scannées…). */
  const [piecesCandidates, setPiecesCandidates] = useState<
    { id: string; file_name: string | null; type_document: string | null; created_at: string }[]
  >([]);
  const [piecesOuvertes, setPiecesOuvertes] = useState(false);
  useEffect(() => {
    let vivant = true;
    void (async () => {
      const { data } = await supabase
        .from("documents")
        .select("id,file_name,type_document,created_at,archive_le")
        .eq("dossier_id", dossierId)
        .is("archive_le", null)
        .order("created_at", { ascending: false })
        .limit(80);
      if (!vivant) return;
      const lignes = (data ?? []) as {
        id: string;
        file_name: string | null;
        type_document: string | null;
        created_at: string;
      }[];
      setPiecesCandidates(
        // Une même pièce déposée plusieurs fois (mêmes nom de fichier) n'apparaît
        // qu'une fois dans la liste : la copie la plus récente.
        Object.values(
          lignes
            .filter(
              (l) =>
                /devis|tarif|proposition/i.test(l.type_document ?? "") ||
                /devis|tarif|proposition|offre[_\s-]?assurance/i.test(l.file_name ?? ""),
            )
            .reduce<Record<string, (typeof lignes)[number]>>((acc, l) => {
              const cle = (l.file_name ?? l.id).toLowerCase();
              if (!acc[cle]) acc[cle] = l;
              return acc;
            }, {}),
        ),
      );
    })();
    return () => {
      vivant = false;
    };
  }, [dossierId]);
  const creerFixe = useServerFn(creerDevisTarifFixeFn);

  /** Produit du dossier en tarification fixe : formules et options à cotisation connue. */
  const [produitFixe, setProduitFixe] = useState<{ id: string; nom: string } | null>(null);
  const [formulesFixes, setFormulesFixes] = useState<FormuleFixe[]>([]);
  const [optionsFixes, setOptionsFixes] = useState<OptionFixe[]>([]);
  const [fixeFormuleId, setFixeFormuleId] = useState("");
  const [fixeOptionIds, setFixeOptionIds] = useState<string[]>([]);
  const [fixeEtat, setFixeEtat] = useState<"idle" | "envoi">("idle");

  /** Tarification API Néoliane (toutes branches couvertes). */
  const tariferNeoliane = useServerFn(neolianeTariferDossier);
  const [nbAssuresApi, setNbAssuresApi] = useState(0);
  const [neoDate, setNeoDate] = useState(premierDuMoisSuivant());
  const [neoEtat, setNeoEtat] = useState<"idle" | "appel">("idle");
  const [neoMsg, setNeoMsg] = useState<string | null>(null);
  const [neoErr, setNeoErr] = useState<string | null>(null);

  /** Tarification API UGIP Assurances (branche emprunteur). */
  const tariferUgip = useServerFn(ugipTariferDossier);
  const [nbAssuresUgipApi, setNbAssuresUgipApi] = useState(0);
  const [ugipDate, setUgipDate] = useState(premierDuMoisSuivant());
  const [ugipEtat, setUgipEtat] = useState<"idle" | "appel">("idle");
  const [ugipMsg, setUgipMsg] = useState<string | null>(null);
  const [ugipErr, setUgipErr] = useState<string | null>(null);

  /** Tarification API Simulassur (branche emprunteur). */
  const tariferSimulassur = useServerFn(simulassurTariferDossier);
  const [nbAssuresSimu, setNbAssuresSimu] = useState(0);
  const [simuDate, setSimuDate] = useState(premierDuMoisSuivant());
  const [simuEtat, setSimuEtat] = useState<"idle" | "appel">("idle");
  const [simuMsg, setSimuMsg] = useState<string | null>(null);
  const [simuErr, setSimuErr] = useState<string | null>(null);

  /** Offre actuellement retenue sur le dossier + état du dossier (validé ou non). */
  const [dossierInfo, setDossierInfo] = useState<{
    compagnie_id: string | null;
    produit_id: string | null;
    statut: string | null;
  }>({ compagnie_id: null, produit_id: null, statut: null });
  /** Familles du catalogue : rattachement branche → produits proposables. */
  const [famillesBranche, setFamillesBranche] = useState<string[]>([]);
  /** Branche du dossier (utilisée quand la prop n'est pas fournie). */
  const [brancheDossierEtat, setBrancheDossierEtat] = useState<string>("");
  const estEmprunteur = (branche ?? brancheDossierEtat) === "emprunteur";
  /** Famille de la grille de garanties standardisée correspondant à la branche du dossier. */
  const familleCodeDossier = familleCodePourBranche(branche ?? brancheDossierEtat);

  /** Grilles de garanties emprunteur VALIDÉES, par produit : base de la notation. */
  const [grillesProduits, setGrillesProduits] = useState<Record<string, ValeursGrille>>({});


  /** Comparatif : par défaut une seule offre par assureur porteur (doublons de canaux masqués). */
  const [afficherDoublons, setAfficherDoublons] = useState(false);

  /** Base de comparaison issue du recueil des besoins emprunteur (pas de ressaisie). */
  const [moisRestants, setMoisRestants] = useState<number | null>(null);
  const [crdRecueil, setCrdRecueil] = useState<number | null>(null);

  /** Bloc de saisie manuelle : ouvert à la demande depuis l'en-tête du panneau. */
  const [saisieOuverte, setSaisieOuverte] = useState(false);
  /** Motif de la saisie manuelle (traçabilité DDA). */
  const [motifSaisie, setMotifSaisie] = useState<"sans_api" | "retroactif" | "autre">("sans_api");

  const [form, setForm] = useState({
    compagnie_id: "",
    produit_id: "",
    formule_id: "",
    montant_total_saisi: "",
    type_cotisation: "" as "" | "CI" | "CRD",
    cotisation_mensuelle: "",
    cotisation_min: "",
    cotisation_max: "",
    quotite_pct: "",
    taux_commission: "",
    commission_base: "economie_realisee" as BaseCommission,
    garanties_resume: "",
    assure_rang: "1",
  });

  /**
   * Hors assurance emprunteur, il n'y a pas d'« économie réalisée » face à une
   * assurance bancaire : l'assiette proposée est la cotisation.
   */
  useEffect(() => {
    if (estEmprunteur) return;
    setForm((f) => (f.commission_base === "prime" ? f : { ...f, commission_base: "prime" }));
  }, [estEmprunteur]);



  const LIBELLE_MOTIF: Record<"sans_api" | "retroactif" | "autre", string> = {
    sans_api: "compagnie sans API de tarification (devis reçu par e-mail ou extranet)",
    retroactif: "contrat déjà validé par la compagnie (import rétroactif)",
    autre: "saisie manuelle par le conseiller",
  };

  /** Têtes assurées issues du recueil des besoins (co-emprunteurs inclus). */
  const [assuresRecueil, setAssuresRecueil] = useState<
    {
      rang: number;
      label: string;
      /** Identité telle que saisie / extraite des documents (jamais déduite). */
      nom: string | null;
      quotite: number | null;
      garanties: string | null;
      franchise: string | null;
      options: string | null;
      adhesion: string | null;
    }[]
  >([]);


  /** Mensuel moyen dérivé : montant total sur la durée ÷ mois restants du recueil. */
  const mensuelMoyenDerive =
    form.montant_total_saisi && moisRestants && moisRestants > 0
      ? Number(form.montant_total_saisi) / moisRestants
      : null;

  /**
   * Assurance bancaire actuelle : coût restant à courir entre le mois prévu de
   * la substitution et la fin du crédit. Base de l'économie de chaque devis.
   */
  const assuranceInit = useMemo(
    () => assuranceInitialeDepuisRecueil(recueilDossier, moisRestants),
    [recueilDossier, moisRestants],
  );

  /** Coût total d'un devis sur la période restante, puis économie associée. */
  const economiePourDevis = useCallback(
    (d: { montant_total_saisi: number | null; cotisation_mensuelle: number | null }) => {
      const cout =
        d.montant_total_saisi != null
          ? Number(d.montant_total_saisi)
          : d.cotisation_mensuelle != null && moisRestants
            ? Number(d.cotisation_mensuelle) * moisRestants
            : null;
      return economieDevis(assuranceInit.coutRestant, cout);
    },
    [assuranceInit, moisRestants],
  );

  /**
   * Barème du cabinet : sert à PRÉREMPLIR le taux de commission d'un devis
   * (compagnie > branche > défaut). Lecture réservée au staff — le client et le
   * prescripteur ne voient jamais ce bloc.
   */
  const { staff, regles: reglesBareme } = useCommissionBareme();
  const brancheCommission = branche ?? brancheDossierEtat ?? null;
  const tauxDefaut = useCallback(
    (compagnieId: string | null) => tauxDefautDevis(reglesBareme, brancheCommission, compagnieId),
    [reglesBareme, brancheCommission],
  );

  /** Édition en place du taux de commission d'un devis déjà enregistré. */
  const [commEdit, setCommEdit] = useState<{ id: string; taux: string; base: BaseCommission } | null>(null);
  const [commBusy, setCommBusy] = useState(false);

  const ouvrirCommission = (d: DossierDevis) => {
    const defaut = tauxDefaut(d.compagnie_id);
    setCommEdit({
      id: d.id,
      taux: d.taux_commission != null ? String(d.taux_commission) : defaut.taux != null ? String(defaut.taux) : "",
      base: (d.commission_base as BaseCommission | null) ?? defaut.base,
    });
  };

  const enregistrerCommission = async () => {
    if (!commEdit) return;
    setCommBusy(true);
    const { error } = await supabase
      .from("dossier_devis")
      .update({
        taux_commission: commEdit.taux ? Number(commEdit.taux) : null,
        commission_base: commEdit.base,
        commission_source: "manuel",
      } as never)
      .eq("id", commEdit.id);
    setCommBusy(false);
    if (error) return setErr(error.message);
    setCommEdit(null);
    await load();
  };

  /** Commission prévisionnelle interne d'un devis, calculée depuis son seul taux. */
  const commissionPourDevis = (d: DossierDevis) => {
    const defaut = tauxDefaut(d.compagnie_id);
    const taux = d.taux_commission ?? defaut.taux;
    const base = ((d.commission_base as BaseCommission | null) ?? defaut.base) as BaseCommission;
    const origine =
      d.taux_commission != null && d.commission_source === "manuel"
        ? "Taux saisi sur ce devis"
        : LIBELLE_SOURCE[defaut.source === "manuel" ? "defaut" : defaut.source];
    const prevu = commissionDepuisDevis(
      { taux, base },
      {
        cotisationMensuelle: d.cotisation_mensuelle,
        economie: economiePourDevis(d)?.economie ?? null,
        moisRestants,
        quotitePct: d.quotite_pct,
        totalQuotites: d.quotite_pct != null ? d.quotite_pct : null,
      },
    );
    return { taux, base, origine, prevu, applique: d.taux_commission != null };
  };

  const load = useCallback(async () => {
    const [d, c, p, cl, dos] = await Promise.all([
      supabase
        .from("dossier_devis")
        .select("id,dossier_id,compagnie_id,produit_id,formule_id,cotisation_mensuelle,type_cotisation,cotisation_min,cotisation_max,montant_total_saisi,source,garanties_resume,quotite_pct,taux_commission,commission_base,commission_source,assure_rang,assureur_porteur,created_at")
        .eq("dossier_id", dossierId)
        .is("archive_le", null)
        .order("created_at", { ascending: true }),
      supabase.from("compagnies").select("id,nom").order("nom"),
      supabase.from("produits").select("id,nom,compagnie_id,famille_id,assureur_porteur").order("nom"),
      supabase
        .from("dossier_devis_classements")
        .select("id,genere_le,modele_ia,classement,statut,route,profils_specifiques")
        .eq("dossier_id", dossierId)
        .eq("statut", "propose")
        .order("genere_le", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("dossiers")
        .select("produit_id,compagnie_id,statut,type_assurance,recueil_besoins,mode_recommandation")
        .eq("id", dossierId)
        .maybeSingle(),
    ]);
    if (d.error) setErr(d.error.message);
    setDevis((d.data as DossierDevis[]) ?? []);
    setCompagnies((c.data as Ref[]) ?? []);
    setProduits((p.data as ProduitRef[]) ?? []);
    setClassement((cl.data as Classement | null) ?? null);

    const dossier = dos.data as
      | {
          compagnie_id?: string | null;
          statut?: string | null;
          produit_id: string | null;
          type_assurance: string | null;
          recueil_besoins: unknown;
          mode_recommandation?: string | null;
        }
      | null;
    const recueil = (dossier?.recueil_besoins ?? {}) as Record<string, unknown>;
    const brancheDossier = dossier?.type_assurance ?? "";
    setBrancheDossierEtat(brancheDossier);
    const emprunteur = (branche ?? brancheDossier) === "emprunteur";
    setModeReco(dossier?.mode_recommandation ?? "auto");
    setDossierInfo({
      compagnie_id: dossier?.compagnie_id ?? null,
      produit_id: dossier?.produit_id ?? null,
      statut: dossier?.statut ?? null,
    });

    // Familles du catalogue correspondant à la branche du dossier : le devis
    // peut être créé chez un autre partenaire à condition de rester dans la
    // même branche et dans le catalogue.
    const { data: fam } = await supabase.from("produit_familles").select("id,branches");
    const brancheCible = (branche ?? brancheDossier ?? "").trim();
    setFamillesBranche(
      ((fam as { id: string; branches: string[] | null }[] | null) ?? [])
        .filter((f) => !brancheCible || (f.branches ?? []).includes(brancheCible))
        .map((f) => f.id),
    );
    setRecueilDossier(recueil);

    // Grilles de garanties emprunteur validées : seule base autorisée pour noter
    // les produits du catalogue (aucune valeur déduite).
    if (emprunteur) {
      const { data: gr } = await supabase
        .from("produit_garanties")
        .select("produit_id,valeurs,statut,famille_code")
        .eq("famille_code", "emprunteur")
        .eq("statut", "valide");
      const table: Record<string, ValeursGrille> = {};
      for (const g of (gr as { produit_id: string; valeurs: unknown }[] | null) ?? []) {
        table[g.produit_id] = (g.valeurs ?? {}) as ValeursGrille;
      }
      setGrillesProduits(table);
    } else {
      setGrillesProduits({});
    }

    const nb = (v: unknown) => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    const assures = Array.isArray(recueil["assures"]) ? (recueil["assures"] as Record<string, unknown>[]) : [];
    const txt = (v: unknown) => {
      if (v == null) return null;
      if (Array.isArray(v)) {
        const l = v.map((x) => String(x)).filter(Boolean);
        return l.length ? l.join(", ") : null;
      }
      const s = String(v).trim();
      return s ? s : null;
    };
    setAssuresRecueil(
      assures.map((a, i) => ({
        rang: i + 1,
        label: `${
          a?.["lien"] === "co_emprunteur" ? "Co-emprunteur" : "Assuré principal"
        }${a?.["quotite_pct"] ? ` — quotité ${a["quotite_pct"]} %` : ""}`,
        nom:
          txt(a?.["nom_complet"]) ??
          txt([txt(a?.["prenom"]), txt(a?.["nom"])].filter(Boolean).join(" ")),

        quotite: nb(a?.["quotite_pct"]),
        garanties: txt(a?.["garanties"]) ?? txt(a?.["garanties_souhaitees"]),
        franchise: txt(a?.["franchise"]) ?? txt(a?.["franchise_jours"]),
        options: txt(a?.["options"]),
        adhesion: txt(a?.["numero_adhesion"]) ?? txt(a?.["adhesion"]),
      })),
    );

    setMoisRestants(nb(recueil["mois_restants"]) ?? nb(recueil["duree_mois"]));
    setCrdRecueil(nb(recueil["capital_restant_du"]) ?? nb(recueil["capital"]));
    // Branche emprunteur : plus aucune tarification automatique par API — le
    // devis est établi depuis le catalogue et le prix obtenu du partenaire.
    setNbAssuresApi(
      !emprunteur && brancheTarifableNeoliane(brancheDossier) ? nbAssuresNeoliane(brancheDossier, recueil) : 0,
    );
    setNbAssuresUgipApi(emprunteur ? 0 : nbAssuresUgip(brancheDossier, recueil));
    setNbAssuresSimu(
      !emprunteur && brancheTarifableSimulassur(brancheDossier) ? nbAssuresSimulassur(brancheDossier, recueil) : 0,
    );



    const produitDossierId = dossier?.produit_id ?? null;
    if (!produitDossierId) {
      setProduitFixe(null);
      setFormulesFixes([]);
      setOptionsFixes([]);
      return;
    }
    const { data: prod } = await supabase
      .from("produits")
      .select("id,nom,mode_tarification")
      .eq("id", produitDossierId)
      .maybeSingle();
    const pr = prod as { id: string; nom: string; mode_tarification: string } | null;
    if (!pr || pr.mode_tarification !== "fixe") {
      setProduitFixe(null);
      setFormulesFixes([]);
      setOptionsFixes([]);
      return;
    }
    setProduitFixe({ id: pr.id, nom: pr.nom });
    const [fm, op] = await Promise.all([
      supabase
        .from("produit_formules")
        .select("id,nom,tarif_fixe,actif")
        .eq("produit_id", pr.id)
        .eq("actif", true)
        .order("ordre"),
      supabase
        .from("produit_options")
        .select("id,nom,tarif_fixe,description")
        .eq("produit_id", pr.id)
        .eq("actif", true)
        .order("ordre"),
    ]);
    setFormulesFixes((fm.data as FormuleFixe[]) ?? []);
    setOptionsFixes((op.data as OptionFixe[]) ?? []);
  }, [dossierId, branche]);



  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    (async () => {
      if (!form.produit_id) return setFormules([]);
      const { data } = await supabase
        .from("produit_formules")
        .select("id,nom,produit_id,actif")
        .eq("produit_id", form.produit_id)
        .order("ordre");
      setFormules(((data as FormuleRef[]) ?? []).filter((f) => f.actif));
    })();
  }, [form.produit_id]);

  const nomCompagnie = (id: string | null) => compagnies.find((c) => c.id === id)?.nom ?? "—";
  const nomProduit = (id: string | null) => produits.find((p) => p.id === id)?.nom ?? "—";

  /** Assureur porteur d'un devis : produit du catalogue en priorité, sinon valeur renvoyée par l'API. */
  const porteurDevis = (d: DossierDevis | undefined) => {
    if (!d) return null;
    const viaProduit = produits.find((p) => p.id === d.produit_id)?.assureur_porteur ?? null;
    const nom = (viaProduit || d.assureur_porteur || "").trim();
    return nom ? nom : null;
  };

  /** Regroupement des devis du dossier par assureur porteur (au moins 2 offres du même porteur). */
  const groupesPorteur = new Map<string, { nom: string; canaux: string[]; devisIds: string[] }>();
  for (const d of devis) {
    const nom = porteurDevis(d);
    if (!nom) continue;
    const cle = nom.toLowerCase();
    const g = groupesPorteur.get(cle) ?? { nom, canaux: [], devisIds: [] };
    const canal = nomCompagnie(d.compagnie_id);
    if (canal !== "—" && !g.canaux.includes(canal)) g.canaux.push(canal);
    g.devisIds.push(d.id);
    groupesPorteur.set(cle, g);
  }
  const porteurPartage = (d: DossierDevis | undefined) => {
    const nom = porteurDevis(d);
    if (!nom) return null;
    const g = groupesPorteur.get(nom.toLowerCase());
    return g && g.devisIds.length > 1 ? g : null;
  };

  /**
   * Offre retenue par défaut dans un groupe de même assureur porteur : la moins
   * chère, priorité au tarif automatique (API) à égalité — même règle que la
   * sélection automatique du classement emprunteur.
   */
  const representantsGroupe = new Set<string>();
  for (const g of groupesPorteur.values()) {
    if (g.devisIds.length < 2) continue;
    const membres = g.devisIds.map((id) => devis.find((x) => x.id === id)).filter((x): x is DossierDevis => !!x);
    const tarifes = membres.filter((m) => m.cotisation_mensuelle != null);
    const tri = (tarifes.length > 0 ? tarifes : membres).sort((a, b) => {
      const pa = a.cotisation_mensuelle == null ? Infinity : Number(a.cotisation_mensuelle);
      const pb = b.cotisation_mensuelle == null ? Infinity : Number(b.cotisation_mensuelle);
      if (pa !== pb) return pa - pb;
      return (a.source === "api" ? 0 : 1) - (b.source === "api" ? 0 : 1);
    });
    if (tri[0]) representantsGroupe.add(tri[0].id);
  }
  /** Un devis est masqué s'il fait partie d'un groupe sans en être l'offre retenue. */
  const estDoublonMasque = (d: DossierDevis | undefined) => {
    if (!d) return false;
    const g = porteurPartage(d);
    return g != null && !representantsGroupe.has(d.id);
  };
  const nbDoublonsMasques = devis.filter((d) => estDoublonMasque(d)).length;
  const devisAffiches = afficherDoublons ? devis : devis.filter((d) => !estDoublonMasque(d));



  const ajouter = async (retenirDirect = false) => {
    setErr(null);
    setIaMsg(null);
    if (!form.compagnie_id || !form.produit_id) {
      setErr("Choisissez une compagnie et un produit.");
      return;
    }
    if (assuresRecueil.length >= 2 && !form.assure_rang) {
      setErr(
        "Ce dossier comporte un co-emprunteur : indiquez la tête assurée visée. Un devis combiné unique est interdit (DDA).",
      );
      return;
    }
    setSaving(true);
    const mensuel = form.cotisation_mensuelle
      ? Number(form.cotisation_mensuelle)
      : mensuelMoyenDerive != null
        ? Math.round(mensuelMoyenDerive * 100) / 100
        : null;
    const noteMotif = `Saisie manuelle — ${LIBELLE_MOTIF[motifSaisie]}`;
    const resume = [form.garanties_resume.trim(), noteMotif].filter(Boolean).join("\n");
    const { data: cree, error } = await supabase
      .from("dossier_devis")
      .insert({
        dossier_id: dossierId,
        compagnie_id: form.compagnie_id,
        produit_id: form.produit_id,
        formule_id: form.formule_id || null,
        montant_total_saisi: form.montant_total_saisi ? Number(form.montant_total_saisi) : null,
        type_cotisation: form.type_cotisation || null,
        cotisation_mensuelle: mensuel,
        cotisation_min: form.type_cotisation === "CRD" && form.cotisation_min ? Number(form.cotisation_min) : null,
        cotisation_max: form.type_cotisation === "CRD" && form.cotisation_max ? Number(form.cotisation_max) : null,
        quotite_pct: form.quotite_pct ? Number(form.quotite_pct) : null,
        // Taux saisi, sinon défaut du barème (compagnie > branche > cabinet).
        taux_commission: form.taux_commission
          ? Number(form.taux_commission)
          : tauxDefaut(form.compagnie_id || null).taux,
        commission_base: form.taux_commission
          ? form.commission_base
          : tauxDefaut(form.compagnie_id || null).base,
        commission_source: form.taux_commission ? "manuel" : "bareme",
        assure_rang: form.assure_rang ? Number(form.assure_rang) : 1,
        garanties_resume: resume || null,
        source: importDocId ? "pdf" : "manuel",
        saisi_par: userId,
        document_id: importDocId,
      })
      .select("id")
      .single();
    if (error) {
      setSaving(false);
      return setErr(error.message);
    }
    let erreurValidationSource: string | null = null;
    if (importDocId) {
      try {
        await validerLectureDevis({ data: { dossier_id: dossierId, document_id: importDocId } });
      } catch {
        // Le devis est déjà enregistré ; signaler le problème sans perdre la saisie.
        erreurValidationSource =
          "Devis enregistré, mais la lecture de référence n'a pas pu être validée. Vérifiez la migration de versionnement.";
      }
    }
    if (retenirDirect) {
      try {
        await retenirManuel({ data: { devis_id: (cree as { id: string }).id, motif: LIBELLE_MOTIF[motifSaisie] } });
        setIaMsg(
          "Devis enregistré et retenu : compagnie et produit reportés sur le dossier, devoir de conseil créé en brouillon (aucun envoi au client).",
        );
      } catch (e) {
        setSaving(false);
        return setErr(e instanceof Error ? e.message : "Sélection directe impossible");
      }
    }
    setSaving(false);
    setForm({
      compagnie_id: "",
      produit_id: "",
      formule_id: "",
      montant_total_saisi: "",
      type_cotisation: "",
      cotisation_mensuelle: "",
      cotisation_min: "",
      cotisation_max: "",
      quotite_pct: "",
      taux_commission: "",
      commission_base: "economie_realisee",
      garanties_resume: "",
      assure_rang: "1",
    });
    setImportDocId(null);
    setImportMsg(null);
    if (erreurValidationSource) setErr(erreurValidationSource);
    await load();
    onChanged?.();
  };

  /**
   * Importe un devis reçu (PDF ou photo) : le fichier est archivé sur le dossier
   * puis lu par l'IA. Les valeurs lues ne sont que PROPOSÉES dans le formulaire
   * ci-dessous — le conseiller vérifie et valide avant enregistrement.
   */
  /**
   * Import d'un devis (PDF ou photo) analysé par l'IA. `produit` : produit du
   * catalogue depuis lequel l'import est lancé — il sert de valeur de repli
   * lorsque l'IA ne reconnaît pas le partenaire ou le produit.
   */
  const importerDevis = async (file: File, produit?: ProduitRef) => {
    setImportBusy(true);
    setErr(null);
    setImportMsg("Dépôt du devis…");
    try {
      const safeName = file.name.replace(/[^\w.-]+/g, "_").slice(0, 120);
      const path = `${dossierId}/${Date.now()}-${safeName}`;
      const { error: upErr } = await supabase.storage.from("dossier-documents").upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data: auth } = await supabase.auth.getUser();
      const uploaderId = auth.user?.id;
      if (!uploaderId) throw new Error("Session expirée — reconnectez-vous.");
      const { data: doc, error: insErr } = await supabase
        .from("documents")
        .insert({
          dossier_id: dossierId,
          uploader_id: uploaderId,
          storage_path: path,
          file_name: file.name.slice(0, 200),
          file_size: file.size,
          mime_type: file.type || null,
          categorie: "dossier",
          type_document: "devis_assurance",
        })
        .select("id")
        .maybeSingle();
      if (insErr) throw insErr;
      const docId = (doc as { id: string } | null)?.id ?? null;
      if (!docId) throw new Error("Enregistrement du devis impossible.");
      setImportDocId(docId);

      setImportMsg("Lecture du devis par l'IA…");
      const lu = await lireDevis({ data: { dossier_id: dossierId, document_id: docId } });
      const num = (v: number | null) => (v === null || v === undefined ? "" : String(v));
      setForm((f) => ({
        ...f,
        compagnie_id: lu.compagnie_id ?? produit?.compagnie_id ?? f.compagnie_id,
        produit_id: lu.produit_id ?? produit?.id ?? f.produit_id,
        montant_total_saisi: num(lu.montant_total) || f.montant_total_saisi,
        type_cotisation: lu.type_cotisation ?? f.type_cotisation,
        cotisation_mensuelle: num(lu.cotisation_mensuelle) || f.cotisation_mensuelle,
        cotisation_min: num(lu.cotisation_min) || f.cotisation_min,
        cotisation_max: num(lu.cotisation_max) || f.cotisation_max,
        quotite_pct: num(lu.quotite_pct) || f.quotite_pct,
        garanties_resume: lu.garanties_resume ?? f.garanties_resume,
      }));
      setSaisieOuverte(true);
      const manque: string[] = [];
      if (!lu.compagnie_id) manque.push(lu.compagnie ? `partenaire (« ${lu.compagnie} » absent du catalogue de la branche)` : "partenaire");
      if (!lu.produit_id) manque.push(lu.produit ? `produit (« ${lu.produit} »)` : "produit");
      if (lu.cotisation_mensuelle === null && lu.montant_total === null) manque.push("tarif");
      setImportMsg(
        `Devis lu${lu.assure_nom ? ` (assuré : ${lu.assure_nom})` : ""}. Vérifiez les valeurs proposées ci-dessous puis enregistrez.` +
          (manque.length ? ` À compléter à la main : ${manque.join(", ")}.` : ""),
      );
      setSaisieOuverte(true);
    } catch (e) {
      setImportMsg(null);
      setErr(e instanceof Error ? e.message : "Import du devis impossible");
    } finally {
      setImportBusy(false);
    }
  };

  /**
   * Reprise d'une pièce DÉJÀ déposée sur le dossier (devis reçu par e-mail ou
   * scanné) : aucune duplication de fichier, lecture IA puis validation humaine.
   */
  const reprendreDocument = async (docId: string, nom: string) => {
    setImportBusy(true);
    setErr(null);
    setImportMsg(`Lecture de « ${nom} » par l'IA…`);
    try {
      setImportDocId(docId);
      const lu = await lireDevis({ data: { dossier_id: dossierId, document_id: docId } });
      const num = (v: number | null) => (v === null || v === undefined ? "" : String(v));
      setForm((f) => ({
        ...f,
        compagnie_id: lu.compagnie_id ?? f.compagnie_id,
        produit_id: lu.produit_id ?? f.produit_id,
        montant_total_saisi: num(lu.montant_total) || f.montant_total_saisi,
        type_cotisation: lu.type_cotisation ?? f.type_cotisation,
        cotisation_mensuelle: num(lu.cotisation_mensuelle) || f.cotisation_mensuelle,
        cotisation_min: num(lu.cotisation_min) || f.cotisation_min,
        cotisation_max: num(lu.cotisation_max) || f.cotisation_max,
        quotite_pct: num(lu.quotite_pct) || f.quotite_pct,
        garanties_resume: lu.garanties_resume ?? f.garanties_resume,
      }));
      const manque: string[] = [];
      if (!lu.compagnie_id)
        manque.push(
          lu.compagnie ? `partenaire (« ${lu.compagnie} » absent du catalogue de la branche)` : "partenaire",
        );
      if (!lu.produit_id) manque.push(lu.produit ? `produit (« ${lu.produit} »)` : "produit");
      if (lu.cotisation_mensuelle === null && lu.montant_total === null) manque.push("tarif");
      setImportMsg(
        `Pièce lue${lu.assure_nom ? ` (assuré : ${lu.assure_nom})` : ""}. Vérifiez les valeurs proposées puis enregistrez.` +
          (manque.length ? ` À compléter à la main : ${manque.join(", ")}.` : ""),
      );
      setSaisieOuverte(true);
    } catch (e) {
      setImportMsg(null);
      setErr(e instanceof Error ? e.message : "Lecture de la pièce impossible");
    } finally {
      setImportBusy(false);
    }
  };

  /** Traçabilité ACPR : le devis n'est jamais supprimé, il est archivé (masqué). */
  const supprimer = async (d: DossierDevis) => {
    if (!confirm("Archiver ce devis ? Il sera retiré du comparatif mais conservé comme preuve (ACPR).")) return;
    const { error } = await supabase
      .from("dossier_devis")
      .update({ archive_le: new Date().toISOString() })
      .eq("id", d.id);
    if (error) return setErr(error.message);
    await load();
    onChanged?.();
  };

  /**
   * Catalogue proposable : uniquement les produits de la MÊME branche que le
   * dossier (rattachement produit_familles.branches). Le conseiller peut donc
   * établir un devis chez un autre partenaire ou sur un autre produit, sans
   * jamais sortir de la branche ni du catalogue.
   */
  const produitsBranche = produits.filter(
    (p) => famillesBranche.length === 0 || famillesBranche.includes(p.famille_id),
  );
  const compagniesBranche = compagnies.filter((c) => produitsBranche.some((p) => p.compagnie_id === c.id));
  const produitsVisibles = produitsBranche.filter((p) => !form.compagnie_id || p.compagnie_id === form.compagnie_id);

  /**
   * Note d'adéquation de chaque produit emprunteur du catalogue, calculée sur sa
   * grille de garanties validée dans le CRM et la situation du prospect. Sans
   * grille validée, le produit reste non notable (aucune valeur déduite).
   */
  const notesProduits = useMemo(() => {
    const table = new Map<string, NoteProduit>();
    if (!estEmprunteur) return table;
    for (const p of produitsBranche) {
      table.set(p.id, noterProduitEmprunteur(grillesProduits[p.id] ?? null, recueilDossier));
    }
    return table;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estEmprunteur, produits, famillesBranche, grillesProduits, recueilDossier]);

  /** Produits du catalogue triés par note décroissante (non notables en dernier). */
  const produitsNotes = useMemo(
    () =>
      [...produitsBranche]
        .map((p) => ({ produit: p, note: notesProduits.get(p.id) ?? null }))
        .sort((a, b) => (b.note?.score ?? -1) - (a.note?.score ?? -1)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [produits, famillesBranche, notesProduits],
  );

  /** Coût total d'un devis sur la période restante du prêt. */
  const coutTotalDevis = useCallback(
    (d: DossierDevis): number | null => {
      if (d.montant_total_saisi != null) return Number(d.montant_total_saisi);
      if (d.cotisation_mensuelle != null && moisRestants) return Number(d.cotisation_mensuelle) * moisRestants;
      if (d.cotisation_mensuelle != null) return null;
      return null;
    },
    [moisRestants],
  );

  /** Classement du moins cher au plus cher (base : coût total, sinon cotisation). */
  const classementPrix = useMemo(() => {
    const cle = (d: DossierDevis) => {
      const total = coutTotalDevis(d);
      if (total != null) return total;
      return d.cotisation_mensuelle != null ? Number(d.cotisation_mensuelle) * 1000 : Infinity;
    };
    return [...devisAffiches].sort((a, b) => cle(a) - cle(b));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devisAffiches, coutTotalDevis]);

  /** Prépare la saisie du prix obtenu pour un produit du catalogue. */
  const preparerDevisProduit = (p: ProduitRef) => {
    setForm((f) => ({ ...f, compagnie_id: p.compagnie_id, produit_id: p.id, formule_id: "" }));
    setMotifSaisie("sans_api");
    setSaisieOuverte(true);
  };



  /** Devis actuellement retenu sur le dossier (compagnie + produit reportés). */
  const estDevisRetenu = (d: DossierDevis) =>
    !!dossierInfo.produit_id &&
    d.produit_id === dossierInfo.produit_id &&
    (dossierInfo.compagnie_id == null || d.compagnie_id === dossierInfo.compagnie_id);

  /** Meilleur prix par tête assurée (repère visuel du comparatif). */
  const meilleurParTete = new Map<number, string>();
  for (const d of devis) {
    if (d.cotisation_mensuelle == null) continue;
    const tete = d.assure_rang ?? 1;
    const actuel = meilleurParTete.get(tete);
    const ref = actuel ? devis.find((x) => x.id === actuel) : null;
    if (!ref || Number(d.cotisation_mensuelle) < Number(ref.cotisation_mensuelle)) meilleurParTete.set(tete, d.id);
  }

  /** Rang attribué par le classement IA, s'il existe. */
  const rangIa = (id: string) => classement?.classement.find((l) => l.dossier_devis_id === id)?.rang ?? null;

  /**
   * Coût des 8 premières années : calculé uniquement pour une cotisation
   * constante (capital initial). En capital restant dû, la valeur dépend de
   * l'échéancier et n'est pas déduite ici.
   */
  const coutHuitAns = (d: DossierDevis): number | null => {
    if (d.cotisation_mensuelle == null || d.type_cotisation === "CRD") return null;
    const mois = moisRestants ? Math.min(96, moisRestants) : 96;
    return Number(d.cotisation_mensuelle) * mois;
  };

  /** Colonnes du comparatif : une par tête assurée du recueil (au moins une). */
  const assuresColonnes =
    assuresRecueil.length > 0
      ? assuresRecueil
      : [
          {
            rang: 1,
            label: "Assuré principal",
            nom: null,
            quotite: null,
            garanties: null,
            franchise: null,
            options: null,
            adhesion: null,
          },
        ];

  /** Propositions d'une tête assurée, du moins cher au plus cher. */
  const propositionsParTete = (rang: number) =>
    devisAffiches
      .filter((d) => (d.assure_rang ?? 1) === rang)
      .sort((a, b) => {
        const va = coutTotalDevis(a) ?? (a.cotisation_mensuelle != null ? Number(a.cotisation_mensuelle) * 1000 : Infinity);
        const vb = coutTotalDevis(b) ?? (b.cotisation_mensuelle != null ? Number(b.cotisation_mensuelle) * 1000 : Infinity);
        return va - vb;
      });

  /** Agrégats du dossier : offre retenue par tête, sinon la moins chère. */
  const referencesParTete = assuresColonnes.map((a) => {
    const offres = propositionsParTete(a.rang);
    return offres.find((o) => estDevisRetenu(o)) ?? offres[0] ?? null;
  });
  const somme = (valeurs: (number | null)[]) =>
    valeurs.some((v) => v == null) || valeurs.length === 0
      ? null
      : valeurs.reduce((s, v) => (s ?? 0) + (v ?? 0), 0);
  const totalRetenuDossier = somme(referencesParTete.map((d) => (d ? coutTotalDevis(d) : null)));
  const huitAnsRetenuDossier = somme(referencesParTete.map((d) => (d ? coutHuitAns(d) : null)));
  const economieRetenueDossier =
    assuranceInit.coutRestant != null && totalRetenuDossier != null
      ? assuranceInit.coutRestant - totalRetenuDossier
      : null;

  /** Détail technique des devis : replié par défaut en emprunteur. */
  const [detailOuvert, setDetailOuvert] = useState(false);



  /**
   * Sélection directe d'un devis depuis le comparatif, y compris sur un dossier
   * déjà validé : compagnie et produit sont reportés sur le dossier et le devoir
   * de conseil est régénéré en brouillon (aucun envoi au client).
   */
  const retenirDirectement = async (d: DossierDevis) => {
    if (
      !confirm(
        "Recommander ce devis : il devient l'offre retenue du dossier, alimente le devoir de conseil (brouillon, aucun envoi au client) et pré-enregistre les données du futur contrat. Confirmer ?",
      )
    )
      return;
    setErr(null);
    setIaMsg(null);
    setIaEtat("selection");
    try {
      await retenirManuel({
        data: { devis_id: d.id, motif: "offre choisie par le conseiller dans le comparatif du dossier" },
      });
      await load();
      setIaMsg(
        "Offre retenue : compagnie et produit reportés sur le dossier, devoir de conseil créé en brouillon. L'envoi au client reste manuel.",
      );
      onChanged?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Sélection impossible");
    } finally {
      setIaEtat("idle");
    }
  };

  const demanderClassement = async () => {
    setIaMsg(null);
    setErr(null);
    setIaEtat("classement");
    try {
      await lancerClassement({ data: { dossier_id: dossierId } });
      await load();
      setIaMsg("Classement IA généré — à vous de retenir l'offre.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Classement IA impossible");
    } finally {
      setIaEtat("idle");
    }
  };

  const retenir = async (devisId: string) => {
    if (!classement) return;
    if (!confirm("Retenir cette offre et générer le devoir de conseil en brouillon (sans envoi au client) ?")) return;
    setIaMsg(null);
    setErr(null);
    setIaEtat("selection");
    try {
      await retenirOffre({ data: { classement_id: classement.id, devis_id: devisId } });
      await load();
      setIaMsg(
        "Offre retenue : compagnie et produit reportés sur le dossier, devoir de conseil créé en brouillon. L'envoi au client reste à déclencher manuellement.",
      );
      onChanged?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Sélection impossible");
    } finally {
      setIaEtat("idle");
    }
  };


  const formuleFixeChoisie = formulesFixes.find((f) => f.id === fixeFormuleId) ?? null;
  const totalFixe =
    (formuleFixeChoisie?.tarif_fixe == null ? 0 : Number(formuleFixeChoisie.tarif_fixe)) +
    optionsFixes
      .filter((o) => fixeOptionIds.includes(o.id))
      .reduce((s, o) => s + (o.tarif_fixe == null ? 0 : Number(o.tarif_fixe)), 0);

  const genererDepuisTarifFixe = async () => {
    if (!fixeFormuleId) return;
    if (
      !confirm(
        "Créer ce devis comme seule offre du dossier et générer le devoir de conseil en brouillon (sans envoi au client) ?",
      )
    )
      return;
    setErr(null);
    setIaMsg(null);
    setFixeEtat("envoi");
    try {
      await creerFixe({ data: { dossier_id: dossierId, formule_id: fixeFormuleId, option_ids: fixeOptionIds } });
      await load();
      setIaMsg(
        "Devis créé depuis le tarif fixe du produit et devoir de conseil généré en brouillon. L'envoi au client reste à déclencher manuellement.",
      );
      onChanged?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Génération impossible");
    } finally {
      setFixeEtat("idle");
    }
  };

  const recupererTarifsNeoliane = async () => {
    setNeoErr(null);
    setNeoMsg(null);
    setNeoEtat("appel");
    try {
      const res = (await tariferNeoliane({ data: { dossier_id: dossierId, date_effet: neoDate } })) as {
        nbDevisCrees: number;
        nbTarifs: number;
        nbAssures: number;
        compagnieTrouvee: boolean;
      };
      await load();
      setNeoMsg(
        `${res.nbDevisCrees} devis Néoliane ajoutés au dossier (${res.nbTarifs} tarifs retournés pour ${res.nbAssures} assuré(s)).` +
          (res.compagnieTrouvee ? "" : " Compagnie « Néoliane » introuvable en base : les devis sont créés sans compagnie."),
      );
      onChanged?.();
    } catch (e) {
      setNeoErr(e instanceof Error ? e.message : "Appel Néoliane impossible");
    } finally {
      setNeoEtat("idle");
    }
  };

  const recupererTarifsUgip = async () => {
    setUgipErr(null);
    setUgipMsg(null);
    setUgipEtat("appel");
    try {
      const res = (await tariferUgip({ data: { dossier_id: dossierId, date_effet: ugipDate } })) as {
        nbDevisCrees: number;
        nbTarifs: number;
        nbProduitsInterroges: number;
        nbAssures: number;
        compagnieTrouvee: boolean;
        echecs: string[];
      };
      await load();
      setUgipMsg(
        `${res.nbDevisCrees} devis UGIP ajoutés au dossier (${res.nbTarifs} tarifs obtenus sur ${res.nbProduitsInterroges} produits interrogés, ${res.nbAssures} assuré(s)).` +
          (res.compagnieTrouvee ? "" : " Compagnie « UGIP » introuvable en base : les devis sont créés sans compagnie.") +
          (res.echecs.length > 0 ? `\nProduits écartés : ${res.echecs.join(" · ")}` : ""),
      );
      onChanged?.();
    } catch (e) {
      setUgipErr(e instanceof Error ? e.message : "Appel UGIP impossible");
    } finally {
      setUgipEtat("idle");
    }
  };





  const recupererTarifsSimulassur = async () => {
    setSimuErr(null);
    setSimuMsg(null);
    setSimuEtat("appel");
    try {
      const res = (await tariferSimulassur({
        data: { dossier_id: dossierId, date_effet: simuDate },
      })) as {
        nbDevisCrees: number;
        nbOffres: number;
        nbOffresExploitables: number;
        nbAssures: number;
        compagnieTrouvee: boolean;
        erreursProduits: string[];
      };
      await load();
      setSimuMsg(
        `${res.nbDevisCrees} devis Simulassur ajoutés au dossier (${res.nbOffresExploitables} offres exploitables sur ${res.nbOffres} retournées, ${res.nbAssures} assuré(s)).` +
          (res.compagnieTrouvee
            ? ""
            : " Compagnie « Simulassur » introuvable en base : les devis sont créés sans compagnie.") +
          (res.erreursProduits.length > 0
            ? `\nProduits écartés : ${res.erreursProduits.join(" · ")}`
            : ""),
      );
      onChanged?.();
    } catch (e) {
      setSimuErr(e instanceof Error ? e.message : "Appel Simulassur impossible");
    } finally {
      setSimuEtat("idle");
    }
  };

  return (
    <div className="rounded-2xl border border-line bg-surface-elevated p-5">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 sm:flex sm:items-center sm:justify-between">
        <h2 className="min-w-0 font-serif text-lg font-medium text-ink">Devis et valorisation</h2>
        {(
          <button
            onClick={() => {
              setSaisieOuverte(true);
            }}
            className="shrink-0 rounded-full bg-ink px-4 py-2 text-xs text-primary-foreground"
          >
            Nouveau devis (autre partenaire ou produit)
          </button>
        )}
      </div>
      <p className="mt-1 text-xs text-ink-muted">
        {produitFixe
          ? `Produit à tarification fixe (${produitFixe.nom}) : le devis est repris directement du tarif renseigné sur la fiche produit, sans ressaisie ni classement IA.`
          : `Saisie manuelle des devis étudiés pour ce dossier${branche ? ` (${branche})` : ""}. Ils alimentent le tableau des offres comparées du devoir de conseil. La saisie manuelle couvre les compagnies sans API de tarification et les contrats déjà validés par la compagnie (import rétroactif).`}
      </p>

      {/* Ajout d'un devis : dépôt direct ou reprise d'une pièce déjà au dossier. */}
      <div className="mt-4 rounded-xl border border-line bg-surface p-4">
        <h3 className="text-sm font-medium text-ink">Ajouter un devis</h3>
        <p className="mt-1 text-xs text-ink-muted">
          Déposez le devis reçu, ou reprenez une pièce déjà présente sur le dossier (reçue par e-mail, scannée). La
          pièce est lue automatiquement : partenaire, produit, tarif{estEmprunteur ? ", quotité" : ""} et garanties
          sont seulement proposés. Rien n'est enregistré sans votre validation.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-ink px-4 py-2 text-xs text-primary-foreground disabled:opacity-60">
            <input
              type="file"
              accept="application/pdf,image/*"
              className="hidden"
              disabled={importBusy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void importerDevis(f);
              }}
            />
            {importBusy ? "Lecture en cours…" : "Déposer un devis (PDF ou photo)"}
          </label>
          <button
            type="button"
            onClick={() => setPiecesOuvertes((v) => !v)}
            disabled={importBusy}
            className="rounded-full border border-line px-4 py-2 text-xs text-ink hover:bg-surface disabled:opacity-60"
          >
            Reprendre un devis du dossier ({piecesCandidates.length})
          </button>
        </div>

        {piecesOuvertes && (
          <div className="mt-3 space-y-2">
            {piecesCandidates.length === 0 ? (
              <p className="text-xs text-ink-muted">
                Aucune pièce du dossier ne ressemble à un devis. Déposez le fichier ci-dessus, ou classez la pièce en
                « devis » depuis l'onglet des pièces du dossier.
              </p>
            ) : (
              piecesCandidates.map((p) => (
                <div
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface-elevated/60 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-ink">{p.file_name ?? "Pièce sans nom"}</p>
                    <p className="text-[11px] text-ink-muted">
                      Déposée le {new Date(p.created_at).toLocaleDateString("fr-FR")}
                      {p.type_document ? ` · ${p.type_document.replace(/_/g, " ")}` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void reprendreDocument(p.id, p.file_name ?? "cette pièce")}
                    disabled={importBusy}
                    className="shrink-0 rounded-full border border-line px-3 py-1.5 text-xs text-ink hover:bg-surface disabled:opacity-60"
                  >
                    Lire et préremplir
                  </button>
                </div>
              ))
            )}
          </div>
        )}

        {importMsg && <p className="mt-2 text-xs text-emerald-700">{importMsg}</p>}
      </div>




      {err && <p className="mt-2 text-sm text-destructive">{err}</p>}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-xs">
        <p className="text-ink-soft">
          {dossierInfo.produit_id ? (
            <>
              Offre actuellement retenue : <strong className="text-ink">{nomCompagnie(dossierInfo.compagnie_id)}</strong>{" "}
              — {nomProduit(dossierInfo.produit_id)}
            </>
          ) : (
            "Aucune offre retenue pour l'instant : choisissez un devis ci-dessous."
          )}
        </p>
        <p className="text-ink-muted">
          {devis.length} devis au dossier · une autre offre peut être retenue à tout moment, même sur un dossier déjà
          validé.
        </p>
      </div>

      {nbDoublonsMasques > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[color:var(--crm-gold)]/40 bg-[color:var(--crm-gold)]/10 px-3 py-2">
          <p className="text-xs text-ink-soft">
            {nbDoublonsMasques} offre(s) masquée(s) : même assureur porteur distribué par plusieurs canaux — seule
            l'offre la moins chère (priorité au tarif automatique) est affichée.
          </p>
          <button
            onClick={() => setAfficherDoublons((v) => !v)}
            className="rounded-full border border-line bg-surface px-3 py-1.5 text-xs text-ink"
          >
            {afficherDoublons ? "Masquer les doublons de canaux" : "Afficher tous les canaux (y compris doublons)"}
          </button>
        </div>
      )}

      {assuresRecueil.length >= 2 &&
        assuresRecueil.some((a) => !devis.some((d) => (d.assure_rang ?? 1) === a.rang)) && (
          <p className="mt-4 rounded-xl border border-[color:var(--crm-gold)]/50 bg-[color:var(--crm-gold)]/10 px-3 py-2 text-sm text-ink">
            Prêt à deux têtes : un devis distinct est obligatoire pour chaque assuré. Manquant pour{" "}
            {assuresRecueil
              .filter((a) => !devis.some((d) => (d.assure_rang ?? 1) === a.rang))
              .map((a) => a.label)
              .join(", ")}
            .
          </p>
        )}

      {estEmprunteur && (
        <div className="mt-4 rounded-xl border border-line bg-surface-elevated/60 px-3 py-2 text-xs">
          {assuranceInit.coutRestant != null ? (
            <p className="text-ink">
              <strong>Assurance bancaire actuelle</strong> :{" "}
              {assuranceInit.mensuel?.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} € / mois
              {assuranceInit.origine === "offre" ? " (offre de prêt)" : " (calcul par taux)"} — reste{" "}
              <strong>{Math.round(assuranceInit.coutRestant).toLocaleString("fr-FR")} €</strong> à payer
              {assuranceInit.moisRestants ? ` sur ${assuranceInit.moisRestants} mois` : ""}, du mois prévu de la
              substitution à la fin du crédit. C'est la base de comparaison des devis ci-dessous.
            </p>
          ) : (
            <p className="text-ink-muted">
              Économie non chiffrable : renseignez dans le recueil des besoins le taux d'assurance de la banque (ou la
              cotisation mensuelle de l'offre de prêt) et les mois restants.
            </p>
          )}
        </div>
      )}

      {estEmprunteur && (
        <div className="mt-4 rounded-xl border border-line bg-surface p-4">
          <h3 className="text-sm font-medium text-ink">Produits du catalogue et adéquation au dossier</h3>
          <p className="mt-1 text-xs text-ink-muted">
            Le contrat est choisi dans le catalogue du cabinet selon la situation du prospect
            {notesProduits.size > 0 &&
            [...notesProduits.values()][0] &&
            [...notesProduits.values()][0]!.profils.length > 0
              ? ` (${[...notesProduits.values()][0]!.profils.map((p) => LIBELLES_PROFILS[p]).join(", ")})`
              : ""}
            . La note est calculée uniquement sur les grilles de garanties validées dans le CRM : un produit sans
            grille validée n'est pas noté. Pour chaque produit retenu, ajoutez le prix obtenu auprès du partenaire —
            le classement par prix se fait automatiquement ci-dessous.
          </p>

          {produitsNotes.length === 0 && (
            <p className="mt-3 text-sm text-ink-muted">
              Aucun produit emprunteur dans le catalogue : ajoutez-les depuis les fiches partenaires.
            </p>
          )}

          <div className="mt-3 space-y-2">
            {produitsNotes.map(({ produit, note }) => {
              const devisProduit = devis.filter((d) => d.produit_id === produit.id);
              return (
                <div key={produit.id} className="rounded-xl border border-line bg-surface-elevated/60 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink">
                        {nomCompagnie(produit.compagnie_id)} — {produit.nom}
                        {produit.assureur_porteur && (
                          <span className="text-ink-soft"> · porté par {produit.assureur_porteur}</span>
                        )}
                      </p>
                      {note?.score != null ? (
                        <p className="mt-1 text-xs text-ink-soft">
                          {note.points_forts.length > 0 && <>Points forts : {note.points_forts.join(", ")}. </>}
                          {note.points_faibles.length > 0 && <>À surveiller : {note.points_faibles.join(", ")}.</>}
                        </p>
                      ) : (
                        <p className="mt-1 text-xs text-ink-muted">
                          Grille de garanties non validée pour ce produit : adéquation non disponible pour
                          comparaison.
                        </p>
                      )}
                      {devisProduit.length > 0 && (
                        <p className="mt-1 text-xs text-ink-muted">
                          {devisProduit.length} prix déjà saisi(s) pour ce produit sur le dossier.
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <span
                        className={`inline-flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-full text-xs ${
                          note?.score == null
                            ? "border border-dashed border-line text-ink-muted"
                            : note.score >= 70
                              ? "bg-[color:var(--crm-gold)]/25 text-ink"
                              : "border border-line text-ink-soft"
                        }`}
                      >
                        {note?.score == null ? "—" : <strong>{note.score}</strong>}
                        {note?.score != null && <span className="text-[10px] text-ink-muted">/100</span>}
                      </span>
                      <button
                        onClick={() => preparerDevisProduit(produit)}
                        className="rounded-full border border-line bg-surface px-3 py-1.5 text-xs text-ink"
                      >
                        Saisir le prix de ce produit
                      </button>
                      <label
                        className={`cursor-pointer rounded-full border border-line bg-surface px-3 py-1.5 text-xs text-ink ${
                          importBusy ? "opacity-50" : "hover:bg-surface-elevated"
                        }`}
                      >
                        <input
                          type="file"
                          accept="application/pdf,image/*"
                          className="hidden"
                          disabled={importBusy}
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            e.target.value = "";
                            if (f) {
                              preparerDevisProduit(produit);
                              void importerDevis(f, produit);
                            }
                          }}
                        />
                        {importBusy ? "Lecture…" : "Importer le devis (IA)"}
                      </label>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {estEmprunteur && (
        <div className="mt-4 space-y-3">
          {/* Bandeau de synthèse du dossier : coût total et gain, toutes têtes confondues. */}
          <div className="rounded-xl border border-line bg-ink px-4 py-3 text-primary-foreground">
            <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
              <div>
                <p className="text-[11px] uppercase tracking-wide opacity-70">Coût total assurance retenu</p>
                <p className="font-serif text-xl">
                  {totalRetenuDossier != null
                    ? `${Math.round(totalRetenuDossier).toLocaleString("fr-FR")} €`
                    : "non disponible"}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide opacity-70">Les 8 premières années</p>
                <p className="text-sm">
                  {huitAnsRetenuDossier != null
                    ? `${Math.round(huitAnsRetenuDossier).toLocaleString("fr-FR")} €`
                    : "non disponible"}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide opacity-70">Assurance bancaire actuelle</p>
                <p className="text-sm">
                  {assuranceInit.coutRestant != null
                    ? `${Math.round(assuranceInit.coutRestant).toLocaleString("fr-FR")} €`
                    : "non disponible"}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide opacity-70">Économie estimée</p>
                <p
                  className={`text-sm font-medium ${
                    economieRetenueDossier == null
                      ? ""
                      : economieRetenueDossier >= 0
                        ? "text-emerald-300"
                        : "text-red-300"
                  }`}
                >
                  {economieRetenueDossier == null
                    ? "non disponible"
                    : `${economieRetenueDossier >= 0 ? "+" : "−"}${Math.abs(
                        Math.round(economieRetenueDossier),
                      ).toLocaleString("fr-FR")} €`}
                </p>
              </div>
              <p className="ml-auto text-[11px] opacity-70">
                {moisRestants ? `${moisRestants} mois restants` : "durée restante à compléter"}
              </p>
            </div>
          </div>

          {/* Une colonne par assuré : couvertures puis propositions chiffrées. */}
          <div
            className={`grid gap-3 ${assuresColonnes.length >= 2 ? "lg:grid-cols-2" : "grid-cols-1"}`}
          >
            {assuresColonnes.map((a) => {
              const offres = propositionsParTete(a.rang);
              const meilleur = offres[0];
              const retenuTete = offres.find((o) => estDevisRetenu(o));
              const reference = retenuTete ?? meilleur;
              const totalTete = reference ? coutTotalDevis(reference) : null;
              return (
                <div key={a.rang} className="overflow-hidden rounded-xl border border-line bg-surface">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 bg-ink px-4 py-3 text-primary-foreground">
                    <div className="min-w-0">
                      <p className="font-serif text-base">{a.nom ?? a.label}</p>
                      <p className="text-[11px] opacity-70">
                        {a.label}
                        {a.adhesion ? ` · adhésion ${a.adhesion}` : ""}
                      </p>
                    </div>
                    <p className="text-sm">
                      {totalTete != null ? (
                        <>
                          <strong className="font-serif text-lg">
                            {Math.round(totalTete).toLocaleString("fr-FR")} €
                          </strong>
                          <span className="ml-2 text-[11px] opacity-70">coût total assurance</span>
                        </>
                      ) : (
                        <span className="text-[11px] opacity-70">coût total non disponible</span>
                      )}
                    </p>
                  </div>

                  <div className="border-b border-line bg-surface-elevated/60 px-4 py-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-ink-soft">Couvertures</p>
                    <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
                      <div>
                        <dt className="text-ink-muted">Garanties</dt>
                        <dd className="text-ink">{a.garanties ?? "non renseignées"}</dd>
                      </div>
                      <div>
                        <dt className="text-ink-muted">Quotité</dt>
                        <dd className="text-ink">{a.quotite != null ? `${a.quotite} %` : "non renseignée"}</dd>
                      </div>
                      <div>
                        <dt className="text-ink-muted">Franchise</dt>
                        <dd className="text-ink">{a.franchise ?? "non renseignée"}</dd>
                      </div>
                    </dl>
                    {a.options && <p className="mt-2 text-xs text-ink-soft">Options : {a.options}</p>}
                    {crdRecueil != null && (
                      <p className="mt-2 text-xs text-ink-muted">
                        Capital assuré de référence : {Math.round(crdRecueil).toLocaleString("fr-FR")} €
                      </p>
                    )}
                  </div>

                  <div className="px-4 py-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-ink-soft">
                      {offres.length} proposition{offres.length > 1 ? "s" : ""} — du moins cher au plus cher
                    </p>
                    {offres.length === 0 && (
                      <p className="mt-2 rounded-lg border border-dashed border-line px-3 py-3 text-xs text-ink-muted">
                        Aucun prix saisi pour cet assuré : utilisez « Saisir le prix » ou « Importer le devis » sur un
                        produit du catalogue ci-dessus.
                      </p>
                    )}
                    <div className="mt-2 space-y-2">
                      {offres.map((d, i) => {
                        const total = coutTotalDevis(d);
                        const huit = coutHuitAns(d);
                        const eco = economiePourDevis(d);
                        const note = notesProduits.get(d.produit_id ?? "")?.score ?? null;
                        const retenu = estDevisRetenu(d);
                        return (
                          <div
                            key={d.id}
                            className={`rounded-lg border p-3 ${
                              retenu
                                ? "border-[color:var(--crm-gold)] bg-[color:var(--crm-gold)]/10"
                                : "border-line bg-surface-elevated/40"
                            }`}
                          >
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <p className="min-w-0 text-sm font-medium text-ink">
                                <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-ink text-[10px] text-primary-foreground">
                                  {i + 1}
                                </span>
                                {nomCompagnie(d.compagnie_id)} — {nomProduit(d.produit_id)}
                              </p>
                              <span
                                className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${
                                  note == null
                                    ? "border border-dashed border-line text-ink-muted"
                                    : note >= 70
                                      ? "bg-emerald-600/15 text-emerald-800"
                                      : "border border-line text-ink-soft"
                                }`}
                              >
                                {note == null
                                  ? "équivalence non disponible"
                                  : note >= 70
                                    ? "Compatible banque"
                                    : `Adéquation ${note}/100`}
                              </span>
                            </div>

                            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-xs sm:grid-cols-4">
                              <div>
                                <p className="text-ink-muted">Coût total assurance</p>
                                <p className="text-ink">
                                  {total != null
                                    ? `${Math.round(total).toLocaleString("fr-FR")} €`
                                    : "non disponible"}
                                </p>
                              </div>
                              <div>
                                <p className="text-ink-muted">Les 8 premières années</p>
                                <p className="text-ink">
                                  {huit != null ? `${Math.round(huit).toLocaleString("fr-FR")} €` : "non disponible"}
                                </p>
                              </div>
                              <div>
                                <p className="text-ink-muted">Cotisation</p>
                                <p className="text-ink">
                                  {d.cotisation_mensuelle != null
                                    ? `${Number(d.cotisation_mensuelle).toLocaleString("fr-FR", {
                                        maximumFractionDigits: 2,
                                      })} € / mois`
                                    : "à renseigner"}
                                  {d.type_cotisation ? ` (${d.type_cotisation})` : ""}
                                </p>
                              </div>
                              <div>
                                <p className="text-ink-muted">Différentiel vs banque</p>
                                <p
                                  className={
                                    eco == null
                                      ? "text-ink-muted"
                                      : eco.economie >= 0
                                        ? "font-medium text-emerald-700"
                                        : "font-medium text-red-700"
                                  }
                                >
                                  {eco == null
                                    ? "non disponible"
                                    : `${eco.economie >= 0 ? "−" : "+"}${Math.abs(
                                        Math.round(eco.economie),
                                      ).toLocaleString("fr-FR")} €${
                                        eco.economie >= 0 ? ` (${eco.pourcentage} %)` : ""
                                      }`}
                                </p>
                              </div>
                            </div>

                            {d.type_cotisation === "CRD" && (
                              <p className="mt-2 rounded-md bg-surface px-2 py-1 text-[11px] text-ink-soft">
                                Cotisation sur capital restant dû : plus élevée au début puis dégressive. Cette
                                information est reprise dans le devoir de conseil remis au client.
                              </p>
                            )}

                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              <button
                                onClick={() => void retenirDirectement(d)}
                                disabled={iaEtat !== "idle" || !d.compagnie_id || !d.produit_id}
                                className={`rounded-full px-4 py-1.5 text-xs disabled:opacity-50 ${
                                  retenu ? "border border-line bg-surface text-ink" : "bg-ink text-primary-foreground"
                                }`}
                              >
                                {retenu ? "Offre retenue" : "Recommander ce devis"}
                              </button>
                              <button
                                onClick={() => supprimer(d)}
                                className="text-[11px] text-red-700 underline underline-offset-4"
                              >
                                Archiver
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <DevisComparatifTable
            familleCode="emprunteur"
            devis={devisAffiches}
            nomCompagnie={(id) => compagnies.find((c) => c.id === id)?.nom ?? "Compagnie non renseignée"}
            nomProduit={(id) => produits.find((p) => p.id === id)?.nom ?? "Produit non renseigné"}
            grillesProduits={grillesProduits}
            coutTotal={(d) => coutTotalDevis(d as DossierDevis)}
            coutHuitAns={(d) => coutHuitAns(d as DossierDevis)}
            economie={(d) => economiePourDevis(d)}
            estRetenu={(d) => estDevisRetenu(d as DossierDevis)}
            pret={{
              moisRestants,
              crd: crdRecueil,
              coutBanque: assuranceInit.coutRestant,
            }}
            labelAssure={(rang) =>
              assuresColonnes.find((a) => a.rang === (rang ?? 1))?.label ?? `Assuré ${rang ?? 1}`
            }
          />

          <button
            onClick={() => setDetailOuvert((v) => !v)}
            className="rounded-full border border-line bg-surface px-3 py-1.5 text-xs text-ink"
          >
            {detailOuvert ? "Masquer le détail technique des devis" : "Afficher le détail technique des devis"}
          </button>
        </div>
      )}

      {/* Hors emprunteur : comparatif sur la grille de garanties de la branche du dossier. */}
      {!estEmprunteur && familleCodeDossier && (
        <DevisComparatifTable
          familleCode={familleCodeDossier}
          devis={devisAffiches}
          nomCompagnie={(id) => compagnies.find((c) => c.id === id)?.nom ?? "Compagnie non renseignée"}
          nomProduit={(id) => produits.find((p) => p.id === id)?.nom ?? "Produit non renseigné"}
          grillesProduits={grillesProduits}
          coutTotal={() => null}
          coutHuitAns={() => null}
          economie={() => null}
          estRetenu={(d) => estDevisRetenu(d as DossierDevis)}
          labelAssure={(rang) => `Assuré ${rang ?? 1}`}
        />
      )}


      <div className={`mt-4 space-y-2 ${estEmprunteur && !detailOuvert ? "hidden" : ""}`}>
        {devis.length === 0 && (
          <p className="rounded-xl border border-dashed border-line bg-surface px-3 py-4 text-sm text-ink-muted">
            Aucune offre pour ce dossier. Lancez une tarification automatique ci-dessous ou ajoutez un devis
            manuellement : tous les partenaires et produits du catalogue de la branche sont disponibles.
          </p>
        )}
        {devisAffiches.map((d) => {
          const formule = d.formule_id;
          const groupeListe = porteurPartage(d);
          const retenu = estDevisRetenu(d);
          const meilleur = meilleurParTete.get(d.assure_rang ?? 1) === d.id;
          const rang = rangIa(d.id);
          return (
            <div
              key={d.id}
              className={`rounded-xl border bg-surface p-4 text-sm ${
                retenu
                  ? "border-[color:var(--crm-gold)] bg-[color:var(--crm-gold)]/10 ring-1 ring-[color:var(--crm-gold)]"
                  : groupeListe
                    ? "border-l-4 border-l-[color:var(--crm-gold)] border-[color:var(--crm-gold)]/40"
                    : "border-line"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {rang != null && (
                      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-ink text-xs text-primary-foreground">
                        {rang}
                      </span>
                    )}
                    <p className="font-serif text-base font-medium text-ink">
                      {nomCompagnie(d.compagnie_id)} — {nomProduit(d.produit_id)}
                      {formule && <FormuleNom formuleId={formule} />}
                    </p>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                    {retenu && (
                      <span className="rounded-full bg-ink px-2 py-0.5 text-primary-foreground">Offre retenue</span>
                    )}
                    {meilleur && !retenu && (
                      <span className="rounded-full border border-[color:var(--crm-gold)] px-2 py-0.5 text-ink">
                        Cotisation la plus basse
                      </span>
                    )}
                    {assuresRecueil.length >= 2 && (
                      <span className="rounded-full border border-line px-2 py-0.5 text-ink-soft">
                        {assuresRecueil.find((a) => a.rang === (d.assure_rang ?? 1))?.label ??
                          `Tête ${d.assure_rang ?? 1}`}
                      </span>
                    )}
                    <span className="rounded-full border border-line px-2 py-0.5 text-ink-muted">
                      {d.source === "api" ? "Tarif automatique (API)" : d.source === "pdf" ? "Devis PDF" : "Saisie manuelle"}
                    </span>
                    {estEmprunteur && d.quotite_pct != null && (
                      <span className="rounded-full border border-line px-2 py-0.5 text-ink-muted">
                        Quotité {d.quotite_pct} %
                      </span>
                    )}

                  </div>

                  {/* Rémunération du cabinet — interne, jamais visible client ni apporteur. */}
                  {staff &&
                    (() => {
                      const c = commissionPourDevis(d);
                      const enEdition = commEdit?.id === d.id;
                      return (
                        <div className="mt-2 rounded-lg border border-dashed border-[color:var(--crm-gold)]/60 bg-background p-2 text-xs">
                          {enEdition ? (
                            <div className="flex flex-wrap items-end gap-2">
                              <label className="block">
                                <span className="text-ink-muted">Taux (%)</span>
                                <input
                                  type="number"
                                  step="0.01"
                                  min={0}
                                  max={100}
                                  value={commEdit.taux}
                                  onChange={(e) => setCommEdit({ ...commEdit, taux: e.target.value })}
                                  className="mt-0.5 block w-24 rounded-md border border-line bg-surface px-2 py-1"
                                />
                              </label>
                              <label className="block">
                                <span className="text-ink-muted">Assiette</span>
                                <select
                                  value={commEdit.base}
                                  onChange={(e) =>
                                    setCommEdit({ ...commEdit, base: e.target.value as BaseCommission })
                                  }
                                  className="mt-0.5 block rounded-md border border-line bg-surface px-2 py-1"
                                >
                                  <option value="economie_realisee">Économie réalisée</option>
                                  <option value="prime">Cotisation</option>
                                </select>
                              </label>
                              <button
                                onClick={() => void enregistrerCommission()}
                                disabled={commBusy}
                                className="rounded-full bg-ink px-3 py-1 text-primary-foreground disabled:opacity-60"
                              >
                                {commBusy ? "Enregistrement…" : "Enregistrer"}
                              </button>
                              <button
                                onClick={() => setCommEdit(null)}
                                className="text-ink-muted underline underline-offset-4"
                              >
                                Annuler
                              </button>
                            </div>
                          ) : (
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-ink">
                                Commission cabinet :{" "}
                                <strong>
                                  {c.taux != null ? `${c.taux} %` : "à définir"}
                                  {c.base === "economie_realisee" ? " des économies" : " de la cotisation"}
                                </strong>
                                {c.prevu.total != null && (
                                  <>
                                    {" · "}
                                    {Math.round(c.prevu.total).toLocaleString("fr-FR")} € prévisionnels
                                  </>
                                )}
                              </span>
                              <span className="rounded-full border border-line px-2 py-0.5 text-ink-muted">
                                {c.applique ? c.origine : `Proposé — ${c.origine}`}
                              </span>
                              <button
                                onClick={() => ouvrirCommission(d)}
                                className="text-ink underline underline-offset-4"
                              >
                                {c.applique ? "Modifier le taux" : "Saisir le taux"}
                              </button>
                            </div>
                          )}
                          <p className="mt-1 text-[11px] text-ink-muted">
                            Donnée interne (dashboard et comptabilité) : ce taux devient la commission
                            prévisionnelle du contrat de l'assuré si ce devis est retenu.
                          </p>
                        </div>
                      );
                    })()}
                </div>
                <div className="text-right">
                  <p className="font-serif text-lg text-ink">
                    {d.cotisation_mensuelle != null
                      ? `${Number(d.cotisation_mensuelle).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} € / mois`
                      : "Cotisation à renseigner"}
                  </p>
                  {d.montant_total_saisi != null && (
                    <p className="text-xs text-ink-soft">
                      {Number(d.montant_total_saisi).toLocaleString("fr-FR")} €{" "}
                      {estEmprunteur ? "au total sur la durée du prêt" : "par an"}
                    </p>
                  )}
                  {estEmprunteur && d.type_cotisation && (
                    <p className="text-xs text-ink-muted">
                      {d.type_cotisation === "CI"
                        ? "CI — cotisation constante sur le capital initial"
                        : `CRD — cotisation dégressive${
                            d.cotisation_min != null && d.cotisation_max != null
                              ? ` (de ${Number(d.cotisation_min).toLocaleString("fr-FR")} € à ${Number(
                                  d.cotisation_max,
                                ).toLocaleString("fr-FR")} €)`
                              : ""
                          }`}
                    </p>
                  )}

                </div>
              </div>

              {estEmprunteur && d.type_cotisation === "CRD" && (
                <p className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-800">
                  Note d'information : cotisation calculée sur le capital restant dû. Même si le coût
                  total est inférieur, la cotisation est plus élevée les premières années puis diminue
                  avec le capital. Si cette offre est retenue, cette caractéristique est reprise dans
                  le devoir de conseil remis au client.
                </p>
              )}


              {(() => {
                if (!estEmprunteur) return null;
                const eco = economiePourDevis(d);
                if (!eco) return null;

                return (
                  <p
                    className={`mt-2 rounded-md px-2 py-1 text-xs ${
                      eco.economie > 0
                        ? "bg-[color:var(--crm-gold)]/15 text-ink"
                        : "bg-surface-elevated/70 text-ink-muted"
                    }`}
                  >
                    {eco.economie > 0 ? (
                      <>
                        Économie estimée : <strong>{Math.round(eco.economie).toLocaleString("fr-FR")} €</strong> (
                        {eco.pourcentage} %) — {Math.round(eco.coutDevis).toLocaleString("fr-FR")} € contre{" "}
                        {Math.round(eco.coutInitial).toLocaleString("fr-FR")} € avec la banque, jusqu'à la fin du
                        crédit.
                      </>
                    ) : (
                      <>
                        Aucune économie : ce devis coûte{" "}
                        {Math.abs(Math.round(eco.economie)).toLocaleString("fr-FR")} € de plus que l'assurance bancaire
                        actuelle sur la période restante.
                      </>
                    )}
                  </p>
                );
              })()}
              {groupeListe && (
                <p className="mt-2 rounded-md bg-surface-elevated/70 px-2 py-1 text-xs text-ink-soft">
                  Même assureur porteur : <strong>{groupeListe.nom}</strong> — disponible via{" "}
                  {groupeListe.canaux.join(", ")}
                </p>
              )}
              {d.garanties_resume && (
                <p className="mt-2 whitespace-pre-wrap text-xs text-ink-soft">{d.garanties_resume}</p>
              )}
              {rang != null && classement && (
                <p className="mt-2 whitespace-pre-wrap rounded-md bg-surface-elevated/70 px-2 py-1 text-xs text-ink-soft">
                  {classement.classement.find((l) => l.dossier_devis_id === d.id)?.justification}
                </p>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  onClick={() => void retenirDirectement(d)}
                  disabled={iaEtat !== "idle" || !d.compagnie_id || !d.produit_id}
                  className={`rounded-full px-4 py-2 text-xs disabled:opacity-50 ${
                    retenu
                      ? "border border-line bg-surface text-ink"
                      : "bg-ink text-primary-foreground"
                  }`}
                >
                  {iaEtat === "selection"
                    ? "Traitement…"
                    : retenu
                      ? "Confirmer cette recommandation"
                      : "Recommander ce devis"}
                </button>
                {(!d.compagnie_id || !d.produit_id) && (
                  <span className="text-xs text-ink-muted">
                    Compagnie ou produit manquant sur ce devis : il ne peut pas être retenu.
                  </span>
                )}
                <button onClick={() => supprimer(d)} className="text-xs text-red-700 underline underline-offset-4">
                  Archiver
                </button>
              </div>
            </div>
          );
        })}

      </div>

      {nbAssuresApi > 0 && (
        <div className="mt-4 space-y-3 rounded-xl border border-line bg-surface p-4">
          <div>
            <h3 className="text-sm font-medium text-ink">Tarification Néoliane (API)</h3>
            <p className="mt-1 text-xs text-ink-muted">
              {nbAssuresApi} assuré(s) du recueil seront transmis à Néoliane pour cette branche. Les tarifs obtenus
              sont ajoutés automatiquement au comparatif ; la saisie manuelle reste toujours possible.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">Date d'effet</span>
              <input type="date" value={neoDate} onChange={(e) => setNeoDate(e.target.value)} className={inp} />
            </label>
            <button
              onClick={recupererTarifsNeoliane}
              disabled={neoEtat === "appel" || !neoDate}
              className="rounded-full bg-ink px-5 py-2 text-sm text-primary-foreground disabled:opacity-50"
            >
              {neoEtat === "appel" ? "Appel Néoliane…" : "Récupérer les tarifs Néoliane"}
            </button>
          </div>
          {neoMsg && <p className="text-sm text-emerald-700">{neoMsg}</p>}
          {neoErr && <p className="whitespace-pre-wrap text-sm text-destructive">{neoErr}</p>}
        </div>
      )}

      {nbAssuresUgipApi > 0 && (
        <div className="mt-4 space-y-3 rounded-xl border border-line bg-surface p-4">
          <div>
            <h3 className="text-sm font-medium text-ink">Tarification UGIP Assurances (API)</h3>
            <p className="mt-1 text-xs text-ink-muted">
              {nbAssuresUgipApi} assuré(s) du recueil, avec leur quotité, seront transmis à UGIP sur l'ensemble des
              produits emprunteur commercialisés (bases capital initial et capital restant dû). Les 5 offres les moins
              chères sont ajoutées au comparatif, garanties Décès, PTIA, IPT et ITT franchise 90 jours.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">Date d'effet</span>
              <input type="date" value={ugipDate} onChange={(e) => setUgipDate(e.target.value)} className={inp} />
            </label>
            <button
              onClick={recupererTarifsUgip}
              disabled={ugipEtat === "appel" || !ugipDate}
              className="rounded-full bg-ink px-5 py-2 text-sm text-primary-foreground disabled:opacity-50"
            >
              {ugipEtat === "appel" ? "Appel UGIP…" : "Récupérer les tarifs UGIP"}
            </button>
          </div>
          {ugipMsg && <p className="whitespace-pre-wrap text-sm text-emerald-700">{ugipMsg}</p>}
          {ugipErr && <p className="whitespace-pre-wrap text-sm text-destructive">{ugipErr}</p>}
        </div>
      )}



      {nbAssuresSimu > 0 && (
        <div className="mt-4 space-y-3 rounded-xl border border-line bg-surface p-4">
          <div>
            <h3 className="text-sm font-medium text-ink">Tarification Simulassur (API)</h3>
            <p className="mt-1 text-xs text-ink-muted">
              {nbAssuresSimu} assuré(s) du recueil, avec leur quotité, sont transmis à Simulassur avec les
              caractéristiques du prêt. Les 5 offres les moins chères sont ajoutées au comparatif (Décès, PTIA, IPT,
              ITT/ITP franchise 90 jours), avec coût total et TAEA.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">Date d'effet</span>
              <input type="date" value={simuDate} onChange={(e) => setSimuDate(e.target.value)} className={inp} />
            </label>
            <button
              onClick={recupererTarifsSimulassur}
              disabled={simuEtat === "appel" || !simuDate}
              className="rounded-full bg-ink px-5 py-2 text-sm text-primary-foreground disabled:opacity-50"
            >
              {simuEtat === "appel" ? "Appel Simulassur…" : "Récupérer les tarifs Simulassur"}
            </button>
          </div>
          {simuMsg && <p className="whitespace-pre-wrap text-sm text-emerald-700">{simuMsg}</p>}
          {simuErr && <p className="whitespace-pre-wrap text-sm text-destructive">{simuErr}</p>}
        </div>
      )}

      {produitFixe && (
        <div className="mt-4 space-y-3 border-t border-line pt-4">
          <div>
            <h3 className="text-sm font-medium text-ink">Tarif fixe du produit</h3>
            <p className="mt-1 text-xs text-ink-muted">
              Choisissez la formule et les options souhaitées : le total est calculé automatiquement et devient la
              seule offre du dossier. Aucun classement IA n'est nécessaire.
            </p>
          </div>

          {formulesFixes.length === 0 && (
            <p className="text-sm text-ink-muted">
              Aucune formule active avec tarif fixe sur ce produit — renseignez-les sur la fiche produit.
            </p>
          )}

          {formulesFixes.length > 0 && (
            <>
              <label className="block sm:max-w-sm">
                <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">Formule</span>
                <select value={fixeFormuleId} onChange={(e) => setFixeFormuleId(e.target.value)} className={inp}>
                  <option value="">— Choisir —</option>
                  {formulesFixes.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.nom}
                      {f.tarif_fixe == null ? " (tarif non renseigné)" : ` — ${eur(Number(f.tarif_fixe))}`}
                    </option>
                  ))}
                </select>
              </label>

              {optionsFixes.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">Options</p>
                  {optionsFixes.map((o) => (
                    <label key={o.id} className="flex items-start gap-2 text-sm text-ink">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={fixeOptionIds.includes(o.id)}
                        onChange={(e) =>
                          setFixeOptionIds((l) => (e.target.checked ? [...l, o.id] : l.filter((x) => x !== o.id)))
                        }
                      />
                      <span>
                        {o.nom}
                        <span className="text-ink-soft">
                          {" "}
                          — {o.tarif_fixe == null ? "tarif non renseigné" : eur(Number(o.tarif_fixe))}
                        </span>
                        {o.description && <span className="block text-xs text-ink-muted">{o.description}</span>}
                      </span>
                    </label>
                  ))}
                </div>
              )}

              <p className="text-sm font-medium text-ink">
                Total calculé : <span className="text-ink-soft">{eur(totalFixe)}</span>
              </p>

              <button
                onClick={genererDepuisTarifFixe}
                disabled={!fixeFormuleId || fixeEtat !== "idle"}
                className="rounded-full bg-ink px-4 py-2 text-sm text-primary-foreground disabled:opacity-60"
              >
                {fixeEtat === "envoi" ? "Génération…" : "Créer ce devis et générer le devoir de conseil"}
              </button>
              {iaMsg && <p className="text-sm text-emerald-700">{iaMsg}</p>}
            </>
          )}
        </div>
      )}

      {!produitFixe && (
      <div className="mt-4 border-t border-line pt-4">

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-medium text-ink">Classement IA des devis</h3>
            <p className="mt-1 text-xs text-ink-muted">
              L'IA classe les devis saisis au regard du recueil des besoins et justifie chaque rang. Elle ne décide
              pas : vous retenez l'offre, ce qui génère le devoir de conseil en brouillon (aucun envoi au client).
            </p>
          </div>
          <button
            onClick={demanderClassement}
            disabled={devis.length < 2 || iaEtat !== "idle"}
            className="rounded-full border border-line px-4 py-2 text-sm text-ink disabled:opacity-50"
          >
            {iaEtat === "classement" ? "Analyse en cours…" : "Lancer le classement IA"}
          </button>
        </div>
        {devis.length < 2 && (
          <p className="mt-2 text-xs text-ink-muted">Saisissez au moins 2 devis pour activer le classement.</p>
        )}

        {estEmprunteur && (
          <div className="mt-3 rounded-xl border border-line bg-surface-2 p-3 text-xs">
            <p className="font-medium text-ink">
              Route de recommandation :{" "}
              {routeEmprunteurPrevue.route === "A"
                ? "A — prix croissant"
                : "B — score d'adéquation technique (Notebook Emprunteur)"}
            </p>
            <p className="mt-1 text-ink-muted">
              {routeEmprunteurPrevue.profils.length > 0
                ? `Spécificité détectée dans le recueil : ${routeEmprunteurPrevue.profils
                    .map((p) => LIBELLES_PROFILS[p])
                    .join(", ")}.`
                : "Aucune spécificité déclarée dans le recueil : le classement retient le critère du coût."}{" "}
              Base de calcul restreinte aux contrats stars du cabinet.
            </p>
            <label className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-ink-muted">Mode :</span>
              <select
                value={modeReco}
                onChange={async (e) => {
                  const v = e.target.value;
                  setModeReco(v);
                  await supabase.from("dossiers").update({ mode_recommandation: v }).eq("id", dossierId);
                }}
                className="rounded-lg border border-line bg-surface px-2 py-1 text-ink"
              >
                <option value="auto">Automatique (selon le recueil)</option>
                <option value="A">Forcer la route A — prix</option>
                <option value="B">Forcer la route B — adéquation technique</option>
              </select>
            </label>
          </div>
        )}

        {iaMsg && <p className="mt-2 text-sm text-emerald-700">{iaMsg}</p>}

        {classement && (
          <div className="mt-3 space-y-2">
            <p className="text-xs text-ink-muted">
              Généré le {new Date(classement.genere_le).toLocaleString("fr-FR")}
              {classement.modele_ia ? ` · ${classement.modele_ia}` : ""}
              {classement.route ? ` · Route ${classement.route}` : ""}
              {classement.profils_specifiques && classement.profils_specifiques.length > 0
                ? ` · ${classement.profils_specifiques.join(", ")}`
                : ""}
            </p>

            {[...classement.classement]
              .sort((a, b) => a.rang - b.rang)
              .filter((l) => afficherDoublons || !estDoublonMasque(devis.find((x) => x.id === l.dossier_devis_id)))
              .map((l) => {
                const d = devis.find((x) => x.id === l.dossier_devis_id);
                const groupe = porteurPartage(d);

                const kereisCatalogue = compagnies.find((c) => /kereis/i.test(c.nom));
                const kereisManquant =
                  groupe != null &&
                  kereisCatalogue != null &&
                  !groupe.canaux.some((c) => /kereis/i.test(c));
                return (
                  <div
                    key={l.dossier_devis_id}
                    className={`rounded-xl border p-3 text-sm ${
                      groupe
                        ? "border-l-4 border-l-[color:var(--crm-gold)] border-[color:var(--crm-gold)]/40 bg-[color:var(--crm-gold)]/10"
                        : "border-[color:var(--crm-gold)]/40 bg-[color:var(--crm-gold)]/5"
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="font-medium text-ink">
                        <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-ink text-xs text-primary-foreground">
                          {l.rang}
                        </span>
                        {d ? `${nomCompagnie(d.compagnie_id)} — ${nomProduit(d.produit_id)}` : "Devis supprimé"}
                        {d?.formule_id && <FormuleNom formuleId={d.formule_id} />}
                        {d?.cotisation_mensuelle != null && (
                          <span className="ml-2 text-ink-soft">
                            {Number(d.cotisation_mensuelle).toLocaleString("fr-FR")} € / mois
                          </span>
                        )}
                      </p>
                      {d && (
                        <button
                          onClick={() => retenir(d.id)}
                          disabled={iaEtat !== "idle"}
                          className="rounded-full bg-ink px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-60"
                        >
                          {iaEtat === "selection" ? "Traitement…" : "Retenir cette offre"}
                        </button>
                      )}
                    </div>
                    {groupe && (
                      <p className="mt-2 rounded-md bg-surface/70 px-2 py-1 text-xs text-ink-soft">
                        Même assureur porteur : <strong>{groupe.nom}</strong> — disponible via{" "}
                        {groupe.canaux.join(", ")}
                        {kereisManquant && (
                          <>
                            {" "}
                            · Aucun devis {kereisCatalogue?.nom} pour cet assureur porteur : faites un devis chez{" "}
                            {kereisCatalogue?.nom} pour {groupe.nom} et ajoutez-le au comparatif avant de retenir une
                            offre.
                          </>
                        )}
                      </p>
                    )}
                    <p className="mt-2 whitespace-pre-wrap text-xs text-ink-soft">{l.justification}</p>
                  </div>
                );
              })}

          </div>
        )}
      </div>
      )}

      {saisieOuverte && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto bg-ink/60 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSaisieOuverte(false);
          }}
        >
          <div className="mx-auto my-6 w-full max-w-3xl rounded-2xl border border-line bg-surface-elevated p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-line pb-3">
              <div className="min-w-0">
                <h3 className="font-serif text-lg font-medium text-ink">Ajouter le prix de ce produit</h3>
                <p className="mt-1 truncate text-xs text-ink-muted">
                  {form.produit_id
                    ? `${nomCompagnie(form.compagnie_id)} — ${nomProduit(form.produit_id)}`
                    : "Choisissez le partenaire et le produit du catalogue, puis saisissez le prix obtenu."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSaisieOuverte(false)}
                className="shrink-0 rounded-full border border-line px-3 py-1.5 text-xs text-ink hover:bg-surface"
              >
                Fermer
              </button>
            </div>

      <div className="mt-4 rounded-xl border border-line bg-surface-elevated/60 p-3">
        <h3 className="text-sm font-medium text-ink">Importer un devis reçu (PDF ou photo)</h3>
        <p className="mt-1 text-xs text-ink-muted">
          Le devis est conservé comme justificatif sur le dossier et lu automatiquement : partenaire, produit, tarif
          {estEmprunteur ? ", mode de calcul, quotité" : ""} et garanties sont proposés dans le formulaire ci-dessous.
          Rien n'est enregistré tant que vous n'avez pas vérifié et validé.
        </p>

        <label className="mt-2 inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface">
          <input
            type="file"
            accept="application/pdf,image/*"
            className="hidden"
            disabled={importBusy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void importerDevis(f);
            }}
          />
          {importBusy ? "Lecture en cours…" : "Choisir un devis"}
        </label>
        {importMsg && <p className="mt-2 text-xs text-ink-soft">{importMsg}</p>}
      </div>

      <div
        id="saisie-devis-manuel"
        className="mt-4 grid gap-3 rounded-xl border-t border-line pt-4 sm:grid-cols-2"
      >
        <div className="sm:col-span-2">
          <h3 className="text-sm font-medium text-ink">Nouveau devis — autre partenaire ou autre produit</h3>
          <p className="mt-1 text-xs text-ink-muted">
            Choisissez librement un partenaire et un produit du catalogue, dans la même branche que le dossier
            {branche ? ` (${branche})` : ""} : {compagniesBranche.length} partenaire(s) et {produitsBranche.length}{" "}
            produit(s) disponibles. Utile pour une compagnie sans API de tarification, pour un contrat déjà validé
            repris rétroactivement, ou pour ajouter une offre concurrente à un dossier déjà avancé — un nouveau devis
            peut être retenu à tout moment, ce qui régénère le devoir de conseil en brouillon.
          </p>
        </div>
        <label className="block sm:col-span-2">
          <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">Motif de la saisie manuelle</span>
          <select
            value={motifSaisie}
            onChange={(e) => setMotifSaisie(e.target.value as "sans_api" | "retroactif" | "autre")}
            className={inp}
          >
            <option value="sans_api">Compagnie sans API de tarification — devis reçu par un autre canal</option>
            <option value="retroactif">Contrat déjà validé par la compagnie — import rétroactif</option>
            <option value="autre">Autre saisie manuelle</option>
          </select>
          <span className="mt-1 block text-xs text-ink-muted">
            Le motif est journalisé sur le devis (traçabilité DDA).
            {motifSaisie === "retroactif" &&
              " Ce motif permet de retenir directement cette offre, sans repasser par le comparatif IA."}
          </span>
        </label>

        <label className="block">
          <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">Compagnie</span>
          <select
            value={form.compagnie_id}
            onChange={(e) => setForm({ ...form, compagnie_id: e.target.value, produit_id: "", formule_id: "" })}
            className={inp}
          >
            <option value="">— Choisir —</option>
            {(compagniesBranche.length > 0 ? compagniesBranche : compagnies).map((c) => (
              <option key={c.id} value={c.id}>
                {c.nom}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">Produit</span>
          <select
            value={form.produit_id}
            onChange={(e) => setForm({ ...form, produit_id: e.target.value, formule_id: "" })}
            className={inp}
          >
            <option value="">— Choisir —</option>
            {produitsVisibles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nom}
              </option>
            ))}
          </select>
        </label>
        {formules.length > 0 && (
          <label className="block">
            <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">Formule</span>
            <select
              value={form.formule_id}
              onChange={(e) => setForm({ ...form, formule_id: e.target.value })}
              className={inp}
            >
              <option value="">— Aucune —</option>
              {formules.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nom}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="block sm:col-span-2">
          <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">
            {estEmprunteur
              ? "Montant total de l'assurance sur la durée du prêt (€)"
              : "Montant total annuel de la cotisation (€ / an)"}
          </span>
          <input
            type="number"
            step="0.01"
            value={form.montant_total_saisi}
            onChange={(e) => setForm({ ...form, montant_total_saisi: e.target.value })}
            className={inp}
          />
          <span className="mt-1 block text-xs text-ink-muted">
            {estEmprunteur ? (
              <>
                Donnée d'entrée principale : c'est le montant figurant sur le devis de l'assureur pour la durée totale
                du prêt.
                {moisRestants
                  ? ` Recueil des besoins : ${moisRestants} mois restants${
                      crdRecueil ? ` · capital restant dû ${crdRecueil.toLocaleString("fr-FR")} €` : ""
                    }.`
                  : " Renseignez « mois restants » dans le recueil des besoins pour dériver automatiquement le mensuel moyen."}
                {mensuelMoyenDerive != null &&
                  ` Mensuel moyen calculé : ${mensuelMoyenDerive.toLocaleString("fr-FR", {
                    maximumFractionDigits: 2,
                  })} € / mois.`}
              </>
            ) : (
              <>Cotisation annuelle figurant sur le devis de l'assureur, garanties et franchises incluses.</>
            )}
          </span>
        </label>
        {estEmprunteur && (
          <label className="block">
            <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">
              Mode de calcul (CI / CRD)
            </span>
            <select
              value={form.type_cotisation}
              onChange={(e) =>
                setForm({ ...form, type_cotisation: e.target.value as "" | "CI" | "CRD" })
              }
              className={inp}
            >
              <option value="">— À préciser —</option>
              <option value="CI">CI — capital initial (cotisation constante)</option>
              <option value="CRD">CRD — capital restant dû (cotisation dégressive)</option>
            </select>
          </label>
        )}
        <label className="block">
          <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">
            Cotisation mensuelle {estEmprunteur && form.type_cotisation === "CRD" ? "moyenne " : ""}(€ / mois) —
            complémentaire
          </span>
          <input
            type="number"
            step="0.01"
            value={form.cotisation_mensuelle}
            onChange={(e) => setForm({ ...form, cotisation_mensuelle: e.target.value })}
            placeholder={
              mensuelMoyenDerive != null
                ? mensuelMoyenDerive.toLocaleString("fr-FR", { maximumFractionDigits: 2 })
                : undefined
            }
            className={inp}
          />
          <span className="mt-1 block text-xs text-ink-muted">
            {estEmprunteur
              ? "Laissez vide pour reprendre automatiquement le mensuel moyen dérivé du montant total."
              : "Cotisation prélevée chaque mois, si le devis la mentionne."}
          </span>
        </label>
        {estEmprunteur && form.type_cotisation === "CRD" && (

          <>
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">
                Mensualité la plus basse (€)
              </span>
              <input
                type="number"
                step="0.01"
                value={form.cotisation_min}
                onChange={(e) => setForm({ ...form, cotisation_min: e.target.value })}
                className={inp}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">
                Mensualité la plus haute (€)
              </span>
              <input
                type="number"
                step="0.01"
                value={form.cotisation_max}
                onChange={(e) => setForm({ ...form, cotisation_max: e.target.value })}
                className={inp}
              />
            </label>
          </>
        )}
        {estEmprunteur && assuresRecueil.length >= 2 && (

          <label className="block sm:col-span-2">
            <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">
              Tête assurée couverte par ce devis <span className="text-accent">*</span>
            </span>
            <select
              value={form.assure_rang}
              onChange={(e) => setForm({ ...form, assure_rang: e.target.value })}
              className={inp}
            >
              {assuresRecueil.map((a) => (
                <option key={a.rang} value={String(a.rang)}>
                  {a.label}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-ink-muted">
              Obligation DDA : sur un prêt à deux têtes, un devis distinct est établi par assuré. Le devis
              combiné unique est refusé.
            </span>
          </label>
        )}
        {estEmprunteur && (
          <label className="block">
            <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">Quotité assurée (%)</span>
            <input
              type="number"
              step="1"
              min={1}
              max={100}
              value={form.quotite_pct}
              onChange={(e) => setForm({ ...form, quotite_pct: e.target.value })}
              className={inp}
            />
            <span className="mt-1 block text-xs text-ink-muted">
              Nécessaire pour recalculer la cotisation en cas d'ajustement de quotité demandé par le client.
            </span>
          </label>
        )}
        <label className="block">
          <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">
            Taux de commission (%)
          </span>
          <input
            type="number"
            step="0.01"
            min={0}
            max={100}
            value={form.taux_commission}
            onChange={(e) => setForm({ ...form, taux_commission: e.target.value })}
            className={inp}
            placeholder={
              tauxDefaut(form.compagnie_id || null).taux != null
                ? String(tauxDefaut(form.compagnie_id || null).taux)
                : "5"
            }
          />
          <span className="mt-1 block text-xs text-ink-muted">
            Taux négocié avec le partenaire sur ce devis. Vide : valeur du barème du cabinet (
            {tauxDefaut(form.compagnie_id || null).taux ?? "—"} %{" "}
            {tauxDefaut(form.compagnie_id || null).base === "economie_realisee"
              ? "des économies"
              : "de la cotisation"}
            ). Ce taux est la seule source de la commission prévisionnelle du contrat.
          </span>
        </label>
        <label className="block">
          <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">
            Assiette de la commission
          </span>
          <select
            value={form.commission_base}
            onChange={(e) => setForm({ ...form, commission_base: e.target.value as BaseCommission })}
            className={inp}
          >
            {estEmprunteur && <option value="economie_realisee">Économie réalisée</option>}
            <option value="prime">Cotisation (prime)</option>
          </select>

        </label>
        <label className="block sm:col-span-2">
          <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">Résumé des garanties</span>
          <textarea
            rows={2}
            value={form.garanties_resume}
            onChange={(e) => setForm({ ...form, garanties_resume: e.target.value })}
            className={inp}
          />
        </label>
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <button
            onClick={() => void ajouter(false)}
            disabled={saving}
            className="rounded-full bg-ink px-4 py-2 text-sm text-primary-foreground disabled:opacity-60"
          >
            {saving ? "Enregistrement…" : "Ajouter ce devis"}
          </button>
          {motifSaisie === "retroactif" && (
            <button
              onClick={() => {
                if (
                  confirm(
                    "Enregistrer ce devis comme offre retenue du dossier et générer le devoir de conseil en brouillon (sans envoi au client) ?",
                  )
                )
                  void ajouter(true);
              }}
              disabled={saving}
              className="rounded-full border border-[color:var(--crm-gold)] bg-[color:var(--crm-gold)]/10 px-4 py-2 text-sm text-ink disabled:opacity-60"
            >
              Ajouter et retenir directement cette offre
            </button>
          )}
        </div>
      </div>
          </div>
        </div>
      )}

    </div>
  );
}

function FormuleNom({ formuleId }: { formuleId: string }) {
  const [nom, setNom] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("produit_formules").select("nom").eq("id", formuleId).maybeSingle();
      setNom((data as { nom: string } | null)?.nom ?? null);
    })();
  }, [formuleId]);
  return nom ? <span className="text-ink-soft"> · formule {nom}</span> : null;
}
