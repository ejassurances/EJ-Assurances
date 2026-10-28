import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { lirePiecesPret } from "@/lib/import-pret-verification.functions";
import {
  appliquerValeursPret,
  CHAMPS_IMPORT_PRET,
  CORRESPONDANCES_PRET,
  croiserLecturesPret,
  type ChampImportPret,
  type LecturePret,
} from "@/lib/import-pret-verification";

export type PiecePretVerifiee = { file: File; nature: LecturePret["nature"] };
export function ImportPretVerifie({
  onConfirm,
}: {
  onConfirm: (
    recueil: (base: Record<string, unknown>) => Record<string, unknown>,
    pieces: PiecePretVerifiee[],
    lectures: LecturePret[],
    valeurs: LecturePret["valeurs"],
  ) => Promise<void> | void;
}) {
  const lire = useServerFn(lirePiecesPret);
  const [pieces, setPieces] = useState<PiecePretVerifiee[]>([]);
  const [lectures, setLectures] = useState<LecturePret[]>([]);
  const [valeurs, setValeurs] = useState<LecturePret["valeurs"]>({});
  const [busy, setBusy] = useState(false);
  const [confirme, setConfirme] = useState(false);
  const [analyseFaite, setAnalyseFaite] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const croisement = croiserLecturesPret(lectures);

  async function analyser() {
    setBusy(true);
    setConfirme(false);
    setLectures([]);
    setValeurs({});
    setMessage(null);
    try {
      const fichiers = await Promise.all(
        pieces.map(async (p) => {
          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
            reader.onerror = () => reject(new Error("Lecture impossible"));
            reader.readAsDataURL(p.file);
          });
          return {
            nom: p.file.name,
            nature: p.nature,
            mime: p.file.type as "application/pdf" | "image/jpeg" | "image/png" | "image/webp",
            base64,
          };
        }),
      );
      const resultats = await lire({ data: { fichiers } });
      setLectures(resultats);
      setValeurs(croiserLecturesPret(resultats).valeurs);
      setAnalyseFaite(true);
      if (resultats.some((r) => r.erreur))
        setMessage("Une analyse n'a pas abouti. Vous pouvez continuer sans import.");
    } catch {
      setMessage("Analyse indisponible. Vous pouvez continuer sans ces documents.");
      setAnalyseFaite(true);
      setConfirme(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4 border-y border-line py-4">
      <h3 className="font-serif text-lg text-ink">Documents du prêt (facultatifs)</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        {(["tableau_amortissement", "offre_pret"] as const).map((nature) => (
          <label key={nature} className="space-y-2 text-sm">
            <span>
              {nature === "offre_pret" ? "Offre de prêt" : "Tableau d'amortissement"} — facultatif
            </span>
            <input
              aria-label={nature === "offre_pret" ? "Offre de prêt" : "Tableau d'amortissement"}
              className="block w-full text-xs"
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (
                  !file.size ||
                  file.size > 12 * 1024 * 1024 ||
                  !["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(file.type)
                ) {
                  setMessage("PDF, JPG, PNG ou WEBP, 12 Mo maximum.");
                  e.target.value = "";
                  return;
                }
                setConfirme(false);
                setPieces((p) => [...p.filter((x) => x.nature !== nature), { file, nature }]);
                setAnalyseFaite(false);
                setLectures([]);
                setValeurs({});
                setMessage(null);
              }}
            />
          </label>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={busy || pieces.length === 0}
          onClick={() => void analyser()}
        >
          {busy ? "Analyse…" : "Analyser les documents"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => {
            setPieces([]);
            setLectures([]);
            setValeurs({});
            setConfirme(false);
            setAnalyseFaite(false);
            setMessage("Import ignoré ; saisie manuelle.");
          }}
        >
          Continuer sans import
        </Button>
      </div>
      {lectures.map((l) => (
        <p key={l.nature} className="text-xs text-ink-muted">
          {l.source} · confiance {Math.round(l.confiance * 100)} %{l.erreur ? ` · ${l.erreur}` : ""}
        </p>
      ))}
      {analyseFaite && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {(Object.keys(CHAMPS_IMPORT_PRET) as ChampImportPret[]).map((cle) => (
              <label key={cle} className="text-xs text-ink-muted">
                {CHAMPS_IMPORT_PRET[cle]}
                <input
                  className="mt-1 w-full rounded-md border border-line bg-background px-3 py-2 text-sm text-ink"
                  value={valeurs[cle] ?? ""}
                  placeholder="Non détecté"
                  onChange={(e) => {
                    setConfirme(false);
                    setValeurs((v) => ({ ...v, [cle]: e.target.value }));
                  }}
                />
                {!CORRESPONDANCES_PRET[cle] && (
                  <span className="block">
                    Conservé dans la lecture vérifiée ; aucun champ de dossier dédié.
                  </span>
                )}
                {(croisement.provenance[cle] ?? []).map((s) => (
                  <span key={s.source} className="block">
                    {s.source} : {s.valeur} ({Math.round(s.confiance * 100)} %)
                  </span>
                ))}
                {croisement.contradictions.includes(cle) && (
                  <span className="block text-destructive">
                    Contradiction — vérifiez et saisissez la valeur retenue, ou laissez vide.
                  </span>
                )}
              </label>
            ))}
          </div>
          <Button
            disabled={busy || confirme}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm(
                  (base) => appliquerValeursPret(base, valeurs),
                  pieces,
                  lectures,
                  valeurs,
                );
                setConfirme(true);
                setMessage("Valeurs confirmées. Les champs déjà saisis sont conservés.");
              } catch (e) {
                setMessage(
                  e instanceof Error
                    ? e.message
                    : "Enregistrement impossible ; saisie manuelle possible.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            Confirmer les valeurs et les pièces
          </Button>
        </>
      )}
      {message && (
        <p role="status" className="text-sm text-ink-muted">
          {message}
        </p>
      )}
    </section>
  );
}
