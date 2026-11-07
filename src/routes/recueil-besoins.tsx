import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";

import { RecueilWorkflow } from "@/components/recueil-workflow";
import { getBranche } from "@/lib/recueil-besoins-schemas";
import { chargerRecueilPublic, enregistrerRecueilPublic } from "@/lib/recueil-public.functions";

/**
 * Recueil des besoins emprunteur ouvert depuis le lien de l'e-mail envoyé
 * après une demande d'étude sur le site public. Pas de compte client (V1) :
 * l'accès repose sur le jeton du lien, vérifié côté serveur.
 */
export const Route = createFileRoute("/recueil-besoins")({
  validateSearch: (search: Record<string, unknown>): { token?: string } => ({
    ...(typeof search["token"] === "string" ? { token: search["token"] } : {}),
  }),
  head: () => ({
    meta: [
      { title: "Votre recueil des besoins — EJ Partners Assurances" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: RecueilBesoinsPublic,
});

function RecueilBesoinsPublic() {
  const { token } = Route.useSearch();
  const charger = useServerFn(chargerRecueilPublic);
  const enregistrer = useServerFn(enregistrerRecueilPublic);
  const branche = getBranche("emprunteur");

  const [etat, setEtat] = useState<"chargement" | "pret" | "envoi" | "termine" | "erreur">(
    "chargement",
  );
  const [erreur, setErreur] = useState<string | null>(null);
  const [prenom, setPrenom] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);
  const [valeurs, setValeurs] = useState<Record<string, unknown>>({});
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!token) {
      setErreur("Ce lien est incomplet. Utilisez le lien reçu par e-mail.");
      setEtat("erreur");
      return;
    }
    charger({ data: { token } })
      .then((res) => {
        setPrenom(res.prenom);
        setReference(res.reference);
        setValeurs(JSON.parse(res.recueilJson) as Record<string, unknown>);
        setEtat("pret");
      })
      .catch((e: unknown) => {
        setErreur(e instanceof Error ? e.message : "Lien indisponible.");
        setEtat("erreur");
      });
  }, [token, charger]);

  const sauvegarder = async (final: boolean) => {
    if (!token) return;
    setErreur(null);
    if (final) setEtat("envoi");
    try {
      await enregistrer({
        data: { token, recueil: valeurs, final, message: message.trim() || null },
      });
      if (final) setEtat("termine");
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Enregistrement impossible.");
      if (final) setEtat("pret");
    }
  };

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-wide text-ink-muted">EJ Partners Assurances</p>
        <h1 className="text-2xl font-semibold">
          {prenom ? `Bonjour ${prenom}, votre recueil des besoins` : "Votre recueil des besoins"}
        </h1>
        <p className="text-sm text-ink-muted">
          Assurance de prêt immobilier{reference ? ` · dossier ${reference}` : ""}. Vos réponses
          sont enregistrées à chaque étape : vous pouvez revenir plus tard avec le même lien.
        </p>
      </header>

      {erreur && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          {erreur}
        </div>
      )}

      {etat === "chargement" && <p className="text-sm text-ink-muted">Chargement…</p>}

      {etat === "termine" && (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-6 text-sm text-emerald-900">
          <p className="font-medium">Merci, votre recueil est bien transmis.</p>
          <p className="mt-2">
            Votre conseiller l'étudie et revient vers vous sous 72 heures. Si un document manque, il
            vous le demandera par e-mail.
          </p>
        </div>
      )}

      {(etat === "pret" || etat === "envoi") && branche && (
        <RecueilWorkflow
          branche={branche}
          values={valeurs}
          onChange={setValeurs}
          onSaveStep={() => void sauvegarder(false)}
          onComplete={() => void sauvegarder(true)}
          completeLabel={etat === "envoi" ? "Envoi…" : "Envoyer mon recueil"}
          titreEntete="Recueil des besoins · Assurance emprunteur"
        >
          <div className="space-y-4">
            <label className="block">
              <span className="mb-1 block text-xs uppercase tracking-wide text-ink-muted">
                Précisions pour votre conseiller (facultatif)
              </span>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
                maxLength={2000}
                className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
              />
            </label>
            <p className="text-xs text-ink-muted">
              Ne transmettez aucune information médicale détaillée ici : si elle est nécessaire,
              votre conseiller vous indiquera le canal sécurisé prévu par l'assureur.
            </p>
          </div>
        </RecueilWorkflow>
      )}
    </main>
  );
}
