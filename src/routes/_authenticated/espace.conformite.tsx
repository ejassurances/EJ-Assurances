import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { IconShieldCheck } from "@tabler/icons-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/page-header";
import { SectionNav, type SectionNavItem } from "@/components/section-nav";
import { RegistreClientsConformite } from "@/components/registre-clients-conformite";
import { VeilleReglementairePanel } from "@/components/veille-reglementaire-panel";
import { ReclamationsPanel } from "@/components/reclamations-panel";

import { ControleInternePanel } from "@/components/controle-interne-panel";
import { CartographieRisquesPanel } from "@/components/cartographie-risques-panel";
import { RegistreRgpdPanel } from "@/components/registre-rgpd-panel";
import { FormationsPersonnelPanel } from "@/components/formations-personnel-panel";
import { DoraRegistrePanel } from "@/components/dora-registre-panel";
import { RgpdDroitsViolationsPanel } from "@/components/rgpd-droits-violations-panel";
import { RegistreConformiteCabinetPanel } from "@/components/registre-conformite-cabinet-panel";

export const Route = createFileRoute("/_authenticated/espace/conformite")({
  component: ConformitePage,
});

type ConfType =
  | "cni"
  | "justificatif_domicile"
  | "orias"
  | "association_pro"
  | "rcpro"
  | "der"
  | "autre";

type ConfDoc = {
  id: string;
  user_id: string;
  type: ConfType;
  nom: string;
  storage_path: string;
  date_emission: string | null;
  date_expiration: string | null;
  statut: "a_valider" | "valide" | "expire" | "refuse";
  notes: string | null;
  created_at: string;
};

type CompagnieDoc = {
  id: string;
  compagnie_id: string;
  type: "contrat_partenariat" | "avenant" | "protocole_commissions" | "conditions_apporteur" | "autre";
  nom: string;
  storage_path: string;
  date_signature: string | null;
  date_fin: string | null;
  reference: string | null;
  notes: string | null;
  created_at: string;
};

type Profile = { id: string; email: string | null; full_name: string | null };
type Compagnie = { id: string; nom: string };

const CONF_TYPES: { value: ConfType; label: string; obligatoire?: boolean }[] = [
  { value: "cni", label: "CNI", obligatoire: true },
  { value: "justificatif_domicile", label: "Justificatif de domicile", obligatoire: true },
  { value: "orias", label: "Attestation ORIAS", obligatoire: true },
  { value: "association_pro", label: "Attestation association pro.", obligatoire: true },
  { value: "rcpro", label: "Attestation RCPro", obligatoire: true },
  { value: "der", label: "DER (Document d'entrée en relation)", obligatoire: true },
  { value: "autre", label: "Autre" },
];

const COMP_DOC_TYPES: { value: CompagnieDoc["type"]; label: string }[] = [
  { value: "contrat_partenariat", label: "Contrat de partenariat" },
  { value: "avenant", label: "Avenant" },
  { value: "protocole_commissions", label: "Protocole commissions" },
  { value: "conditions_apporteur", label: "Conditions apporteur" },
  { value: "autre", label: "Autre" },
];

const STATUT_LABEL: Record<ConfDoc["statut"], string> = {
  a_valider: "À valider",
  valide: "Valide",
  expire: "Expiré",
  refuse: "Refusé",
};
const STATUT_CLASS: Record<ConfDoc["statut"], string> = {
  a_valider: "bg-amber-100 text-amber-900",
  valide: "bg-emerald-100 text-emerald-900",
  expire: "bg-red-100 text-red-900",
  refuse: "bg-red-100 text-red-900",
};

type SectionKey =
  | "mes-documents"
  | "equipe"
  | "partenariats"
  | "registre-clients"
  | "reclamations"
  | "veille"
  | "controle-interne"
  | "cartographie"
  | "registre-rgpd"
  | "droits-violations"
  | "registre-dora"
  | "formations"
  | "registre-cabinet";

function ConformitePage() {
  const { user, role, loading } = useAuth();
  const [section, setSection] = useState<SectionKey>("mes-documents");

  if (loading) return <p className="text-sm text-ink-muted">Chargement…</p>;
  if (role === "client") return <p className="text-sm text-ink-muted">Accès réservé.</p>;

  const items: SectionNavItem<SectionKey>[] = [
    { key: "mes-documents", label: "Mes documents" },
    ...(role === "admin" ? [{ key: "equipe" as SectionKey, label: "Équipe & mandataires" }] : []),
    { key: "partenariats", label: "Partenariats compagnies" },
    { key: "registre-clients", label: "Registre clients" },
    { key: "reclamations", label: "Réclamations" },
    { key: "veille", label: "Veille réglementaire" },
    { key: "controle-interne", label: "Contrôle interne" },
    { key: "cartographie", label: "Cartographie des risques" },
    { key: "registre-rgpd", label: "Registre RGPD" },
    { key: "droits-violations", label: "Droits & violations" },
    { key: "registre-dora", label: "Registre DORA & incidents" },
    { key: "formations", label: "Formation du personnel" },
    { key: "registre-cabinet", label: "Registre obligations & actions" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Conformité ACPR"
        title="Conformité"
        description="Point d'entrée unique en cas de contrôle ACPR : documents obligatoires du cabinet et de ses mandataires, contrats de partenariat compagnies, registre de conformité clients (KYC, risque LCB-FT, vigilance)."
        icon={IconShieldCheck}
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        <div className="min-w-0">
          {section === "mes-documents" && user && (
            <MesDocuments userId={user.id} isAdmin={role === "admin"} />
          )}

          {section === "equipe" && role === "admin" && <EquipeConformite />}

          {section === "partenariats" && <Partenariats canManage={role === "admin"} />}

          {section === "registre-clients" && <RegistreClientsConformite isAdmin={role === "admin"} />}

          {section === "reclamations" && (
            <ReclamationsPanel canManage={role === "admin" || role === "mandataire"} />
          )}

          {section === "veille" && <VeilleReglementairePanel canManage={role === "admin"} />}

          {section === "controle-interne" && <ControleInternePanel isAdmin={role === "admin"} />}

          {section === "cartographie" && <CartographieRisquesPanel isAdmin={role === "admin"} />}

          {section === "registre-rgpd" && <RegistreRgpdPanel isAdmin={role === "admin"} />}

          {section === "droits-violations" && (
            <RgpdDroitsViolationsPanel canManage={role === "admin" || role === "mandataire"} />
          )}

          {section === "registre-dora" && <DoraRegistrePanel isAdmin={role === "admin"} />}

          {section === "formations" && <FormationsPersonnelPanel isAdmin={role === "admin"} />}

          {section === "registre-cabinet" && <RegistreConformiteCabinetPanel isAdmin={role === "admin"} />}
        </div>

        <div className="lg:w-72">
          <SectionNav title="Sections" items={items} active={section} onSelect={setSection} />
        </div>
      </div>
    </div>
  );
}

/* ---------- Mes documents ---------- */

function MesDocuments({ userId, isAdmin }: { userId: string; isAdmin: boolean }) {
  const [docs, setDocs] = useState<ConfDoc[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("conformite_documents")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    setDocs((data as ConfDoc[]) ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, [userId]);

  const byType = useMemo(() => {
    const map: Record<string, ConfDoc | undefined> = {};
    for (const d of docs) {
      const prev = map[d.type];
      if (!prev || new Date(d.created_at) > new Date(prev.created_at)) map[d.type] = d;
    }
    return map;
  }, [docs]);

  return (
    <div className="space-y-6">
      <div className="crm-card p-5">
        <h3 className="font-serif text-lg font-medium">Checklist obligatoire</h3>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {CONF_TYPES.filter((t) => t.obligatoire).map((t) => {
            const d = byType[t.value];
            const ok = d && d.statut === "valide";
            return (
              <li key={t.value} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-background p-3 text-sm">
                <span>
                  <span className={"mr-2 inline-block size-2 rounded-full " + (ok ? "bg-emerald-500" : d ? "bg-amber-500" : "bg-red-500")} />
                  {t.label}
                </span>
                <span className="text-xs text-ink-muted">
                  {d ? STATUT_LABEL[d.statut] : "Manquant"}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <UploadConfForm userId={userId} onUploaded={load} />

      <DocsList docs={docs} loading={loading} onChanged={load} canValidate={isAdmin} />
    </div>
  );
}

function UploadConfForm({ userId, onUploaded }: { userId: string; onUploaded: () => void }) {
  const [type, setType] = useState<ConfType>("cni");
  const [nom, setNom] = useState("");
  const [dateEmission, setDateEmission] = useState("");
  const [dateExpiration, setDateExpiration] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const submit = async () => {
    setErr(null);
    const file = fileRef.current?.files?.[0];
    if (!file) { setErr("Sélectionnez un fichier."); return; }
    if (file.size > 15 * 1024 * 1024) { setErr("Fichier > 15 Mo."); return; }
    setBusy(true);
    const path = `${userId}/${type}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const up = await supabase.storage.from("conformite-documents").upload(path, file, { upsert: false });
    if (up.error) { setErr(up.error.message); setBusy(false); return; }
    const ins = await supabase.from("conformite_documents").insert({
      user_id: userId,
      type,
      nom: nom || file.name,
      storage_path: path,
      date_emission: dateEmission || null,
      date_expiration: dateExpiration || null,
      notes: notes || null,
      uploaded_by: userId,
    });
    setBusy(false);
    if (ins.error) { setErr(ins.error.message); return; }
    setNom(""); setDateEmission(""); setDateExpiration(""); setNotes("");
    if (fileRef.current) fileRef.current.value = "";
    onUploaded();
  };

  return (
    <div className="crm-card p-5">
      <h3 className="font-serif text-lg font-medium">Téléverser un document</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Select value={type} onValueChange={(v) => setType(v as ConfType)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {CONF_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input placeholder="Nom du document" value={nom} onChange={(e) => setNom(e.target.value)} />
        <input ref={fileRef} type="file" className="rounded-md border border-line bg-background px-3 py-2 text-sm" />
        <div>
          <label className="mb-1 block text-xs uppercase tracking-wide text-ink-muted">Date d'émission</label>
          <Input type="date" value={dateEmission} onChange={(e) => setDateEmission(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs uppercase tracking-wide text-ink-muted">Date d'expiration</label>
          <Input type="date" value={dateExpiration} onChange={(e) => setDateExpiration(e.target.value)} />
        </div>
        <Input placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      <div className="mt-3">
        <Button onClick={submit} disabled={busy}>{busy ? "Envoi…" : "Téléverser"}</Button>
      </div>
    </div>
  );
}

function DocsList({
  docs, loading, onChanged, canValidate, showOwner = false, profiles,
}: {
  docs: ConfDoc[]; loading: boolean; onChanged: () => void; canValidate: boolean;
  showOwner?: boolean; profiles?: Profile[];
}) {
  const download = async (path: string) => {
    const { data, error } = await supabase.storage.from("conformite-documents").createSignedUrl(path, 60);
    if (error) return alert(error.message);
    window.open(data.signedUrl, "_blank");
  };
  const setStatut = async (id: string, statut: ConfDoc["statut"]) => {
    await supabase.from("conformite_documents").update({ statut }).eq("id", id);
    onChanged();
  };
  const remove = async (d: ConfDoc) => {
    if (!confirm("Supprimer ce document ?")) return;
    await supabase.storage.from("conformite-documents").remove([d.storage_path]);
    await supabase.from("conformite_documents").delete().eq("id", d.id);
    onChanged();
  };
  const nameOf = (id: string) => profiles?.find((p) => p.id === id)?.full_name
    || profiles?.find((p) => p.id === id)?.email || id.slice(0, 8);

  return (
    <div className="crm-card overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {showOwner && <TableHead>Utilisateur</TableHead>}
            <TableHead>Type</TableHead>
            <TableHead>Nom</TableHead>
            <TableHead>Émission</TableHead>
            <TableHead>Expiration</TableHead>
            <TableHead>Statut</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow><TableCell colSpan={showOwner ? 7 : 6} className="text-center text-ink-muted">Chargement…</TableCell></TableRow>
          ) : docs.length === 0 ? (
            <TableRow><TableCell colSpan={showOwner ? 7 : 6} className="text-center text-ink-muted">Aucun document.</TableCell></TableRow>
          ) : docs.map((d) => (
            <TableRow key={d.id}>
              {showOwner && <TableCell className="text-xs">{nameOf(d.user_id)}</TableCell>}
              <TableCell className="text-xs">{CONF_TYPES.find((t) => t.value === d.type)?.label ?? d.type}</TableCell>
              <TableCell className="max-w-[220px] truncate">{d.nom}</TableCell>
              <TableCell className="text-xs">{d.date_emission ? new Date(d.date_emission).toLocaleDateString("fr-FR") : "—"}</TableCell>
              <TableCell className="text-xs">{d.date_expiration ? new Date(d.date_expiration).toLocaleDateString("fr-FR") : "—"}</TableCell>
              <TableCell>
                {canValidate ? (
                  <Select value={d.statut} onValueChange={(v) => setStatut(d.id, v as ConfDoc["statut"])}>
                    <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="a_valider">À valider</SelectItem>
                      <SelectItem value="valide">Valide</SelectItem>
                      <SelectItem value="expire">Expiré</SelectItem>
                      <SelectItem value="refuse">Refusé</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <span className={"inline-flex rounded-full px-2 py-0.5 text-xs font-medium " + STATUT_CLASS[d.statut]}>{STATUT_LABEL[d.statut]}</span>
                )}
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => download(d.storage_path)}>Voir</Button>
                  <Button variant="ghost" size="sm" onClick={() => remove(d)}>Suppr.</Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/* ---------- Équipe (admin) ---------- */

function EquipeConformite() {
  const [docs, setDocs] = useState<ConfDoc[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [members, setMembers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const [{ data: d }, { data: p }, { data: r }] = await Promise.all([
      supabase.from("conformite_documents").select("*").order("created_at", { ascending: false }),
      supabase.from("profiles").select("id,email,full_name"),
      supabase.from("user_roles").select("user_id,role").in("role", ["admin", "mandataire"]),
    ]);
    setDocs((d as ConfDoc[]) ?? []);
    const allProfiles = (p as Profile[]) ?? [];
    setProfiles(allProfiles);
    const memberIds = new Set((r ?? []).map((x) => x.user_id));
    setMembers(allProfiles.filter((pp) => memberIds.has(pp.id)));
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const checklist = useMemo(() => {
    const map: Record<string, Record<string, ConfDoc | undefined>> = {};
    for (const d of docs) {
      map[d.user_id] = map[d.user_id] ?? {};
      const prev = map[d.user_id][d.type];
      if (!prev || new Date(d.created_at) > new Date(prev.created_at)) map[d.user_id][d.type] = d;
    }
    return map;
  }, [docs]);

  const required = CONF_TYPES.filter((t) => t.obligatoire);

  return (
    <div className="space-y-6">
      <div className="crm-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Membre</TableHead>
              {required.map((t) => <TableHead key={t.value} className="text-xs">{t.label}</TableHead>)}
              <TableHead className="text-right">Complétude</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((m) => {
              const done = required.filter((t) => checklist[m.id]?.[t.value]?.statut === "valide").length;
              return (
                <TableRow key={m.id}>
                  <TableCell>{m.full_name || m.email}</TableCell>
                  {required.map((t) => {
                    const d = checklist[m.id]?.[t.value];
                    const cls = !d ? "bg-red-500" : d.statut === "valide" ? "bg-emerald-500" : d.statut === "expire" || d.statut === "refuse" ? "bg-red-500" : "bg-amber-500";
                    return <TableCell key={t.value}><span className={"inline-block size-2.5 rounded-full " + cls} /></TableCell>;
                  })}
                  <TableCell className="text-right text-sm">{done}/{required.length}</TableCell>
                </TableRow>
              );
            })}
            {members.length === 0 && (
              <TableRow><TableCell colSpan={required.length + 2} className="text-center text-ink-muted">Aucun membre.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <h3 className="font-serif text-lg font-medium">Tous les documents</h3>
      <DocsList docs={docs} loading={loading} onChanged={load} canValidate showOwner profiles={profiles} />
    </div>
  );
}

/* ---------- Partenariats compagnies ---------- */

function Partenariats({ canManage }: { canManage: boolean }) {
  const [docs, setDocs] = useState<CompagnieDoc[]>([]);
  const [compagnies, setCompagnies] = useState<Compagnie[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const [{ data: d }, { data: c }] = await Promise.all([
      supabase.from("compagnie_documents").select("*").order("created_at", { ascending: false }),
      supabase.from("compagnies").select("id,nom").order("nom"),
    ]);
    setDocs((d as CompagnieDoc[]) ?? []);
    setCompagnies((c as Compagnie[]) ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const nameOf = (id: string) => compagnies.find((c) => c.id === id)?.nom ?? id.slice(0, 8);

  return (
    <div className="space-y-6">
      {canManage && <UploadCompagnieDocForm compagnies={compagnies} onUploaded={load} />}
      <CompagnieDocsTable docs={docs} loading={loading} nameOf={nameOf} onChanged={load} canManage={canManage} showCompagnie />
    </div>
  );
}

export function CompagnieDocsTable({
  docs, loading, onChanged, canManage, showCompagnie, nameOf,
}: {
  docs: CompagnieDoc[]; loading: boolean; onChanged: () => void; canManage: boolean;
  showCompagnie?: boolean; nameOf?: (id: string) => string;
}) {
  const download = async (path: string) => {
    const { data, error } = await supabase.storage.from("compagnie-documents").createSignedUrl(path, 60);
    if (error) return alert(error.message);
    window.open(data.signedUrl, "_blank");
  };
  const remove = async (d: CompagnieDoc) => {
    if (!confirm("Supprimer ce document ?")) return;
    await supabase.storage.from("compagnie-documents").remove([d.storage_path]);
    await supabase.from("compagnie_documents").delete().eq("id", d.id);
    onChanged();
  };
  return (
    <div className="crm-card overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {showCompagnie && <TableHead>Compagnie</TableHead>}
            <TableHead>Type</TableHead>
            <TableHead>Nom</TableHead>
            <TableHead>Signature</TableHead>
            <TableHead>Fin</TableHead>
            <TableHead>Référence</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow><TableCell colSpan={showCompagnie ? 7 : 6} className="text-center text-ink-muted">Chargement…</TableCell></TableRow>
          ) : docs.length === 0 ? (
            <TableRow><TableCell colSpan={showCompagnie ? 7 : 6} className="text-center text-ink-muted">Aucun document.</TableCell></TableRow>
          ) : docs.map((d) => (
            <TableRow key={d.id}>
              {showCompagnie && <TableCell>{nameOf?.(d.compagnie_id) ?? d.compagnie_id.slice(0, 8)}</TableCell>}
              <TableCell className="text-xs">{COMP_DOC_TYPES.find((t) => t.value === d.type)?.label ?? d.type}</TableCell>
              <TableCell className="max-w-[220px] truncate">{d.nom}</TableCell>
              <TableCell className="text-xs">{d.date_signature ? new Date(d.date_signature).toLocaleDateString("fr-FR") : "—"}</TableCell>
              <TableCell className="text-xs">{d.date_fin ? new Date(d.date_fin).toLocaleDateString("fr-FR") : "—"}</TableCell>
              <TableCell className="text-xs text-ink-muted">{d.reference ?? "—"}</TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => download(d.storage_path)}>Voir</Button>
                  {canManage && <Button variant="ghost" size="sm" onClick={() => remove(d)}>Suppr.</Button>}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function UploadCompagnieDocForm({
  compagnies, defaultCompagnieId, onUploaded,
}: {
  compagnies: Compagnie[]; defaultCompagnieId?: string; onUploaded: () => void;
}) {
  const [compagnieId, setCompagnieId] = useState(defaultCompagnieId ?? "");
  const [type, setType] = useState<CompagnieDoc["type"]>("contrat_partenariat");
  const [nom, setNom] = useState("");
  const [dateSignature, setDateSignature] = useState("");
  const [dateFin, setDateFin] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const submit = async () => {
    setErr(null);
    if (!compagnieId) { setErr("Sélectionnez une compagnie."); return; }
    const file = fileRef.current?.files?.[0];
    if (!file) { setErr("Sélectionnez un fichier."); return; }
    setBusy(true);
    const path = `${compagnieId}/${type}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const up = await supabase.storage.from("compagnie-documents").upload(path, file);
    if (up.error) { setErr(up.error.message); setBusy(false); return; }
    const ins = await supabase.from("compagnie_documents").insert({
      compagnie_id: compagnieId,
      type,
      nom: nom || file.name,
      storage_path: path,
      date_signature: dateSignature || null,
      date_fin: dateFin || null,
      reference: reference || null,
      notes: notes || null,
    });
    setBusy(false);
    if (ins.error) { setErr(ins.error.message); return; }
    setNom(""); setDateSignature(""); setDateFin(""); setReference(""); setNotes("");
    if (fileRef.current) fileRef.current.value = "";
    onUploaded();
  };

  return (
    <div className="crm-card p-5">
      <h3 className="font-serif text-lg font-medium">Ajouter un document compagnie</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {!defaultCompagnieId && (
          <Select value={compagnieId} onValueChange={setCompagnieId}>
            <SelectTrigger><SelectValue placeholder="Compagnie" /></SelectTrigger>
            <SelectContent>
              {compagnies.map((c) => <SelectItem key={c.id} value={c.id}>{c.nom}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <Select value={type} onValueChange={(v) => setType(v as CompagnieDoc["type"])}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {COMP_DOC_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input placeholder="Nom" value={nom} onChange={(e) => setNom(e.target.value)} />
        <input ref={fileRef} type="file" className="rounded-md border border-line bg-background px-3 py-2 text-sm" />
        <div>
          <label className="mb-1 block text-xs uppercase tracking-wide text-ink-muted">Signature</label>
          <Input type="date" value={dateSignature} onChange={(e) => setDateSignature(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs uppercase tracking-wide text-ink-muted">Fin</label>
          <Input type="date" value={dateFin} onChange={(e) => setDateFin(e.target.value)} />
        </div>
        <Input placeholder="Référence contrat" value={reference} onChange={(e) => setReference(e.target.value)} />
        <Input className="sm:col-span-2" placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      <div className="mt-3">
        <Button onClick={submit} disabled={busy}>{busy ? "Envoi…" : "Ajouter"}</Button>
      </div>
    </div>
  );
}
