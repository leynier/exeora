import type { ReactNode } from "react";
import { NavLink } from "react-router";
import type { NavIconName, ShellLink } from "./nav.js";

/**
 * The left-hand navigation.
 *
 * On a wide screen it sits in the flow and can collapse to icons, which is the
 * usual console layout. Below `lg` it is a drawer instead: the same list, but
 * over the page, because a persistent rail would leave no room for the work.
 */

export function Sidebar({
  links,
  collapsed,
  mobileOpen,
  onToggleCollapsed,
  back,
  heading,
}: {
  links: readonly ShellLink[];
  collapsed: boolean;
  mobileOpen: boolean;
  onToggleCollapsed: () => void;
  back?: { to: string; label: string };
  heading?: string;
}) {
  return (
    <aside
      id="dashboard-sidebar"
      aria-label={heading ?? "Dashboard"}
      className={`border-border-subtle bg-surface fixed inset-y-0 left-0 z-50 flex shrink-0 flex-col overflow-hidden border-r transition-[width,transform] duration-mid lg:static lg:z-auto lg:translate-x-0 ${
        mobileOpen ? "translate-x-0" : "-translate-x-full max-lg:invisible"
      } ${collapsed ? "w-60 lg:w-16 lg:min-w-16" : "w-60"}`}
    >
      <div
        className={`border-border-subtle flex h-14 shrink-0 items-center border-b ${
          collapsed ? "px-3 lg:justify-center lg:px-0" : "px-3"
        }`}
      >
        <a href="/" className="flex min-w-0 items-center gap-2" aria-label="Exeora, home">
          <svg
            viewBox="0 0 64 44"
            className="text-foreground h-[14px] w-auto shrink-0"
            fill="currentColor"
            aria-hidden="true"
          >
            <rect x="20" y="0" width="24" height="24" rx="4" />
            <rect x="0" y="20" width="24" height="24" rx="4" />
            <rect x="40" y="20" width="24" height="24" rx="4" />
          </svg>
          <span className={`text-title-md tracking-tight ${collapsed ? "lg:hidden" : ""}`}>
            Exeora
          </span>
        </a>
      </div>

      <nav className="flex-1 overflow-y-auto p-2">
        {back && (
          <NavLink
            to={back.to}
            title={collapsed ? back.label : undefined}
            className={`text-foreground-muted hover:bg-surface-variant hover:text-foreground mb-1 flex items-center gap-3 rounded-lg px-3 py-2 text-title-md transition-colors duration-fast ${
              collapsed ? "lg:justify-center lg:px-0" : ""
            }`}
          >
            <BackIcon />
            <span className={collapsed ? "lg:sr-only" : undefined}>{back.label}</span>
          </NavLink>
        )}
        {heading && (
          <p
            className={`text-label-md text-foreground-faint px-3 pt-1 pb-2 font-mono uppercase ${
              collapsed ? "lg:sr-only" : ""
            }`}
          >
            {heading}
          </p>
        )}
        <ul className="space-y-0.5">
          {links.map((link) => (
            <li key={link.to}>
              <NavLink
                to={link.to}
                end={link.end}
                title={collapsed ? link.label : undefined}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-3 py-2 text-title-md transition-colors duration-fast ${
                    collapsed ? "lg:justify-center lg:px-0" : ""
                  } ${
                    isActive
                      ? "bg-accent-subtle text-foreground"
                      : "text-foreground-muted hover:bg-surface-variant hover:text-foreground"
                  }`
                }
              >
                <NavIcon name={link.icon} />
                <span className={collapsed ? "lg:sr-only" : undefined}>{link.label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className="border-border-subtle hidden shrink-0 border-t p-2 lg:block">
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-expanded={!collapsed}
          aria-controls="dashboard-sidebar"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={`text-foreground-muted hover:bg-surface-variant hover:text-foreground flex w-full items-center gap-3 rounded-lg px-3 py-2 text-title-md transition-colors duration-fast ${
            collapsed ? "justify-center px-0" : ""
          }`}
        >
          <CollapseIcon collapsed={collapsed} />
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );
}

function BackIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15 6l-6 6 6 6" />
    </svg>
  );
}

function NavIcon({ name }: { name: NavIconName }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {icons[name]}
    </svg>
  );
}

function CollapseIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {collapsed ? <path d="M9 6l6 6-6 6" /> : <path d="M15 6l-6 6 6 6" />}
    </svg>
  );
}

const icons: Record<NavIconName, ReactNode> = {
  overview: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  machines: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </>
  ),
  projects: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />,
  clients: (
    <>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </>
  ),
  activity: <path d="M22 12h-4l-3 7L9 3l-3 9H2" />,
  workspace: <path d="M7 8l-4 4 4 4M17 8l4 4-4 4M14 4l-4 16" />,
  settings: <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />,
  admin: <path d="M12 3 4 6v5c0 5 3.4 8.4 8 10 4.6-1.6 8-5 8-10V6Z" />,
  users: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
};
