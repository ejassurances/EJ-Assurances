import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";

import { RecueilWorkflow } from "@/components/recueil-workflow";
import { getBranche } from "@/lib/recueil-besoins-schemas";
import { envoyerMonRecueil, mesRecueilsAFaire } from "@/lib/recueil-espace-client.functions";

/**
 * Invite le client à transmettre son recueil des besoins emprunteur pour un
 * dossier déjà ouvert : soit en remplissant le formulaire, soit en déposant
 * ses documents (offre de prêt, tableau d'amortissement, CNI de chaque assuré)
 * dans l'onglet des pièces.
 */
export function RecueilEspaceClientCard({ onEnvoye }: { onEnvoye?: () => void }) {
  const charger = useServerFn(mesRecueilsAFaire);
  const envoyer = useServerFn(envoyerMonRecueil);
  const branche = getBranche("emprunteur");

  const [dossiers, setDossiers] = useState<{ id: string; reference: string }[]>([]);
  const [ouvert, setOuvert] = useState<string | null>(null);
  const [valeurs, setValeurs] = useState<Record<string, unknown>>({});
  const [message, setMessage] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    charger()
      .then((res) => setDossiers(res.dossiers))
      .catch(() => setDossiers([]));
  }, [charger]);

  // Brouillon local : rien n'est envoyé au cabinet avant validation finale.
  const cleBrouillon = (id: string) => `recueil-emprunteur-brouillon:${id}`;
  const ouvrir = (id: string) => {
    let brouillon: Record<string, unknown> = {};
    try {
      const brut = window.localStorage.getItem(cleBrouillon(id));
      if (brut) brouillon = JSON.parse(brut) as Record<string, unknown>;
    } catch {
      brouillon = {};
    }
    setValeurs(brouillon);
    setOuvert(id);
  };
  const majValeurs = (v: Record<string, unknown>) => {
    setValeurs(v);
    if (!ouvert) return;
    try {
      window.localStorage.setItem(cleBrouillon(ouvert), JSON.stringify(v));
    } catch {
      /* stockage indisponible : le brouillon reste en mémoire */
    }
  };

  const valider = async () => {
    if (!ouvert) return;
    setEnvoi(true);
    setErreur(null);
    try {
      const res = await envoyer({
        data: { dossier_id: ouvert, recueil: valeurs, message: message.trim() || null },
      });
      try {
        window.localStorage.removeItem(cleBrouillon(ouvert));
      } catch {
        /* sans effet */
      }
      setOk(
        `Recueil transmis pour le dossier ${res.reference}. Votre lettre de mission vous sera envoyée pour signature, et votre conseiller revient vers vous sous 72 h.`,
      );
      setDossiers((d) => d.filter((x) => x.id !== ouvert));
      setOuvert(null);
      onEnvoye?.();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Envoi impossible");
    }
    setEnvoi(false);
  };

  if (ok) {
    return (
      <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900">
        {ok}
      </div>
    );
  }
  if (dossiers.length === 0 || !branche) return null;

  return (
    <div className="space-y-4 rounded-lg border border-amber-300 bg-amber-50 p-5 text-sm text-amber-950">
      {!ouvert && (
        <>
          <p className="font-medium">Étape suivante : votre recueil des besoins</p>
          <p>Pour lancer l'étude de votre assurance de prêt, deux possibilités :</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>remplir le recueil en ligne (5 à 10 minutes) ;</li>
            <li>
              ou déposer vos documents dans l'onglet des pièces : offre de prêt, tableau
              d'amortissement et pièce d'identité de chaque assuré.
            </li>
          </ul>
          <div className="flex flex-wrap gap-3">
            {dossiers.map((d) => (
              <button
                key={d.id}
                onClick={() => ouvrir(d.id)}
                className="rounded-full bg-[#D4AF37] px-5 py-2 text-sm font-semibold text-[#0A192F] hover:bg-[#c8a233]"
              >
                Remplir le recueil — dossier {d.reference}
              </button>
            ))}
          </div>
        </>
      )}

      {erreur && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">{erreur}</div>
      )}

      {ouvert && (
        <RecueilWorkflow
          branche={branche}
          values={valeurs}
          onChange={majValeurs}
          onBack={() => setOuvert(null)}
          onComplete={() => void valider()}
          completeLabel={envoi ? "Envoi…" : "Envoyer mon recueil"}
          titreEntete="Recueil des besoins · Assurance emprunteur"
        >
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
        </RecueilWorkflow>
      )}
    </div>
  );
}
