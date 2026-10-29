import { RemunerationContratCard } from "@/components/remuneration-contrat-card";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { synchroniserContactBrevoClient } from "@/lib/brevo-contact.functions";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { calculerEconomieEmprunteur, economieColumns } from "@/lib/economie-emprunteur";
import { CompagnieProduitPicker } from "@/components/compagnie-produit-picker";
import { CommissionContratCard } from "@/components/commission-contrat-card";
import { ContratDocumentsPanel } from "@/components/contrat-documents-panel";
import { PageHeader } from "@/components/page-header";
import { BoutonEnvoiEmail } from "@/components/envoi-rapide-email";
import { EmailsLiesPanel } from "@/components/emails-lies-panel";
import { StatCard } from "@/components/stat-card";
import { IconFileText } from "@tabler/icons-react";

export const Route = createFileRoute("/_authenticated/espace/contrats/$id")({
  head: () => ({
    meta: [
      { title: "Contrat et rémunération — EJ Assurances" },
      {
        name: "description",
        content: "Contrat, frais de distribution et commission compagnie prévisionnelle séparés.",
      },
      { property: "og:title", content: "Contrat et rémunération — EJ Assurances" },
      {
        property: "og:description",
        content: "Contrat, frais de distribution et commission compagnie prévisionnelle séparés.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ContratDetail,
});

type Contrat = {
  id: string;
  client_id: string;
  numero: string | null;
  assureur: string;
  produit: string;
  date_effet: string | null;
  date_echeance: string | null;
  duree_mois: number | null;
  prime_annuelle: number | null;
  prime_nette_annuelle: number | null;
  fractionnement: string;
  statut: string;
  notes: string | null;
  compagnie_id: string | null;
  produit_id: string | null;
  mandataire_id: string | null;
  prescripteur_id: string | null;
  mode_commissionnement: "precompte" | "lineaire" | "degressif";
  commission_cabinet_taux: number | null;
  is_emprunteur: boolean;
  capital_initial: number | null;
  taux_pret: number | null;
  taux_assurance_annuel: number | null;
  quotite: number | null;
  assiette: "capital_initial" | "capital_restant_du";
  economie_cout_groupe: number | null;
  economie_cout_delegue: number | null;
  economie_realisee: number | null;
  economie_calculee_le: string | null;
  prochain_suivi_le: string | null;
  dernier_suivi_le: string | null;
  recommandation_personnalisee: boolean | null;
};

type Echeance = {
  id: string;
  annee: number;
  date_debut_periode: string;
  date_fin_periode: string;
  capital_restant_du_debut: number | null;
  prime_periode: number;
  commission_cabinet_periode: number;
  commission_mandataire_periode: number;
  commission_prescripteur_periode: number;
  statut: string;
};

type Partenaire = { id: string; full_name: string | null; email: string | null; role: string };
type ClientLite = {
  id: string;
  nom: string;
  prenom: string | null;
  reference: string;
  date_naissance: string | null;
  fumeur: boolean | null;
  marque: string;
};

function ContratDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const { role, user } = useAuth();
  const canEdit = role === "admin" || role === "mandataire";
  const syncBrevo = useServerFn(synchroniserContactBrevoClient);

  const [c, setC] = useState<Contrat | null>(null);
  const [client, setClient] = useState<ClientLite | null>(null);
  const [ech, setEch] = useState<Echeance[]>([]);
  const [mandataires, setMandataires] = useState<Partenaire[]>([]);
  const [prescripteurs, setPrescripteurs] = useState<Partenaire[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /** Correction tracée d'un contrat verrouillé : motif obligatoire. */
  const [correctionMotif, setCorrectionMotif] = useState<string | null>(null);
  const [mode, setMode] = useState<
    "synthese" | "modifier" | "assures" | "frais" | "echeances" | "fichiers" | "emails" | "a_venir"
  >("synthese");
  const [ongletAVenir, setOngletAVenir] = useState<string>("");

  async function load() {
    setLoading(true);
    const [contrat, echeances, users, roles] = await Promise.all([
      supabase.from("contrats").select("*").eq("id", id).maybeSingle(),
      supabase.from("contrat_echeances").select("*").eq("contrat_id", id).order("annee"),
      supabase.from("profiles").select("id,full_name,email"),
      supabase.from("user_roles").select("user_id,role"),
    ]);
    if (contrat.error) setErr(contrat.error.message);
    const ct = contrat.data as Contrat | null;
    setC(ct);
    setEch((echeances.data as Echeance[]) ?? []);

    const roleMap = new Map<string, string[]>();
    for (const r of (roles.data as { user_id: string; role: string }[]) ?? []) {
      const arr = roleMap.get(r.user_id) ?? [];
      arr.push(r.role);
      roleMap.set(r.user_id, arr);
    }
    const profs = (users.data as Partenaire[]) ?? [];
    setMandataires(
      profs
        .filter((p) => roleMap.get(p.id)?.includes("mandataire"))
        .map((p) => ({ ...p, role: "mandataire" })),
    );
    setPrescripteurs(
      profs
        .filter((p) => roleMap.get(p.id)?.includes("prescripteur"))
        .map((p) => ({ ...p, role: "prescripteur" })),
    );

    if (ct) {
      const cl = await supabase
        .from("clients")
        .select("id,nom,prenom,reference,date_naissance,fumeur,marque")
        .eq("id", ct.client_id)
        .maybeSingle();
      setClient((cl.data as ClientLite | null) ?? null);
    }
    setLoading(false);
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  /** Économie figée : calculée quand un contrat emprunteur devient « signé ». */
  function economiePayload(force = false) {
    if (!c) return {};
    const signe = c.is_emprunteur && c.statut === "signe";
    if (!signe) {
      return c.economie_realisee !== null ? economieColumns(null) : {};
    }
    if (c.economie_realisee !== null && !force) return {};
    const res = calculerEconomieEmprunteur({
      capitalInitial: c.capital_initial,
      dureeMois: c.duree_mois,
      quotite: c.quotite,
      tauxAssuranceAnnuel: c.taux_assurance_annuel,
      dateNaissance: client?.date_naissance ?? null,
      fumeur: client?.fumeur ?? null,
      dateEffet: c.date_effet,
    });
    return res ? economieColumns(res) : {};
  }

  /** Statuts pour lesquels la compagnie a validé le contrat : données figées. */
  const STATUTS_VERROUILLES = ["actif", "contrat_actif", "contrat_valide"];

  async function save(forceEconomie = false) {
    if (!c) return;
    setSaving(true);
    setErr(null);

    // Contrat validé par la compagnie : la correction passe par l'action tracée
    // (motif obligatoire, journalisée avec l'avant/après).
    if (STATUTS_VERROUILLES.includes(c.statut) && correctionMotif !== null) {
      const { error: rpcErr } = await supabase.rpc("corriger_contrat_actif", {
        _contrat_id: c.id,
        _motif: correctionMotif,
        _champs: {
          numero: c.numero,
          assureur: c.assureur,
          produit: c.produit,
          compagnie_id: c.compagnie_id,
          produit_id: c.produit_id,
          date_effet: c.date_effet,
          date_echeance: c.date_echeance,
          duree_mois: c.duree_mois,
          prime_annuelle: c.prime_annuelle,
          prime_nette_annuelle: c.prime_nette_annuelle,
          fractionnement: c.fractionnement,
          statut: c.statut,
          notes: c.notes,
          mandataire_id: c.mandataire_id,
          prescripteur_id: c.prescripteur_id,
          mode_commissionnement: c.mode_commissionnement,
          commission_cabinet_taux: c.commission_cabinet_taux,
          is_emprunteur: c.is_emprunteur,
          capital_initial: c.capital_initial,
          taux_pret: c.taux_pret,
          taux_assurance_annuel: c.taux_assurance_annuel,
          quotite: c.quotite,
          assiette: c.assiette,
        },
      } as never);
      setSaving(false);
      if (rpcErr) return setErr(rpcErr.message);
      setCorrectionMotif(null);
      await load();
      return;
    }

    const { error } = await supabase
      .from("contrats")
      .update({
        numero: c.numero,
        assureur: c.assureur,
        produit: c.produit,
        date_effet: c.date_effet,
        date_echeance: c.date_echeance,
        duree_mois: c.duree_mois,
        prime_annuelle: c.prime_annuelle,
        prime_nette_annuelle: c.prime_nette_annuelle,
        fractionnement: c.fractionnement,
        statut: c.statut,
        notes: c.notes,
        compagnie_id: c.compagnie_id,
        produit_id: c.produit_id,
        mandataire_id: c.mandataire_id,
        prescripteur_id: c.prescripteur_id,
        mode_commissionnement: c.mode_commissionnement,
        commission_cabinet_taux: c.commission_cabinet_taux,
        is_emprunteur: c.is_emprunteur,
        capital_initial: c.capital_initial,
        taux_pret: c.taux_pret,
        taux_assurance_annuel: c.taux_assurance_annuel,
        quotite: c.quotite,
        assiette: c.assiette,
        recommandation_personnalisee: c.recommandation_personnalisee ?? false,
        ...economiePayload(forceEconomie),
      } as never)
      .eq("id", c.id);
    setSaving(false);
    if (error) return setErr(error.message);
    if (["actif", "contrat_actif", "contrat_valide"].includes(c.statut)) {
      void syncBrevo({ data: { client_id: c.client_id } }).catch((e) =>
        console.error("[brevo] synchro contact échouée", e),
      );
    }
    await load();
  }

  async function recalc() {
    const { error } = await supabase.rpc("recalculer_echeances_contrat", {
      _contrat_id: id,
    } as never);
    if (error) return setErr(error.message);
    await load();
  }

  async function del() {
    if (!c) return;
    if (!confirm("Supprimer ce contrat ?")) return;
    const clientId = c.client_id;
    const { error } = await supabase.from("contrats").delete().eq("id", c.id);
    if (error) return setErr(error.message);
    navigate({ to: "/espace/clients/$id", params: { id: clientId } });
  }

  if (loading) return <p className="text-sm text-ink-muted">Chargement…</p>;
  if (!c) return <p className="text-sm text-ink-muted">Contrat introuvable.</p>;

  const totaux = ech.reduce(
    (acc, e) => ({
      prime: acc.prime + Number(e.prime_periode),
      cabinet: acc.cabinet + Number(e.commission_cabinet_periode),
      mand: acc.mand + Number(e.commission_mandataire_periode),
      presc: acc.presc + Number(e.commission_prescripteur_periode),
    }),
    { prime: 0, cabinet: 0, mand: 0, presc: 0 },
  );

  const verrouille = STATUTS_VERROUILLES.includes(c.statut);
  const enCorrection = verrouille && correctionMotif !== null;
  const editable = canEdit && (!verrouille || enCorrection);
  const sorti = ["resilie", "annule", "cloture"].includes(c.statut);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={c.assureur}
        title={c.produit}
        description={c.is_emprunteur ? "Contrat d'assurance emprunteur" : "Contrat standard"}
        icon={IconFileText}
      >
        {client && (
          <Link
            to="/espace/clients/$id"
            params={{ id: client.id }}
            className="text-xs text-white/70 underline underline-offset-4 hover:text-white"
          >
            ← {client.prenom ? client.prenom + " " : ""}
            {client.nom} · {client.reference}
          </Link>
        )}
        {canEdit && (
          <BoutonEnvoiEmail
            type="contrat"
            id={c.id}
            className="inline-flex items-center gap-2 rounded-full border border-white/30 px-3 py-1.5 text-xs text-white hover:bg-white/10"
          />
        )}
        {canEdit && (
          <button
            onClick={recalc}
            className="rounded-full border border-white/30 px-3 py-1.5 text-xs text-white hover:bg-white/10"
          >
            Recalculer
          </button>
        )}
        {canEdit && role === "admin" && (
          <button
            onClick={del}
            className="text-xs text-red-300 underline underline-offset-4 hover:text-red-200"
          >
            Supprimer
          </button>
        )}
      </PageHeader>

      <div className="flex flex-wrap gap-1 border-b border-line">
        {(
          [
            { mode: "synthese", label: "Synthèse" },
            { mode: "modifier", label: "Modifier" },
            { mode: "assures", label: "Assurés" },
            { mode: "frais", label: "Frais & Commissionnement" },
            { mode: "echeances", label: "Échéances" },
            { mode: "fichiers", label: "Fichiers" },
            { mode: "emails", label: "E-mails" },
          ] as const
        ).map((t) => (
          <button
            key={t.mode}
            onClick={() => setMode(t.mode)}
            className={
              "rounded-t-md px-3 py-2 text-sm font-medium " +
              (mode === t.mode
                ? "border-b-2 border-[color:var(--crm-gold)] text-ink"
                : "text-ink-muted hover:text-ink")
            }
          >
            {t.label}
          </button>
        ))}
        {(
          [
            "Chargé d'affaire",
            "Tâche(s)",
            "Réaffectation client",
            "Gestion avenant",
            "Contrôle des pièces",
            "Compléments",
          ] as const
        ).map((label) => (
          <button
            key={label}
            onClick={() => {
              setOngletAVenir(label);
              setMode("a_venir");
            }}
            className={
              "rounded-t-md px-3 py-2 text-sm font-medium " +
              (mode === "a_venir" && ongletAVenir === label
                ? "border-b-2 border-[color:var(--crm-gold)] text-ink"
                : "text-ink-muted/60 hover:text-ink-muted")
            }
          >
            {label}
          </button>
        ))}
      </div>

      {err && <p className="rounded-md bg-red-50 p-3 text-sm text-red-800">{err}</p>}

      {mode === "a_venir" && (
        <div className="crm-card p-6 text-sm text-ink-muted">
          <p className="font-serif text-lg text-ink">{ongletAVenir}</p>
          <p className="mt-2">
            Onglet pas encore construit — pas de donnée propre à afficher pour l'instant.
          </p>
        </div>
      )}

      {mode === "synthese" && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-4">
            <StatCard
              label="Prime TTC actuelle"
              value={formatEuro(c.prime_annuelle)}
              icon={IconFileText}
              accent
            />
            <StatCard label="Fractionnement" value={c.fractionnement} />
            <StatCard
              label="Date d'effet"
              value={c.date_effet ? new Date(c.date_effet).toLocaleDateString("fr-FR") : "—"}
            />
            <StatCard label="Ancienneté" value={ancienneteLabel(c.date_effet)} />
          </div>

          {verrouille && (
            <section className="crm-card space-y-3 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-serif text-lg">Contrat validé par la compagnie</h3>
                  <p className="text-xs text-ink-muted">
                    Les données contractuelles sont verrouillées. Toute correction passe par une
                    action explicite et tracée (motif obligatoire, avant/après journalisé), réservée
                    à un administrateur.
                  </p>
                </div>
                {role === "admin" && !enCorrection && (
                  <button
                    onClick={() => setCorrectionMotif("")}
                    className="rounded-full border border-line px-4 py-2 text-xs font-medium hover:bg-surface"
                  >
                    Corriger ce contrat (tracé)
                  </button>
                )}
              </div>
              {enCorrection && (
                <div className="space-y-2 rounded-lg border border-dashed border-line p-3">
                  <label className="block text-xs font-medium text-ink-muted">
                    Motif de la correction (obligatoire, 5 caractères minimum)
                  </label>
                  <input
                    value={correctionMotif ?? ""}
                    onChange={(e) => setCorrectionMotif(e.target.value)}
                    placeholder="Ex. : numéro de contrat erroné communiqué par la compagnie"
                    className={inp}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => save()}
                      disabled={saving || (correctionMotif ?? "").trim().length < 5}
                      className="rounded-full bg-[#0A192F] px-4 py-2 text-xs font-medium text-white disabled:opacity-60"
                    >
                      {saving ? "Enregistrement…" : "Valider la correction tracée"}
                    </button>
                    <button
                      onClick={() => {
                        setCorrectionMotif(null);
                        void load();
                      }}
                      className="rounded-full border border-line px-4 py-2 text-xs hover:bg-surface"
                    >
                      Annuler
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <section className="crm-card space-y-3 p-5">
              <p className="crm-eyebrow">Contrat</p>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-ink-muted">Compagnie</p>
                  <p className="font-medium text-ink">{c.assureur}</p>
                </div>
                <div>
                  <p className="text-xs text-ink-muted">Produit</p>
                  <p className="font-medium text-ink">{c.produit}</p>
                </div>
                <div>
                  <p className="text-xs text-ink-muted">Référence</p>
                  <p className="font-medium text-ink">{c.numero ?? "Non renseignée"}</p>
                </div>
                <div>
                  <p className="text-xs text-ink-muted">Statut</p>
                  <p className="font-medium capitalize text-ink">{c.statut.replace(/_/g, " ")}</p>
                </div>
              </div>
            </section>
            <section className="crm-card space-y-3 p-5">
              <p className="crm-eyebrow">Finances</p>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-ink-muted">Prime totale annuelle</p>
                  <p className="font-medium text-ink">{formatEuro(c.prime_annuelle)}</p>
                </div>
                <div>
                  <p className="text-xs text-ink-muted">Prime nette annuelle</p>
                  <p className="font-medium text-ink">{formatEuro(c.prime_nette_annuelle)}</p>
                </div>
                <div>
                  <p className="text-xs text-ink-muted">Commission cabinet (cumul)</p>
                  <p className="font-medium text-ink">{formatEuro(totaux.cabinet)}</p>
                </div>
                <div>
                  <p className="text-xs text-ink-muted">Fractionnement</p>
                  <p className="font-medium text-ink">{c.fractionnement}</p>
                </div>
              </div>
            </section>
          </div>

          <CommissionContratCard
            dossierId={(c as unknown as { dossier_id: string | null }).dossier_id ?? null}
            isEmprunteur={c.is_emprunteur}
            compagnieId={c.compagnie_id}
            primeAnnuelle={c.prime_annuelle}
            primeNetteAnnuelle={c.prime_nette_annuelle}
            economieRealisee={c.economie_realisee}
          />

          <RemunerationContratCard
            dossierId={(c as unknown as { dossier_id: string | null }).dossier_id ?? null}
            contrat={{
              id: c.id,
              compagnie_id: c.compagnie_id,
              produit_id: c.produit_id,
              date_effet: c.date_effet,
              prime_annuelle: c.prime_annuelle,
              duree_mois: c.duree_mois,
              is_emprunteur: c.is_emprunteur,
              economie_realisee: c.economie_realisee,
              economie_cout_groupe: c.economie_cout_groupe,
              economie_cout_delegue: c.economie_cout_delegue,
            }}
          />
        </div>
      )}

      {mode === "assures" && (
        <section className="crm-card space-y-3 p-5">
          <p className="crm-eyebrow">Assuré</p>
          {client ? (
            <div className="grid gap-3 sm:grid-cols-2 text-sm">
              <div>
                <p className="text-xs text-ink-muted">Nom</p>
                <p className="font-medium text-ink">
                  {client.prenom ? client.prenom + " " : ""}
                  {client.nom}
                </p>
              </div>
              <div>
                <p className="text-xs text-ink-muted">Référence client</p>
                <p className="font-medium text-ink">{client.reference}</p>
              </div>
              <div>
                <p className="text-xs text-ink-muted">Date de naissance</p>
                <p className="font-medium text-ink">
                  {client.date_naissance
                    ? new Date(client.date_naissance).toLocaleDateString("fr-FR")
                    : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs text-ink-muted">Fumeur</p>
                <p className="font-medium text-ink">
                  {client.fumeur === null ? "—" : client.fumeur ? "Oui" : "Non"}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-ink-muted">Aucun client rattaché.</p>
          )}
          <p className="text-xs text-ink-muted">
            Cet onglet reste à construire pour les contrats à plusieurs assurés — un seul assuré (le
            client titulaire) est affiché pour l'instant.
          </p>
        </section>
      )}

      {mode === "modifier" && (
        <div className="space-y-6">
          <section className="crm-card grid gap-4 p-5 md:grid-cols-3">
            <F label="Type de contrat" wide>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={c.is_emprunteur}
                  disabled={!editable}
                  onChange={(e) => setC({ ...c, is_emprunteur: e.target.checked })}
                />
                Assurance emprunteur
              </label>
            </F>

            <div className="md:col-span-2 grid gap-4 md:grid-cols-2">
              <CompagnieProduitPicker
                branche={c.is_emprunteur ? "emprunteur" : null}
                compagnieId={c.compagnie_id}
                produitId={c.produit_id}
                disabled={!editable}
                onChange={(sel) =>
                  setC({
                    ...c,
                    compagnie_id: sel.compagnie_id,
                    produit_id: sel.produit_id,
                    assureur: sel.compagnie_nom ?? c.assureur,
                    produit: sel.produit_nom ?? c.produit,
                  })
                }
              />
            </div>
            <F label="Assureur (libellé enregistré)">
              <input value={c.assureur} readOnly className={`${inp} bg-background/60`} />
            </F>
            <F label="Nom du produit (libellé enregistré)">
              <input value={c.produit} readOnly className={`${inp} bg-background/60`} />
            </F>
            {!c.produit_id && (
              <p className="md:col-span-3 rounded-md bg-amber-50 p-2 text-xs text-amber-800">
                Produit non rattaché au référentiel — à compléter.
              </p>
            )}

            <F label="Numéro contrat">
              <input
                value={c.numero ?? ""}
                onChange={(e) => setC({ ...c, numero: e.target.value })}
                readOnly={!editable}
                className={inp}
              />
            </F>
            <F label="Date d'effet">
              <input
                type="date"
                value={c.date_effet ?? ""}
                onChange={(e) => setC({ ...c, date_effet: e.target.value || null })}
                readOnly={!editable}
                className={inp}
              />
            </F>
            <F label="Durée (mois)">
              <input
                type="number"
                value={c.duree_mois ?? ""}
                onChange={(e) =>
                  setC({ ...c, duree_mois: e.target.value ? Number(e.target.value) : null })
                }
                readOnly={!editable}
                className={inp}
              />
            </F>
            <F label="Statut">
              <select
                value={c.statut}
                onChange={(e) => setC({ ...c, statut: e.target.value })}
                disabled={!editable}
                className={inp}
              >
                <option value="en_cours">En cours</option>
                <option value="propose">Proposé</option>
                <option value="signe">Signé</option>
                <option value="contrat_valide">Validé par la compagnie</option>
                <option value="actif">Actif au portefeuille</option>
                <option value="resilie">Résilié</option>
                <option value="annule">Annulé</option>
              </select>
            </F>
          </section>

          <section className="crm-card grid gap-4 p-5 md:grid-cols-3">
            <div className="md:col-span-3">
              <h3 className="font-serif text-lg">Conseil dans la durée</h3>
              <p className="text-xs text-ink-muted">
                Le point de suivi périodique est envoyé automatiquement au client dès que la date
                est dépassée (regroupé avec ses autres contrats actifs).
              </p>
            </div>
            <F label="Prochain point de suivi">
              <input value={c.prochain_suivi_le ?? "—"} readOnly className={inp} />
            </F>
            <F label="Dernier point de suivi">
              <input value={c.dernier_suivi_le ?? "—"} readOnly className={inp} />
            </F>
            <F label="Recommandation personnalisée fournie">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={Boolean(c.recommandation_personnalisee)}
                  onChange={(e) => setC({ ...c, recommandation_personnalisee: e.target.checked })}
                  disabled={!editable}
                />
                <span className="text-ink-muted">Ramène le suivi épargne/retraite à 2 ans</span>
              </label>
            </F>
          </section>

          {editable && !verrouille && (
            <div className="flex justify-end">
              <button
                onClick={() => save()}
                disabled={saving}
                className="rounded-full bg-[#0A192F] px-5 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {saving ? "Enregistrement…" : "Enregistrer et recalculer"}
              </button>
            </div>
          )}
        </div>
      )}

      {mode === "frais" && (
        <div className="space-y-6">
          {c.is_emprunteur && (
            <section className="crm-card grid gap-4 p-5 md:grid-cols-3">
              <div className="md:col-span-3">
                <h3 className="font-serif text-lg">Paramètres du prêt et de l'assurance</h3>
                <p className="text-xs text-ink-muted">
                  Ces valeurs alimentent le calcul de la prime et de la commission pour chaque
                  année.
                </p>
              </div>
              <F label="Capital initial (€)">
                <input
                  type="number"
                  value={c.capital_initial ?? ""}
                  onChange={(e) =>
                    setC({ ...c, capital_initial: e.target.value ? Number(e.target.value) : null })
                  }
                  readOnly={!editable}
                  className={inp}
                />
              </F>
              <F label="Taux du prêt (déc. ex : 0.032)">
                <input
                  type="number"
                  step="0.0001"
                  value={c.taux_pret ?? ""}
                  onChange={(e) =>
                    setC({ ...c, taux_pret: e.target.value ? Number(e.target.value) : null })
                  }
                  readOnly={!editable}
                  className={inp}
                />
              </F>
              <F label="Taux assurance annuel (déc. ex : 0.0032)">
                <input
                  type="number"
                  step="0.0001"
                  value={c.taux_assurance_annuel ?? ""}
                  onChange={(e) =>
                    setC({
                      ...c,
                      taux_assurance_annuel: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                  readOnly={!editable}
                  className={inp}
                />
              </F>
              <F label="Quotité assurée (%)">
                <input
                  type="number"
                  step="1"
                  value={c.quotite ?? 100}
                  onChange={(e) =>
                    setC({ ...c, quotite: e.target.value ? Number(e.target.value) : null })
                  }
                  readOnly={!editable}
                  className={inp}
                />
              </F>
              <F label="Assiette de calcul">
                <select
                  value={c.assiette}
                  onChange={(e) => setC({ ...c, assiette: e.target.value as Contrat["assiette"] })}
                  disabled={!editable}
                  className={inp}
                >
                  <option value="capital_initial">Capital initial (bancaire)</option>
                  <option value="capital_restant_du">Capital restant dû (délégation)</option>
                </select>
              </F>

              <div className="md:col-span-3 rounded-lg border border-line bg-surface-elevated p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-semibold text-ink">
                      Économie réalisée pour le client
                    </h4>
                    <p className="text-xs text-ink-muted">
                      Figée automatiquement au passage du contrat au statut « Signé » (contrat
                      groupe bancaire vs délégation).
                    </p>
                  </div>
                  {editable && c.statut === "signe" && (
                    <button
                      onClick={() => save(true)}
                      disabled={saving}
                      className="rounded-md border border-line px-3 py-1.5 text-xs disabled:opacity-60"
                    >
                      Recalculer l'économie
                    </button>
                  )}
                </div>
                {c.economie_realisee === null ? (
                  <p className="mt-3 text-xs text-ink-muted">
                    {c.statut === "signe"
                      ? "Calcul impossible : renseignez le capital initial, la durée et la date de naissance du client."
                      : "Aucune économie figée — le contrat n'est pas encore signé."}
                  </p>
                ) : (
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <Stat
                      label="Coût contrat bancaire"
                      value={formatEuro(c.economie_cout_groupe)}
                    />
                    <Stat
                      label="Coût contrat délégué"
                      value={formatEuro(c.economie_cout_delegue)}
                    />
                    <Stat
                      label="Économie réalisée"
                      value={formatEuro(c.economie_realisee)}
                      accent
                    />
                    {c.economie_calculee_le && (
                      <p className="sm:col-span-3 text-xs text-ink-muted">
                        Calculée le {new Date(c.economie_calculee_le).toLocaleDateString("fr-FR")}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </section>
          )}

          {canEdit && (
            <section className="crm-card grid gap-4 p-5 md:grid-cols-3">
              <div className="md:col-span-3">
                <h3 className="font-serif text-lg">Commissionnement</h3>
                <p className="text-xs text-ink-muted">
                  La part cabinet calculée sur la prime utilise désormais la prime nette. La prime
                  totale reste conservée séparément pour le suivi du contrat. Les rétrocessions
                  mandataire/prescripteur suivent les règles configurées.
                </p>
              </div>
              <F label="Commission cabinet (part de la prime, ex : 0.15 pour 15 %)">
                <input
                  type="number"
                  step="0.0001"
                  value={c.commission_cabinet_taux ?? ""}
                  onChange={(e) =>
                    setC({
                      ...c,
                      commission_cabinet_taux: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                  readOnly={!editable}
                  className={inp}
                />
              </F>
              <F label="Mode de commissionnement">
                <select
                  value={c.mode_commissionnement}
                  onChange={(e) =>
                    setC({
                      ...c,
                      mode_commissionnement: e.target.value as Contrat["mode_commissionnement"],
                    })
                  }
                  disabled={!editable}
                  className={inp}
                >
                  <option value="lineaire">Linéaire (chaque année)</option>
                  <option value="degressif">Dégressif (emprunteur)</option>
                  <option value="precompte">Précompte (une fois)</option>
                </select>
              </F>
              <F
                label={
                  c.is_emprunteur
                    ? "Prime totale annuelle assureur (référence emprunteur)"
                    : "Prime totale annuelle"
                }
              >
                <input
                  type="number"
                  step="0.01"
                  value={c.prime_annuelle ?? ""}
                  onChange={(e) =>
                    setC({ ...c, prime_annuelle: e.target.value ? Number(e.target.value) : null })
                  }
                  readOnly={!editable}
                  className={inp}
                />
              </F>
              <F label="Prime nette annuelle (assiette des commissions)">
                <input
                  type="number"
                  step="0.01"
                  value={c.prime_nette_annuelle ?? ""}
                  onChange={(e) =>
                    setC({
                      ...c,
                      prime_nette_annuelle: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                  readOnly={!editable}
                  className={inp}
                />
              </F>
              <F label="Mandataire">
                <select
                  value={c.mandataire_id ?? ""}
                  onChange={(e) => setC({ ...c, mandataire_id: e.target.value || null })}
                  disabled={role !== "admin" || !editable}
                  className={inp}
                >
                  <option value="">— Aucun —</option>
                  {mandataires.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.full_name ?? m.email}
                    </option>
                  ))}
                </select>
              </F>
              <F label="Prescripteur">
                <select
                  value={c.prescripteur_id ?? ""}
                  onChange={(e) => setC({ ...c, prescripteur_id: e.target.value || null })}
                  disabled={role !== "admin" || !editable}
                  className={inp}
                >
                  <option value="">— Aucun —</option>
                  {prescripteurs.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.full_name ?? m.email}
                    </option>
                  ))}
                </select>
              </F>
              <F label="Notes">
                <textarea
                  value={c.notes ?? ""}
                  onChange={(e) => setC({ ...c, notes: e.target.value })}
                  readOnly={!editable}
                  rows={2}
                  className={inp}
                />
              </F>
            </section>
          )}

          {editable && !verrouille && (
            <div className="flex justify-end">
              <button
                onClick={() => save()}
                disabled={saving}
                className="rounded-full bg-[#0A192F] px-5 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {saving ? "Enregistrement…" : "Enregistrer et recalculer"}
              </button>
            </div>
          )}
        </div>
      )}

      {mode === "echeances" && (
        <section className="space-y-3 rounded-lg border border-line bg-surface p-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-serif text-lg">
                {sorti ? "Historique des appels de cotisation" : "Échéances calculées"}
              </h3>
              <p className="text-xs text-ink-muted">
                {sorti
                  ? "Contrat sorti du portefeuille : les appels de cotisation et commissions déjà émis avant la résiliation sont conservés en l'état, sans recalcul."
                  : "Prime totale et commissions année par année. Les commissions sont calculées sur la prime nette lorsque la règle est assise sur la prime."}
              </p>
            </div>
            <div className="text-right text-xs text-ink-muted">
              {ech.length} année{ech.length > 1 ? "s" : ""} · Cabinet total :{" "}
              {formatEuro(totaux.cabinet)}
            </div>
          </div>

          {ech.length === 0 ? (
            <p className="text-sm text-ink-muted">
              Renseignez la date d'effet et la durée pour générer les échéances.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-line bg-background">
              <table className="w-full text-sm">
                <thead className="bg-surface text-xs uppercase tracking-wide text-ink-muted">
                  <tr>
                    <th className="px-3 py-2 text-left">Année</th>
                    <th className="px-3 py-2 text-left">Période</th>
                    <th className="px-3 py-2 text-right">CRD début</th>
                    <th className="px-3 py-2 text-right">Prime totale</th>
                    <th className="px-3 py-2 text-right">Cabinet</th>
                    {role === "admin" && <th className="px-3 py-2 text-right">Mandataire</th>}
                    {role === "admin" && <th className="px-3 py-2 text-right">Prescripteur</th>}
                    <th className="px-3 py-2 text-left">Statut</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {ech.map((e) => (
                    <tr key={e.id}>
                      <td className="px-3 py-2">{e.annee}</td>
                      <td className="px-3 py-2 text-xs text-ink-muted">
                        {new Date(e.date_debut_periode).toLocaleDateString("fr-FR")} →{" "}
                        {new Date(e.date_fin_periode).toLocaleDateString("fr-FR")}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {formatEuro(e.capital_restant_du_debut)}
                      </td>
                      <td className="px-3 py-2 text-right font-medium">
                        {formatEuro(e.prime_periode)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {formatEuro(e.commission_cabinet_periode)}
                      </td>
                      {role === "admin" && (
                        <td className="px-3 py-2 text-right">
                          {formatEuro(e.commission_mandataire_periode)}
                        </td>
                      )}
                      {role === "admin" && (
                        <td className="px-3 py-2 text-right">
                          {formatEuro(e.commission_prescripteur_periode)}
                        </td>
                      )}
                      <td className="px-3 py-2 text-xs">
                        <span className="rounded-full bg-surface px-2 py-0.5">{e.statut}</span>
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-surface font-medium">
                    <td className="px-3 py-2" colSpan={3}>
                      Total
                    </td>
                    <td className="px-3 py-2 text-right">{formatEuro(totaux.prime)}</td>
                    <td className="px-3 py-2 text-right">{formatEuro(totaux.cabinet)}</td>
                    {role === "admin" && (
                      <td className="px-3 py-2 text-right">{formatEuro(totaux.mand)}</td>
                    )}
                    {role === "admin" && (
                      <td className="px-3 py-2 text-right">{formatEuro(totaux.presc)}</td>
                    )}
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {mode === "fichiers" && user && (
        <ContratDocumentsPanel
          contratId={c.id}
          clientId={c.client_id}
          userId={user.id}
          canEdit={canEdit}
          produitId={c.produit_id}
          compagnieId={c.compagnie_id}
          onPrimeUpdated={load}
        />
      )}

      {mode === "emails" && (
        <EmailsLiesPanel liens={{ client_id: c.client_id, contrat_id: c.id }} />
      )}
    </div>
  );
}

const inp = "w-full rounded-md border border-line bg-background px-3 py-2 text-sm";

function F({
  label,
  wide,
  children,
}: {
  label: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={wide ? "md:col-span-3" : ""}>
      <label className="mb-1 block text-xs font-medium text-ink-muted">{label}</label>
      {children}
    </div>
  );
}

/** Ancienneté (ou délai avant effet) sous forme "X an(s), Y mois, Z jour(s)", sur le modèle Courtigo. */
function ancienneteLabel(dateEffet: string | null): string {
  if (!dateEffet) return "—";
  const effet = new Date(dateEffet);
  const maintenant = new Date();
  const passe = effet <= maintenant;
  const [debut, fin] = passe ? [effet, maintenant] : [maintenant, effet];

  let annees = fin.getFullYear() - debut.getFullYear();
  let mois = fin.getMonth() - debut.getMonth();
  let jours = fin.getDate() - debut.getDate();
  if (jours < 0) {
    mois -= 1;
    jours += new Date(fin.getFullYear(), fin.getMonth(), 0).getDate();
  }
  if (mois < 0) {
    annees -= 1;
    mois += 12;
  }
  const duree = `${annees} an(s), ${mois} mois, ${jours} jour(s)`;
  return passe ? duree : `Prend effet dans ${duree}`;
}

function formatEuro(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2,
  }).format(Number(n));
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={"crm-card p-3 " + (accent ? "crm-card-accent" : "")}>
      <p className="crm-eyebrow">{label}</p>
      <p
        className={
          "crm-figure mt-1 text-lg " + (accent ? "text-[color:var(--crm-gold-muted)]" : "text-ink")
        }
      >
        {value}
      </p>
    </div>
  );
}
