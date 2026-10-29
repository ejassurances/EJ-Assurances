import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { importerFactureFichier } from "@/lib/factures-achat.functions";

import { dansExerciceComptable, PREMIER_EXERCICE } from "@/lib/exercice";
type Compte = { numero: string; libelle: string; classe: number };
type Exercice = { id: string; libelle: string; date_debut: string; date_fin: string; cloture: boolean };
type Facture = {
  id: string;
  fournisseur: string;
  numero_facture: string | null;
  date_facture: string;
  date_echeance: string | null;
  montant_ht: number;
  montant_tva: number;
  montant_ttc: number;
  compte_charge: string;
  compte_tva: string;
  statut: "a_payer" | "payee" | "annulee";
  date_paiement: string | null;
  moyen_paiement: string | null;
  notes: string | null;
  fichier_path: string | null;
  fichier_nom: string | null;
  ecriture_id: string | null;
  abonnement_sans_fin?: boolean;
};

const fmt = (n: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 2 }).format(n);

const STATUT_LABEL: Record<Facture["statut"], string> = {
  a_payer: "À payer",
  payee: "Payée",
  annulee: "Annulée",
};

const statutClass = (s: Facture["statut"]) =>
  s === "payee"
    ? "bg-emerald-100 text-emerald-800"
    : s === "annulee"
      ? "bg-neutral-200 text-neutral-700"
      : "bg-amber-100 text-amber-800";

const COMPTE_FOURNISSEURS = "401000";

export function FacturesAchatTab() {
  const { user } = useAuth();
  const [comptes, setComptes] = useState<Compte[]>([]);
  const [exercices, setExercices] = useState<Exercice[]>([]);
  const [rows, setRows] = useState<Facture[]>([]);
  const [filtre, setFiltre] = useState<"toutes" | Facture["statut"]>("toutes");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const [{ data: pc }, { data: ex }, { data: f }] = await Promise.all([
      supabase.from("plan_comptable").select("numero, libelle, classe").eq("actif", true).order("numero"),
      supabase.from("exercices").select("*").eq("cloture", false).order("date_debut", { ascending: false }),
      supabase.from("factures_achat").select("*").order("date_facture", { ascending: false }),
    ]);
    setComptes((pc as Compte[]) ?? []);
    setExercices((ex as Exercice[]) ?? []);
    setRows((f as Facture[]) ?? []);
    setLoading(false);
  };
  useEffect(() => {
    load();
  }, []);

  const affichees = useMemo(
    () => rows.filter((r) => filtre === "toutes" || r.statut === filtre),
    [rows, filtre],
  );

  const totaux = useMemo(() => {
    const aPayer = rows.filter((r) => r.statut === "a_payer");
    return {
      aPayerTtc: aPayer.reduce((s, r) => s + Number(r.montant_ttc), 0),
      nbAPayer: aPayer.length,
      annuelHt: rows
        .filter((r) => r.statut !== "annulee" && new Date(r.date_facture).getFullYear() === new Date().getFullYear())
        .reduce((s, r) => s + Number(r.montant_ht), 0),
      tvaDeductible: rows
        .filter((r) => r.statut !== "annulee")
        .reduce((s, r) => s + Number(r.montant_tva), 0),
    };
  }, [rows]);

  /* --- Génération de l'écriture comptable (journal AC) --- */
  const genererEcriture = async (f: Facture) => {
    if (f.ecriture_id) return;
    // Premier exercice comptable du cabinet : 2026. Rien d'antérieur n'est comptabilisé.
    if (!dansExerciceComptable(f.date_facture)) {
      toast.error(
        `Facture antérieure au premier exercice (${PREMIER_EXERCICE}) : elle n'entre pas en comptabilité.`,
      );
      return;
    }
    const exercice = exercices.find((e) => f.date_facture >= e.date_debut && f.date_facture <= e.date_fin) ?? exercices[0];

    if (!exercice) {
      toast.error("Aucun exercice ouvert pour cette date de facture.");
      return;
    }
    const { data: ec, error: eErr } = await supabase
      .from("ecritures")
      .insert({
        exercice_id: exercice.id,
        journal_code: "AC",
        date_ecriture: f.date_facture,
        numero_piece: f.numero_facture,
        libelle: `Facture ${f.fournisseur}${f.numero_facture ? ` n°${f.numero_facture}` : ""}`,
        statut: "brouillon",
        source: "facture_achat",
      })
      .select("id")
      .single();
    if (eErr || !ec) {
      toast.error(eErr?.message ?? "Erreur lors de la création de l'écriture.");
      return;
    }
    const lignes: {
      ecriture_id: string;
      numero_ligne: number;
      compte_numero: string;
      libelle: string;
      debit: number;
      credit: number;
    }[] = [
      {
        ecriture_id: ec.id,
        numero_ligne: 1,
        compte_numero: f.compte_charge,
        libelle: `Achat ${f.fournisseur}`,
        debit: Number(f.montant_ht),
        credit: 0,
      },
    ];
    if (Number(f.montant_tva) > 0) {
      lignes.push({
        ecriture_id: ec.id,
        numero_ligne: 2,
        compte_numero: f.compte_tva,
        libelle: "TVA déductible",
        debit: Number(f.montant_tva),
        credit: 0,
      });
    }
    lignes.push({
      ecriture_id: ec.id,
      numero_ligne: lignes.length + 1,
      compte_numero: COMPTE_FOURNISSEURS,
      libelle: f.fournisseur,
      debit: 0,
      credit: Number(f.montant_ttc),
    });
    const { error: lErr } = await supabase.from("ecritures_lignes").insert(lignes);
    if (lErr) {
      toast.error(lErr.message);
      return;
    }
    const { error: vErr } = await supabase.from("ecritures").update({ statut: "valide" }).eq("id", ec.id);
    if (vErr) {
      toast.error(vErr.message);
      return;
    }
    await supabase.from("factures_achat").update({ ecriture_id: ec.id }).eq("id", f.id);
    toast.success("Écriture comptable générée (journal Achats).");
    load();
  };

  const marquerPayee = async (f: Facture) => {
    const { error } = await supabase
      .from("factures_achat")
      .update({ statut: "payee", date_paiement: new Date().toISOString().slice(0, 10) })
      .eq("id", f.id);
    if (error) return toast.error(error.message);
    toast.success("Facture marquée payée.");
    load();
  };

  const annuler = async (f: Facture) => {
    const { error } = await supabase.from("factures_achat").update({ statut: "annulee" }).eq("id", f.id);
    if (error) return toast.error(error.message);
    load();
  };

  const ouvrirFichier = async (f: Facture) => {
    if (!f.fichier_path) return;
    const { data, error } = await supabase.storage.from("factures-achat").createSignedUrl(f.fichier_path, 300);
    if (error || !data) return toast.error("Justificatif introuvable.");
    window.open(data.signedUrl, "_blank", "noopener");
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Restant à payer" value={fmt(totaux.aPayerTtc)} hint={`${totaux.nbAPayer} facture(s)`} />
        <Kpi label="Charges HT (année)" value={fmt(totaux.annuelHt)} />
        <Kpi label="TVA déductible" value={fmt(totaux.tvaDeductible)} />
        <Kpi label="Factures enregistrées" value={String(rows.length)} />
      </div>

      <ImportPdfFactures onDone={load} />

      <NouvelleFacture
        comptes={comptes}
        userId={user?.id ?? null}
        onCreated={async (facture) => {
          if (facture) await genererEcriture(facture);
          load();
        }}
      />

      <div className="flex flex-wrap items-center gap-3">
        <Select value={filtre} onValueChange={(v) => setFiltre(v as typeof filtre)}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="toutes">Toutes les factures</SelectItem>
            <SelectItem value="a_payer">À payer</SelectItem>
            <SelectItem value="payee">Payées</SelectItem>
            <SelectItem value="annulee">Annulées</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-ink-muted">{affichees.length} ligne(s)</span>
      </div>

      <div className="overflow-x-auto crm-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Fournisseur</TableHead>
              <TableHead>N° pièce</TableHead>
              <TableHead>Compte</TableHead>
              <TableHead className="text-right">HT</TableHead>
              <TableHead className="text-right">TVA</TableHead>
              <TableHead className="text-right">TTC</TableHead>
              <TableHead>Échéance</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {affichees.map((f) => (
              <TableRow key={f.id}>
                <TableCell className="whitespace-nowrap text-sm">
                  {new Date(f.date_facture).toLocaleDateString("fr-FR")}
                </TableCell>
                <TableCell className="text-sm font-medium">{f.fournisseur}</TableCell>
                <TableCell className="font-mono text-xs">{f.numero_facture ?? "—"}</TableCell>
                <TableCell className="font-mono text-xs">{f.compte_charge}</TableCell>
                <TableCell className="text-right text-sm">{fmt(Number(f.montant_ht))}</TableCell>
                <TableCell className="text-right text-sm">{fmt(Number(f.montant_tva))}</TableCell>
                <TableCell className="text-right text-sm font-medium">{fmt(Number(f.montant_ttc))}</TableCell>
                <TableCell className="whitespace-nowrap text-xs text-ink-muted">
                  {f.date_echeance ? new Date(f.date_echeance).toLocaleDateString("fr-FR") : "—"}
                </TableCell>
                <TableCell className="text-xs">{f.abonnement_sans_fin ? "Abonnement mensuel" : "Ponctuelle"}</TableCell>
                <TableCell>
                  <span className={"rounded-full px-2 py-0.5 text-xs " + statutClass(f.statut)}>
                    {STATUT_LABEL[f.statut]}
                  </span>
                  {f.ecriture_id && <span className="ml-1 text-[10px] text-ink-muted">· comptabilisée</span>}
                </TableCell>
                <TableCell className="space-x-1 whitespace-nowrap text-right">
                  {f.fichier_path && (
                    <Button size="sm" variant="ghost" onClick={() => ouvrirFichier(f)}>
                      PDF
                    </Button>
                  )}
                  {!f.ecriture_id && f.statut !== "annulee" && (
                    <Button size="sm" variant="outline" onClick={() => genererEcriture(f)}>
                      Comptabiliser
                    </Button>
                  )}
                  {f.statut === "a_payer" && (
                    <Button size="sm" variant="outline" onClick={() => marquerPayee(f)}>
                      Payée
                    </Button>
                  )}
                  {f.statut !== "annulee" && (
                    <Button size="sm" variant="ghost" onClick={() => annuler(f)}>
                      Annuler
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {!loading && affichees.length === 0 && (
              <TableRow>
                <TableCell colSpan={11} className="py-8 text-center text-sm text-ink-muted">
                  Aucune facture enregistrée.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/* --- Import multi-PDF avec lecture IA et affectation comptable --- */
function ImportPdfFactures({ onDone }: { onDone: () => void }) {
  const importer = useServerFn(importerFactureFichier);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ fait: number; total: number }>({ fait: 0, total: 0 });
  const [resultats, setResultats] = useState<
    { nom: string; ok: boolean; message: string }[]
  >([]);

  const lireBase64 = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result).split(",")[1] ?? "");
      fr.onerror = () => reject(new Error("Lecture du fichier impossible"));
      fr.readAsDataURL(file);
    });

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const liste = Array.from(files);
    setBusy(true);
    setResultats([]);
    setProgress({ fait: 0, total: liste.length });
    const out: { nom: string; ok: boolean; message: string }[] = [];
    for (const file of liste) {
      try {
        if (file.size > 12 * 1024 * 1024) throw new Error("Fichier trop volumineux (max 12 Mo).");
        const base64 = await lireBase64(file);
        const r = await importer({
          data: { nom_fichier: file.name, mime: file.type || "application/pdf", base64 },
        });
        out.push({
          nom: file.name,
          ok: true,
          message: `${r.fournisseur} — ${fmt(Number(r.montant_ttc))}${r.compte_charge ? ` — compte ${r.compte_charge}` : " — compte à préciser"}${r.avertissement ? ` (${r.avertissement})` : ""}`,
        });
      } catch (e) {
        out.push({ nom: file.name, ok: false, message: e instanceof Error ? e.message : "Import impossible" });
      }
      setProgress((p) => ({ ...p, fait: p.fait + 1 }));
      setResultats([...out]);
    }
    setBusy(false);
    const ok = out.filter((r) => r.ok).length;
    if (ok > 0) toast.success(`${ok} facture(s) importée(s) et pré-affectée(s) au plan comptable.`);
    if (ok < out.length) toast.error(`${out.length - ok} fichier(s) en échec.`);
    onDone();
  };

  return (
    <div className="crm-card p-5">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-ink">Import de factures PDF (lecture IA)</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Déposez un ou plusieurs PDF : l'IA lit le fournisseur, les montants, la TVA et propose le compte de charge du
        plan comptable. Les montants restent modifiables avant génération de l'écriture.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Input
          type="file"
          multiple
          accept="application/pdf,image/png,image/jpeg"
          disabled={busy}
          className="max-w-sm"
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
        {busy && (
          <span className="text-sm text-muted-foreground">
            Analyse en cours… {progress.fait}/{progress.total}
          </span>
        )}
      </div>
      {resultats.length > 0 && (
        <ul className="mt-4 space-y-1 text-sm">
          {resultats.map((r) => (
            <li key={r.nom} className={r.ok ? "text-emerald-700" : "text-destructive"}>
              <span className="font-medium">{r.nom}</span> — {r.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="crm-card p-5">
      <p className="crm-eyebrow">{label}</p>
      <p className="crm-figure mt-2 text-2xl">{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-muted">{hint}</p>}
    </div>
  );
}

/* ================================================================
   FORMULAIRE — NOUVELLE FACTURE D'ACHAT
================================================================ */
function NouvelleFacture({
  comptes,
  userId,
  onCreated,
}: {
  comptes: Compte[];
  userId: string | null;
  onCreated: (facture?: Facture | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fichier, setFichier] = useState<File | null>(null);
  const [form, setForm] = useState({
    fournisseur: "",
    numero_facture: "",
    date_facture: new Date().toISOString().slice(0, 10),
    date_echeance: "",
    montant_ht: "",
    taux_tva: "20",
    compte_charge: "606800",
    moyen_paiement: "",
    notes: "",
    abonnement_sans_fin: false,
  });

  const comptesCharge = comptes.filter((c) => c.classe === 6);
  const ht = Number(form.montant_ht || 0);
  const tva = Math.round(ht * (Number(form.taux_tva || 0) / 100) * 100) / 100;
  const ttc = Math.round((ht + tva) * 100) / 100;

  const reset = () => {
    setForm({
      fournisseur: "",
      numero_facture: "",
      date_facture: new Date().toISOString().slice(0, 10),
      date_echeance: "",
      montant_ht: "",
      taux_tva: "20",
      compte_charge: "606800",
      moyen_paiement: "",
      notes: "",
      abonnement_sans_fin: false,
    });
    setFichier(null);
  };

  const save = async () => {
    if (!form.fournisseur.trim() || ht <= 0) {
      toast.error("Fournisseur et montant HT obligatoires.");
      return;
    }
    setSaving(true);
    let fichier_path: string | null = null;
    if (fichier) {
      const ext = fichier.name.split(".").pop() ?? "pdf";
      const path = `${userId ?? "cabinet"}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("factures-achat").upload(path, fichier);
      if (upErr) {
        toast.error("Envoi du justificatif impossible : " + upErr.message);
        setSaving(false);
        return;
      }
      fichier_path = path;
    }
    const { data: created, error } = await supabase
      .from("factures_achat")
      .insert({
        fournisseur: form.fournisseur.trim(),
        numero_facture: form.numero_facture || null,
        date_facture: form.date_facture,
        date_echeance: form.date_echeance || null,
        montant_ht: ht,
        montant_tva: tva,
        montant_ttc: ttc,
        compte_charge: form.compte_charge,
        moyen_paiement: form.moyen_paiement || null,
        notes: form.notes || null,
        abonnement_sans_fin: form.abonnement_sans_fin,
        fichier_path,
        fichier_nom: fichier?.name ?? null,
      })
      .select("*")
      .single();
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Facture enregistrée.");
    reset();
    setOpen(false);
    onCreated(created as Facture | null);

  };

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>Ajouter une facture d'achat</Button>
    );
  }

  return (
    <div className="crm-card p-5">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-ink">Nouvelle facture d'achat</h3>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <Field label="Fournisseur *">
          <Input value={form.fournisseur} onChange={(e) => setForm({ ...form, fournisseur: e.target.value })} />
        </Field>
        <Field label="N° de facture">
          <Input value={form.numero_facture} onChange={(e) => setForm({ ...form, numero_facture: e.target.value })} />
        </Field>
        <Field label="Compte de charge">
          <Select value={form.compte_charge} onValueChange={(v) => setForm({ ...form, compte_charge: v })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {comptesCharge.map((c) => (
                <SelectItem key={c.numero} value={c.numero}>
                  {c.numero} — {c.libelle}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Date de facture">
          <Input
            type="date"
            value={form.date_facture}
            onChange={(e) => setForm({ ...form, date_facture: e.target.value })}
          />
        </Field>
        <Field label="Échéance">
          <Input
            type="date"
            value={form.date_echeance}
            onChange={(e) => setForm({ ...form, date_echeance: e.target.value })}
          />
        </Field>
        <Field label="Abonnement mensuel sans date de fin">
          <label className="flex min-h-10 items-center gap-2 rounded-md border border-line px-3 text-sm">
            <input type="checkbox" checked={form.abonnement_sans_fin} onChange={(e) => setForm({ ...form, abonnement_sans_fin: e.target.checked })} />
            Répéter chaque mois dans le prévisionnel
          </label>
        </Field>
        <Field label="Moyen de paiement">
          <Input
            placeholder="Virement, prélèvement, CB…"
            value={form.moyen_paiement}
            onChange={(e) => setForm({ ...form, moyen_paiement: e.target.value })}
          />
        </Field>
        <Field label="Montant HT *">
          <Input
            type="number"
            step="0.01"
            value={form.montant_ht}
            onChange={(e) => setForm({ ...form, montant_ht: e.target.value })}
          />
        </Field>
        <Field label="Taux de TVA (%)">
          <Select value={form.taux_tva} onValueChange={(v) => setForm({ ...form, taux_tva: v })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">0 % (exonéré)</SelectItem>
              <SelectItem value="5.5">5,5 %</SelectItem>
              <SelectItem value="10">10 %</SelectItem>
              <SelectItem value="20">20 %</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Total">
          <div className="rounded-md border border-line bg-surface px-3 py-2 text-sm">
            TVA {fmt(tva)} · <span className="font-medium">TTC {fmt(ttc)}</span>
          </div>
        </Field>
        <Field label="Justificatif (PDF, image)">
          <Input
            type="file"
            accept="application/pdf,image/*"
            onChange={(e) => setFichier(e.target.files?.[0] ?? null)}
          />
        </Field>
        <div className="md:col-span-2">
          <Field label="Notes">
            <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <Button onClick={save} disabled={saving}>
          {saving ? "Enregistrement…" : "Enregistrer la facture"}
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            reset();
            setOpen(false);
          }}
        >
          Annuler
        </Button>
      </div>
      <p className="mt-3 text-xs text-ink-muted">
        À l'enregistrement, l'écriture comptable est générée automatiquement dans le journal Achats : compte de charge
        au débit, TVA déductible (445660) au débit, fournisseur (401000) au crédit.
      </p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ink-soft">{label}</span>
      {children}
    </label>
  );
}
