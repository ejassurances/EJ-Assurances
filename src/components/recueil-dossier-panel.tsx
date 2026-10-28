/**
 * Recueil des besoins d'un dossier existant.
 *
 * Le conseiller retrouve exactement le même parcours par étapes que lors de la
 * création du dossier (une étape par section + récapitulatif). La colonne
 * latérale est CONTEXTUELLE : elle n'affiche à chaque étape que ce qui sert
 * réellement — rappel du client, dépôt de l'offre de prêt et du tableau
 * d'amortissement à l'étape du prêt, fiches clients des assurés à l'étape des
 * assurés, devis (API partenaires + catalogue, notation IA) à l'étape de
 * tarification, pièces diverses ensuite.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { getBranche, type BrancheConfig } from "@/lib/recueil-besoins-schemas";
import { RecueilWorkflow } from "@/components/recueil-workflow";
import { DocumentsPretPanel } from "@/components/documents-pret-panel";
import { DossierDevisPanel } from "@/components/dossier-devis-panel";
import { synchroniserAssuresClients } from "@/lib/recueil-clients.functions";
import { situationPret, incoherencesPret } from "@/lib/pret-amortissement";
import { assuranceInitialeDepuisRecueil } from "@/lib/assurance-initiale";
import { fusionnerRecueilPret } from "@/lib/import-pret-verification";

/** Étape de tarification : c'est là que les devis sont produits. */
function estEtapeTarification(titre: string): boolean {
  return /tarif/i.test(titre);
}

/** Étape du prêt : c'est là que l'offre et le tableau d'amortissement arrivent. */
function estEtapePret(titre: string): boolean {
  return /pr[eê]t/i.test(titre);
}

/** Étape des personnes assurées. */
function estEtapeAssures(titre: string): boolean {
  return /assur/i.test(titre);
}

function PanneauLateral({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-background/40 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">{titre}</p>
      <div className="mt-3 space-y-3">{children}</div>
    </div>
  );
}

/** Fiches clients des assurés du prêt : une fiche par assuré, jamais d'écrasement. */
function FichesAssures({ dossierId, canEdit }: { dossierId: string; canEdit: boolean }) {
  const sync = useServerFn(synchroniserAssuresClients);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const lancer = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await sync({ data: { dossier_id: dossierId } });
      setMsg(res.message);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Erreur de synchronisation");
    } finally {
      setBusy(false);
    }
  };

  return (
    <PanneauLateral titre="Fiches clients des assurés">
      <p className="text-xs text-ink-muted">
        Chaque assuré du prêt dispose de sa propre fiche client (un contrat par assuré au passage en
        contrat). Seuls les champs vides sont complétés : aucune saisie existante n'est écrasée.
      </p>
      {canEdit && (
        <button
          type="button"
          onClick={() => void lancer()}
          disabled={busy}
          className="rounded-full bg-ink px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-60"
        >
          {busy ? "Synchronisation…" : "Mettre à jour les fiches clients"}
        </button>
      )}
      {msg && <p className="text-xs text-ink-muted">{msg}</p>}
    </PanneauLateral>
  );
}

/**
 * Coût de l'assurance bancaire actuelle : cotisation lue sur l'offre de prêt ou
 * calculée depuis le taux du contrat groupe, puis coût restant à courir entre
 * le mois prévu de la substitution et la fin du crédit.
 */
function AssuranceBancaire({
  values,
  moisRestants,
}: {
  values: Record<string, unknown>;
  moisRestants: number | null;
}) {
  const a = assuranceInitialeDepuisRecueil(values, moisRestants);
  const euros = (v: number | null) =>
    v === null
      ? "—"
      : `${v.toLocaleString("fr-FR", { minimumFractionDigits: a.origine === "document" ? 2 : 0, maximumFractionDigits: 2 })} €`;
  if (a.mensuel === null) {
    return (
      <p className="rounded-md bg-surface-elevated/70 px-2 py-1 text-xs text-ink-muted">
        Assurance actuelle : renseignez le taux d'assurance de la banque ou la cotisation mensuelle
        de l'offre de prêt pour chiffrer le coût initial et l'économie de la substitution.
      </p>
    );
  }
  return (
    <div className="rounded-md bg-surface-elevated/70 px-2 py-1.5">
      <p className="text-xs font-medium text-ink">Assurance bancaire actuelle</p>
      <dl className="mt-1 space-y-1 text-xs">
        <div className="flex justify-between gap-2">
          <dt className="text-ink-muted">
            {a.origine === "document"
              ? "Première cotisation (document)"
              : `Cotisation mensuelle ${a.origine === "offre" ? "(offre de prêt)" : "(calcul par taux)"}`}
          </dt>
          <dd className="text-ink">
            {a.mensuel.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} € / mois
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-ink-muted">
            Coût total {a.origine === "document" ? "(document bancaire)" : "(calculé)"}
          </dt>
          <dd className="text-ink">{euros(a.coutTotal)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-ink-muted">Cotisation totale restante (substitution → fin)</dt>
          <dd className="font-medium text-ink">
            {a.coutRestant === null && a.origine === "document"
              ? "Non disponible sans échéancier détaillé"
              : euros(a.coutRestant)}
            {a.moisRestants ? ` · ${a.moisRestants} mois restants` : ""}
          </dd>
        </div>
      </dl>
    </div>
  );
}

/**
 * Cohérence du prêt : le capital restant dû et les mois restants sont
 * recalculés à la date d'effet prévue de la substitution (date communiquée par
 * la compagnie, sinon création du dossier + 3 mois). Les écarts avec la saisie
 * sont signalés, jamais corrigés automatiquement.
 */
function CoherencePret({
  values,
  dossierCreeLe,
  dateDocument,
}: {
  values: Record<string, unknown>;
  dossierCreeLe: string | null;
  /** Date d'édition de l'offre/tableau importé : point de départ du prêt si la première échéance est absente. */
  dateDocument?: string | null;
}) {
  const nombre = (cle: string): number | null => {
    const n = Number(values[cle]);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const calcul = situationPret({
    capital: nombre("capital"),
    taux_pret: nombre("taux_pret"),
    duree_mois: nombre("duree_mois"),
    date_premiere_echeance:
      typeof values["date_premiere_echeance"] === "string"
        ? (values["date_premiere_echeance"] as string)
        : null,
    date_document: dateDocument ?? null,
    date_effet: typeof values["date_effet"] === "string" ? (values["date_effet"] as string) : null,
    dossier_cree_le: dossierCreeLe,
  });
  const alertes = incoherencesPret(values, dossierCreeLe, dateDocument ?? null);
  const euros = (v: number | null) =>
    v === null ? "—" : `${Math.round(v).toLocaleString("fr-FR")} €`;
  const dateFr = (v: string | null) => (v ? new Date(v).toLocaleDateString("fr-FR") : "—");

  return (
    <PanneauLateral titre="Cohérence du prêt">
      <dl className="space-y-1 text-xs">
        <div className="flex justify-between gap-2">
          <dt className="text-ink-muted">
            Début du prêt{" "}
            {calcul.origine_debut_pret === "echeance"
              ? "(tableau / offre)"
              : calcul.origine_debut_pret === "document"
                ? "(édition du document)"
                : calcul.origine_debut_pret === "dossier"
                  ? "(création du dossier)"
                  : ""}
          </dt>
          <dd className="text-ink">{dateFr(calcul.debut_pret)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-ink-muted">
            Date d'effet{" "}
            {calcul.origine_date_effet === "compagnie" ? "(compagnie)" : "(création + 3 mois)"}
          </dt>
          <dd className="text-ink">{dateFr(calcul.date_effet)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-ink-muted">Capital restant dû calculé</dt>
          <dd className="text-ink">{euros(calcul.capital_restant_du)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-ink-muted">Échéances déjà payées</dt>
          <dd className="font-medium text-ink">
            {calcul.mois_ecoules ?? "—"}
            {nombre("duree_mois") ? ` / ${nombre("duree_mois")}` : ""}
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-ink-muted">Échéances restantes</dt>
          <dd className="text-ink">{calcul.mois_restants ?? "—"}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-ink-muted">Mensualité estimée</dt>
          <dd className="text-ink">{euros(calcul.mensualite)}</dd>
        </div>
      </dl>
      <AssuranceBancaire values={values} moisRestants={calcul.mois_restants} />
      {alertes.length > 0 ? (
        <ul className="space-y-1 text-xs text-destructive">
          {alertes.map((a) => (
            <li key={a}>• {a}</li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-ink-muted">
          Aucune incohérence détectée entre les montants et les durées saisis.
        </p>
      )}
    </PanneauLateral>
  );
}

/** Chiffres utiles affichés dans le corps de l'étape Prêts, pas seulement dans la colonne latérale. */
function SynthesePret({
  values,
  dossierCreeLe,
  dateDocument,
}: {
  values: Record<string, unknown>;
  dossierCreeLe: string | null;
  dateDocument: string | null;
}) {
  const nombre = (cle: string): number | null => {
    const n = Number(values[cle]);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const calcul = situationPret({
    capital: nombre("capital"),
    taux_pret: nombre("taux_pret"),
    duree_mois: nombre("duree_mois"),
    date_premiere_echeance:
      typeof values["date_premiere_echeance"] === "string"
        ? String(values["date_premiere_echeance"])
        : null,
    date_document: dateDocument,
    date_effet: typeof values["date_effet"] === "string" ? String(values["date_effet"]) : null,
    dossier_cree_le: dossierCreeLe,
  });
  const assurance = assuranceInitialeDepuisRecueil(values, calcul.mois_restants);
  const euros = (v: number | null) =>
    v === null ? "—" : `${Math.round(v).toLocaleString("fr-FR")} €`;
  const eurosAssurance = (v: number | null) =>
    v === null
      ? "—"
      : `${v.toLocaleString("fr-FR", { minimumFractionDigits: assurance.origine === "document" ? 2 : 0, maximumFractionDigits: 2 })} €`;

  const lignes = [
    ["Capital restant dû", euros(calcul.capital_restant_du)],
    ["Échéances déjà payées", calcul.mois_ecoules === null ? "—" : String(calcul.mois_ecoules)],
    ["Échéances restantes", calcul.mois_restants === null ? "—" : String(calcul.mois_restants)],
    [
      assurance.origine === "document"
        ? "Première cotisation d’assurance"
        : "Cotisation d’assurance mensuelle",
      assurance.mensuel === null ? "—" : `${assurance.mensuel.toLocaleString("fr-FR")} €`,
    ],
    ["Montant total de l’assurance", eurosAssurance(assurance.coutTotal)],
    [
      "Montant d’assurance restant",
      assurance.coutRestant === null && assurance.origine === "document"
        ? "Non disponible"
        : eurosAssurance(assurance.coutRestant),
    ],
  ];

  return (
    <section className="border-t border-line pt-5" aria-label="Synthèse calculée du prêt">
      <h4 className="font-serif text-lg text-ink">Synthèse calculée</h4>
      <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {lignes.map(([label, valeur]) => (
          <div key={label} className="rounded-md border border-line bg-background p-3">
            <dt className="text-xs text-ink-muted">{label}</dt>
            <dd className="mt-1 text-base font-medium text-ink">{valeur}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function RecueilDossierPanel({
  dossierId,
  typeAssurance,
  recueil,
  canEdit,
  onSaved,
  client,
  filtreSections,
  sectionUnique = false,
}: {
  dossierId: string;
  typeAssurance: string;
  recueil: Record<string, unknown> | null;
  canEdit: boolean;
  onSaved?: () => void;
  /** Informations client rappelées en permanence dans la colonne latérale. */
  client?: {
    id: string | null;
    nom: string;
    email: string | null;
    telephone: string | null;
    reference?: string | null;
  };
  /** Restreint les sections du recueil (parcours emprunteur : une étape = une vue). */
  filtreSections?: (titre: string) => boolean;
  /** Affiche une seule section, sans sous-parcours ni récapitulatif. */
  sectionUnique?: boolean;
}) {
  const branche = getBranche(typeAssurance) as BrancheConfig | null;
  const [values, setValues] = useState<Record<string, unknown>>(recueil ?? {});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const syncClients = useServerFn(synchroniserAssuresClients);
  const [dossierCreeLe, setDossierCreeLe] = useState<string | null>(null);
  const [dateDocumentPret, setDateDocumentPret] = useState<string | null>(null);
  const valuesRef = useRef(values);
  const initialRender = useRef(true);
  const saveSequence = useRef(0);
  const dirtyRef = useRef(false);

  // Le panneau reste monté entre deux vues : ne pas garder le recueil initial
  // après une confirmation d'import et le rechargement du dossier parent.
  useEffect(() => {
    setValues((actuel) => {
      const prochain = dirtyRef.current
        ? fusionnerRecueilPret(actuel, recueil ?? {})
        : { ...(recueil ?? {}) };
      valuesRef.current = prochain;
      return JSON.stringify(prochain) === JSON.stringify(actuel) ? actuel : prochain;
    });
  }, [dossierId, recueil]);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from("dossiers")
        .select("created_at")
        .eq("id", dossierId)
        .maybeSingle();
      setDossierCreeLe((data?.created_at as string | null) ?? null);
    })();
  }, [dossierId]);

  // Date d'édition réellement lue dans l'offre/tableau. La date d'import du
  // fichier n'est pas une date de début du prêt et ne doit jamais la remplacer.
  useEffect(() => {
    void (async () => {
      const { data: documents } = await supabase
        .from("documents")
        .select("id")
        .eq("dossier_id", dossierId)
        .in("type_document", ["offre_pret", "tableau_amortissement"])
        .order("created_at", { ascending: true })
        .limit(10);
      const ids = (documents ?? []).map((d) => d.id);
      if (ids.length === 0) return setDateDocumentPret(null);
      const { data: extractions } = await supabase
        .from("doc_extractions")
        .select("extracted_data, created_at")
        .in("document_id", ids)
        .order("created_at", { ascending: true });
      const date = (extractions ?? [])
        .map((e) => {
          const extrait = e.extracted_data;
          if (!extrait || Array.isArray(extrait) || typeof extrait !== "object") return null;
          const valeur = (extrait as Record<string, unknown>)["date_edition_document"];
          return typeof valeur === "string" && valeur ? valeur : null;
        })
        .find((v): v is string => Boolean(v));
      setDateDocumentPret(date ?? null);
    })();
  }, [dossierId]);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.auth.getUser();
      setUserId(data.user?.id ?? null);
    })();
  }, []);

  /**
   * Assuré principal repris de la fiche client liée au dossier quand aucun
   * assuré n'est encore enregistré : l'identité connue en base fait référence,
   * les documents importés la corrigent ensuite. Rien n'est écrasé.
   */
  const clientId = client?.id ?? null;
  useEffect(() => {
    if (typeAssurance !== "emprunteur" || !clientId) return;
    void (async () => {
      const { data } = await supabase
        .from("clients")
        .select("nom, prenom, date_naissance")
        .eq("id", clientId)
        .maybeSingle();
      if (!data?.nom) return;
      const fiche = {
        nom: (data.nom as string) ?? "",
        prenom: (data.prenom as string | null) ?? "",
        date_naissance: (data.date_naissance as string | null) ?? "",
      };
      setValues((prev) => {
        const liste = Array.isArray(prev["assures"])
          ? (prev["assures"] as Record<string, unknown>[])
          : [];
        // Aucun assuré : l'assuré principal est créé depuis la fiche client.
        if (liste.length === 0) {
          return {
            ...prev,
            assures: [
              {
                lien: "principal",
                prenom: fiche.prenom,
                nom: fiche.nom,
                date_naissance: fiche.date_naissance,
                quotite_pct: 100,
                csp: "",
                fumeur: false,
              },
            ],
          };
        }
        // Assurés déjà présents : seuls les champs d'identité VIDES de l'assuré
        // principal sont complétés depuis la fiche client. Rien n'est écrasé.
        const iPrincipal = liste.findIndex((a) => a["lien"] === "principal");
        const index = iPrincipal >= 0 ? iPrincipal : 0;
        const cible = liste[index] ?? {};
        const complete: Record<string, unknown> = { ...cible };
        let modifie = false;
        for (const cle of ["prenom", "nom", "date_naissance"] as const) {
          const actuel = complete[cle];
          const vide = actuel === null || actuel === undefined || actuel === "";
          if (vide && fiche[cle]) {
            complete[cle] = fiche[cle];
            modifie = true;
          }
        }
        if (!modifie) return prev;
        const maj = [...liste];
        maj[index] = complete;
        return { ...prev, assures: maj };
      });
    })();
  }, [clientId, typeAssurance]);

  useEffect(() => {
    valuesRef.current = values;
  }, [values]);

  const enregistrerValeurs = useCallback(
    async (aEnregistrer: Record<string, unknown>, synchroniser = false) => {
      const sequence = ++saveSequence.current;
      setSaving(true);
      setError(null);
      const { error: err } = await supabase
        .from("dossiers")
        .update({ recueil_besoins: aEnregistrer as never })
        .eq("id", dossierId);
      if (err) {
        setError(err.message);
        if (sequence === saveSequence.current) setSaving(false);
        return;
      }
      if (
        sequence === saveSequence.current &&
        JSON.stringify(aEnregistrer) === JSON.stringify(valuesRef.current)
      )
        dirtyRef.current = false;
      let complement = "";
      if (synchroniser) {
        try {
          const res = await syncClients({ data: { dossier_id: dossierId } });
          complement = ` ${res.message}`;
        } catch {
          complement = " Fiches clients non mises à jour.";
        }
      }
      if (sequence === saveSequence.current) {
        setMessage(`Enregistré automatiquement.${complement}`);
        setSaving(false);
      }
    },
    [dossierId, syncClients],
  );

  const enregistrer = useCallback(async () => {
    await enregistrerValeurs(valuesRef.current, true);
    onSaved?.();
  }, [enregistrerValeurs, onSaved]);

  // Sauvegarde réelle après chaque modification, y compris quand l'utilisateur
  // quitte l'étape depuis la barre principale du parcours 0–11.
  useEffect(() => {
    if (!canEdit) return;
    if (initialRender.current) {
      initialRender.current = false;
      return;
    }
    dirtyRef.current = true;
    setMessage("Enregistrement automatique…");
    const timer = window.setTimeout(() => {
      void enregistrerValeurs(valuesRef.current);
    }, 650);
    return () => window.clearTimeout(timer);
  }, [canEdit, enregistrerValeurs, values]);

  // La barre des 12 étapes démonte cette vue. Une dernière écriture est donc
  // déclenchée au départ si la temporisation n'a pas encore eu le temps d'agir.
  useEffect(() => {
    return () => {
      if (!canEdit || !dirtyRef.current) return;
      void supabase
        .from("dossiers")
        .update({ recueil_besoins: valuesRef.current as never })
        .eq("id", dossierId);
    };
  }, [canEdit, dossierId]);

  // Les résultats déterministes du calcul alimentent directement le recueil.
  useEffect(() => {
    if (!canEdit || branche?.value !== "emprunteur") return;
    const nombre = (cle: string): number | null => {
      const n = Number(values[cle]);
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    const calcul = situationPret({
      capital: nombre("capital"),
      taux_pret: nombre("taux_pret"),
      duree_mois: nombre("duree_mois"),
      date_premiere_echeance:
        typeof values["date_premiere_echeance"] === "string"
          ? String(values["date_premiere_echeance"])
          : null,
      date_document: dateDocumentPret,
      date_effet: typeof values["date_effet"] === "string" ? String(values["date_effet"]) : null,
      dossier_cree_le: dossierCreeLe,
    });
    if (calcul.capital_restant_du === null || calcul.mois_restants === null) return;
    const capitalRestant = Math.round(calcul.capital_restant_du);
    // Le calcul ne complète que les champs VIDES : une valeur saisie par un
    // humain (reprise du tableau d'amortissement) n'est jamais écrasée. Les
    // écarts restent signalés par les contrôles de cohérence.
    const vide = (cle: string) => {
      const v = values[cle];
      return (
        v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) || Number(v) <= 0
      );
    };
    const maj: Record<string, unknown> = {};
    if (vide("capital_restant_du")) maj["capital_restant_du"] = capitalRestant;
    if (vide("mois_restants")) maj["mois_restants"] = calcul.mois_restants;
    if (Object.keys(maj).length === 0) return;
    setValues((prev) => ({ ...prev, ...maj }));
  }, [branche?.value, canEdit, dateDocumentPret, dossierCreeLe, values]);

  if (!branche) return null;

  const contexte = client ? (
    <PanneauLateral titre="Client du dossier">
      <p className="font-serif text-base text-ink">{client.nom}</p>
      <dl className="space-y-1 text-xs">
        {client.reference && (
          <div className="flex justify-between gap-2">
            <dt className="text-ink-muted">Dossier</dt>
            <dd className="text-ink">{client.reference}</dd>
          </div>
        )}
        <div className="flex justify-between gap-2">
          <dt className="text-ink-muted">Email</dt>
          <dd className="truncate text-ink">{client.email ?? "—"}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-ink-muted">Téléphone</dt>
          <dd className="text-ink">{client.telephone ?? "—"}</dd>
        </div>
      </dl>
      {client.id && (
        <Link
          to="/espace/clients/$id"
          params={{ id: client.id }}
          className="inline-block text-xs text-ink underline"
        >
          Ouvrir la fiche client →
        </Link>
      )}
    </PanneauLateral>
  ) : null;

  /** Colonne latérale contextuelle : uniquement ce qui sert à l'étape en cours. */
  const lateral = (titre: string) => {
    if (branche.value === "emprunteur" && estEtapePret(titre)) {
      return (
        <div className="space-y-3">
          <PanneauLateral titre="Offre de prêt & tableau d'amortissement">
            <DocumentsPretPanel
              dossierId={dossierId}
              onAnalyse={({ recueil: prerempli }) => {
                if (!prerempli) return;
                // Les saisies en cours (non encore enregistrées) restent prioritaires.
                setValues((prev) => {
                  const fusion: Record<string, unknown> = { ...prerempli };
                  for (const [cle, valeur] of Object.entries(prev)) {
                    const estVide =
                      valeur === null ||
                      valeur === undefined ||
                      valeur === "" ||
                      (Array.isArray(valeur) && valeur.length === 0);
                    if (!estVide) fusion[cle] = valeur;
                  }
                  return fusion;
                });
                setMessage("Document analysé : les étapes suivantes ont été pré-remplies.");
              }}
            />
          </PanneauLateral>
          <CoherencePret
            values={values}
            dossierCreeLe={dossierCreeLe}
            dateDocument={dateDocumentPret}
          />
        </div>
      );
    }
    if (branche.value === "emprunteur" && /montant|dur[eé]e|substitut|capital/i.test(titre)) {
      return (
        <CoherencePret
          values={values}
          dossierCreeLe={dossierCreeLe}
          dateDocument={dateDocumentPret}
        />
      );
    }
    if (estEtapeAssures(titre)) {
      return <FichesAssures dossierId={dossierId} canEdit={canEdit} />;
    }
    if (estEtapeTarification(titre)) {
      // Les devis sont affichés en pleine largeur sous l'étape (colonnes par assuré).
      return null;
    }
    return (
      <PanneauLateral titre="Pièces du recueil">
        <DocumentsPretPanel
          dossierId={dossierId}
          titre="Pièces, relevés et justificatifs"
          filtre="tous"
          typeDocument="recueil"
        />
      </PanneauLateral>
    );
  };

  return (
    <div id="section-recueil" className="space-y-3">
      {!canEdit ? (
        <p className="text-sm text-ink-muted">
          Recueil consultable uniquement : vous n'avez pas les droits de modification.
        </p>
      ) : null}
      <RecueilWorkflow
        branche={branche}
        values={values}
        onChange={setValues}
        onComplete={canEdit ? () => void enregistrer() : undefined}
        onSaveStep={canEdit ? () => void enregistrer() : undefined}
        completeLabel={saving ? "Enregistrement…" : "Enregistrer cette étape"}
        dossierId={dossierId}
        contexte={contexte}
        filtreSections={filtreSections}
        sectionUnique={sectionUnique}
        asideSection={(section) => lateral(section.title)}
        pleineLargeurSection={(section) =>
          branche.value === "emprunteur" && estEtapePret(section.title) ? (
            <SynthesePret
              values={values}
              dossierCreeLe={dossierCreeLe}
              dateDocument={dateDocumentPret}
            />
          ) : estEtapeTarification(section.title) && userId ? (
            <DossierDevisPanel
              dossierId={dossierId}
              branche={branche.value}
              userId={userId}
              onChanged={onSaved}
            />
          ) : null
        }
      />
      {saving && <p className="text-sm text-ink-muted">Enregistrement automatique…</p>}
      {message && <p className="text-sm text-ink-muted">{message}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
