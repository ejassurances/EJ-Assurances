import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { creerClientDossierRapide } from "@/lib/creation-rapide-client-dossier.functions";
import { archiverPiecesPortefeuille, extraireAttestationPortefeuille } from "@/lib/import-portefeuille.functions";
import { BRANCHES_CREATION } from "@/lib/recueil-besoins-schemas";
import { PIECES_KYC_IMPORT, TAILLE_MAX_PIECE } from "@/lib/import-portefeuille";

type Fichier = { nom: string; mime: string; base64: string };
type Candidat = { client_id: string; nom: string; prenom: string | null; email: string | null };

async function lire(file: File): Promise<Fichier> {
  if (file.size > TAILLE_MAX_PIECE) throw new Error("Fichier trop volumineux (10 Mo maximum).");
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { nom: file.name, mime: file.type || "application/pdf", base64: btoa(bin) };
}

const VIDE = {
  civilite: "", prenom: "", nom: "", date_naissance: "", email: "", mobile: "",
  adresse: "", code_postal: "", ville: "",
};

export function ImportPortefeuilleForm({ onDone }: { onDone: (clientId: string) => void }) {
  const extraire = useServerFn(extraireAttestationPortefeuille);
  const creer = useServerFn(creerClientDossierRapide);
  const archiver = useServerFn(archiverPiecesPortefeuille);

  const [attestation, setAttestation] = useState<Fichier | null>(null);
  const [kyc, setKyc] = useState<Record<string, Fichier | null>>({ cni: null, justificatif_domicile: null, rib: null });
  const [form, setForm] = useState(VIDE);
  const [contrat, setContrat] = useState({ assureur: "", produit: "", numero_contrat: "", date_effet: "", date_fin: "", cotisation: "" });
  const [branche, setBranche] = useState("");
  const [lecture, setLecture] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [candidat, setCandidat] = useState<Candidat | null>(null);

  const champ = "w-full rounded-md border border-line bg-background px-3 py-2 text-sm";

  const onAttestation = async (file?: File) => {
    if (!file) return;
    setErreur(null);
    try {
      const f = await lire(file);
      setAttestation(f);
      setLecture(true);
      const r = await extraire({ data: f });
      if (r.erreur || !r.champs) {
        toast.message(r.erreur ?? "Lecture impossible, saisissez les champs.");
        return;
      }
      const c = r.champs;
      // Préremplit uniquement les champs encore vides : jamais d'écrasement d'une saisie.
      setForm((cur) => {
        const next = { ...cur };
        for (const k of Object.keys(VIDE) as (keyof typeof VIDE)[]) if (!next[k] && c[k]) next[k] = c[k] as string;
        return next;
      });
      setContrat((cur) => ({
        assureur: cur.assureur || c.assureur || "",
        produit: cur.produit || c.produit || "",
        numero_contrat: cur.numero_contrat || c.numero_contrat || "",
        date_effet: cur.date_effet || c.date_effet || "",
        date_fin: cur.date_fin || c.date_fin || "",
        cotisation: cur.cotisation || (c.cotisation_mensuelle != null ? String(c.cotisation_mensuelle) : ""),
      }));
      if (!branche && c.branche_suggeree) setBranche(c.branche_suggeree);
      toast.success("Champs préremplis : vérifiez-les avant de valider.");
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setLecture(false);
    }
  };

  const valider = async (confirmerId: string | null) => {
    setErreur(null);
    if (!attestation) return setErreur("Déposez l'attestation ou le certificat.");
    if (!branche) return setErreur("Choisissez la branche d'assurance.");
    if (!form.nom.trim()) return setErreur("Le nom est obligatoire.");
    const manquantes = PIECES_KYC_IMPORT.filter((p) => !kyc[p.code]).map((p) => p.libelle);
    if (manquantes.length) return setErreur(`Pièces obligatoires manquantes : ${manquantes.join(", ")}.`);

    setEnvoi(true);
    try {
      const libelleBranche = BRANCHES_CREATION.find((b) => b.value === branche)?.label ?? branche;
      const besoin = [
        "Client déjà en portefeuille — import depuis attestation.",
        contrat.assureur && `Assureur : ${contrat.assureur}`,
        contrat.produit && `Produit : ${contrat.produit}`,
        contrat.numero_contrat && `N° contrat/certificat : ${contrat.numero_contrat}`,
        contrat.date_effet && `Effet : ${contrat.date_effet}`,
        contrat.date_fin && `Fin : ${contrat.date_fin}`,
        contrat.cotisation && `Cotisation mensuelle : ${contrat.cotisation} €`,
      ].filter(Boolean).join("\n");
      const r = await creer({
        data: {
          client: { ...form, date_naissance: form.date_naissance || null, email: form.email || null },
          dossier: { type_assurance: branche, intitule: `${libelleBranche} — portefeuille`, besoin },
          confirmer_client_id: confirmerId,
        },
      });
      if (r.status === "confirmation_required") {
        setCandidat(r.candidate as Candidat);
        return;
      }
      if (r.status !== "created") {
        setErreur("La fiche proposée a changé, relancez la vérification.");
        setCandidat(null);
        return;
      }
      const a = await archiver({
        data: {
          client_id: r.client_id,
          dossier_id: r.dossier_id,
          attestation,
          kyc: { cni: kyc.cni!, justificatif_domicile: kyc.justificatif_domicile!, rib: kyc.rib! },
        },
      });
      if (a.complet) toast.success(`Dossier ${r.dossier_reference} créé, pièces archivées.`);
      else {
        const ko = a.resultats.filter((x) => !x.ok).map((x) => x.code).join(", ");
        toast.error(`Dossier ${r.dossier_reference} créé, mais pièces non archivées : ${ko}. Redéposez-les depuis la fiche.`);
      }
      onDone(r.client_id);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setEnvoi(false);
    }
  };

  const input = (k: keyof typeof VIDE, label: string, type = "text") => (
    <label className="text-xs text-muted-foreground">
      {label}
      <input type={type} className={champ} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
    </label>
  );

  return (
    <div className="mt-6 space-y-5 rounded-xl border border-line bg-card p-5">
      <div>
        <h3 className="font-semibold">Client déjà en portefeuille</h3>
        <p className="text-sm text-muted-foreground">
          Déposez l'attestation : les champs sont préremplis par lecture automatique, à vérifier avant validation.
        </p>
      </div>

      <label className="block text-sm">
        Attestation / certificat (PDF ou image)
        <input type="file" accept="application/pdf,image/*" className={champ} onChange={(e) => onAttestation(e.target.files?.[0])} />
        {lecture && <span className="text-xs text-muted-foreground">Lecture en cours…</span>}
      </label>

      <div className="grid gap-3 sm:grid-cols-3">
        {input("civilite", "Civilité")}
        {input("prenom", "Prénom")}
        {input("nom", "Nom *")}
        {input("date_naissance", "Date de naissance", "date")}
        {input("email", "E-mail", "email")}
        {input("mobile", "Mobile")}
        {input("adresse", "Adresse")}
        {input("code_postal", "Code postal")}
        {input("ville", "Ville")}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {(["assureur", "produit", "numero_contrat", "date_effet", "date_fin", "cotisation"] as const).map((k) => (
          <label key={k} className="text-xs text-muted-foreground">
            {{ assureur: "Assureur", produit: "Produit", numero_contrat: "N° contrat / certificat", date_effet: "Date d'effet", date_fin: "Date de fin", cotisation: "Cotisation mensuelle (€)" }[k]}
            <input
              type={k.startsWith("date") ? "date" : "text"}
              className={champ}
              value={contrat[k]}
              onChange={(e) => setContrat({ ...contrat, [k]: e.target.value })}
            />
          </label>
        ))}
      </div>

      <label className="block text-sm">
        Branche d'assurance *
        <select className={champ} value={branche} onChange={(e) => setBranche(e.target.value)}>
          <option value="">— Choisir —</option>
          {BRANCHES_CREATION.map((b) => (
            <option key={b.value} value={b.value}>{b.label}</option>
          ))}
        </select>
      </label>

      <div className="grid gap-3 sm:grid-cols-3">
        {PIECES_KYC_IMPORT.map((p) => (
          <label key={p.code} className="text-xs text-muted-foreground">
            {p.libelle} *
            <input
              type="file"
              accept="application/pdf,image/*"
              className={champ}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  const f = await lire(file);
                  setKyc((cur) => ({ ...cur, [p.code]: f }));
                } catch (err) {
                  setErreur(err instanceof Error ? err.message : String(err));
                }
              }}
            />
          </label>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Les autres pièces propres à la branche resteront à fournir dans le dossier.</p>

      {candidat && (
        <div className="rounded-md border border-line bg-muted p-3 text-sm">
          Une fiche existe peut-être déjà : <strong>{[candidat.prenom, candidat.nom].filter(Boolean).join(" ")}</strong>
          {candidat.email ? ` (${candidat.email})` : ""}.
          <div className="mt-2 flex gap-2">
            <button disabled={envoi} onClick={() => valider(candidat.client_id)} className="rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
              Rattacher à cette fiche
            </button>
            <button onClick={() => setCandidat(null)} className="rounded-full border border-line px-3 py-1 text-xs">
              Annuler
            </button>
          </div>
        </div>
      )}

      {erreur && <p className="text-sm text-destructive">{erreur}</p>}

      <button
        disabled={envoi || lecture}
        onClick={() => valider(null)}
        className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
      >
        {envoi ? "Enregistrement…" : "Valider et créer le dossier"}
      </button>
    </div>
  );
}
