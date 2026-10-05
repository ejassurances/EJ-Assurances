import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { IconFolderPlus } from "@tabler/icons-react";

import { GlobalSearch } from "@/components/shell/global-search";
import { IconAction } from "@/components/shell/icon-action";
import { QuickActions } from "@/components/shell/quick-actions";
import { ModuleColumn } from "@/components/shell/module-column";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { groupesVisibles, libelleRouteActive, type AppRole } from "@/lib/navigation";

export const Route = createFileRoute("/_authenticated/espace")({
  component: EspaceLayout,
});

const ROLE_LABEL: Record<string, string> = {
  admin: "Administrateur",
  mandataire: "Mandataire",
  client: "Client",
  prescripteur: "Prescripteur",
};

function EspaceLayout() {
  const { user, role, loading } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [mustChange, setMustChange] = useState(false);
  const [menuOuvert, setMenuOuvert] = useState(false);
  const [tachesOuvertes, setTachesOuvertes] = useState<number | null>(null);

  // Compteur de tâches à traiter affiché dans la barre supérieure (lecture seule).
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { count } = await supabase
        .from("taches")
        .select("id", { count: "exact", head: true })
        .in("statut", ["a_faire", "en_cours"]);
      setTachesOuvertes(count ?? null);
    })();
  }, [user]);

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  // Changement de mot de passe obligatoire après création automatique du compte.
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("must_change_password")
        .eq("id", user.id)
        .maybeSingle();
      setMustChange(!!(data as { must_change_password?: boolean } | null)?.must_change_password);
    })();
  }, [user]);

  useEffect(() => {
    if (mustChange && pathname !== "/espace/parametres") {
      navigate({ to: "/espace/parametres", replace: true });
    }
  }, [mustChange, pathname, navigate]);

  const roleNav = (role ?? null) as AppRole | null;
  const groupes = useMemo(() => groupesVisibles(roleNav), [roleNav]);
  const routeActive = useMemo(() => libelleRouteActive(pathname, groupes), [pathname, groupes]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-ink-muted">
        Chargement…
      </div>
    );
  }

  const initiales = (user?.email ?? "")
    .replace(/@.*/, "")
    .split(/[.\-_]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("");

  const logo = (
    <Link to="/espace" onClick={() => setMenuOuvert(false)} aria-label="EJ Partners Assurances">
      <img
        src="/logo-ej-partners.png"
        alt=""
        className="size-9 rounded-sm object-cover ring-1 ring-[color:var(--crm-gold)]/40"
      />
    </Link>
  );

  const avatar = (
    <button
      type="button"
      onClick={() => {
        setMenuOuvert(false);
        void signOut();
      }}
      title={`${user?.email ?? ""} — Se déconnecter`}
      className="flex w-full items-center gap-2 rounded-sm px-1 py-2 text-ink-muted transition-colors hover:bg-surface hover:text-ink"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-[color:var(--crm-gold)]/40 bg-[color:var(--crm-gold)]/15 text-[10px] font-bold text-[color:var(--crm-gold)]">
        {initiales || "EJ"}
      </span>
      <span className="text-xs font-semibold uppercase tracking-[0.08em]">Quitter</span>
    </button>
  );

  return (
    <div className="crm-theme flex min-h-screen bg-background">
      {/* Voile mobile */}
      {menuOuvert && (
        <button
          type="button"
          aria-label="Fermer le menu"
          onClick={() => setMenuOuvert(false)}
          className="fixed inset-0 z-30 bg-ink/50 lg:hidden"
        />
      )}

      {/* Navigation principale, avec le même contenu dans le drawer mobile. */}
      <div
        className={
          "fixed inset-y-0 left-0 z-40 flex transition-transform duration-200 lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:translate-x-0 " +
          (menuOuvert ? "translate-x-0" : "-translate-x-full")
        }
      >
        <ModuleColumn
          groups={groupes}
          pathname={pathname}
          onNavigate={() => setMenuOuvert(false)}
          header={logo}
          footer={avatar}
          taskCount={tachesOuvertes}
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b border-line bg-surface-elevated">
          <div className="flex min-w-0 items-center gap-2 px-3 py-2 sm:h-16 sm:gap-3 sm:px-6 sm:py-0">
            <button
              type="button"
              onClick={() => setMenuOuvert(true)}
              aria-label="Ouvrir le menu"
              aria-expanded={menuOuvert}
              aria-controls="crm-navigation"
              className="shrink-0 rounded-full border border-line px-3 py-2 text-ink-soft lg:hidden"
            >
              <span aria-hidden="true">☰</span>
            </button>

            <div className="hidden min-w-0 flex-1 justify-center md:flex">
              <GlobalSearch />
            </div>

            <div className="flex min-w-0 flex-1 items-center justify-end gap-2 md:flex-none">
              {role === "admin" || role === "mandataire" ? (
                <Link
                  to="/espace/dossiers/nouveau"
                  aria-label="Nouveau dossier"
                  title="Nouveau client & dossier"
                  className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full bg-[color:var(--crm-navy)] px-3 text-xs font-semibold text-white transition-colors hover:bg-[color:var(--crm-navy)]/90 sm:gap-2 sm:px-4 sm:text-sm"
                >
                  <IconFolderPlus size={17} aria-hidden="true" />
                  <span className="sm:hidden">+ Dossier</span>
                  <span className="hidden sm:inline">+ Nouveau dossier</span>
                </Link>
              ) : null}
              <QuickActions compact />
              <span className="crm-eyebrow hidden xl:inline">{role ? ROLE_LABEL[role] : ""}</span>
              <IconAction
                label={`${user?.email ?? ""} — Se déconnecter`}
                onClick={() => void signOut()}
              >
                <span className="text-[11px] font-bold text-[color:var(--crm-gold)]">
                  {initiales || "EJ"}
                </span>
              </IconAction>
            </div>
          </div>

          <div className="border-t border-line px-3 py-2 md:hidden">
            <GlobalSearch />
          </div>

          <nav
            aria-label="Fil d'Ariane"
            className="min-w-0 truncate border-t border-line px-4 py-2 text-xs text-ink-muted sm:px-6"
          >
            {routeActive && (
              <span className="font-semibold uppercase tracking-[0.14em]">{routeActive.group}</span>
            )}
            {routeActive && (
              <>
                <span aria-hidden="true" className="px-2 text-ink-muted/50">
                  ›
                </span>
                <span className="text-ink">{routeActive.item}</span>
              </>
            )}
          </nav>
        </header>

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 sm:py-8">
          <div className="mx-auto min-w-0 w-full max-w-[1700px]">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
