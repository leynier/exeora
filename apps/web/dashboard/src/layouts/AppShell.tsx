import { NavLink, Outlet } from "react-router";
import { Unauthorized } from "../api.js";
import { signOut } from "../auth.js";
import { ApprovalBanner } from "../components/ApprovalBanner.js";
import {
  useApprovals,
  useClients,
  useDevices,
  useMe,
  useProjects,
  useToolCalls,
} from "../queries.js";

/**
 * The frame every signed-in screen sits in: navigation, and the account.
 *
 * It subscribes to every query so a token that expired while the tab was open
 * signs out from anywhere, not only from whichever page happened to be
 * fetching.
 */
export function AppShell() {
  const me = useMe();
  const queries = [me, useDevices(), useProjects(), useClients(), useToolCalls(), useApprovals()];

  if (queries.some((query) => query.error instanceof Unauthorized)) signOut();

  const links = [
    { to: "/", label: "Overview", end: true },
    { to: "/machines", label: "Machines" },
    { to: "/projects", label: "Projects" },
    { to: "/clients", label: "Clients" },
    { to: "/activity", label: "Activity" },
    { to: "/settings", label: "Settings" },
    ...(me.data?.isAdmin ? [{ to: "/admin", label: "Admin", end: false }] : []),
  ];

  return (
    <div className="min-h-screen">
      <header className="border-border-subtle bg-bg/80 sticky top-0 z-40 border-b backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-5">
          <a href="/" className="flex items-center gap-2" aria-label="Exeora, home">
            {/* Three tiles, 24 wide on a pitch of 20 with a radius of 4, the
                same numbers the landing and the OAuth screens draw. */}
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
            <span className="text-title-md tracking-tight">Exeora</span>
          </a>

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
        </div>

        <nav className="mx-auto max-w-5xl px-5">
          <ul className="-mb-px flex gap-1 overflow-x-auto">
            {links.map((link) => (
              <li key={link.to}>
                <NavLink
                  to={link.to}
                  end={link.end}
                  className={({ isActive }) =>
                    `text-title-md block border-b-2 px-3 py-2.5 whitespace-nowrap transition-colors duration-fast ${
                      isActive
                        ? "border-accent text-foreground"
                        : "text-foreground-muted hover:text-foreground border-transparent"
                    }`
                  }
                >
                  {link.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        {/* Inside the sticky header, so it stays on screen. A question that
            scrolls away is one someone answers late, and late is the same as
            never when there is a client holding a request open. It renders
            nothing at all when there is nothing to answer, which is almost
            always, so the header keeps its usual height. */}
        <ApprovalBanner />
      </header>

      <main className="mx-auto max-w-5xl px-5 py-8">
        <Outlet />
      </main>
    </div>
  );
}
