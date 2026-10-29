import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/page-header";
import { IconMailCheck } from "@tabler/icons-react";
import { testerConnexionEmailCrm } from "@/lib/emails.functions";

export const Route = createFileRoute("/_authenticated/espace/mail-test")({
  component: TestMessagerie,
});

function TestMessagerie() {
  const { role } = useAuth();
  const testerEmail = useServerFn(testerConnexionEmailCrm);
  const [busy, setBusy] = useState(false);
  const [resultat, setResultat] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  if (role !== "admin" && role !== "mandataire") {
    return <p className="text-sm text-ink-muted">Accès réservé au cabinet.</p>;
  }

  async function tester() {
    setBusy(true);
    setResultat(null);
    try {
      await testerEmail({ data: {} });
      setResultat({
        type: "ok",
        text: "Connexion IMAP et authentification SMTP réussies. La réception et l'envoi peuvent maintenant être testés depuis le CRM.",
      });
    } catch (error) {
      setResultat({
        type: "err",
        text: error instanceof Error ? error.message : "Test de messagerie impossible.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader
        eyebrow="Diagnostic technique"
        title="Messagerie IONOS"
        description="Vérifier la réception et l'envoi du CRM sans envoyer de message de test."
        icon={IconMailCheck}
      />
      <section className="crm-card space-y-4 p-5">
        <p className="text-sm text-ink-muted">
          Vérifie IMAP et SMTP côté serveur sans envoyer de message.
        </p>
        <button
          type="button"
          onClick={tester}
          disabled={busy}
          className="rounded-md bg-[#0A192F] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {busy ? "Vérification…" : "Tester la connexion e-mail"}
        </button>
        {resultat && (
          <p className={`text-sm ${resultat.type === "ok" ? "text-emerald-700" : "text-red-700"}`}>
            {resultat.text}
          </p>
        )}
      </section>
    </div>
  );
}
