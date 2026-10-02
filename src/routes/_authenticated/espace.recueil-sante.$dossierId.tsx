import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { enregistrerRecueilSante, lireRecueilSante } from "@/lib/recueil-sante.functions";
import {
  calculerBesoins, LABEL_BESOIN, LABEL_STATUT, POSTES, questionsVisibles,
  type Besoin, type Poste, type RecueilSante, type Reponses,
} from "@/lib/recueil-sante-config";

export const Route = createFileRoute("/_authenticated/espace/recueil-sante/$dossierId")({
  head: () => ({
    meta: [
      { title: "Faisons le point sur vos besoins santé — EJ Partners" },
      { name: "description", content: "Recueil des besoins en complémentaire santé, préparatoire à l'étude de votre conseiller." },
      { property: "og:title", content: "Recueil santé — EJ Partners" },
      { property: "og:description", content: "Quelques questions pour comprendre ce qui compte pour vous." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RecueilSantePage,
});

type Ecran = "intro" | "question" | "synthese" | "fin";

function RecueilSantePage() {
  const { dossierId } = Route.useParams();
  const lire = useServerFn(lireRecueilSante);
  const enregistrer = useServerFn(enregistrerRecueilSante);
  const [info, setInfo] = useState<{ reference: string; client_nom: string; recueil: RecueilSante | null } | null>(null);
  const [reponses, setReponses] = useState<Reponses>({});
  const [ajust, setAjust] = useState<Partial<Record<Poste, Besoin>>>({});
  const [ecran, setEcran] = useState<Ecran>("intro");
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    lire({ data: { dossier_id: dossierId } })
      .then((r) => {
        setInfo(r);
        if (r.recueil) { setReponses(r.recueil.reponses ?? {}); setAjust(r.recueil.ajustements ?? {}); }
      })
      .catch((e: unknown) => toast.error(e instanceof Error ? e.message : "Dossier indisponible"));
  }, [dossierId, lire]);

  const visibles = useMemo(() => questionsVisibles(reponses), [reponses]);
  const besoins = useMemo(() => calculerBesoins(reponses), [reponses]);
  const q = visibles[Math.min(index, visibles.length - 1)];

  const sauver = async (opts: { terminer?: boolean; a_revoir?: boolean } = {}, r = reponses, a = ajust) => {
    setBusy(true);
    try {
      const res = await enregistrer({ data: { dossier_id: dossierId, reponses: r, ajustements: a, ...opts } });
      setInfo((i) => (i ? { ...i, recueil: res } : i));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Enregistrement impossible");
    } finally { setBusy(false); }
  };

  const choisir = (value: string) => {
    const r = { ...reponses, [q.key]: value };
    setReponses(r);
    void sauver({}, r);
  };

  const continuer = () => {
    if (index + 1 >= questionsVisibles(reponses).length) setEcran("synthese");
    else setIndex(index + 1);
  };

  const modifierPoste = (poste: Poste) => {
    const i = visibles.findIndex((x) => x.poste === poste);
    setIndex(i >= 0 ? i : 0);
    setEcran("question");
  };

  if (!info) return <p className="p-8 text-sm text-ink-muted">Chargement…</p>;
  const statut = info.recueil?.statut;

  return (
    <div className="mx-auto max-w-xl px-4 py-8 sm:py-12">
      <div className="mb-8 flex items-center justify-between text-xs text-ink-muted">
        <Link to="/espace/dossiers/$id" params={{ id: dossierId }} className="hover:text-ink">← Dossier {info.reference}</Link>
        <span>{statut ? LABEL_STATUT[statut] : "Non commencé"}{busy ? " · enregistrement…" : ""}</span>
      </div>

      {ecran === "intro" && (
        <section className="crm-card space-y-5 rounded-2xl p-6 sm:p-10">
          <h1 className="text-2xl font-semibold text-ink">Faisons le point sur votre santé et vos habitudes</h1>
          <p className="text-ink-muted">Quelques questions suffisent pour comprendre ce qui compte pour vous{info.client_nom ? `, ${info.client_nom}` : ""}. Vos réponses nous permettront de préparer une étude adaptée à votre situation.</p>
          <p className="text-sm text-ink-muted">Vous pourrez modifier vos réponses à tout moment.</p>
          <div className="flex flex-wrap gap-3 pt-2">
            <button onClick={() => { setIndex(0); setEcran("question"); }} className="rounded-full bg-[color:var(--crm-navy)] px-6 py-2.5 text-sm font-medium text-primary-foreground">
              {Object.keys(reponses).length ? "Reprendre" : "Commencer"}
            </button>
            {Object.keys(reponses).length > 0 && (
              <button onClick={() => setEcran("synthese")} className="rounded-full border border-line px-6 py-2.5 text-sm text-ink">Voir ce que nous avons retenu</button>
            )}
          </div>
        </section>
      )}

      {ecran === "question" && q && (
        <section className="space-y-6">
          <p className="text-xs tracking-wide text-ink-muted">Question {Math.min(index, visibles.length - 1) + 1} sur {visibles.length}</p>
          <div className="h-0.5 w-full rounded bg-line"><div className="h-0.5 rounded bg-[color:var(--crm-gold)] transition-all" style={{ width: `${((index + 1) / visibles.length) * 100}%` }} /></div>
          <h2 className="text-xl font-semibold leading-snug text-ink sm:text-2xl">{q.titre}</h2>
          {q.encadre && <p className="rounded-xl bg-surface-elevated p-3 text-sm text-ink-muted">{q.encadre}</p>}
          <div className="space-y-3">
            {q.options.map((o) => {
              const actif = reponses[q.key] === o.value;
              return (
                <button key={o.value} onClick={() => choisir(o.value)}
                  className={`block w-full rounded-2xl border p-4 text-left transition ${actif ? "border-[color:var(--crm-navy)] bg-surface-elevated" : "border-line hover:border-ink-muted"}`}>
                  <span className="block text-sm font-medium text-ink">{o.label}</span>
                  {o.aide && <span className="mt-1 block text-xs text-ink-muted">{o.aide}</span>}
                </button>
              );
            })}
          </div>
          <div className="flex items-center justify-between pt-2">
            <button onClick={() => (index === 0 ? setEcran("intro") : setIndex(index - 1))} className="text-sm text-ink-muted hover:text-ink">Retour</button>
            <button disabled={!reponses[q.key]} onClick={continuer} className="rounded-full bg-[color:var(--crm-navy)] px-6 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-40">Continuer</button>
          </div>
        </section>
      )}

      {ecran === "synthese" && (
        <section className="space-y-6">
          <h2 className="text-2xl font-semibold text-ink">Voici ce que nous avons retenu de vos réponses</h2>
          <p className="text-sm text-ink-muted">Si quelque chose ne vous ressemble pas, ajustez-le. Ces éléments seront vérifiés avec vous lors de l'étude.</p>
          <ul className="divide-y divide-line rounded-2xl border border-line">
            {POSTES.map((p) => {
              const valeur = ajust[p.key] ?? besoins[p.key];
              const choix: Besoin[] = p.binaire ? ["oui", "non"] : ["faible", "modere", "fort"];
              return (
                <li key={p.key} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div>
                    <p className="text-sm font-medium text-ink">{p.label}</p>
                    <button onClick={() => modifierPoste(p.key)} className="text-xs text-ink-muted underline-offset-2 hover:underline">Revoir mes réponses</button>
                  </div>
                  <select value={valeur} onChange={(e) => {
                    const v = e.target.value as Besoin;
                    const a = { ...ajust };
                    if (v === besoins[p.key]) delete a[p.key]; else a[p.key] = v;
                    setAjust(a); void sauver({}, reponses, a);
                  }} className="rounded-full border border-line bg-transparent px-3 py-1.5 text-sm text-ink">
                    {choix.map((c) => <option key={c} value={c}>{LABEL_BESOIN[c]}</option>)}
                  </select>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button onClick={() => { setIndex(0); setEcran("question"); }} className="text-sm text-ink-muted hover:text-ink">Tout revoir</button>
            <button disabled={busy} onClick={async () => { await sauver({ terminer: true }); setEcran("fin"); }} className="rounded-full bg-[color:var(--crm-navy)] px-6 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-40">C'est bien ça</button>
          </div>
        </section>
      )}

      {ecran === "fin" && (
        <section className="crm-card space-y-4 rounded-2xl p-6 sm:p-10">
          <h2 className="text-2xl font-semibold text-ink">Merci, nous avons maintenant une bonne vision de vos besoins.</h2>
          <p className="text-ink-muted">Votre demande peut maintenant être étudiée par notre équipe. Nous vérifierons les garanties disponibles et les conditions des contrats avant de vous présenter les solutions adaptées.</p>
          <div className="flex flex-wrap gap-3 pt-2">
            <button onClick={() => setEcran("synthese")} className="rounded-full border border-line px-5 py-2 text-sm text-ink">Modifier mes réponses</button>
            <button onClick={() => void sauver({ a_revoir: true })} className="rounded-full border border-line px-5 py-2 text-sm text-ink-muted">Marquer à revoir</button>
            <Link to="/espace/dossiers/$id" params={{ id: dossierId }} className="rounded-full bg-[color:var(--crm-navy)] px-5 py-2 text-sm text-primary-foreground">Retour au dossier</Link>
          </div>
        </section>
      )}

      <p className="mt-10 text-center text-xs text-ink-muted">
        Besoin d'aide ? Un conseiller EJ Partners peut vous rappeler ou faire ce point avec vous par téléphone.
      </p>
    </div>
  );
}
