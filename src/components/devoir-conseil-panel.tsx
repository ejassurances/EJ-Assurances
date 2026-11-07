import { useEffect, useMemo, useState } from "react";
import { echeancierDepuisRecueil, regrouperEcheancierParAnnee } from "@/lib/echeancier-comparatif";
import { calculerFraisCourtage } from "@/lib/frais-courtage";
import { assuresEmprunteur } from "@/lib/recueil-besoins-schemas";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { catalogueOffreUniqueFn, envoyerDevoirConseilFn, pdfDevoirConseil } from "@/lib/devoir-conseil.functions";
import { prefillDevoirConseil, STATUT_OFFRE_LABEL, type StatutOffre } from "@/lib/devoir-conseil-modeles";
import { useAuth } from "@/lib/auth-context";
import { useCommissionBareme } from "@/hooks/use-commission-bareme";
import { resoudreRegle, decrireRegle, fmtEuros } from "@/lib/commissions-bareme";
import {
  montantMensuelEstime,
  moisRestantsRecueil,
  totalPrevisionnel,
  type Periodicite,
} from "@/lib/commission-previsions";
import { etatDelaiEnvoi } from "@/lib/devoir-conseil-delai";
import { DocumentsPretPanel } from "@/components/documents-pret-panel";



type Devoir = {
  id: string;
  statut: string;
  recommandation: string | null;
  motifs: string | null;
  mises_en_garde: string | null;
  envoye_le: string | null;
  signed_at: string | null;
  refus_motif: string | null;
  refuse_le: string | null;
  hash: string | null;
  email_destinataire: string | null;
  echelonnement_demande: boolean | null;
  echelonnement_montant_mensuel: number | null;
};

type DevisLigne = {
  id: string;
  compagnie: string;
  produit: string;
  formule: string;
  cotisation_mensuelle: number | null;
  type_cotisation: "CI" | "CRD" | null;
  cotisation_min: number | null;
  cotisation_max: number | null;
  montant_total_saisi: number | null;
  garanties_resume: string | null;
};

type OffreForm = {
  compagnie: string;
  produit: string;
  formule: string;
  cotisation_mensuelle: string;
  cout_total: string;
  statut: StatutOffre;
  commentaire: string;
};

const STATUT_LABEL: Record<string, string> = {
  brouillon: "Brouillon — à relire puis valider",
  valide: "Validé — envoi automatique programmé",
  envoye: "Envoyé — en attente du client",
  signe: "Signé par le client",
  refuse: "Refusé par le client",
};

const offreVide = (statut: StatutOffre): OffreForm => ({
  compagnie: "",
  produit: "",
  formule: "",
  cotisation_mensuelle: "",
  cout_total: "",
  statut,
  commentaire: "",
});

export function DevoirConseilPanel({
  dossierId,
  clientEmail,
  branche = "",
  onChanged,
  contreProposition = null,
}: {
  dossierId: string;
  clientEmail: string | null;
  branche?: string;
  onChanged: () => void;
  /** Pré-remplissage d'une nouvelle saisie après refus (analyse IA). */
  contreProposition?: { suggestion: string; motif: string; key: number } | null;
}) {
  const envoyer = useServerFn(envoyerDevoirConseilFn);
  const getPdf = useServerFn(pdfDevoirConseil);
  const verifierCatalogue = useServerFn(catalogueOffreUniqueFn);
  const [devoir, setDevoir] = useState<Devoir | null>(null);
  const [devisDossier, setDevisDossier] = useState<DevisLigne[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Commission prévisionnelle (flux grossiste) confirmée à la validation.
  const { user } = useAuth();
  const { staff, regles } = useCommissionBareme();
  const [dossier, setDossier] = useState<{
    compagnie_id: string | null;
    type_assurance: string | null;
    recueil_besoins: Record<string, unknown> | null;
    created_at: string | null;
  } | null>(null);
  const [prevision, setPrevision] = useState<{ id: string; montant_previsionnel_total: number | null } | null>(
    null,
  );
  const [prevOpen, setPrevOpen] = useState(false);
  const [prevForm, setPrevForm] = useState<{ mensuel: string; mois: string; periodicite: Periodicite }>({
    mensuel: "",
    mois: "",
    periodicite: "mensuelle",
  });
  const [prevIgnoree, setPrevIgnoree] = useState(false);
  /** Un devis du dossier porte un taux de commission : source unique du prévisionnel. */
  const [tauxDevisPresent, setTauxDevisPresent] = useState(false);

  const emprunteur = branche === "emprunteur";

  const [form, setForm] = useState({
    recommandation: "",
    motifs: "",
    mises_en_garde: "",
    compagnie: "",
    produit: "",
    garanties: "",
    exigences_client: "",
    cotisation_mensuelle: "",
    type_cotisation: "" as "" | "CI" | "CRD",
    cotisation_min: "",
    cotisation_max: "",
    montant_total: "",
    frais_dossier: "",
    frais_souscription: "",
    frais_courtage: "",
    frais_adhesion: "",
    economie_estimee: "",
    assiette: "capital_restant_du" as "capital_initial" | "capital_restant_du",
    capital_assure: "",
    capital_restant_du: "",
    quotite: "",
    duree_mois: "",
    ipid_remis: true,
    cg_remis: true,
    tarifs_remis: true,
    der_remis: true,
  });

  const [offres, setOffres] = useState<OffreForm[]>([
    offreVide("retenue"),
    offreVide("equivalente"),
    offreVide("ecartee"),
  ]);

  const load = async () => {
    const { data } = await supabase
      .from("devoirs_conseil")
      .select(
        "id, statut, recommandation, motifs, mises_en_garde, envoye_le, signed_at, refus_motif, refuse_le, hash, email_destinataire, echelonnement_demande, echelonnement_montant_mensuel",
      )
      .eq("dossier_id", dossierId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const d = (data as Devoir | null) ?? null;
    setDevoir(d);
    if (d) {
      setForm((f) => ({
        ...f,
        recommandation: d.recommandation ?? f.recommandation,
        motifs: d.motifs ?? f.motifs,
        mises_en_garde: d.mises_en_garde ?? f.mises_en_garde,
      }));
    }
  };

  const loadPrevision = async () => {
    const [d, p] = await Promise.all([
      supabase
        .from("dossiers")
        .select("compagnie_id, type_assurance, recueil_besoins, created_at")
        .eq("id", dossierId)
        .maybeSingle(),
      supabase
        .from("commission_previsions")
        .select("id, montant_previsionnel_total")
        .eq("dossier_id", dossierId)
        .maybeSingle(),
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setDossier((d.data as any) ?? null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setPrevision((p.data as any) ?? null);
  };

  useEffect(() => {
    load();
    if (staff) loadPrevision();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dossierId, staff]);

  // Catalogue à un seul produit actif pour cette branche : la règle des 3 devis
  // ne s'applique pas et le modèle bascule sur la mention « offre unique ».
  const [offreUnique, setOffreUnique] = useState(false);
  useEffect(() => {
    const b = branche || dossier?.type_assurance || "";
    if (!b) return;
    (async () => {
      try {
        const res = await verifierCatalogue({ data: { branche: b } });
        setOffreUnique(Boolean(res.offre_unique));
      } catch {
        setOffreUnique(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branche, dossier?.type_assurance]);

  // Délai de réflexion : 16 h après signature de la lettre de mission,
  // et envoi possible uniquement pendant les horaires d'ouverture.
  const [lettreSigneeLe, setLettreSigneeLe] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("lettres_mission")
        .select("signed_at")
        .eq("dossier_id", dossierId)
        .eq("statut", "signee")
        .order("signed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      setLettreSigneeLe((data as { signed_at: string | null } | null)?.signed_at ?? null);
    })();
  }, [dossierId]);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60000);
    return () => clearInterval(t);
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const delai = etatDelaiEnvoi(lettreSigneeLe, new Date());
  void tick;


  // Contre-proposition demandée depuis l'analyse IA du refus : ouvre et pré-remplit la saisie.
  useEffect(() => {
    if (!contreProposition) return;
    setOpen(true);
    setForm((f) => ({
      ...f,
      recommandation: contreProposition.suggestion || f.recommandation,
      motifs: `Contre-proposition suite au refus du client (motif : ${contreProposition.motif}).\n${f.motifs}`.trim(),
    }));
  }, [contreProposition?.key]);


  // Devis saisis sur le dossier + recueil de besoins : base de pré-remplissage automatique.
  useEffect(() => {
    (async () => {
      const [{ data }, dos] = await Promise.all([
        supabase
          .from("dossier_devis")
          .select(
            "id, cotisation_mensuelle, type_cotisation, cotisation_min, cotisation_max, montant_total_saisi, garanties_resume, taux_commission, compagnies:compagnie_id(nom), produits:produit_id(nom), produit_formules:formule_id(nom)",
          )
          .eq("dossier_id", dossierId)
          .order("created_at", { ascending: true }),
        supabase
          .from("dossiers")
          .select("compagnie_id, type_assurance, recueil_besoins, capital, duree_mois, created_at")
          .eq("id", dossierId)
          .maybeSingle(),
      ]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const list: DevisLigne[] = ((data as any[]) ?? []).map((d) => ({
        id: d.id as string,
        compagnie: d.compagnies?.nom ?? "",
        produit: d.produits?.nom ?? "",
        formule: d.produit_formules?.nom ?? "",
        cotisation_mensuelle: d.cotisation_mensuelle as number | null,
        type_cotisation: (d.type_cotisation as "CI" | "CRD" | null) ?? null,
        cotisation_min: (d.cotisation_min as number | null) ?? null,
        cotisation_max: (d.cotisation_max as number | null) ?? null,
        montant_total_saisi: (d.montant_total_saisi as number | null) ?? null,
        garanties_resume: (d.garanties_resume as string | null) ?? null,
      }));
      setDevisDossier(list);
      // Un devis porte déjà un taux de commission : c'est la SEULE source de la
      // commission prévisionnelle (calculée à la création du contrat de l'assuré),
      // aucune estimation indépendante n'est demandée ici.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setTauxDevisPresent(((data as any[]) ?? []).some((d) => d.taux_commission != null));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dosRow = (dos.data as any) ?? null;
      if (dosRow) {
        setDossier({
          compagnie_id: dosRow.compagnie_id ?? null,
          type_assurance: dosRow.type_assurance ?? null,
          recueil_besoins: dosRow.recueil_besoins ?? null,
          created_at: dosRow.created_at ?? null,
        });
        appliquerRecueil(dosRow);
      }
      if (list.length > 0) appliquerDevis(list);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dossierId]);

  /** Montant en euros, format court pour un tableau dense. */
  const eur = (n: number) =>
    n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";

  /**
   * Échéancier comparatif emprunteur (fonction pure) : prélèvement bancaire,
   * assurance en place, assurance proposée et différentiel mois par mois.
   */
  const echeancier = useMemo(
    () =>
      echeancierDepuisRecueil(
        dossier?.recueil_besoins ?? null,
        {
          mensuelle: form.cotisation_mensuelle ? Number(form.cotisation_mensuelle) : null,
          type_cotisation: form.type_cotisation || null,
        },
        dossier?.created_at ?? null,
        {
          courtage: null,
          dossier: form.frais_dossier ? Number(form.frais_dossier) : null,
          adhesion: form.frais_adhesion ? Number(form.frais_adhesion) : null,
        },
      ),
    [
      dossier?.recueil_besoins,
      dossier?.created_at,
      form.cotisation_mensuelle,
      form.type_cotisation,
      form.frais_dossier,
      form.frais_adhesion,
    ],
  );

  /**
   * Frais de courtage (= frais de distribution) : calculés automatiquement,
   * jamais saisis à la main — 5 % de l'économie brute, plancher 175 € par
   * assuré, déduction de la part partenaire (dossier + adhésion) au-delà du
   * plancher, sans jamais redescendre sous ce plancher (règle du 07/11/2026).
   */
  const nbAssures = useMemo(() => {
    const liste = assuresEmprunteur(dossier?.recueil_besoins?.["assures"]);
    return Math.max(1, liste.length);
  }, [dossier?.recueil_besoins]);

  const fraisCourtageCalc = useMemo(
    () =>
      calculerFraisCourtage({
        economieBrute: echeancier.economie_brute || null,
        nbAssures,
        fraisDossierPartenaire: form.frais_dossier ? Number(form.frais_dossier) : 0,
        fraisAdhesionPartenaire: form.frais_adhesion ? Number(form.frais_adhesion) : 0,
      }),
    [echeancier.economie_brute, nbAssures, form.frais_dossier, form.frais_adhesion],
  );

  // Synchronise form.frais_courtage sur le montant calculé, pour que tous les
  // usages existants (sauvegarde, PDF, affichage) restent corrects sans
  // dupliquer la logique de calcul à chaque endroit.
  // Quand le calcul n'est pas possible (branche hors emprunteur, aucune économie
  // chiffrée), la saisie manuelle reste possible : on n'efface jamais le montant.
  useEffect(() => {
    if (!fraisCourtageCalc) return;
    const calcule = String(fraisCourtageCalc.montant);
    setForm((f) => (f.frais_courtage === calcule ? f : { ...f, frais_courtage: calcule }));
  }, [fraisCourtageCalc]);

  const economieNette = useMemo(() => {
    if (!fraisCourtageCalc) return echeancier.economie_brute;
    return (
      echeancier.economie_brute -
      fraisCourtageCalc.montant -
      Number(form.frais_dossier || 0) -
      Number(form.frais_adhesion || 0)
    );
  }, [echeancier.economie_brute, fraisCourtageCalc, form.frais_dossier, form.frais_adhesion]);


  /** Reprend les données du recueil de besoins (capital, CRD, quotité, durée, exigences). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const appliquerRecueil = (dosRow: any) => {
    const recueil = (dosRow?.recueil_besoins ?? {}) as Record<string, unknown>;
    const nb = (v: unknown) => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    const capital = nb(recueil["capital_emprunte"]) ?? nb(recueil["capital"]) ?? nb(dosRow?.capital);
    const crd = nb(recueil["capital_restant_du"]) ?? nb(recueil["crd"]);
    const quotite = nb(recueil["quotite"]);
    const duree = nb(recueil["mois_restants"]) ?? nb(recueil["duree_mois"]) ?? nb(dosRow?.duree_mois);
    const exigences =
      typeof recueil["exigences"] === "string"
        ? (recueil["exigences"] as string)
        : typeof recueil["besoins"] === "string"
          ? (recueil["besoins"] as string)
          : "";
    setForm((f) => ({
      ...f,
      capital_assure: f.capital_assure || (capital != null ? String(capital) : ""),
      capital_restant_du: f.capital_restant_du || (crd != null ? String(crd) : ""),
      quotite: f.quotite || (quotite != null ? String(quotite) : ""),
      duree_mois: f.duree_mois || (duree != null ? String(duree) : ""),
      exigences_client: f.exigences_client || exigences,
    }));
  };

  /** Reprend les devis du dossier dans le tableau comparatif et l'offre retenue. */
  const appliquerDevis = (list: DevisLigne[]) => {
    if (list.length === 0) return;
    setOffres((prev) => {
      const dejaSaisi = prev.some((o) => o.compagnie.trim() || o.produit.trim());
      if (dejaSaisi) return prev;
      return list.map((d, i) => ({
        compagnie: d.compagnie,
        produit: d.produit,
        formule: d.formule,
        cotisation_mensuelle: d.cotisation_mensuelle != null ? String(d.cotisation_mensuelle) : "",
        cout_total: d.montant_total_saisi != null ? String(d.montant_total_saisi) : "",
        statut: (i === 0 ? "retenue" : "equivalente") as StatutOffre,
        commentaire: d.garanties_resume ?? "",
      }));
    });
    // Devis retenu (le premier) : reprend le mode de calcul CI/CRD et les montants.
    const retenu = list[0];
    if (retenu) {
      setForm((f) => ({
        ...f,
        compagnie: f.compagnie || retenu.compagnie,
        produit: f.produit || retenu.produit,
        type_cotisation: f.type_cotisation || (retenu.type_cotisation ?? f.type_cotisation),
        montant_total: f.montant_total || (retenu.montant_total_saisi != null ? String(retenu.montant_total_saisi) : ""),
        cotisation_mensuelle:
          f.cotisation_mensuelle || (retenu.cotisation_mensuelle != null ? String(retenu.cotisation_mensuelle) : ""),
        cotisation_min: f.cotisation_min || (retenu.cotisation_min != null ? String(retenu.cotisation_min) : ""),
        cotisation_max: f.cotisation_max || (retenu.cotisation_max != null ? String(retenu.cotisation_max) : ""),
      }));
    }
  };

  /** Reprise manuelle (écrase le tableau comparatif avec les devis du dossier). */
  const prefillDepuisDevis = () => {
    if (devisDossier.length === 0) return;
    setOffres(
      devisDossier.map((d, i) => ({
        compagnie: d.compagnie,
        produit: d.produit,
        formule: d.formule,
        cotisation_mensuelle: d.cotisation_mensuelle != null ? String(d.cotisation_mensuelle) : "",
        cout_total: d.montant_total_saisi != null ? String(d.montant_total_saisi) : "",
        statut: (i === 0 ? "retenue" : "equivalente") as StatutOffre,
        commentaire: d.garanties_resume ?? "",
      })),
    );
    const retenu = devisDossier[0];
    if (retenu) {
      setForm((f) => ({
        ...f,
        compagnie: retenu.compagnie || f.compagnie,
        produit: retenu.produit || f.produit,
        type_cotisation: retenu.type_cotisation ?? f.type_cotisation,
        montant_total: retenu.montant_total_saisi != null ? String(retenu.montant_total_saisi) : f.montant_total,
        cotisation_mensuelle:
          retenu.cotisation_mensuelle != null ? String(retenu.cotisation_mensuelle) : f.cotisation_mensuelle,
        cotisation_min: retenu.cotisation_min != null ? String(retenu.cotisation_min) : f.cotisation_min,
        cotisation_max: retenu.cotisation_max != null ? String(retenu.cotisation_max) : f.cotisation_max,
      }));
    }
  };

  const offresRemplies = offres.filter((o) => o.compagnie.trim() && o.produit.trim());

  const regleApplicable =
    staff && dossier?.compagnie_id
      ? resoudreRegle(regles, branche || dossier.type_assurance, dossier.compagnie_id)
      : null;

  /** Demande la confirmation de la commission prévisionnelle avant l'envoi. */
  const submit = async (sansEnvoi = false) => {
    if (sansEnvoi) {
      await doSubmit(true);
      return;
    }
    // Repli uniquement : si un devis porte un taux de commission, la prévision
    // est dérivée de ce taux au moment de la création du contrat de l'assuré.
    if (staff && !prevision && !prevIgnoree && !tauxDevisPresent && regleApplicable) {
      const periodicite: Periodicite = regleApplicable.regle.periodicite === "annuelle" ? "annuelle" : "mensuelle";
      // En annuel, l'assiette est la cotisation de l'année (12 × la mensuelle saisie).
      const cotisation = form.cotisation_mensuelle ? Number(form.cotisation_mensuelle) : null;
      const mensuel = montantMensuelEstime(
        regleApplicable.regle,
        cotisation != null ? (periodicite === "annuelle" ? cotisation * 12 : cotisation) : null,
      );
      const mois =
        moisRestantsRecueil(branche || dossier?.type_assurance || null, dossier?.recueil_besoins) ??
        (form.duree_mois ? Number(form.duree_mois) : null);
      setPrevForm({
        mensuel: mensuel != null ? String(mensuel) : "",
        mois: mois != null ? String(mois) : "",
        periodicite,
      });
      setPrevOpen(true);
      return;
    }
    await doSubmit();
  };

  /** Enregistre la prévision confirmée puis poursuit l'envoi. */
  const confirmerPrevision = async () => {
    const mensuel = prevForm.mensuel ? Number(prevForm.mensuel) : null;
    const mois = prevForm.mois ? Number(prevForm.mois) : null;
    const { error: e } = await supabase.from("commission_previsions").upsert(
      {
        dossier_id: dossierId,
        branche: branche || dossier?.type_assurance || null,
        compagnie_id: dossier?.compagnie_id ?? null,
        montant_mensuel_estime: mensuel,
        mois_restants_initial: mois,
        date_estimation: new Date().toISOString().slice(0, 10),
        periodicite: prevForm.periodicite,
        montant_previsionnel_total: totalPrevisionnel(mensuel, mois, prevForm.periodicite),
        statut: "estime",
        confirme_par: user?.id ?? null,
        confirme_le: new Date().toISOString(),
      } as never,
      { onConflict: "dossier_id" },
    );
    setPrevOpen(false);
    if (e) setError(e.message);
    else await loadPrevision();
    await doSubmit();
  };

  const doSubmit = async (sansEnvoi = false) => {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await envoyer({
        data: {
          dossier_id: dossierId,
          sans_envoi: sansEnvoi,
          recommandation: form.recommandation.trim(),
          motifs: form.motifs.trim(),
          mises_en_garde: form.mises_en_garde.trim() || undefined,
          compagnie: form.compagnie.trim() || undefined,
          produit: form.produit.trim() || undefined,
          garanties: form.garanties.trim() || undefined,
          exigences_client: form.exigences_client.trim() || undefined,
          cotisation_mensuelle: form.cotisation_mensuelle ? Number(form.cotisation_mensuelle) : null,
          type_cotisation: form.type_cotisation || null,
          montant_total: form.montant_total ? Number(form.montant_total) : null,
          cotisation_min:
            form.type_cotisation === "CRD" && form.cotisation_min ? Number(form.cotisation_min) : null,
          cotisation_max:
            form.type_cotisation === "CRD" && form.cotisation_max ? Number(form.cotisation_max) : null,
          frais_dossier: form.frais_dossier ? Number(form.frais_dossier) : null,
          frais_souscription: form.frais_souscription ? Number(form.frais_souscription) : null,
          frais_courtage: form.frais_courtage ? Number(form.frais_courtage) : null,
          frais_adhesion: form.frais_adhesion ? Number(form.frais_adhesion) : null,
          economie_estimee: form.economie_estimee ? Number(form.economie_estimee) : null,
          offres:
            offresRemplies.length > 0
              ? offresRemplies.map((o) => ({
                  compagnie: o.compagnie.trim(),
                  produit: o.produit.trim(),
                  formule: o.formule.trim() || null,
                  cotisation_mensuelle: o.cotisation_mensuelle ? Number(o.cotisation_mensuelle) : null,
                  cout_total: o.cout_total ? Number(o.cout_total) : null,
                  statut: o.statut,
                  commentaire: o.commentaire.trim() || null,
                }))
              : undefined,
          ...(emprunteur
            ? {
                assiette: form.assiette,
                capital_assure: form.capital_assure ? Number(form.capital_assure) : null,
                capital_restant_du: form.capital_restant_du ? Number(form.capital_restant_du) : null,
                quotite: form.quotite ? Number(form.quotite) : null,
                duree_mois: form.duree_mois ? Number(form.duree_mois) : null,
              }
            : {}),
          ipid_remis: form.ipid_remis,
          cg_remis: form.cg_remis,
          tarifs_remis: form.tarifs_remis,
          der_remis: form.der_remis,
        },
      });
      setMsg(
        sansEnvoi
          ? "Devoir de conseil validé et enregistré en brouillon — envoi possible dès la fin du délai de réflexion."
          : "Devoir de conseil généré et envoyé au client.",
      );
      setOpen(false);
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : sansEnvoi ? "Erreur de validation" : "Erreur d'envoi");
    }
    setBusy(false);
  };

  const telechargerPdf = async () => {
    if (!devoir) return;
    setError(null);
    try {
      const res = await getPdf({ data: { devoir_id: devoir.id } });
      window.open(res.url, "_blank");
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDF indisponible");
    }
  };

  const troisOffres = !emprunteur || offreUnique || offresRemplies.length >= 3;
  const valide = form.recommandation.trim().length >= 10 && form.motifs.trim().length >= 10 && troisOffres;

  const appliquerModele = () => {
    const pre = prefillDevoirConseil({
      branche,
      compagnie: form.compagnie || null,
      produit: form.produit || null,
      garanties: form.garanties || null,
      exigences: form.exigences_client || undefined,
      cotisation_mensuelle: form.cotisation_mensuelle ? Number(form.cotisation_mensuelle) : null,
      economie_estimee: form.economie_estimee ? Number(form.economie_estimee) : null,
      offreUnique,
    });
    setForm((f) => ({
      ...f,
      recommandation: pre.recommandation,
      motifs: pre.motifs,
      mises_en_garde: pre.mises_en_garde,
      exigences_client: pre.exigences_client,
    }));
    setOffres((list) =>
      list.map((o, i) =>
        i === 0 && form.compagnie
          ? { ...o, compagnie: form.compagnie, produit: form.produit, statut: "retenue" }
          : o,
      ),
    );
  };

  const majOffre = (index: number, patch: Partial<OffreForm>) =>
    setOffres((list) => list.map((o, i) => (i === index ? { ...o, ...patch } : o)));

  return (
    <div className="rounded-2xl border border-line bg-surface-elevated p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-serif text-lg font-medium text-ink">Devoir de conseil</h2>
        {devoir && (
          <span className="rounded-full border border-line px-3 py-1 text-xs text-ink-soft">
            {STATUT_LABEL[devoir.statut] ?? devoir.statut}
          </span>
        )}
      </div>

      {devoir ? (
        <div className="mt-3 space-y-1 text-sm text-ink-soft">
          <p>
            Destinataire : {devoir.email_destinataire ?? "—"}
          </p>
          {devoir.envoye_le ? (
            <p className="text-emerald-700">
              Envoyé le {new Date(devoir.envoye_le).toLocaleString("fr-FR")}
            </p>
          ) : devoir.statut === "valide" ? (
            <p className="text-ink-soft">
              Validé — envoi automatique prévu{" "}
              {delai.autorise
                ? "au prochain passage du planificateur (quelques minutes)"
                : delai.disponible_le
                  ? `le ${delai.disponible_le.toLocaleString("fr-FR")} (horaires d'ouverture)`
                  : "dès la signature de la lettre de mission"}
              .
            </p>
          ) : null}
          {devoir.signed_at && (
            <p className="text-emerald-700">Signé le {new Date(devoir.signed_at).toLocaleString("fr-FR")}</p>
          )}
          {devoir.signed_at && devoir.echelonnement_demande && (
            <p className="rounded-lg border border-amber-400/50 bg-amber-50 px-3 py-2 text-amber-900">
              ⚠ Le client a demandé l'échelonnement des frais de distribution en 12 fois
              {devoir.echelonnement_montant_mensuel
                ? ` (+${Number(devoir.echelonnement_montant_mensuel).toLocaleString("fr-FR", { minimumFractionDigits: 2 })} € / mois pendant 12 mois)`
                : ""}
              . Pensez à l'indiquer sur l'intranet du partenaire, afin qu'il prélève bien les frais de
              distribution en 12 fois plutôt qu'en une seule fois. Les frais de dossier, eux, restent prélevés
              en une seule fois.
            </p>
          )}
          {devoir.refuse_le && (
            <p className="text-destructive">
              Refusé le {new Date(devoir.refuse_le).toLocaleString("fr-FR")} — motif : {devoir.refus_motif}
            </p>
          )}
          {devoir.hash && <p className="text-xs text-ink-muted">Empreinte SHA-256 : {devoir.hash.slice(0, 24)}…</p>}
          {devoir.recommandation && (
            <p className="mt-2 whitespace-pre-wrap rounded-md bg-surface p-3 text-sm">{devoir.recommandation}</p>
          )}
        </div>
      ) : (
        <p className="mt-3 text-sm text-ink-muted">Aucun devoir de conseil généré pour ce projet.</p>
      )}

      {staff && prevision && (
        <p className="mt-3 rounded-md border border-line bg-surface p-3 text-xs text-ink-soft">
          Commission prévisionnelle enregistrée :{" "}
          <strong>
            {prevision.montant_previsionnel_total != null
              ? fmtEuros(Number(prevision.montant_previsionnel_total))
              : "montant mensuel seul"}
          </strong>
        </p>
      )}
      {staff && !prevision && prevIgnoree && (
        <p className="mt-3 rounded-md border border-dashed border-line p-3 text-xs text-ink-muted">
          Rappel : la commission prévisionnelle de ce dossier n'a pas été confirmée.
        </p>
      )}

      {prevOpen && (
        <div className="mt-4 space-y-3 rounded-xl border border-[color:var(--crm-gold,#D4AF37)] bg-surface p-4">
          <p className="font-serif text-base text-ink">Commission prévisionnelle de ce dossier</p>
          <p className="text-xs text-ink-muted">
            Règle appliquée : {regleApplicable ? decrireRegle(regleApplicable.regle) : "—"}. Ajustez si besoin
            avant confirmation.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-ink-muted">
              Cycle de la commission
              <select
                value={prevForm.periodicite}
                onChange={(e) =>
                  setPrevForm({ ...prevForm, periodicite: e.target.value as Periodicite })
                }
                className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
              >
                <option value="mensuelle">Mensuelle</option>
                <option value="annuelle">Annuelle (une fois par an)</option>
              </select>
            </label>
            <label className="text-xs text-ink-muted">
              {prevForm.periodicite === "annuelle" ? "Commission annuelle (€)" : "Commission mensuelle (€)"}
              <input
                type="number"
                step="0.01"
                value={prevForm.mensuel}
                onChange={(e) => setPrevForm({ ...prevForm, mensuel: e.target.value })}
                className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
              />
            </label>
            <label className="text-xs text-ink-muted">
              Mois restants
              <input
                type="number"
                value={prevForm.mois}
                onChange={(e) => setPrevForm({ ...prevForm, mois: e.target.value })}
                className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
              />
            </label>
          </div>
          <p className="text-sm text-ink">
            {prevForm.mensuel ? fmtEuros(Number(prevForm.mensuel)) : "—"} ×{" "}
            {prevForm.periodicite === "annuelle"
              ? `${prevForm.mois ? Math.ceil(Number(prevForm.mois) / 12) : "?"} année(s)`
              : `${prevForm.mois || "?"} mois`}{" "}
            ={" "}
            <strong>
              {prevForm.mensuel && prevForm.mois
                ? fmtEuros(
                    totalPrevisionnel(Number(prevForm.mensuel), Number(prevForm.mois), prevForm.periodicite) ?? 0,
                  )
                : "total indisponible"}
            </strong>
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={confirmerPrevision}
              className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              Confirmer et envoyer
            </button>
            <button
              onClick={() => {
                setPrevIgnoree(true);
                setPrevOpen(false);
                doSubmit();
              }}
              className="rounded-full border border-line px-4 py-2 text-sm"
            >
              Envoyer sans enregistrer
            </button>
            <button
              onClick={() => {
                setPrevIgnoree(true);
                setPrevOpen(false);
              }}
              className="text-sm text-ink-muted underline underline-offset-4"
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {!clientEmail && (
        <p className="mt-3 text-xs text-destructive">
          Renseignez l'email du client pour pouvoir envoyer le devoir de conseil.
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          onClick={() => setOpen((o) => !o)}
          disabled={!clientEmail}
          className="rounded-full border border-line px-4 py-2 text-sm hover:bg-surface disabled:opacity-50"
        >
          {open ? "Fermer" : devoir ? "Regénérer / renvoyer" : "Rédiger le devoir de conseil"}
        </button>
        {devoir && (
          <button
            onClick={telechargerPdf}
            className="rounded-full border border-line px-4 py-2 text-sm hover:bg-surface"
          >
            Télécharger le PDF
          </button>
        )}
        {open && (
          <button onClick={appliquerModele} className="rounded-full border border-line px-4 py-2 text-sm hover:bg-surface">
            Pré-remplir depuis le modèle
          </button>
        )}
        {open && devisDossier.length > 0 && (
          <button
            onClick={prefillDepuisDevis}
            className="rounded-full border border-line px-4 py-2 text-sm hover:bg-surface"
          >
            Réactualiser depuis les {devisDossier.length} devis du dossier
          </button>
        )}
      </div>

      {devisDossier.length === 0 && (
        <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Aucun devis enregistré sur ce dossier : la mise en concurrence du devoir de conseil serait vide. Revenez à
          l'étape « Étude et devis » pour déposer ou reprendre les devis, puis revenez ici.
        </p>
      )}

      {open && (
        <div className="mt-4 space-y-3 border-t border-line pt-4">
          <Field label="1. Exigences et besoins exprimés par le client">
            <textarea
              rows={3}
              value={form.exigences_client}
              onChange={(e) => setForm({ ...form, exigences_client: e.target.value })}
              className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
            />
          </Field>

          {emprunteur && (
            <DocumentsPretPanel
              dossierId={dossierId}
              titre="Devis et devoir de conseil de cette étape"
              filtre="devis_conseil"
              typeDocument="devis"
            />
          )}



          {/* Offres comparées */}
          <div className="rounded-xl border border-line p-3">
            <p className="text-xs uppercase tracking-wide text-ink-muted">
              2. Offres comparées {emprunteur && <span className="text-destructive">(3 minimum en emprunteur)</span>}
            </p>
            <div className="mt-3 space-y-3">
              {offres.map((o, i) => (
                <div key={i} className="grid gap-2 rounded-md border border-line bg-surface p-3 sm:grid-cols-6">
                  <input
                    placeholder="Compagnie"
                    value={o.compagnie}
                    onChange={(e) => majOffre(i, { compagnie: e.target.value })}
                    className="rounded-md border border-line bg-background px-2 py-1.5 text-sm sm:col-span-2"
                  />
                  <input
                    placeholder="Produit"
                    value={o.produit}
                    onChange={(e) => majOffre(i, { produit: e.target.value })}
                    className="rounded-md border border-line bg-background px-2 py-1.5 text-sm sm:col-span-2"
                  />
                  <input
                    placeholder="Formule (santé)"
                    value={o.formule}
                    onChange={(e) => majOffre(i, { formule: e.target.value })}
                    className="rounded-md border border-line bg-background px-2 py-1.5 text-sm sm:col-span-2"
                  />
                  <input
                    type="number"
                    placeholder="€/mois"
                    value={o.cotisation_mensuelle}
                    onChange={(e) => majOffre(i, { cotisation_mensuelle: e.target.value })}
                    className="rounded-md border border-line bg-background px-2 py-1.5 text-sm"
                  />
                  <input
                    type="number"
                    placeholder="Coût total €"
                    value={o.cout_total}
                    onChange={(e) => majOffre(i, { cout_total: e.target.value })}
                    className="rounded-md border border-line bg-background px-2 py-1.5 text-sm"
                  />
                  <select
                    value={o.statut}
                    onChange={(e) => majOffre(i, { statut: e.target.value as StatutOffre })}
                    className="rounded-md border border-line bg-background px-2 py-1.5 text-sm sm:col-span-2"
                  >
                    {(Object.keys(STATUT_OFFRE_LABEL) as StatutOffre[]).map((s) => (
                      <option key={s} value={s}>
                        {STATUT_OFFRE_LABEL[s]}
                      </option>
                    ))}
                  </select>
                  <input
                    placeholder="Appréciation motivée (pas de note chiffrée)"
                    value={o.commentaire}
                    onChange={(e) => majOffre(i, { commentaire: e.target.value })}
                    className="rounded-md border border-line bg-background px-2 py-1.5 text-sm sm:col-span-4"
                  />
                </div>
              ))}
            </div>
            <button
              onClick={() => setOffres((l) => [...l, offreVide("ecartee")])}
              className="mt-2 text-xs text-ink-muted underline"
            >
              + Ajouter une offre
            </button>
          </div>

          {/* Base de calcul (emprunteur) */}
          {emprunteur && (
            <div className="grid gap-3 rounded-xl border border-line p-3 sm:grid-cols-2">
              <p className="text-xs uppercase tracking-wide text-ink-muted sm:col-span-2">
                3. Base de calcul du coût
              </p>
              <Field label="Assiette">
                <select
                  value={form.assiette}
                  onChange={(e) =>
                    setForm({ ...form, assiette: e.target.value as "capital_initial" | "capital_restant_du" })
                  }
                  className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
                >
                  <option value="capital_initial">Capital initial (tarif fixe)</option>
                  <option value="capital_restant_du">Capital restant dû (tarif dégressif)</option>
                </select>
              </Field>
              <Field label="Capital assuré (€)">
                <input
                  type="number"
                  value={form.capital_assure}
                  onChange={(e) => setForm({ ...form, capital_assure: e.target.value })}
                  className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
                />
              </Field>
              <Field label="Capital restant dû (€)">
                <input
                  type="number"
                  value={form.capital_restant_du}
                  onChange={(e) => setForm({ ...form, capital_restant_du: e.target.value })}
                  className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
                />
              </Field>
              <Field label="Quotité assurée (%)">
                <input
                  type="number"
                  value={form.quotite}
                  onChange={(e) => setForm({ ...form, quotite: e.target.value })}
                  className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
                />
              </Field>
              <Field label="Durée résiduelle (mois)">
                <input
                  type="number"
                  value={form.duree_mois}
                  onChange={(e) => setForm({ ...form, duree_mois: e.target.value })}
                  className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
                />
              </Field>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Compagnie recommandée">
              <input
                value={form.compagnie}
                onChange={(e) => setForm({ ...form, compagnie: e.target.value })}
                className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
              />
            </Field>
            <Field label="Produit / contrat">
              <input
                value={form.produit}
                onChange={(e) => setForm({ ...form, produit: e.target.value })}
                className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
              />
            </Field>
            {emprunteur && (
              <>
                <Field label="Coût total de l'assurance sur la durée du prêt (€)">
                  <input
                    type="number"
                    step="0.01"
                    value={form.montant_total}
                    onChange={(e) => setForm({ ...form, montant_total: e.target.value })}
                    className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
                  />
                </Field>
                <Field label="Mode de calcul de la cotisation">
                  <select
                    value={form.type_cotisation}
                    onChange={(e) =>
                      setForm({ ...form, type_cotisation: e.target.value as "" | "CI" | "CRD" })
                    }
                    className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
                  >
                    <option value="">— À préciser —</option>
                    <option value="CI">CI — capital initial (cotisation constante)</option>
                    <option value="CRD">CRD — capital restant dû (cotisation dégressive)</option>
                  </select>
                </Field>
              </>
            )}
            <Field
              label={
                form.type_cotisation === "CRD"
                  ? "Cotisation mensuelle moyenne (€)"
                  : "Cotisation mensuelle (€)"
              }
            >
              <input
                type="number"
                step="0.01"
                value={form.cotisation_mensuelle}
                onChange={(e) => setForm({ ...form, cotisation_mensuelle: e.target.value })}
                className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
              />
            </Field>
            {emprunteur && form.type_cotisation === "CRD" && (
              <>
                <Field label="Mensualité la plus basse (€)">
                  <input
                    type="number"
                    step="0.01"
                    value={form.cotisation_min}
                    onChange={(e) => setForm({ ...form, cotisation_min: e.target.value })}
                    className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
                  />
                </Field>
                <Field label="Mensualité la plus haute (€)">
                  <input
                    type="number"
                    step="0.01"
                    value={form.cotisation_max}
                    onChange={(e) => setForm({ ...form, cotisation_max: e.target.value })}
                    className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
                  />
                </Field>
              </>
            )}
            <Field label="Frais de dossier (€)">
              <input
                type="number"
                value={form.frais_dossier}
                onChange={(e) => setForm({ ...form, frais_dossier: e.target.value })}
                className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
              />
            </Field>
            <Field label="Frais de souscription (€)">
              <input
                type="number"
                value={form.frais_souscription}
                onChange={(e) => setForm({ ...form, frais_souscription: e.target.value })}
                className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
              />
            </Field>
            <Field
              label={
                fraisCourtageCalc
                  ? "Frais de courtage / distribution (€) — calculés automatiquement"
                  : "Frais de courtage / distribution (€)"
              }
            >
              {fraisCourtageCalc ? (
                <div className="w-full rounded-md border border-line bg-muted/40 px-3 py-2 text-sm">
                  <span className="font-semibold">{eur(fraisCourtageCalc.montant)}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {fraisCourtageCalc.planchierApplique
                      ? `(plancher 175 € × ${nbAssures} assuré${nbAssures > 1 ? "s" : ""} — 5 % de l'économie était inférieur au plancher)`
                      : `(5 % de l'économie = ${eur(fraisCourtageCalc.base)}, dont ${eur(fraisCourtageCalc.partPartenaireDeduite)} déduits pour le partenaire)`}
                  </span>
                </div>
              ) : (
                <>
                  <input
                    type="number"
                    value={form.frais_courtage}
                    onChange={(e) => setForm({ ...form, frais_courtage: e.target.value })}
                    className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Calcul automatique indisponible (aucune économie chiffrée) : saisissez le montant retenu.
                  </p>
                </>
              )}
            </Field>
            <Field label="Frais d'adhésion (€)">
              <input
                type="number"
                value={form.frais_adhesion}
                onChange={(e) => setForm({ ...form, frais_adhesion: e.target.value })}
                className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
              />
            </Field>
            {emprunteur && (
              <Field label="Économie estimée (€)">
                <input
                  type="number"
                  value={form.economie_estimee}
                  onChange={(e) => setForm({ ...form, economie_estimee: e.target.value })}
                  className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
                />
              </Field>
            )}
          </div>

          {emprunteur && echeancier.lignes.length > 0 && (
            <>
            <div className="rounded-lg border border-line">
              <div className="border-b border-line px-3 py-2">
                <p className="text-sm font-semibold">Échéancier comparatif du prêt</p>
                <p className="text-xs text-muted-foreground">
                  À compter du mois prévu de la substitution
                  {echeancier.date_effet
                    ? ` (${echeancier.date_effet.split("-").reverse().join("/")})`
                    : ""}
                  . 12 premières échéances détaillées, puis une ligne par année. Différentiel en
                  vert : économie pour le client ; en rouge : surcoût.
                </p>
                {form.type_cotisation === "CRD" && (
                  <p className="mt-1 text-xs text-amber-700">
                    Cotisation calculée sur le capital restant dû : plus élevée les premières années,
                    puis dégressive. Cette information est reprise dans le devoir de conseil remis au
                    client.
                  </p>
                )}
              </div>
              <div className="max-h-80 overflow-auto">
                <table className="w-full text-right text-xs">
                  <thead className="sticky top-0 bg-muted">
                    <tr>
                      <th className="px-2 py-1 text-left font-medium">Date d'échéance</th>
                      <th className="px-2 py-1 font-medium">Échéance banque (hors assurance)</th>
                      <th className="px-2 py-1 font-medium">Assurance banque</th>
                      <th className="px-2 py-1 font-medium">Total</th>
                      <th className="px-2 py-1 font-medium">Assurance EJ Assurances</th>
                      <th className="px-2 py-1 font-medium">Économie réalisée</th>
                    </tr>
                  </thead>
                  <tbody>
                    {regrouperEcheancierParAnnee(echeancier.lignes).map((v) =>
                      v.type === "mois" ? (
                        <tr key={`m-${v.ligne.rang}`} className="border-t border-line">
                          <td className="px-2 py-1 text-left">
                            {v.ligne.date.split("-").reverse().join("/")}
                          </td>
                          <td className="px-2 py-1">{eur(v.ligne.echeance)}</td>
                          <td className="px-2 py-1">{eur(v.ligne.assurance_initiale)}</td>
                          <td className="px-2 py-1">{eur(v.ligne.total_actuel)}</td>
                          <td className="px-2 py-1">{eur(v.ligne.assurance_nouvelle)}</td>
                          <td
                            className={`px-2 py-1 font-semibold ${v.ligne.differentiel > 0 ? "text-red-600" : "text-emerald-600"}`}
                          >
                            {v.ligne.differentiel > 0 ? "-" : ""}
                            {eur(Math.abs(v.ligne.differentiel))}
                          </td>
                        </tr>
                      ) : (
                        <tr key={`a-${v.annee}`} className="border-t border-line bg-muted/60 font-medium">
                          <td className="px-2 py-1 text-left">
                            Année {v.annee} ({v.nb_mois} mois)
                          </td>
                          <td className="px-2 py-1">{eur(v.echeance)}</td>
                          <td className="px-2 py-1">{eur(v.assurance_initiale)}</td>
                          <td className="px-2 py-1">{eur(v.total_actuel)}</td>
                          <td className="px-2 py-1">{eur(v.assurance_nouvelle)}</td>
                          <td
                            className={`px-2 py-1 font-semibold ${v.differentiel > 0 ? "text-red-600" : "text-emerald-600"}`}
                          >
                            {v.differentiel > 0 ? "-" : ""}
                            {eur(Math.abs(v.differentiel))}
                          </td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
              <div className="border-t border-line px-3 py-2 text-xs">
                Assurance de la banque : {eur(echeancier.total_assurance_initiale)} — assurance
                proposée : {eur(echeancier.total_assurance_nouvelle)} sur la période restante.
              </div>
            </div>

            <div className="mt-4 rounded-lg border border-line">
              <div className="border-b border-line px-3 py-2">
                <p className="text-sm font-semibold">Conditions financières</p>
                <p className="text-xs text-muted-foreground">
                  Frais ponctuels du nouveau contrat — jamais étalés sur la durée, déduits une
                  seule fois de l'économie brute pour obtenir l'économie nette.
                </p>
              </div>
              <div className="grid grid-cols-3 divide-x divide-line text-sm">
                <div className="px-3 py-2">
                  <p className="text-xs text-muted-foreground">Frais de courtage</p>
                  <p className="font-medium">{eur(Number(form.frais_courtage || 0))}</p>
                </div>
                <div className="px-3 py-2">
                  <p className="text-xs text-muted-foreground">Frais de dossier</p>
                  <p className="font-medium">{eur(Number(form.frais_dossier || 0))}</p>
                </div>
                <div className="px-3 py-2">
                  <p className="text-xs text-muted-foreground">Frais d'adhésion</p>
                  <p className="font-medium">{eur(Number(form.frais_adhesion || 0))}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 divide-x divide-line border-t border-line text-sm">
                <div className="px-3 py-3">
                  <p className="text-xs text-muted-foreground">
                    Économie brute (cotisations seules, sur la durée résiduelle)
                  </p>
                  <p
                    className={`text-base font-semibold ${
                      echeancier.economie_brute >= 0 ? "text-emerald-600" : "text-red-600"
                    }`}
                  >
                    {echeancier.economie_brute >= 0 ? "" : "-"}
                    {eur(Math.abs(echeancier.economie_brute))}
                  </p>
                </div>
                <div className="px-3 py-3">
                  <p className="text-xs text-muted-foreground">
                    Économie nette (après frais de courtage, dossier, adhésion)
                  </p>
                  <p
                    className={`text-base font-semibold ${
                      economieNette >= 0 ? "text-emerald-600" : "text-red-600"
                    }`}
                  >
                    {economieNette >= 0 ? "" : "-"}
                    {eur(Math.abs(economieNette))}
                  </p>
                </div>
              </div>
            </div>
            </>
          )}


          <Field label="Garanties retenues">
            <textarea
              rows={3}
              value={form.garanties}
              onChange={(e) => setForm({ ...form, garanties: e.target.value })}
              className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Recommandation (obligatoire)">
            <textarea
              rows={4}
              value={form.recommandation}
              onChange={(e) => setForm({ ...form, recommandation: e.target.value })}
              className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Motifs du conseil (obligatoire — renvoyer aux exigences du point 1)">
            <textarea
              rows={4}
              value={form.motifs}
              onChange={(e) => setForm({ ...form, motifs: e.target.value })}
              className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Mises en garde">
            <textarea
              rows={3}
              value={form.mises_en_garde}
              onChange={(e) => setForm({ ...form, mises_en_garde: e.target.value })}
              className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
            />
          </Field>

          <div className="rounded-xl border border-line p-3">
            <p className="text-xs uppercase tracking-wide text-ink-muted">Accusé de remise des documents</p>
            <div className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
              {(
                [
                  ["ipid_remis", "IPID remis"],
                  ["cg_remis", "Conditions générales / tableau de garanties"],
                  ["tarifs_remis", "Grille tarifaire / proposition"],
                  ["der_remis", "DER remis"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form[key]}
                    onChange={(e) => setForm({ ...form, [key]: e.target.checked })}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {/* Seule action manuelle : la validation. L'envoi au client est
                déclenché automatiquement une fois le délai de réflexion écoulé
                (et pendant les horaires d'ouverture). */}
            <button
              onClick={() => submit(true)}
              disabled={busy || !valide}
              className="rounded-full bg-ink px-5 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {busy ? "Enregistrement…" : "Valider (brouillon)"}
            </button>
          </div>
          <p className="text-xs text-ink-muted">
            Après validation, l'envoi au client est automatique
            {delai.disponible_le ? ` (prévu à partir du ${delai.disponible_le.toLocaleString("fr-FR")})` : ""}.
            {!delai.autorise && delai.motif ? ` ${delai.motif}` : ""}
          </p>

          {!valide && (
            <p className="text-xs text-ink-muted">
              Recommandation et motifs doivent contenir au moins 10 caractères (exigence DDA)
              {emprunteur && !offreUnique && ", et 3 offres comparées doivent être renseignées"}.
            </p>
          )}
        </div>
      )}

      {msg && <p className="mt-3 text-xs text-emerald-700">{msg}</p>}
      {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs uppercase tracking-wide text-ink-muted">{label}</span>
      {children}
    </label>
  );
}
