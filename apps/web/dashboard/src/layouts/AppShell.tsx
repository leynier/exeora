import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router";
import { Unauthorized } from "../api.js";
import { signOut } from "../auth.js";
import { ApprovalBanner } from "../components/ApprovalBanner.js";
import { ErrorBanner } from "../components/ui.js";
import {
  useApprovals,
  useClients,
  useDevices,
  useMe,
  useProjects,
  useToolCalls,
} from "../queries.js";
import { adminShellLinks, isAdminSection, sectionTitle, shellLinks } from "./nav.js";
import { Sidebar } from "./Sidebar.js";

const COLLAPSED_KEY = "exeora.sidebar_collapsed";

/**
 * The frame every signed-in screen sits in: a collapsible rail, a top bar, and
 * the account.
 *
 * It subscribes to every query so a token that expired while the tab was open
 * signs out from anywhere, not only from whichever page happened to be
 * fetching.
 *
 * Height is the viewport, and the page scroll lives on `<main>`. The Workspace
 * screen is a git client: it needs the leftover height as a pane, not a
 * document that grows under a terminal.
 */
export function AppShell() {
  const me = useMe();
  const location = useLocation();
  const workspace = location.pathname === "/workspace";
  const adminSection = isAdminSection(location.pathname);
  const queries = [me, useDevices(), useProjects(), useClients(), useToolCalls(), useApprovals()];
  const unauthorized = queries.some((query) => query.error instanceof Unauthorized);
  const failed = queries.find((query) => query.isError && !(query.error instanceof Unauthorized));
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (unauthorized) signOut();
  }, [unauthorized]);

  // pathname is the signal that a navigation happened, including Back. It is
  // not read inside: the drawer just has to close, wherever we landed.
  // biome-ignore lint/correctness/useExhaustiveDependencies: trigger only
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMobileOpen(false);
      document.getElementById("dashboard-menu-toggle")?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  if (unauthorized) return null;

  const links = adminSection ? adminShellLinks() : shellLinks(me.data?.isAdmin === true);

  return (
    <div className="flex h-full">
      {mobileOpen && (
        <button
          type="button"
          aria-label="Close menu"
          className="bg-bg/70 fixed inset-0 z-40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <Sidebar
        links={links}
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onToggleCollapsed={() => setCollapsed((current) => persistCollapsed(!current))}
        back={adminSection ? { to: "/", label: "Dashboard" } : undefined}
        heading={adminSection ? "Admin" : undefined}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="shrink-0">
          <header className="border-border-subtle bg-bg/80 flex h-14 items-center justify-between gap-4 border-b px-4 backdrop-blur-xl lg:px-6">
            <div className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                id="dashboard-menu-toggle"
                className="text-foreground-muted hover:bg-surface-variant hover:text-foreground inline-flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors duration-fast lg:hidden"
                aria-expanded={mobileOpen}
                aria-controls="dashboard-sidebar"
                aria-label={mobileOpen ? "Close menu" : "Open menu"}
                onClick={() => setMobileOpen((open) => !open)}
              >
                <MenuIcon open={mobileOpen} />
              </button>
              <p className="text-title-md truncate">{sectionTitle(location.pathname, links)}</p>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-body-md text-foreground-faint hidden max-w-52 truncate sm:block">
                {me.data?.email ?? ""}
              </span>
              {me.data?.avatarUrl && (
                <img
                  src={me.data.avatarUrl}
                  alt=""
                  width={28}
                  height={28}
                  className="border-border size-7 rounded-full border"
                />
              )}
              <button type="button" onClick={signOut} className="btn">
                Sign out
              </button>
            </div>
          </header>
          {/* In the chrome above the scrolling pane, so it stays on screen. A
              question that scrolls away is one someone answers late, and late
              is the same as never when there is a client holding a request
              open. It renders nothing at all when there is nothing to answer,
              which is almost always, so the header keeps its usual height. */}
          <ApprovalBanner />
        </div>

        <main
          className={
            workspace
              ? "flex min-h-0 w-full flex-1 flex-col overflow-hidden px-4 py-4 lg:px-6"
              : "min-h-0 w-full flex-1 overflow-y-auto px-4 py-8 lg:px-6"
          }
        >
          {failed && (
            <ErrorBanner
              error={failed.error}
              onRetry={() => {
                void failed.refetch();
              }}
            />
          )}
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function MenuIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      aria-hidden="true"
    >
      {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
    </svg>
  );
}

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function persistCollapsed(collapsed: boolean): boolean {
  try {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    // Private mode, or a full quota: the preference just does not survive a reload.
  }
  return collapsed;
}
