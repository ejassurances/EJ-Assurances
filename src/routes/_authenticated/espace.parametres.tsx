import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { validerChangementMotDePasse, enregistrerConsentementsPlateforme } from "@/lib/client-espace.functions";
import { testerConnexionEmailCrm } from "@/lib/emails.functions";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/page-header";
import { IconSettings } from "@tabler/icons-react";

export const Route = createFileRoute("/_authenticated/espace/parametres")({
  component: Parametres,
});

function Parametres() {
  const { user, role } = useAuth();

  const [fullName, setFullName] = useState<string>((user?.user_metadata as { full_name?: string })?.full_name ?? "");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const [currentPwd, setCurrentPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [savingPwd, setSavingPwd] = useState(false);
  const [pwdMsg, setPwdMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [mustChange, setMustChange] = useState(false);
  const validerMdp = useServerFn(validerChangementMotDePasse);
  const enregistrerConsentements = useServerFn(enregistrerConsentementsPlateforme);
  const testerEmail = useServerFn(testerConnexionEmailCrm);
  const [testEmailBusy, setTestEmailBusy] = useState(false);
  const [testEmailMsg, setTestEmailMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [okRgpd, setOkRgpd] = useState(false);
  const [okCgu, setOkCgu] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase.from("profiles").select("must_change_password").eq("id", user.id).maybeSingle();
      setMustChange(!!(data as { must_change_password?: boolean } | null)?.must_change_password);
    })();
  }, [user]);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSavingProfile(true);
    setProfileMsg(null);
    const [{ error: authErr }, { error: profErr }] = await Promise.all([
      supabase.auth.updateUser({ data: { full_name: fullName } }),
      supabase.from("profiles").update({ full_name: fullName } as never).eq("id", user!.id),
    ]);
    setSavingProfile(false);
    if (authErr || profErr) {
      setProfileMsg({ type: "err", text: (authErr || profErr)!.message });
    } else {
      setProfileMsg({ type: "ok", text: "Profil mis à jour." });
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwdMsg(null);
    if (newPwd.length < 8) {
      setPwdMsg({ type: "err", text: "Le nouveau mot de passe doit contenir au moins 8 caractères." });
      return;
    }
    if (newPwd !== confirmPwd) {
      setPwdMsg({ type: "err", text: "Les deux mots de passe ne correspondent pas." });
      return;
    }
    if (mustChange && (!okRgpd || !okCgu)) {
      setPwdMsg({
        type: "err",
        text: "Vous devez accepter la politique de confidentialité (RGPD) et les conditions générales d'utilisation pour continuer.",
      });
      return;
    }
    setSavingPwd(true);
    // Revérifie le mot de passe actuel via une tentative de connexion silencieuse.
    const verif = await supabase.auth.signInWithPassword({
      email: user!.email!,
      password: currentPwd,
    });
    if (verif.error) {
      setSavingPwd(false);
      setPwdMsg({ type: "err", text: "Mot de passe actuel incorrect." });
      return;
    }
    const { error } = await supabase.auth.updateUser({ password: newPwd });
    setSavingPwd(false);
    if (error) {
      setPwdMsg({ type: "err", text: error.message });
      return;
    }
    setCurrentPwd("");
    setNewPwd("");
    setConfirmPwd("");
    setPwdMsg({ type: "ok", text: "Mot de passe modifié avec succès." });
    if (mustChange) {
      try {
        await enregistrerConsentements({ data: undefined });
      } catch {
        // sans effet bloquant
      }
      try {
        await validerMdp({ data: undefined });
      } catch {
        // sans effet bloquant
      }
      setMustChange(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-8">
      {mustChange && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-medium">Changement de mot de passe obligatoire</p>
          <p className="mt-1">
            Votre compte a été créé avec un mot de passe provisoire. Pour accéder à votre espace, définissez un
            nouveau mot de passe ci-dessous.
          </p>
        </div>
      )}

      <PageHeader
        eyebrow="Mon compte"
        title="Paramètres du compte"
        description={`${user?.email ?? ""} · ${role ?? ""}`}
        icon={IconSettings}
      />

      {(role === "admin" || role === "mandataire") && (
        <section className="crm-card space-y-3 p-5">
          <div>
            <h2 className="font-serif text-lg font-medium">Messagerie IONOS du CRM</h2>
            <p className="mt-1 text-sm text-ink-muted">Vérifie les accès IMAP (réception) et SMTP (envoi) sans envoyer de message.</p>
          </div>
          <button type="button" disabled={testEmailBusy} onClick={async () => {
            setTestEmailBusy(true);
            setTestEmailMsg(null);
            try {
              await testerEmail({ data: {} });
              setTestEmailMsg({ type: "ok", text: "Connexion IMAP et authentification SMTP réussies. Vous pouvez tester la réception et l'envoi depuis le CRM." });
            } catch (err) {
              setTestEmailMsg({ type: "err", text: err instanceof Error ? err.message : "Test de messagerie impossible." });
            } finally {
              setTestEmailBusy(false);
            }
          }} className="rounded-md bg-[#0A192F] px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
            {testEmailBusy ? "Vérification…" : "Tester la connexion e-mail"}
          </button>
          {testEmailMsg && <p className={`text-sm ${testEmailMsg.type === "ok" ? "text-emerald-700" : "text-red-700"}`}>{testEmailMsg.text}</p>}
        </section>
      )}

      {(role === "admin" || role === "mandataire") && (
        <section className="crm-card flex flex-wrap items-center justify-between gap-4 p-5">
          <div>
            <h2 className="font-serif text-lg font-medium">Suivi conformité du cabinet</h2>
            <p className="mt-1 max-w-xl text-sm text-ink-muted">Accéder au registre ACPR / DDA, aux obligations à vérifier, aux preuves attendues et aux actions correctives en cours.</p>
          </div>
          <Link to="/espace/conformite" className="inline-flex items-center rounded-md bg-[#0A192F] px-4 py-2 text-sm font-medium text-white hover:bg-[#0A192F]/90">
            Ouvrir la conformité
          </Link>
        </section>
      )}

      <form onSubmit={saveProfile} className="crm-card space-y-4 p-5">
        <h2 className="crm-eyebrow">Profil</h2>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-muted">Nom complet</label>
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-muted">Adresse e-mail</label>
          <input
            value={user?.email ?? ""}
            readOnly
            className="w-full rounded-md border border-line bg-surface-elevated px-3 py-2 text-sm text-ink-muted"
          />
          <p className="mt-1 text-xs text-ink-muted">
            La modification de l'adresse e-mail se fait sur demande auprès de l'administrateur.
          </p>
        </div>
        {profileMsg && (
          <p className={`text-sm ${profileMsg.type === "ok" ? "text-emerald-700" : "text-red-700"}`}>
            {profileMsg.text}
          </p>
        )}
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={savingProfile}
            className="rounded-md bg-[#0A192F] px-5 py-2 text-sm font-medium text-white hover:bg-[#0A192F]/90 disabled:opacity-60"
          >
            {savingProfile ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      </form>

      <form onSubmit={changePassword} className="crm-card space-y-4 p-5">
        <h2 className="crm-eyebrow">Changer de mot de passe</h2>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-muted">Mot de passe actuel</label>
          <input
            type="password"
            value={currentPwd}
            onChange={(e) => setCurrentPwd(e.target.value)}
            autoComplete="current-password"
            required
            className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-muted">Nouveau mot de passe</label>
          <input
            type="password"
            value={newPwd}
            onChange={(e) => setNewPwd(e.target.value)}
            autoComplete="new-password"
            required
            minLength={8}
            className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-ink-muted">Minimum 8 caractères.</p>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-muted">Confirmer le nouveau mot de passe</label>
          <input
            type="password"
            value={confirmPwd}
            onChange={(e) => setConfirmPwd(e.target.value)}
            autoComplete="new-password"
            required
            minLength={8}
            className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
          />
        </div>
        {mustChange && (
          <div className="space-y-3 rounded-md border border-line bg-surface-elevated p-4">
            <label className="flex items-start gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={okRgpd}
                onChange={(e) => setOkRgpd(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                J'ai lu et j'accepte la{" "}
                <Link to="/espace/confidentialite" target="_blank" className="underline">
                  politique de confidentialité (RGPD)
                </Link>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={okCgu}
                onChange={(e) => setOkCgu(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                J'ai lu et j'accepte les{" "}
                <Link to="/espace/cgu" target="_blank" className="underline">
                  conditions générales d'utilisation de la plateforme
                </Link>
              </span>
            </label>
          </div>
        )}
        {pwdMsg && (
          <p className={`text-sm ${pwdMsg.type === "ok" ? "text-emerald-700" : "text-red-700"}`}>{pwdMsg.text}</p>
        )}
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={savingPwd || (mustChange && (!okRgpd || !okCgu))}
            className="rounded-md bg-[#0A192F] px-5 py-2 text-sm font-medium text-white hover:bg-[#0A192F]/90 disabled:opacity-60"
          >
            {savingPwd ? "Modification…" : "Modifier le mot de passe"}
          </button>
        </div>
      </form>
    </div>
  );
}
