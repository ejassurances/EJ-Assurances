import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Obligation = {
  id: string; code: string | null; niveau: string; domaine: string; libelle: string;
  description: string | null; periodicite: string | null; preuve_attendue: string | null;
  reference_url: string | null; action_requise: string | null; preuve_reference: string | null;
  responsable: string | null; statut: string; prochaine_echeance: string | null;
  derniere_revue: string | null;
};
type Action = {
  id: string; obligation_id: string | null; titre: string; description: string | null;
  priorite: string; statut: string; responsable: string | null; echeance: string | null;
  preuve_reference: string | null; resolution: string | null; created_at: string;
};
const STATUTS = [
  { value: "a_definir", label: "À vérifier" },
  { value: "a_mettre_en_place", label: "À mettre en place" },
  { value: "en_place", label: "En place — à prouver" },
  { value: "conforme", label: "Vérifié conforme" },
  { value: "non_conforme", label: "Non conforme" },
  { value: "non_applicable", label: "Non applicable — à justifier" },
];
const ACTION_STATUTS = [
  { value: "a_faire", label: "À faire" },
  { value: "en_cours", label: "En cours" },
  { value: "en_attente", label: "En attente" },
  { value: "terminee", label: "Terminée" },
  { value: "annulee", label: "Annulée" },
];
const PRIORITES = [
  { value: "basse", label: "Basse" },
  { value: "normale", label: "Normale" },
  { value: "haute", label: "Haute" },
  { value: "critique", label: "Critique" },
];
const dateFr = (value: string | null | undefined) => value ? new Date(value).toLocaleDateString("fr-FR") : "—";

export function RegistreConformiteCabinetPanel() {
  const { user } = useAuth();
  const [obligations, setObligations] = useState<Obligation[]>([]);
  const [actions, setActions] = useState<Action[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtre, setFiltre] = useState("a_traiter");
  const [saving, setSaving] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, Partial<Obligation>>>({});
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newObligation, setNewObligation] = useState("aucune");
  const [newPriority, setNewPriority] = useState("haute");
  const [newResponsible, setNewResponsible] = useState("");
  const [newDue, setNewDue] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: o, error: oe }, { data: a, error: ae }] = await Promise.all([
      supabase.from("conformite_obligations")
        .select("id,code,niveau,domaine,libelle,description,periodicite,preuve_attendue,reference_url,action_requise,preuve_reference,responsable,statut,prochaine_echeance,derniere_revue")
        .order("domaine").order("libelle"),
      supabase.from("conformite_actions")
        .select("id,obligation_id,titre,description,priorite,statut,responsable,echeance,preuve_reference,resolution,created_at")
        .order("created_at", { ascending: false }),
    ]);
    if (oe) toast.error("Chargement des obligations impossible : " + oe.message);
    if (ae) toast.error("Chargement des actions impossible : " + ae.message);
    setObligations((o as Obligation[]) ?? []);
    setActions((a as Action[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const stats = useMemo(() => ({
    total: obligations.length,
    aVerifier: obligations.filter(o => ["a_definir", "a_mettre_en_place", "en_place", "non_conforme"].includes((edits[o.id]?.statut as string) ?? o.statut)).length,
    conformes: obligations.filter(o => ((edits[o.id]?.statut as string) ?? o.statut) === "conforme").length,
    actionsOuvertes: actions.filter(a => !["terminee", "annulee"].includes(a.statut)).length,
    enRetard: actions.filter(a => a.echeance && a.echeance < new Date().toISOString().slice(0, 10) && !["terminee", "annulee"].includes(a.statut)).length,
  }), [obligations, actions, edits]);

  const filtered = obligations.filter(o => {
    const status = (edits[o.id]?.statut as string) ?? o.statut;
    return filtre === "toutes" || (filtre === "a_traiter" && status !== "conforme" && status !== "non_applicable") || status === filtre;
  });

  const saveObligation = async (o: Obligation) => {
    const edit = edits[o.id] ?? {};
    setSaving(o.id);
    const patch = {
      statut: edit.statut ?? o.statut,
      responsable: edit.responsable !== undefined ? edit.responsable : o.responsable,
      prochaine_echeance: edit.prochaine_echeance !== undefined ? edit.prochaine_echeance || null : o.prochaine_echeance,
      action_requise: edit.action_requise !== undefined ? edit.action_requise : o.action_requise,
      preuve_reference: edit.preuve_reference !== undefined ? edit.preuve_reference : o.preuve_reference,
      derniere_revue: new Date().toISOString().slice(0, 10),
      mis_a_jour_par: user?.id ?? null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("conformite_obligations").update(patch as never).eq("id", o.id);
    setSaving(null);
    if (error) { toast.error(error.message); return; }
    toast.success("Obligation mise à jour.");
    setEdits(prev => { const next = { ...prev }; delete next[o.id]; return next; });
    await load();
  };

  const createAction = async () => {
    if (!newTitle.trim()) { toast.error("Le titre de l'action est obligatoire."); return; }
    setCreating(true);
    const { error } = await supabase.from("conformite_actions").insert({
      obligation_id: newObligation === "aucune" ? null : newObligation,
      titre: newTitle.trim(),
      description: newDescription.trim() || null,
      priorite: newPriority,
      statut: "a_faire",
      responsable: newResponsible.trim() || null,
      echeance: newDue || null,
      cree_par: user?.id ?? null,
    } as never);
    setCreating(false);
    if (error) { toast.error(error.message); return; }
    setNewTitle(""); setNewDescription(""); setNewObligation("aucune"); setNewPriority("haute"); setNewResponsible(""); setNewDue("");
    toast.success("Action ajoutée au registre de conformité.");
    await load();
  };

  const updateAction = async (id: string, patch: Partial<Action>) => {
    const payload: Record<string, unknown> = { ...patch, updated_at: new Date().toISOString() };
    if (patch.statut === "terminee") payload.cloture_le = new Date().toISOString();
    const { error } = await supabase.from("conformite_actions").update(payload as never).eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Action mise à jour.");
    await load();
  };

  return (
    <div className="space-y-6">
      <div className="crm-card p-5">
        <p className="crm-eyebrow">Référentiel de contrôle du cabinet</p>
        <h3 className="mt-1 font-serif text-xl">Registre de conformité ACPR / DDA</h3>
        <p className="mt-2 max-w-4xl text-sm text-ink-muted">
          Les obligations ci-dessous sont un référentiel de départ à confirmer selon les activités, produits,
          flux et effectifs réels du cabinet. « Vérifié conforme » signifie qu'un contrôle et une preuve ont été
          examinés ; ce statut ne remplace pas la vérification des pièces. Les éléments non applicables doivent
          être justifiés et documentés.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Kpi label="Obligations suivies" value={stats.total} />
          <Kpi label="À vérifier / corriger" value={stats.aVerifier} />
          <Kpi label="Vérifiées conformes" value={stats.conformes} />
          <Kpi label="Actions ouvertes" value={stats.actionsOuvertes} />
          <Kpi label="Actions en retard" value={stats.enRetard} />
        </div>
      </div>

      <div className="crm-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-serif text-lg">Obligations et preuves attendues</h3>
            <p className="mt-1 text-sm text-ink-muted">Pour chaque ligne, consignez l'état, le responsable, la prochaine échéance, l'action restante et la référence de la preuve.</p>
          </div>
          <Select value={filtre} onValueChange={setFiltre}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="a_traiter">À vérifier ou corriger</SelectItem>
              <SelectItem value="toutes">Toutes les obligations</SelectItem>
              {STATUTS.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {loading ? <p className="mt-4 text-sm text-ink-muted">Chargement…</p> : filtered.length === 0 ? (
          <p className="mt-4 text-sm text-ink-muted">Aucune obligation pour ce filtre. Vérifiez que le référentiel a été initialisé.</p>
        ) : (
          <div className="mt-4 space-y-4">
            {filtered.map(o => {
              const edit = edits[o.id] ?? {};
              const value = (key: keyof Obligation) => (edit[key] !== undefined ? edit[key] : o[key]) as string | null;
              return (
                <div key={o.id} className="rounded-xl border border-line p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs uppercase tracking-wide text-ink-muted">{o.domaine} · {o.code ?? o.niveau}</p>
                      <h4 className="mt-1 font-medium">{o.libelle}</h4>
                      {o.description && <p className="mt-1 text-sm text-ink-muted">{o.description}</p>}
                      <p className="mt-2 text-xs text-ink-muted">Périodicité : {o.periodicite ?? "À définir"} · Preuve attendue : {o.preuve_attendue ?? "À préciser"}</p>
                      {o.reference_url && <a className="mt-2 inline-block text-sm underline" href={o.reference_url} target="_blank" rel="noreferrer">Consulter la source officielle</a>}
                    </div>
                    <span className={"rounded-full border px-2 py-1 text-xs " + (value("statut") === "conforme" ? "border-emerald-300 bg-emerald-50 text-emerald-900" : value("statut") === "non_conforme" ? "border-red-300 bg-red-50 text-red-900" : "border-amber-300 bg-amber-50 text-amber-900")}>
                      {STATUTS.find(s => s.value === value("statut"))?.label ?? "À vérifier"}
                    </span>
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    <div>
                      <label className="mb-1 block text-xs text-ink-muted">Statut</label>
                      <Select value={value("statut") ?? "a_definir"} onValueChange={v => setEdits(prev => ({ ...prev, [o.id]: { ...prev[o.id], statut: v } }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{STATUTS.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-ink-muted">Responsable</label>
                      <Input value={value("responsable") ?? ""} onChange={e => setEdits(prev => ({ ...prev, [o.id]: { ...prev[o.id], responsable: e.target.value } }))} placeholder="Nom / fonction" />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-ink-muted">Prochaine échéance</label>
                      <Input type="date" value={value("prochaine_echeance") ?? ""} onChange={e => setEdits(prev => ({ ...prev, [o.id]: { ...prev[o.id], prochaine_echeance: e.target.value } }))} />
                    </div>
                    <div className="md:col-span-2 xl:col-span-3">
                      <label className="mb-1 block text-xs text-ink-muted">Action requise / travaux à faire</label>
                      <Textarea rows={2} value={value("action_requise") ?? ""} onChange={e => setEdits(prev => ({ ...prev, [o.id]: { ...prev[o.id], action_requise: e.target.value } }))} placeholder="Décrire les vérifications ou corrections restantes…" />
                    </div>
                    <div className="md:col-span-2 xl:col-span-3">
                      <label className="mb-1 block text-xs text-ink-muted">Référence de la preuve (chemin, nom de pièce, lien interne)</label>
                      <Input value={value("preuve_reference") ?? ""} onChange={e => setEdits(prev => ({ ...prev, [o.id]: { ...prev[o.id], preuve_reference: e.target.value } }))} placeholder="Ex. Conformité > Mes documents > Attestation ORIAS 2026" />
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs text-ink-muted">Dernière revue : {dateFr(o.derniere_revue)}</p>
                    <Button size="sm" onClick={() => void saveObligation(o)} disabled={saving === o.id}>{saving === o.id ? "Enregistrement…" : "Enregistrer le suivi"}</Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="crm-card p-5">
        <h3 className="font-serif text-lg">Registre des actions correctives</h3>
        <p className="mt-1 text-sm text-ink-muted">Toute anomalie, pièce manquante ou mise à jour nécessaire doit devenir une action suivie jusqu'à sa clôture.</p>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <Input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="Action à réaliser (obligatoire)" />
          <Select value={newObligation} onValueChange={setNewObligation}>
            <SelectTrigger><SelectValue placeholder="Obligation liée (facultatif)" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="aucune">Aucune obligation liée</SelectItem>
              {obligations.map(o => <SelectItem key={o.id} value={o.id}>{o.code ? o.code + " — " : ""}{o.libelle}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={newPriority} onValueChange={setNewPriority}>
            <SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{PRIORITES.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
          </Select>
          <Input value={newResponsible} onChange={e => setNewResponsible(e.target.value)} placeholder="Responsable" />
          <Input type="date" value={newDue} onChange={e => setNewDue(e.target.value)} />
          <Button onClick={() => void createAction()} disabled={creating}>{creating ? "Ajout…" : "Ajouter au registre"}</Button>
          <div className="md:col-span-2 xl:col-span-3">
            <Textarea rows={2} value={newDescription} onChange={e => setNewDescription(e.target.value)} placeholder="Description, risque, anomalie constatée ou résultat attendu" />
          </div>
        </div>
        <div className="mt-5 overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead>Action</TableHead><TableHead>Priorité</TableHead><TableHead>Responsable / échéance</TableHead><TableHead>Statut</TableHead></TableRow></TableHeader>
            <TableBody>
              {actions.map(a => (
                <TableRow key={a.id}>
                  <TableCell className="min-w-64">
                    <p className="font-medium">{a.titre}</p>
                    {a.description && <p className="mt-1 whitespace-pre-line text-xs text-ink-muted">{a.description}</p>}
                    {a.resolution && <p className="mt-1 text-xs text-ink-muted">Clôture : {a.resolution}</p>}
                    <p className="mt-1 text-xs text-ink-muted">Créée le {dateFr(a.created_at)}</p>
                  </TableCell>
                  <TableCell>
                    <Select value={a.priorite} onValueChange={v => void updateAction(a.id, { priorite: v })}>
                      <SelectTrigger className="w-32"><SelectValue /></SelectTrigger><SelectContent>{PRIORITES.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="min-w-48">
                    <Input defaultValue={a.responsable ?? ""} placeholder="Responsable" onBlur={e => { if (e.target.value !== (a.responsable ?? "")) void updateAction(a.id, { responsable: e.target.value }); }} />
                    <Input className="mt-2" type="date" defaultValue={a.echeance ?? ""} onBlur={e => { if (e.target.value !== (a.echeance ?? "")) void updateAction(a.id, { echeance: e.target.value || null }); }} />
                  </TableCell>
                  <TableCell className="min-w-40">
                    <Select value={a.statut} onValueChange={v => void updateAction(a.id, { statut: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{ACTION_STATUTS.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </TableCell>
                </TableRow>
              ))}
              {!loading && actions.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-sm text-ink-muted">Aucune action enregistrée. Ajoutez les écarts ou travaux à réaliser ci-dessus.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
      </div>
      <p className="text-xs text-ink-muted">Périmètre : référentiel de préparation au contrôle, à valider selon les produits réellement distribués et les obligations applicables au cabinet. Les échéances et statuts doivent être renseignés sur la base de pièces vérifiées.</p>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: number }) {
  return <div className="rounded-lg border border-line p-3"><p className="text-xs text-ink-muted">{label}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p></div>;
}
