import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  importerBulletinCommission,
  rattacherLigneBulletin,
  genererCommissionsBulletin,
} from "@/lib/bulletins-commissions.functions";

type Bulletin = {
  id: string;
  periode: string;
  assureur: string;
  montant_total: number;
  nb_lignes: number;
  statut: string;
  fichier_path: string | null;
  fichier_nom: string | null;
  analyse_avertissement: string | null;
  created_at: string;
};

type Ligne = {
  id: string;
  client_nom_detecte: string | null;
  numero_contrat_detecte: string | null;
  produit_detecte: string | null;
  montant: number;
  assiette: number | null;
  taux: number | null;
  client_id: string | null;
  contrat_id: string | null;
  commission_id: string | null;
  statut: string;
};

type Client = { id: string; nom: string; prenom: string | null };
type Contrat = { id: string; numero: string | null; produit: string | null; assureur: string | null; client_id: string | null };
type Profil = { id: string; full_name: string | null; email: string | null };

const lireBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = String(reader.result ?? "");
      resolve(res.slice(res.indexOf(",") + 1));
    };
    reader.onerror = () => reject(new Error("Lecture du fichier impossible"));
    reader.readAsDataURL(file);
  });

export function BulletinCommissionsPanel({ onCommissionsCreees }: { onCommissionsCreees?: () => void }) {
  const importer = useServerFn(importerBulletinCommission);
  const rattacher = useServerFn(rattacherLigneBulletin);
  const generer = useServerFn(genererCommissionsBulletin);

  const inputRef = useRef<HTMLInputElement>(null);
  const [bulletins, setBulletins] = useState<Bulletin[]>([]);
  const [lignes, setLignes] = useState<Record<string, Ligne[]>>({});
  const [ouvert, setOuvert] = useState<string | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [contrats, setContrats] = useState<Contrat[]>([]);
  const [profils, setProfils] = useState<Profil[]>([]);
  const [beneficiaire, setBeneficiaire] = useState("");
  const [assureur, setAssureur] = useState("");
  const [periode, setPeriode] = useState("");
  const [enCours, setEnCours] = useState(false);

  const charger = async () => {
    const { data } = await supabase
      .from("bordereaux_commissions")
      .select("id,periode,assureur,montant_total,nb_lignes,statut,fichier_path,fichier_nom,analyse_avertissement,created_at")
      .order("created_at", { ascending: false })
      .limit(30);
    setBulletins((data as Bulletin[]) ?? []);
  };

  useEffect(() => {
    charger();
    (async () => {
      const [c, k, p] = await Promise.all([
        supabase.from("clients").select("id,nom,prenom").order("nom").limit(1000),
        supabase.from("contrats").select("id,numero,produit,assureur,client_id").order("numero").limit(2000),
        supabase.from("profiles").select("id,full_name,email"),
      ]);
      setClients((c.data as Client[]) ?? []);
      setContrats((k.data as Contrat[]) ?? []);
      setProfils((p.data as Profil[]) ?? []);
    })();
  }, []);

  const chargerLignes = async (bulletinId: string) => {
    const { data } = await supabase
      .from("bordereau_lignes")
      .select(
        "id,client_nom_detecte,numero_contrat_detecte,produit_detecte,montant,assiette,taux,client_id,contrat_id,commission_id,statut",
      )
      .eq("bordereau_id", bulletinId)
      .order("created_at");
    setLignes((prev) => ({ ...prev, [bulletinId]: (data as Ligne[]) ?? [] }));
  };

  const basculer = async (id: string) => {
    if (ouvert === id) return setOuvert(null);
    setOuvert(id);
    if (!lignes[id]) await chargerLignes(id);
  };

  const onFichier = async (file: File) => {
    if (file.size > 15 * 1024 * 1024) return toast.error("Fichier trop volumineux (15 Mo max).");
    setEnCours(true);
    try {
      const base64 = await lireBase64(file);
      const res = await importer({
        data: {
          nom_fichier: file.name,
          mime: file.type || null,
          base64,
          assureur: assureur.trim() || null,
          periode: periode.trim() || null,
        },
      });
      if (res.avertissement) toast.warning(`Bulletin archivé mais non analysé : ${res.avertissement}`);
      else
        toast.success(
          `${res.nb_lignes} ligne(s) détectée(s), ${res.nb_rapprochees} rattachée(s) automatiquement à un contrat.`,
        );
      setAssureur("");
      setPeriode("");
      await charger();
      setOuvert(res.bordereau_id);
      await chargerLignes(res.bordereau_id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import impossible");
    } finally {
      setEnCours(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const majLigne = async (ligne: Ligne, bulletinId: string, clientId: string, contratId?: string) => {
    try {
      await rattacher({ data: { ligne_id: ligne.id, client_id: clientId || null, contrat_id: contratId || null } });
      await chargerLignes(bulletinId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Rattachement impossible");
    }
  };

  const ignorer = async (ligne: Ligne, bulletinId: string) => {
    await rattacher({ data: { ligne_id: ligne.id, ignorer: true } });
    await chargerLignes(bulletinId);
  };

  const creerCommissions = async (bulletinId: string) => {
    if (!beneficiaire) return toast.error("Choisissez le bénéficiaire des commissions.");
    try {
      const res = await generer({ data: { bordereau_id: bulletinId, beneficiaire_id: beneficiaire } });
      toast.success(`${res.creees} commission(s) créée(s).`);
      await Promise.all([charger(), chargerLignes(bulletinId)]);
      onCommissionsCreees?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Génération impossible");
    }
  };

  const ouvrirFichier = async (b: Bulletin) => {
    if (!b.fichier_path) return;
    const { data, error } = await supabase.storage.from("bordereaux-commissions").createSignedUrl(b.fichier_path, 300);
    if (error || !data) return toast.error("Ouverture du fichier impossible.");
    window.open(data.signedUrl, "_blank");
  };

  return (
    <section className="mt-8 crm-card p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-xl font-medium text-ink">Importer un bulletin de commissions</h2>
          <p className="mt-1 max-w-3xl text-sm text-ink-muted">
            Déposez un PDF ou une image. L’IA extrait les commissions réelles, puis vous permet de vérifier le client et le contrat avant de les enregistrer. Les commissions prévisionnelles restent distinctes des montants réellement versés.
          </p>
        </div>
        <span className="rounded-full border border-line px-3 py-1 text-xs text-ink-muted">PDF ou image · 15 Mo max</span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <input
          value={assureur}
          onChange={(e) => setAssureur(e.target.value)}
          placeholder="Compagnie (optionnel)"
          className="rounded-md border border-line bg-background px-3 py-2 text-sm"
        />
        <input
          value={periode}
          onChange={(e) => setPeriode(e.target.value)}
          placeholder="Période (ex. 2026-07)"
          className="rounded-md border border-line bg-background px-3 py-2 text-sm"
        />
        <div>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,image/*"
            disabled={enCours}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFichier(f);
            }}
            className="w-full text-sm"
          />
          {enCours && <p className="mt-1 text-xs text-ink-muted">Analyse du bulletin en cours…</p>}
        </div>
      </div>

      <div className="mt-6 space-y-3">
        {bulletins.length === 0 && <p className="text-sm text-ink-muted">Aucun bulletin importé.</p>}
        {bulletins.map((b) => (
          <div key={b.id} className="rounded-xl border border-line">
            <div className="flex flex-wrap items-center justify-between gap-3 p-4">
              <button type="button" onClick={() => basculer(b.id)} className="text-left">
                <p className="text-sm font-medium text-ink">
                  {b.assureur} — {b.periode}
                </p>
                <p className="text-xs text-ink-muted">
                  {b.nb_lignes} ligne(s) · {Number(b.montant_total).toLocaleString("fr-FR")} € · {b.statut}
                </p>
              </button>
              <div className="flex flex-wrap items-center gap-2">
                {b.fichier_path && (
                  <button
                    type="button"
                    onClick={() => ouvrirFichier(b)}
                    className="rounded-md border border-line px-3 py-1.5 text-xs"
                  >
                    Ouvrir le bulletin
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => basculer(b.id)}
                  className="rounded-md border border-line px-3 py-1.5 text-xs"
                >
                  {ouvert === b.id ? "Masquer" : "Voir les lignes"}
                </button>
              </div>
            </div>

            {b.analyse_avertissement && (
              <p className="border-t border-line bg-amber-50 px-4 py-2 text-xs text-amber-900">
                {b.analyse_avertissement}
              </p>
            )}

            {ouvert === b.id && (
              <div className="border-t border-line p-4">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead className="text-left text-xs uppercase tracking-wide text-ink-muted">
                      <tr>
                        <th className="px-2 py-2">Client détecté</th>
                        <th className="px-2 py-2">Contrat</th>
                        <th className="px-2 py-2">Montant</th>
                        <th className="px-2 py-2">Client</th>
                        <th className="px-2 py-2">Contrat associé</th>
                        <th className="px-2 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {(lignes[b.id] ?? []).map((l) => (
                        <tr key={l.id} className="border-t border-line">
                          <td className="px-2 py-2">
                            <p>{l.client_nom_detecte ?? "—"}</p>
                            {l.produit_detecte && <p className="text-xs text-ink-muted">{l.produit_detecte}</p>}
                          </td>
                          <td className="px-2 py-2 text-xs">{l.numero_contrat_detecte ?? "—"}</td>
                          <td className="px-2 py-2">{Number(l.montant).toLocaleString("fr-FR")} €</td>
                          <td className="px-2 py-2">
                            <select
                              value={l.client_id ?? ""}
                              onChange={(e) => majLigne(l, b.id, e.target.value)}
                              disabled={Boolean(l.commission_id)}
                              className="w-48 rounded-md border border-line bg-background px-2 py-1 text-xs"
                            >
                              <option value="">Non rattaché…</option>
                              {clients.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.nom} {c.prenom ?? ""}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-2 py-2">
                            <select
                              value={l.contrat_id ?? ""}
                              onChange={(e) => {
                                const contrat = contrats.find((k) => k.id === e.target.value);
                                majLigne(l, b.id, contrat?.client_id ?? l.client_id ?? "", e.target.value);
                              }}
                              disabled={Boolean(l.commission_id)}
                              className="w-64 rounded-md border border-line bg-background px-2 py-1 text-xs"
                            >
                              <option value="">Choisir un contrat…</option>
                              {contrats.filter((k) => !l.client_id || !k.client_id || k.client_id === l.client_id).map((k) => (
                                <option key={k.id} value={k.id}>
                                  {[k.numero || "Sans numéro", k.assureur, k.produit].filter(Boolean).join(" — ")}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-2 py-2 text-xs">
                            {l.commission_id ? (
                              <span className="text-emerald-700">Commission créée</span>
                            ) : l.statut === "ignoree" ? (
                              <span className="text-ink-muted">Ignorée</span>
                            ) : (
                              <button type="button" onClick={() => ignorer(l, b.id)} className="text-ink-muted underline">
                                Ignorer
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                      {(lignes[b.id] ?? []).length === 0 && (
                        <tr>
                          <td colSpan={6} className="px-2 py-3 text-sm text-ink-muted">
                            Aucune ligne détectée dans ce bulletin.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <select
                    value={beneficiaire}
                    onChange={(e) => setBeneficiaire(e.target.value)}
                    className="rounded-md border border-line bg-background px-3 py-2 text-sm"
                  >
                    <option value="">Bénéficiaire des commissions…</option>
                    {profils.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.full_name ?? p.email ?? p.id.slice(0, 8)}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => creerCommissions(b.id)}
                    className="rounded-md bg-[#0A192F] px-4 py-2 text-sm font-medium text-white"
                  >
                    Créer les commissions des lignes rattachées
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
