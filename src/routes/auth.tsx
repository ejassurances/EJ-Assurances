import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { SITE } from "@/lib/site";
import { useServerFn } from "@tanstack/react-start";
import { demanderReinitialisationMotDePasse } from "@/lib/auth-email.functions";

export const Route = createFileRoute("/auth")({
  // Page d'authentification : pas de SSR (noindex, dépend du navigateur),
  // évite le mismatch d'hydration sur le composant lazy.
  ssr: false,
  head: () => ({
    meta: [
      { title: `Connexion — CRM ${SITE.name}` },
      { name: "description", content: "Accès sécurisé au CRM du cabinet EJ Partners Assurances." },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [monte, setMonte] = useState(false);
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);

  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotMsg, setForgotMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const demanderReset = useServerFn(demanderReinitialisationMotDePasse);

  useEffect(() => {
    setMonte(true);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/espace" });
    });
  }, [navigate]);

  // Rendu uniquement après montage : évite le mismatch d'hydration (route sans SSR).
  if (!monte) return null;

  /** Connexion Google Workspace (comptes @ej-assurances.fr en priorité). */
  const connexionGoogle = async () => {
    setGoogleError(null);
    setGoogleLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: window.location.origin,
          queryParams: { prompt: "select_account" },
        },
      });
      if (error) setGoogleError(error.message || "Connexion Google impossible.");
    } catch (err) {
      setGoogleError(err instanceof Error ? err.message : "Connexion Google impossible.");
    } finally {
      setGoogleLoading(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      navigate({ to: "/espace" });
    } catch (err) {
      setError(
        err instanceof Error && /invalid login/i.test(err.message)
          ? "Identifiants incorrects."
          : err instanceof Error
            ? err.message
            : "Erreur de connexion",
      );
    } finally {
      setLoading(false);
    }
  };

  const requestReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotMsg(null);
    setForgotLoading(true);
    try {
      await demanderReset({ data: { email: forgotEmail } });
      setForgotMsg({
        type: "ok",
        text: "Si un compte existe pour cette adresse, un e-mail de réinitialisation vient d'être envoyé.",
      });
    } catch (err) {
      setForgotMsg({ type: "err", text: err instanceof Error ? err.message : "Erreur d'envoi" });
    }
    setForgotLoading(false);
  };

  const inputClass =
    "mt-1.5 w-full rounded-lg border border-white/15 bg-white/5 px-3.5 py-2.5 text-sm text-white placeholder:text-white/35 outline-none transition focus:border-[#d4af37] focus:ring-2 focus:ring-[#d4af37]/25";
  const labelClass = "text-[11px] font-semibold uppercase tracking-[0.14em] text-white/55";
  const buttonClass =
    "w-full rounded-lg bg-[#d4af37] px-5 py-2.5 text-sm font-semibold text-[#0a192f] transition hover:brightness-110 disabled:opacity-50";

  return (
    <div
      className="min-h-screen font-sans"
      style={{
        backgroundColor: "#0a192f",
        backgroundImage:
          "radial-gradient(80rem 40rem at 50% -10%, rgba(212,175,55,0.10), transparent 60%)",
        fontFamily: '"Plus Jakarta Sans", Inter, system-ui, sans-serif',
      }}
    >
      <div className="flex min-h-screen items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="flex flex-col items-center text-center">
            <img
              src="/logo-ej-partners.png"
              alt={`Logo ${SITE.name}`}
              className="size-14 rounded-xl object-cover ring-1 ring-[#d4af37]/40"
            />
            <h1 className="mt-5 font-sans text-2xl font-bold tracking-tight text-white">
              {SITE.name}
            </h1>
            <p className="mt-1.5 text-sm text-white/55">CRM interne — accès sécurisé</p>
            <span className="mt-4 h-px w-16 bg-[#d4af37]/60" />
          </div>

          <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.04] p-7 shadow-2xl backdrop-blur">
            {!forgotOpen ? (
              <>
                <h2 className="font-sans text-base font-semibold text-white">Connexion</h2>
                <p className="mt-1 text-xs text-white/50">
                  Administrateur, mandataire, prescripteur ou client.
                </p>

                <form onSubmit={submit} className="mt-6 space-y-4">
                  <div>
                    <label htmlFor="email" className={labelClass}>
                      Email
                    </label>
                    <input
                      id="email"
                      type="email"
                      autoComplete="email"
                      required
                      placeholder="prenom.nom@ej-assurances.fr"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label htmlFor="password" className={labelClass}>
                      Mot de passe
                    </label>
                    <div className="relative">
                      <input
                        id="password"
                        type={showPwd ? "text" : "password"}
                        autoComplete="current-password"
                        required
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className={`${inputClass} pr-16`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPwd((v) => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-white/50 hover:text-white"
                      >
                        {showPwd ? "Masquer" : "Afficher"}
                      </button>
                    </div>
                  </div>

                  {error && (
                    <p className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                      {error}
                    </p>
                  )}

                  <button type="submit" disabled={loading} className={buttonClass}>
                    {loading ? "Connexion…" : "Se connecter"}
                  </button>
                </form>

                <div className="my-5 flex items-center gap-3">
                  <span className="h-px flex-1 bg-white/10" />
                  <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40">
                    ou
                  </span>
                  <span className="h-px flex-1 bg-white/10" />
                </div>

                <button
                  type="button"
                  onClick={connexionGoogle}
                  disabled={googleLoading}
                  className="flex w-full items-center justify-center gap-3 rounded-lg border border-white/15 bg-white px-5 py-2.5 text-sm font-semibold text-[#1f1f1f] transition hover:bg-white/90 disabled:opacity-50"
                >
                  <svg viewBox="0 0 48 48" aria-hidden="true" className="size-5">
                    <path
                      fill="#EA4335"
                      d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                    />
                    <path
                      fill="#4285F4"
                      d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M10.53 28.59A14.5 14.5 0 0 1 9.77 24c0-1.6.27-3.15.76-4.59l-7.97-6.19A23.94 23.94 0 0 0 0 24c0 3.88.93 7.54 2.56 10.78l7.97-6.19z"
                    />
                    <path
                      fill="#34A853"
                      d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.46-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                    />
                  </svg>
                  {googleLoading ? "Ouverture de Google…" : "Se connecter avec Google Workspace"}
                </button>

                {googleError && (
                  <p className="mt-3 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                    {googleError}
                  </p>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setForgotOpen(true);
                    setForgotEmail(email);
                    setForgotMsg(null);
                  }}
                  className="mt-4 w-full text-center text-xs text-white/55 underline underline-offset-4 hover:text-white"
                >
                  Mot de passe oublié ?
                </button>

                <p className="mt-6 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-3 text-[11px] leading-relaxed text-white/50">
                  Les accès collaborateurs et les espaces clients sont créés exclusivement sur invitation du cabinet.
                </p>
              </>
            ) : (
              <form onSubmit={requestReset} className="space-y-4">
                <h2 className="font-sans text-base font-semibold text-white">
                  Réinitialiser le mot de passe
                </h2>
                <div>
                  <label htmlFor="forgot" className={labelClass}>
                    Adresse e-mail du compte
                  </label>
                  <input
                    id="forgot"
                    type="email"
                    required
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    className={inputClass}
                  />
                  <p className="mt-1.5 text-xs text-white/45">
                    Vous recevrez un lien pour définir un nouveau mot de passe.
                  </p>
                </div>

                {forgotMsg && (
                  <p
                    className={`rounded-lg px-3 py-2 text-sm ${
                      forgotMsg.type === "ok"
                        ? "border border-[#d4af37]/30 bg-[#d4af37]/10 text-[#d4af37]"
                        : "border border-red-400/30 bg-red-500/10 text-red-200"
                    }`}
                  >
                    {forgotMsg.text}
                  </p>
                )}

                <button type="submit" disabled={forgotLoading} className={buttonClass}>
                  {forgotLoading ? "Envoi…" : "Envoyer le lien"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setForgotOpen(false);
                    setForgotMsg(null);
                  }}
                  className="w-full text-center text-xs text-white/55 underline underline-offset-4 hover:text-white"
                >
                  Retour à la connexion
                </button>
              </form>
            )}
          </div>

          <p className="mt-6 text-center text-[11px] text-white/35">
            {SITE.name} · {SITE.orias} · SIRET {SITE.siret}
          </p>
        </div>
      </div>
    </div>
  );
}
