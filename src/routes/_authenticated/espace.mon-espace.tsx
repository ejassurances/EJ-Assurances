import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { DossierPiecesPanel } from "@/components/dossier-pieces-panel";
import { DossierPipelineClient } from "@/components/dossier-pipeline-client";
import { SinistresPanel } from "@/components/sinistres-panel";
import {
  labelForBranche,
  BRANCHES_CREATION,
  getBranche,
  assurePrincipalEmprunteur,
  ageDepuisDateNaissance,
} from "@/lib/recueil-besoins-schemas";
import { RecueilWorkflow } from "@/components/recueil-workflow";
import { RecueilEspaceClientCard } from "@/components/recueil-espace-client-card";
import {
  majMesCoordonnees,
  monFichierUrl,
  monEspaceComplement,
  envoyerMonMessage,
  demanderNouvelleEtude,
  monDerUrl,
  mesDocumentsDda,
  maLettreMissionUrl,
  monDevoirConseilUrl,
} from "@/lib/espace-client.functions";
import { ouvrirPdf } from "@/lib/ouvrir-pdf";
import { ClientPortalHeader } from "@/components/client-portal-header";
import { EspaceClientContratDocuments } from "@/components/espace-client-contrat-documents";
import { StatCard } from "@/components/stat-card";
import { CompletudeRings } from "@/components/completude-rings";
import { SectionNav, type SectionNavItem } from "@/components/section-nav";
import { IconFileCheck, IconFileEuro, IconFolders } from "@tabler/icons-react";


export const Route = createFileRoute("/_authenticated/espace/mon-espace")({
  component: MonEspace,
  head: () => ({
    meta: [
      { title: "Mon espace client | EJ Partners Assurances" },
      {
        name: "description",
        content:
          "Suivez votre projet d'assurance, déposez vos pièces justificatives et gérez votre compte en toute sécurité.",
      },
      { property: "og:title", content: "Mon espace client | EJ Partners Assurances" },
      {
        property: "og:description",
        content: "Suivi de projet, pièces justificatives et gestion de compte client.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

type ClientRow = {
  id: string;
  reference: string;
  civilite: string | null;
  prenom: string | null;
  nom: string;
  email: string | null;
  email2: string | null;
  mobile: string | null;
  telephone: string | null;
  adresse: string | null;
  complement_adresse: string | null;
  code_postal: string | null;
  ville: string | null;
  pays: string | null;
  preference_contact: string | null;
};

type DossierRow = {
  id: string;
  reference: string;
  statut: string;
  type_assurance: string;
  created_at: string;
  economie_estimee: number | null;
};

type KycRow = {
  id: string;
  type: string;
  nom: string;
  statut: string;
  created_at: string;
};

const KYC_LABEL: Record<string, string> = {
  cni: "Pièce d'identité",
  justificatif_domicile: "Justificatif de domicile",
  rib: "RIB",
  kbis: "KBIS / avis Sirene",
};

const TABS = [
  { key: "projet", label: "Mon projet" },
  { key: "contrats", label: "Mes contrats" },
  { key: "conformite", label: "Mes documents" },
  { key: "sinistres", label: "Mes sinistres" },
  { key: "messages", label: "Mon conseiller" },
  { key: "compte", label: "Mon compte" },
] as const;

type Complement = Awaited<ReturnType<typeof monEspaceComplement>>;

const STATUT_CONTRAT: Record<string, string> = {
  actif: "En cours",
  en_cours: "En cours",
  resilie: "Résilié",
  suspendu: "Suspendu",
};

const euros = (v: number | null) => (v == null ? "—" : `${v.toLocaleString("fr-FR")} €`);
const jour = (v: string | null) => (v ? new Date(v).toLocaleDateString("fr-FR") : "—");

function MonEspace() {
  const { user } = useAuth();
  const majCoordonnees = useServerFn(majMesCoordonnees);
  const fichierUrl = useServerFn(monFichierUrl);
  const chargerComplement = useServerFn(monEspaceComplement);
  const envoyerMessage = useServerFn(envoyerMonMessage);
  const demanderEtude = useServerFn(demanderNouvelleEtude);
  const derUrl = useServerFn(monDerUrl);
  const chargerDda = useServerFn(mesDocumentsDda);
  const lettreUrl = useServerFn(maLettreMissionUrl);
  const devoirUrl = useServerFn(monDevoirConseilUrl);
  const [dda, setDda] = useState<Awaited<ReturnType<typeof mesDocumentsDda>> | null>(null);
  const [comp, setComp] = useState<Complement | null>(null);

  const [message, setMessage] = useState("");
  const [envoiMsg, setEnvoiMsg] = useState(false);
  const [etudeBranche, setEtudeBranche] = useState("");
  const [etudeMessage, setEtudeMessage] = useState("");
  const [etudeRecueil, setEtudeRecueil] = useState<Record<string, unknown>>({});
  const [etudeEtape, setEtudeEtape] = useState<1 | 2>(1);
  const [etudeOuverte, setEtudeOuverte] = useState(false);
  const [etudeEnvoi, setEtudeEnvoi] = useState(false);
  const [etudeOk, setEtudeOk] = useState<string | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("projet");
  const [client, setClient] = useState<ClientRow | null>(null);
  const [dossiers, setDossiers] = useState<DossierRow[]>([]);
  const [kyc, setKyc] = useState<KycRow[]>([]);
  const [estPro, setEstPro] = useState(false);
  const [derAFaire, setDerAFaire] = useState(false);
  const [lettreAFaire, setLettreAFaire] = useState(false);
  const [devoirAFaire, setDevoirAFaire] = useState(false);
  const [loading, setLoading] = useState(true);

  const [edit, setEdit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [form, setForm] = useState({
    civilite: "",
    prenom: "",
    nom: "",
    email2: "",
    mobile: "",
    telephone: "",
    adresse: "",
    complement_adresse: "",
    code_postal: "",
    ville: "",
    pays: "",
    preference_contact: "",
  });

  const load = async () => {
    if (!user) return;
    const { data: c } = await supabase
      .from("clients")
      .select(
        "id,reference,civilite,prenom,nom,email,email2,mobile,telephone,adresse,complement_adresse,code_postal,ville,pays,preference_contact",
      )
      .eq("user_id", user.id)
      .maybeSingle();
    const cl = (c as ClientRow) ?? null;
    setClient(cl);
    if (cl) {
      setForm({
        civilite: cl.civilite ?? "",
        prenom: cl.prenom ?? "",
        nom: cl.nom ?? "",
        email2: cl.email2 ?? "",
        mobile: cl.mobile ?? "",
        telephone: cl.telephone ?? "",
        adresse: cl.adresse ?? "",
        complement_adresse: cl.complement_adresse ?? "",
        code_postal: cl.code_postal ?? "",
        ville: cl.ville ?? "",
        pays: cl.pays ?? "",
        preference_contact: cl.preference_contact ?? "",
      });
    }

    const filtre: string[] = [];
    if (cl) filtre.push(`client_id.eq.${cl.id}`);
    if (user.email) filtre.push(`client_email.eq.${user.email}`);
    if (filtre.length > 0) {
      const { data: d } = await supabase
        .from("dossiers")
        .select("id,reference,statut,type_assurance,created_at,economie_estimee")
        .or(filtre.join(","))
        .order("created_at", { ascending: false });
      setDossiers((d ?? []) as DossierRow[]);
    }

    if (cl) {
      const [{ data: der }, { data: lm }, { data: dc }, { data: docs }, { data: entreprise }] = await Promise.all([
        supabase.from("client_der_envois").select("id").eq("client_id", cl.id).is("signed_at", null).limit(1),
        supabase.from("lettres_mission").select("id").eq("client_id", cl.id).is("signed_at", null).limit(1),
        supabase.from("devoirs_conseil").select("id").eq("client_id", cl.id).eq("statut", "envoye").limit(1),
        supabase
          .from("client_kyc_documents")
          .select("id,type,nom,statut,created_at")
          .eq("client_id", cl.id)
          .order("created_at", { ascending: false }),
        supabase.from("client_entreprise").select("id,siret,raison_sociale").eq("client_id", cl.id).maybeSingle(),
      ]);
      setDerAFaire((der ?? []).length > 0);
      setLettreAFaire((lm ?? []).length > 0);
      setDevoirAFaire((dc ?? []).length > 0);
      setKyc((docs ?? []) as KycRow[]);
      const ent = entreprise as { siret: string | null; raison_sociale: string | null } | null;
      setEstPro(Boolean(ent && (ent.siret || ent.raison_sociale)));
    }

    try {
      setComp(await chargerComplement({ data: undefined }));
    } catch {
      setComp(null);
    }

    try {
      setDda(await chargerDda({ data: undefined }));
    } catch {
      setDda(null);
    }


    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [user]);

  const enregistrer = async () => {
    setSaving(true);
    setSaveErr(null);
    setSavedMsg(null);
    try {
      await majCoordonnees({
        data: {
          civilite: form.civilite,
          prenom: form.prenom,
          nom: form.nom,
          email2: form.email2,
          mobile: form.mobile,
          telephone: form.telephone,
          adresse: form.adresse,
          complement_adresse: form.complement_adresse,
          code_postal: form.code_postal,
          ville: form.ville,
          pays: form.pays,
          preference_contact: form.preference_contact,
        },
      });
      setSavedMsg("Vos informations ont été mises à jour.");
      setEdit(false);
      await load();
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : "Erreur d'enregistrement");
    }
    setSaving(false);
  };

  const telecharger = async (id: string) => {
    try {
      await ouvrirPdf(async () => (await fichierUrl({ data: { source: "kyc", id } })).url);
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : "Téléchargement impossible");
    }
  };

  const telechargerDocument = async (id: string) => {
    try {
      await ouvrirPdf(async () => (await fichierUrl({ data: { source: "document", id } })).url);
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : "Téléchargement impossible");
    }
  };

  const telechargerDer = async (envoiId: string) => {
    try {
      await ouvrirPdf(async () => (await derUrl({ data: { envoi_id: envoiId } })).url);
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : "Téléchargement impossible");
    }
  };

  const ouvrirLettreMission = async (id: string) => {
    try {
      await ouvrirPdf(async () => (await lettreUrl({ data: { lettre_id: id } })).url);
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : "Document indisponible");
    }
  };

  const ouvrirDevoirConseil = async (id: string) => {
    try {
      await ouvrirPdf(async () => (await devoirUrl({ data: { devoir_id: id } })).url);
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : "Document indisponible");
    }
  };


  const envoyer = async () => {
    if (message.trim().length < 2) return;
    setEnvoiMsg(true);
    setSaveErr(null);
    try {
      await envoyerMessage({ data: { contenu: message.trim() } });
      setMessage("");
      await load();
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : "Envoi impossible");
    }
    setEnvoiMsg(false);
  };

  const soumettreEtude = async () => {
    if (!etudeBranche) return;
    setEtudeEnvoi(true);
    setSaveErr(null);
    try {
      // Champs de compat emprunteur, calculés comme côté courtier.
      let capital: number | null = null;
      let duree_mois: number | null = null;
      let age: number | null = null;
      let fumeur: boolean | null = null;
      if (etudeBranche === "emprunteur") {
        capital = Number(etudeRecueil["capital"]) || null;
        duree_mois = Number(etudeRecueil["duree_mois"]) || null;
        const principal = assurePrincipalEmprunteur(etudeRecueil["assures"]);
        age = principal ? ageDepuisDateNaissance(principal.date_naissance) : null;
        fumeur = principal?.fumeur === true;
      }
      const res = await demanderEtude({
        data: {
          type_assurance: etudeBranche,
          message: etudeMessage.trim() || null,
          recueil_besoins: etudeRecueil,
          capital,
          duree_mois,
          age,
          fumeur,
        },
      });
      setEtudeOk(`Demande enregistrée — dossier ${res.reference}. Votre conseiller vous contacte sous 48 h.`);
      setEtudeOuverte(false);
      setEtudeBranche("");
      setEtudeMessage("");
      setEtudeRecueil({});
      setEtudeEtape(1);
      await load();
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : "Demande impossible");
    }
    setEtudeEnvoi(false);
  };

  if (loading) return <p className="text-sm text-ink-muted">Chargement…</p>;

  const kycVisible = kyc.filter((k) => estPro || k.type !== "kbis");

  /* Indicateurs d'affichage, calculés à partir des données déjà chargées. */
  const contrats = comp?.contrats ?? [];
  const contratsActifs = contrats.filter((c) => (c.statut ?? "") !== "resilie").length;
  const primeTotale = contrats.reduce((s, c) => s + (c.prime_annuelle ?? 0), 0);
  const nbDocuments =
    kycVisible.length +
    (comp?.documents ?? []).length +
    (dda?.lettres ?? []).length +
    (dda?.devoirs ?? []).length +
    (comp?.der ?? []).length;
  const signatures = [!derAFaire, !lettreAFaire, !devoirAFaire];
  const pctSignatures = Math.round((signatures.filter(Boolean).length / signatures.length) * 100);
  const pctPieces = kycVisible.length === 0 ? 0 : Math.round(
    (kycVisible.filter((k) => k.statut === "valide").length / kycVisible.length) * 100,
  );
  const dossierEnCours = dossiers[0];
  const items: SectionNavItem<(typeof TABS)[number]["key"]>[] = TABS.map((t) => ({
    key: t.key,
    label: t.label,
  }));

  return (
    <div className="space-y-6">
      <ClientPortalHeader
        prenom={client?.prenom ?? null}
        nom={client?.nom ?? null}
        email={user?.email ?? null}
        contexte={[
          client?.reference ? `Référence client ${client.reference}` : null,
          dossierEnCours ? `Dossier ${dossierEnCours.reference}` : null,
          comp?.conseiller?.nom ? `Conseiller : ${comp.conseiller.nom}` : "Conseiller : EJ Partners Assurances",
        ]}
      >
        {client && (
          <button
            onClick={() => setEtudeOuverte((v) => !v)}
            className="rounded-full bg-[#D4AF37] px-5 py-2 text-sm font-semibold text-[#0A192F] transition-colors hover:bg-[#c8a233]"
          >
            Demander une nouvelle étude
          </button>
        )}
      </ClientPortalHeader>

      <div className="grid gap-6 sm:grid-cols-3">
        <StatCard
          label="Mes contrats en cours"
          value={contratsActifs}
          sub={contrats.length > 1 ? `${contrats.length} contrats au total` : undefined}
          icon={IconFileCheck}
        />
        <StatCard
          label="Cotisations annuelles"
          value={euros(primeTotale)}
          sub="Somme de mes contrats en cours"
          accent
          icon={IconFileEuro}
        />
        <StatCard
          label="Mes documents"
          value={nbDocuments}
          sub="Pièces, contrats et documents de conseil"
          icon={IconFolders}
        />
      </div>

      {(dossiers.length > 0 || kycVisible.length > 0) && (
        <div className="crm-card p-6">
          <p className="crm-eyebrow">Avancement de mon dossier</p>
          <CompletudeRings
            className="mt-4"
            items={[
              { key: "pieces", label: "Mes pièces validées", value: pctPieces },
              { key: "signatures", label: "Documents signés", value: pctSignatures },
            ]}
          />
        </div>
      )}


      {etudeOk && <p className="rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-800">{etudeOk}</p>}

      {etudeOuverte && (
        <div className="space-y-4">
          {etudeEtape === 1 || !getBranche(etudeBranche) ? (
            <div className="rounded-2xl border border-line bg-surface-elevated p-6">
              <h2 className="font-serif text-lg">Nouvelle demande d'étude</h2>
              <p className="mt-1 text-sm text-ink-muted">
                Choisissez la branche concernée : vous remplirez ensuite le même recueil des besoins que celui
                utilisé par votre conseiller.
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {BRANCHES_CREATION.map((b) => (
                  <button
                    key={b.value}
                    type="button"
                    onClick={() => setEtudeBranche(b.value)}
                    className={`rounded-2xl border p-4 text-left transition ${
                      etudeBranche === b.value
                        ? "border-ink bg-background"
                        : "border-line bg-background/40 hover:border-ink/40"
                    }`}
                  >
                    <p className="font-medium text-ink">{b.label}</p>
                    <p className="mt-1 text-xs text-ink-muted">{b.description}</p>
                  </button>
                ))}
              </div>
              <div className="mt-6 flex justify-end">
                <button
                  onClick={() => setEtudeEtape(2)}
                  disabled={!getBranche(etudeBranche)}
                  className="rounded-full bg-[#0A192F] px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  Continuer → Recueil des besoins
                </button>
              </div>
            </div>
          ) : (
            <RecueilWorkflow
              branche={getBranche(etudeBranche)!}
              values={etudeRecueil}
              onChange={setEtudeRecueil}
              onBack={() => setEtudeEtape(1)}
              onComplete={() => soumettreEtude()}
              completeLabel={etudeEnvoi ? "Envoi…" : "Envoyer ma demande"}
            >
              <div className="space-y-4">
                <label className="block">
                  <span className="mb-1 block text-xs uppercase tracking-wide text-ink-muted">
                    Précisions pour mon conseiller (facultatif)
                  </span>
                  <textarea
                    value={etudeMessage}
                    onChange={(e) => setEtudeMessage(e.target.value)}
                    rows={3}
                    className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
                  />
                </label>
                <p className="text-xs text-ink-muted">
                  Vos réponses sont transmises à votre conseiller, qui vous contacte sous 48 h.
                </p>
              </div>
            </RecueilWorkflow>
          )}
        </div>
      )}

      <RecueilEspaceClientCard onEnvoye={() => void load()} />

      {(derAFaire || lettreAFaire || devoirAFaire) && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-medium">Documents à signer</p>
          <div className="mt-2 flex flex-wrap gap-3">
            {derAFaire && (
              <Link to="/espace/signer-der" className="rounded-md border border-amber-400 bg-white px-3 py-1.5">
                Signer le DER
              </Link>
            )}
            {lettreAFaire && (
              <Link
                to="/espace/signer-lettre-mission"
                className="rounded-md border border-amber-400 bg-white px-3 py-1.5"
              >
                Signer la lettre de mission
              </Link>
            )}
            {devoirAFaire && (
              <Link
                to="/espace/signer-devoir-conseil"
                className="rounded-md border border-amber-400 bg-white px-3 py-1.5"
              >
                Valider le devoir de conseil
              </Link>
            )}
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_16rem]">
        <div className="min-w-0 space-y-6">


      {tab === "projet" && (
        <div className="space-y-6">
          {dossiers.length === 0 && (
            <p className="rounded-lg border border-line bg-surface p-5 text-sm text-ink-muted">
              Aucun projet en cours pour le moment. Notre équipe revient vers vous très rapidement.
            </p>
          )}
          {dossiers.map((d) => (
            <div key={d.id} className="space-y-3">
              <div className="rounded-lg border border-line bg-surface p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-ink">{labelForBranche(d.type_assurance)}</p>
                    <p className="text-xs text-ink-muted">
                      Référence {d.reference} · ouvert le {new Date(d.created_at).toLocaleDateString("fr-FR")}
                    </p>
                  </div>
                </div>
                {d.economie_estimee != null && (
                  <p className="mt-3 text-sm text-ink-soft">
                    Économie estimée : <strong>{d.economie_estimee.toLocaleString("fr-FR")} €</strong> sur la durée du
                    prêt (estimation provisoire, une étude complémentaire peut être nécessaire).
                  </p>
                )}
              </div>
              <DossierPipelineClient statut={d.statut} />

              {(() => {
                const lettres = (dda?.lettres ?? []).filter((l) => l.dossier_id === d.id);
                const devoirs = (dda?.devoirs ?? []).filter((x) => x.dossier_id === d.id);
                const docs = (comp?.documents ?? []).filter((x) => x.dossier_id === d.id);
                const ders = comp?.der ?? [];
                if (lettres.length === 0 && devoirs.length === 0 && docs.length === 0 && ders.length === 0) return null;
                return (
                  <div className="rounded-lg border border-line bg-surface p-5">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                      Documents de ce dossier
                    </h3>
                    <ul className="mt-3 space-y-2 text-sm">
                      {ders.map((x) => (
                        <li key={x.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-2">
                          <span>
                            <strong>Document d'entrée en relation (DER)</strong>
                            <span className="ml-2 text-xs text-ink-muted">
                              remis le {jour(x.envoye_le)} ·{" "}
                              {x.signed_at ? `signé le ${jour(x.signed_at)}` : "signature en attente"}
                            </span>
                          </span>
                          {x.telechargeable ? (
                            <button
                              onClick={() => telechargerDer(x.id)}
                              className="shrink-0 rounded-full border border-line px-3 py-1 text-xs hover:bg-background"
                            >
                              Télécharger
                            </button>
                          ) : (
                            <Link to="/espace/signer-der" className="shrink-0 rounded-full border border-line px-3 py-1 text-xs">
                              Consulter
                            </Link>
                          )}
                        </li>
                      ))}
                      {lettres.map((l) => (
                        <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-2">
                          <span>
                            <strong>Lettre de mission</strong>
                            <span className="ml-2 text-xs text-ink-muted">
                              {l.signed_at ? `signée le ${jour(l.signed_at)}` : "signature en attente"}
                            </span>
                          </span>
                          <button
                            onClick={() => ouvrirLettreMission(l.id)}
                            className="shrink-0 rounded-full border border-line px-3 py-1 text-xs hover:bg-background"
                          >
                            Ouvrir / imprimer le PDF
                          </button>
                        </li>
                      ))}
                      {devoirs.map((x) => (
                        <li key={x.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-2">
                          <span>
                            <strong>Devoir de conseil</strong>
                            <span className="ml-2 text-xs text-ink-muted">
                              {x.signed_at ? `validé le ${jour(x.signed_at)}` : x.statut}
                            </span>
                          </span>
                          <button
                            onClick={() => ouvrirDevoirConseil(x.id)}
                            className="shrink-0 rounded-full border border-line px-3 py-1 text-xs hover:bg-background"
                          >
                            Ouvrir / imprimer le PDF
                          </button>
                        </li>
                      ))}
                      {docs.map((doc) => (
                        <li key={doc.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-2">
                          <span className="min-w-0">
                            <strong>{doc.file_name}</strong>
                            <span className="ml-2 text-xs text-ink-muted">
                              {doc.categorie ? `${doc.categorie} · ` : ""}
                              {jour(doc.created_at)}
                            </span>
                          </span>
                          <button
                            onClick={() => telechargerDocument(doc.id)}
                            className="shrink-0 rounded-full border border-line px-3 py-1 text-xs hover:bg-background"
                          >
                            Télécharger
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })()}
            </div>
          ))}
        </div>
      )}

      {tab === "contrats" && (
        <div className="space-y-4">
          {(comp?.contrats ?? []).length === 0 ? (
            <p className="rounded-lg border border-line bg-surface p-5 text-sm text-ink-muted">
              Aucun contrat enregistré à votre nom pour le moment.
            </p>
          ) : (
            (comp?.contrats ?? []).map((c) => (
              <div key={c.id} className="rounded-lg border border-line bg-surface p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-ink">
                      {c.compagnie ?? "Assureur"} {c.produit ? `· ${c.produit}` : ""}
                    </p>
                    <p className="text-xs text-ink-muted">
                      {c.numero ? `Contrat n° ${c.numero} · ` : ""}
                      {STATUT_CONTRAT[c.statut ?? ""] ?? c.statut ?? "—"}
                    </p>
                  </div>
                  <span className="text-sm text-ink-soft">{euros(c.prime_annuelle)} / an</span>
                </div>
                <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
                  <Info label="Date d'effet">{jour(c.date_effet)}</Info>
                  <Info label="Échéance">{jour(c.date_echeance)}</Info>
                  <Info label="Fractionnement">{c.fractionnement ?? "—"}</Info>
                </dl>
                <EspaceClientContratDocuments
                  contratId={c.id}
                  documents={(comp?.documents ?? []).filter((d) => d.contrat_id === c.id)}
                  onTelecharger={telechargerDocument}
                />
              </div>
            ))
          )}
        </div>
      )}

      {tab === "conformite" && (
        <div className="space-y-8">
          <div className="rounded-lg border border-line bg-surface p-5">
            <h2 className="font-serif text-lg">Mes documents déposés</h2>
            {kycVisible.length === 0 ? (
              <p className="mt-2 text-sm text-ink-muted">Aucun document déposé pour le moment.</p>
            ) : (
              <ul className="mt-3 space-y-2 text-sm">
                {kycVisible.map((k) => (
                  <li key={k.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-2">
                    <span>
                      <strong>{KYC_LABEL[k.type] ?? k.type}</strong> · {k.nom}
                      <span className="ml-2 text-xs text-ink-muted">
                        déposé le {new Date(k.created_at).toLocaleDateString("fr-FR")} · {k.statut}
                      </span>
                    </span>
                    <button
                      onClick={() => telecharger(k.id)}
                      className="rounded-full border border-line px-3 py-1 text-xs hover:bg-background"
                    >
                      Télécharger
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {!estPro && (
              <p className="mt-3 text-xs text-ink-muted">
                Vous êtes enregistré comme particulier : aucun document d'entreprise (KBIS / Sirene) ne vous est
                demandé.
              </p>
            )}
          </div>

          {dossiers.length === 0 && (
            <p className="rounded-lg border border-line bg-surface p-5 text-sm text-ink-muted">
              Aucune pièce demandée pour l'instant.
            </p>
          )}
          {dossiers.map((d) => (
            <div key={d.id} className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                Dossier {d.reference} — {labelForBranche(d.type_assurance)}
              </p>
              <DossierPiecesPanel dossierId={d.id} clientId={client?.id ?? null} />
            </div>
          ))}

          <div className="rounded-lg border border-line bg-surface p-5">
            <h2 className="font-serif text-lg">Documents de mes dossiers et contrats</h2>
            {(comp?.documents ?? []).length === 0 ? (
              <p className="mt-2 text-sm text-ink-muted">Aucun document partagé pour le moment.</p>
            ) : (
              <ul className="mt-3 space-y-2 text-sm">
                {(comp?.documents ?? []).map((doc) => (
                  <li
                    key={doc.id}
                    className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-2"
                  >
                    <span>
                      <strong>{doc.file_name}</strong>
                      <span className="ml-2 text-xs text-ink-muted">
                        {[doc.categorie, doc.dossier_reference ? `dossier ${doc.dossier_reference}` : null]
                          .filter(Boolean)
                          .join(" · ")}{" "}
                        · {jour(doc.created_at)}
                      </span>
                    </span>
                    <button
                      onClick={() => telechargerDocument(doc.id)}
                      className="rounded-full border border-line px-3 py-1 text-xs hover:bg-background"
                    >
                      Télécharger
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-lg border border-line bg-surface p-5">
            <h2 className="font-serif text-lg">Ma lettre de mission et mon devoir de conseil</h2>
            <p className="mt-1 text-xs text-ink-muted">
              Ouvrez le PDF puis utilisez la fonction « Imprimer » de votre navigateur (ou « Partager » sur mobile).
            </p>
            {(dda?.lettres ?? []).length === 0 && (dda?.devoirs ?? []).length === 0 ? (
              <p className="mt-2 text-sm text-ink-muted">Aucun document de conseil disponible pour le moment.</p>
            ) : (
              <ul className="mt-3 space-y-2 text-sm">
                {(dda?.lettres ?? []).map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-2">
                    <span>
                      <strong>Lettre de mission</strong>
                      <span className="ml-2 text-xs text-ink-muted">
                        {labelForBranche(l.type_assurance)}
                        {l.reference ? ` · dossier ${l.reference}` : ""} ·{" "}
                        {l.signed_at ? `signée le ${jour(l.signed_at)}` : "signature en attente"}
                      </span>
                    </span>
                    <button
                      onClick={() => ouvrirLettreMission(l.id)}
                      className="rounded-full border border-line px-3 py-1 text-xs hover:bg-background"
                    >
                      Ouvrir / imprimer le PDF
                    </button>
                  </li>
                ))}
                {(dda?.devoirs ?? []).map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-2">
                    <span>
                      <strong>Devoir de conseil</strong>
                      <span className="ml-2 text-xs text-ink-muted">
                        {labelForBranche(d.type_assurance)}
                        {d.reference ? ` · dossier ${d.reference}` : ""} ·{" "}
                        {d.signed_at ? `validé le ${jour(d.signed_at)}` : d.statut}
                      </span>
                    </span>
                    <button
                      onClick={() => ouvrirDevoirConseil(d.id)}
                      className="rounded-full border border-line px-3 py-1 text-xs hover:bg-background"
                    >
                      Ouvrir / imprimer le PDF
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>



          <div className="rounded-lg border border-line bg-surface p-5">
            <h2 className="font-serif text-lg">Mes documents d'information réglementaires</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {(comp?.der ?? []).map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-2">
                  <span>
                    <strong>Document d'entrée en relation (DER)</strong>
                    {d.version ? <span className="ml-1 text-xs text-ink-muted">version {d.version}</span> : null}
                    <span className="ml-2 text-xs text-ink-muted">
                      remis le {jour(d.envoye_le)} ·{" "}
                      {d.signed_at ? `signé le ${jour(d.signed_at)}` : "signature en attente"}
                    </span>
                  </span>
                  {d.telechargeable ? (
                    <button
                      onClick={() => telechargerDer(d.id)}
                      className="rounded-full border border-line px-3 py-1 text-xs hover:bg-background"
                    >
                      Télécharger
                    </button>
                  ) : (
                    <Link to="/espace/signer-der" className="rounded-full border border-line px-3 py-1 text-xs">
                      Consulter
                    </Link>
                  )}
                </li>
              ))}
              <li className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-2">
                <span>
                  <strong>Conditions générales d'utilisation</strong>
                  <span className="ml-2 text-xs text-ink-muted">
                    {(() => {
                      const c = (comp?.consentements ?? []).find((x) => x.type === "cgu");
                      return c ? `acceptées le ${jour(c.accepte_le)}` : "non encore acceptées";
                    })()}
                  </span>
                </span>
                <Link to="/espace/cgu" className="rounded-full border border-line px-3 py-1 text-xs hover:bg-background">
                  Consulter
                </Link>
              </li>
              <li className="flex flex-wrap items-center justify-between gap-3">
                <span>
                  <strong>Politique de confidentialité (RGPD)</strong>
                  <span className="ml-2 text-xs text-ink-muted">
                    {(() => {
                      const c = (comp?.consentements ?? []).find((x) => x.type === "rgpd");
                      return c ? `acceptée le ${jour(c.accepte_le)}` : "non encore acceptée";
                    })()}
                  </span>
                </span>
                <Link
                  to="/espace/confidentialite"
                  className="rounded-full border border-line px-3 py-1 text-xs hover:bg-background"
                >
                  Consulter
                </Link>
              </li>
            </ul>
          </div>
        </div>
      )}

      {tab === "sinistres" && client && (
        <SinistresPanel clientId={client.id} mode="client" canEdit />
      )}

      {tab === "messages" && (
        <div className="space-y-6">
          <div className="rounded-lg border border-line bg-surface p-5">
            <h2 className="font-serif text-lg">Mon conseiller</h2>
            <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
              <Info label="Conseiller référent">{comp?.conseiller?.nom ?? "EJ Partners Assurances"}</Info>
              <Info label="E-mail">
                <a className="underline" href={`mailto:${comp?.conseiller?.email ?? "service.client@ej-assurances.fr"}`}>
                  {comp?.conseiller?.email ?? "service.client@ej-assurances.fr"}
                </a>
              </Info>
              <Info label="Téléphone">
                <a className="underline" href="tel:+33189314029">
                  {comp?.conseiller?.telephone ?? "01.89.31.40.29"}
                </a>
              </Info>
            </dl>
          </div>

          <div className="space-y-4 rounded-lg border border-line bg-surface p-5">
            <h2 className="font-serif text-lg">Messagerie</h2>
            {(comp?.messages ?? []).length === 0 ? (
              <p className="text-sm text-ink-muted">
                Aucun message pour l'instant. Écrivez-nous, votre conseiller vous répond sous 48 h ouvrées.
              </p>
            ) : (
              <ul className="space-y-3">
                {(comp?.messages ?? []).map((m) => (
                  <li
                    key={m.id}
                    className={
                      "rounded-lg border p-3 text-sm " +
                      (m.de_moi ? "border-line bg-background" : "border-emerald-200 bg-emerald-50")
                    }
                  >
                    <p className="text-xs text-ink-muted">
                      {m.de_moi ? "Vous" : "Votre conseiller"} · {new Date(m.created_at).toLocaleString("fr-FR")}
                    </p>
                    <p className="mt-1 whitespace-pre-line">{m.contenu}</p>
                  </li>
                ))}
              </ul>
            )}
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              placeholder="Votre message…"
              className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
            />
            <button
              onClick={envoyer}
              disabled={envoiMsg || message.trim().length < 2}
              className="rounded-full bg-ink px-5 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {envoiMsg ? "Envoi…" : "Envoyer mon message"}
            </button>
          </div>
        </div>
      )}

      {tab === "compte" && (
        <div className="space-y-4 rounded-lg border border-line bg-surface p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-serif text-lg">Mes informations</h2>
            {client && (
              <button
                onClick={() => setEdit((v) => !v)}
                className="rounded-full border border-line px-4 py-1.5 text-sm hover:bg-background"
              >
                {edit ? "Annuler" : "Modifier mes informations"}
              </button>
            )}
          </div>

          {!edit ? (
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <Info label="Nom">{client ? `${client.prenom ?? ""} ${client.nom}`.trim() : "—"}</Info>
              <Info label="Référence client">{client?.reference ?? "—"}</Info>
              <Info label="E-mail de connexion">{user?.email}</Info>
              <Info label="E-mail secondaire">{client?.email2 ?? "—"}</Info>
              <Info label="Mobile">{client?.mobile ?? "—"}</Info>
              <Info label="Téléphone fixe">{client?.telephone ?? "—"}</Info>
              <Info label="Adresse">
                {[client?.adresse, client?.complement_adresse, client?.code_postal, client?.ville, client?.pays]
                  .filter(Boolean)
                  .join(", ") || "—"}
              </Info>
              <Info label="Préférence de contact">{client?.preference_contact ?? "—"}</Info>
            </dl>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <Champ label="Civilité" value={form.civilite} onChange={(v) => setForm({ ...form, civilite: v })} />
              <Champ label="Prénom" value={form.prenom} onChange={(v) => setForm({ ...form, prenom: v })} />
              <Champ label="Nom" value={form.nom} onChange={(v) => setForm({ ...form, nom: v })} />
              <Champ
                label="E-mail secondaire"
                value={form.email2}
                onChange={(v) => setForm({ ...form, email2: v })}
              />
              <Champ label="Mobile" value={form.mobile} onChange={(v) => setForm({ ...form, mobile: v })} />
              <Champ
                label="Téléphone fixe"
                value={form.telephone}
                onChange={(v) => setForm({ ...form, telephone: v })}
              />
              <Champ label="Adresse" value={form.adresse} onChange={(v) => setForm({ ...form, adresse: v })} />
              <Champ
                label="Complément d'adresse"
                value={form.complement_adresse}
                onChange={(v) => setForm({ ...form, complement_adresse: v })}
              />
              <Champ
                label="Code postal"
                value={form.code_postal}
                onChange={(v) => setForm({ ...form, code_postal: v })}
              />
              <Champ label="Ville" value={form.ville} onChange={(v) => setForm({ ...form, ville: v })} />
              <Champ label="Pays" value={form.pays} onChange={(v) => setForm({ ...form, pays: v })} />
              <label className="block">
                <span className="mb-1 block text-xs uppercase tracking-wide text-ink-muted">
                  Préférence de contact
                </span>
                <select
                  value={form.preference_contact}
                  onChange={(e) => setForm({ ...form, preference_contact: e.target.value })}
                  className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
                >
                  <option value="">—</option>
                  <option value="email">E-mail</option>
                  <option value="telephone">Téléphone</option>
                  <option value="sms">SMS</option>
                </select>
              </label>
              <div className="sm:col-span-2">
                <button
                  onClick={enregistrer}
                  disabled={saving || form.nom.trim().length === 0}
                  className="rounded-full bg-ink px-5 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                >
                  {saving ? "Enregistrement…" : "Enregistrer"}
                </button>
              </div>
            </div>
          )}

          {savedMsg && <p className="text-xs text-emerald-700">{savedMsg}</p>}
          {saveErr && <p className="text-xs text-destructive">{saveErr}</p>}

          <p className="text-xs text-ink-muted">
            Votre e-mail de connexion et votre date de naissance ne sont pas modifiables ici : contactez votre
            conseiller.
          </p>
          <Link
            to="/espace/parametres"
            className="inline-block rounded-[var(--radius)] bg-[#0A192F] px-4 py-2 text-sm font-medium text-white"
          >
            Gérer mon mot de passe
          </Link>
        </div>
      )}
        </div>

        <SectionNav title="Mon espace" items={items} active={tab} onSelect={setTab} />
      </div>
    </div>

  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Champ({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs uppercase tracking-wide text-ink-muted">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
      />
    </label>
  );
}
