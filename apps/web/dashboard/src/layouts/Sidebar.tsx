import type { CSSProperties, PointerEvent, ReactNode } from "react";
import { useRef, useState } from "react";
import { NavLink } from "react-router";
import type { NavIconName, ShellLink } from "./nav.js";
import { clampSidebarWidth, MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH } from "./sidebarPrefs.js";

/**
 * The left-hand navigation.
 *
 * On a wide screen it sits in the flow, can collapse to icons, and when it is
 * open the right edge can be dragged to a remembered width. Below `lg` it is a
 * drawer instead: the same list, but over the page, because a persistent rail
 * would leave no room for the work.
 */

export function Sidebar({
  links,
  collapsed,
  mobileOpen,
  width,
  onWidthChange,
  onToggleCollapsed,
  back,
  heading,
  inside,
}: {
  links: readonly ShellLink[];
  collapsed: boolean;
  mobileOpen: boolean;
  width: number;
  onWidthChange: (width: number) => void;
  onToggleCollapsed: () => void;
  back?: { to: string; label: string };
  heading?: string;
  inside?: { parentTo: string; parentLabel: string; kindLabel: string; name: string };
}) {
  const [resizing, setResizing] = useState(false);

  return (
    <aside
      id="dashboard-sidebar"
      aria-label={heading ?? "Dashboard"}
      style={{ "--sidebar-width": `${width}px` } as CSSProperties}
      className={`border-border-subtle bg-surface fixed inset-y-0 left-0 z-50 flex shrink-0 flex-col overflow-hidden border-r lg:relative lg:z-auto lg:translate-x-0 ${
        mobileOpen ? "translate-x-0" : "-translate-x-full max-lg:invisible"
      } ${
        collapsed
          ? "w-60 lg:w-16 lg:min-w-16"
          : "w-60 lg:w-[var(--sidebar-width)] lg:min-w-[var(--sidebar-width)]"
      } ${resizing ? "lg:transition-none" : "transition-[width,transform] duration-mid"}`}
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
        {inside && <InsideCard inside={inside} collapsed={collapsed} />}
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

      {!collapsed && (
        <ResizeHandle width={width} onWidthChange={onWidthChange} onResizingChange={setResizing} />
      )}
    </aside>
  );
}

function InsideCard({
  inside,
  collapsed,
}: {
  inside: { parentTo: string; parentLabel: string; kindLabel: string; name: string };
  collapsed: boolean;
}) {
  return (
    <div
      className={`border-border-subtle bg-accent-subtle mb-2 rounded-lg border-y border-r border-l-2 border-l-foreground ${
        collapsed ? "lg:border-0 lg:bg-transparent lg:border-l-0" : ""
      }`}
    >
      <NavLink
        to={inside.parentTo}
        title={collapsed ? `Back to ${inside.parentLabel}` : undefined}
        className={`text-foreground-muted hover:text-foreground flex items-center gap-3 px-3 py-2 text-title-md transition-colors duration-fast ${
          collapsed ? "lg:justify-center lg:px-0" : ""
        }`}
      >
        <BackIcon />
        <span className={collapsed ? "lg:sr-only" : undefined}>Back to {inside.parentLabel}</span>
      </NavLink>
      <div className={`border-border-subtle border-t px-3 py-2 ${collapsed ? "lg:hidden" : ""}`}>
        <p className="text-label-md text-foreground-faint font-mono uppercase">
          Inside {inside.kindLabel}
        </p>
        <p className="text-title-md mt-0.5 truncate">{inside.name}</p>
      </div>
    </div>
  );
}

function ResizeHandle({
  width,
  onWidthChange,
  onResizingChange,
}: {
  width: number;
  onWidthChange: (width: number) => void;
  onResizingChange: (resizing: boolean) => void;
}) {
  const drag = useRef<{ x: number; width: number } | null>(null);

  const finish = (event: PointerEvent<HTMLHRElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    drag.current = null;
    onResizingChange(false);
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
  };

  return (
    <hr
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuemin={MIN_SIDEBAR_WIDTH}
      aria-valuemax={MAX_SIDEBAR_WIDTH}
      aria-valuenow={width}
      tabIndex={0}
      className="hover:bg-foreground-faint/30 active:bg-foreground-faint/50 absolute inset-y-0 right-0 m-0 hidden w-2 cursor-col-resize border-0 touch-none lg:block"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        drag.current = { x: event.clientX, width };
        event.currentTarget.setPointerCapture(event.pointerId);
        onResizingChange(true);
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
      }}
      onPointerMove={(event) => {
        const origin = drag.current;
        if (!origin || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
        onWidthChange(clampSidebarWidth(origin.width + event.clientX - origin.x));
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
      onLostPointerCapture={() => {
        drag.current = null;
        onResizingChange(false);
        document.body.style.removeProperty("cursor");
        document.body.style.removeProperty("user-select");
      }}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 32 : 16;
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          onWidthChange(clampSidebarWidth(width - step));
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          onWidthChange(clampSidebarWidth(width + step));
        } else if (event.key === "Home") {
          event.preventDefault();
          onWidthChange(MIN_SIDEBAR_WIDTH);
        } else if (event.key === "End") {
          event.preventDefault();
          onWidthChange(MAX_SIDEBAR_WIDTH);
        }
      }}
    />
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
