import { useState } from "react";
import { Link } from "@tanstack/react-router";

import type { NavGroup } from "@/lib/navigation";

export function ModuleColumn({
  groups,
  pathname,
  onNavigate,
  header,
  footer,
  taskCount,
}: {
  groups: NavGroup[];
  pathname: string;
  onNavigate?: () => void;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  taskCount?: number | null;
}) {
  const [collapsed, setCollapsed] = useState(false);

  const estActif = (to: string, exact?: boolean) =>
    exact ? pathname === to : pathname === to || pathname.startsWith(`${to}/`);

  return (
    <aside
      id="crm-navigation"
      aria-label="Navigation principale"
      className={`flex h-dvh w-[min(86vw,19rem)] shrink-0 flex-col border-r border-line bg-surface-elevated transition-[width] duration-200 lg:sticky lg:top-0 lg:h-screen ${collapsed ? "lg:w-[4.5rem]" : "lg:w-64"}`}
    >
      <div
        className={`flex min-h-16 items-center border-b border-line px-3 ${collapsed ? "justify-center lg:px-2" : "justify-between px-5"}`}
      >
        <div className="flex min-w-0 items-center gap-3">
          {header}
          {!collapsed && (
            <span className="truncate text-xs font-semibold uppercase tracking-[0.12em] text-ink-soft">
              EJ Assurances
            </span>
          )}
        </div>
        <button
          type="button"
          aria-label={collapsed ? "Agrandir le menu" : "Réduire le menu"}
          aria-expanded={!collapsed}
          title={collapsed ? "Agrandir le menu" : "Réduire le menu"}
          onClick={() => setCollapsed((value) => !value)}
          className="hidden size-8 shrink-0 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface hover:text-ink lg:flex"
        >
          <span aria-hidden="true">{collapsed ? "→" : "←"}</span>
        </button>
      </div>

      <nav
        className="min-h-0 flex-1 space-y-5 overflow-y-auto px-3 py-4"
        aria-label="Sections du CRM"
      >
        {groups.map((group) => (
          <section key={group.key} aria-label={group.label}>
            <p
              className={`px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-muted ${collapsed ? "lg:sr-only" : ""}`}
            >
              {group.label}
            </p>
            <ul className="space-y-1">
              {group.items.map((item) => {
                const active = estActif(item.to, item.exact);
                const badge = item.label === "Tâches" && taskCount ? taskCount : null;
                return (
                  <li key={`${item.to}-${item.label}`}>
                    <Link
                      to={item.to}
                      onClick={onNavigate}
                      aria-label={item.label}
                      aria-current={active ? "page" : undefined}
                      title={item.label}
                      className={`group relative flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${collapsed ? "lg:justify-center lg:px-2" : ""} ${active ? "bg-[color:var(--crm-navy)] text-white shadow-sm" : "text-ink-soft hover:bg-surface hover:text-ink"}`}
                    >
                      <item.icon size={18} stroke={1.8} aria-hidden="true" className="shrink-0" />
                      <span className={`min-w-0 flex-1 truncate ${collapsed ? "lg:sr-only" : ""}`}>
                        {item.label}
                      </span>
                      {badge !== null && !collapsed && (
                        <span
                          className={`min-w-5 rounded-full px-1.5 py-0.5 text-center text-[10px] font-semibold ${active ? "bg-white/15 text-white" : "bg-[color:var(--crm-gold)]/15 text-ink"}`}
                        >
                          {badge > 99 ? "99+" : badge}
                        </span>
                      )}
                      {badge !== null && collapsed && (
                        <span className="absolute right-1 top-0 hidden rounded-full bg-[color:var(--crm-gold)] px-1 text-[9px] font-bold text-white lg:block">
                          {badge > 99 ? "99+" : badge}
                        </span>
                      )}
                      {active && <span className="sr-only">Page active</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </nav>

      {footer && (
        <div className={`border-t border-line px-3 py-3 ${collapsed ? "lg:px-2" : "px-5"}`}>
          {footer}
        </div>
      )}
    </aside>
  );
}
