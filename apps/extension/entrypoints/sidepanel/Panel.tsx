import { Unauthorized } from "@dashboard/api.js";
import {
  GlobalTerminals,
  TerminalsProvider,
  useTerminals,
} from "@dashboard/components/Terminals.js";
import { ToastProvider } from "@dashboard/components/toast.js";
import { Workspace } from "@dashboard/pages/Workspace.js";
import { useMe } from "@dashboard/queries.js";
import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { MemoryRouter, Navigate, Route, Routes, useLocation } from "react-router";
import { auth, openDashboard } from "../../lib/session.js";

/**
 * The signed-in side panel: the dashboard's Workspace screen under a header of
 * its own.
 *
 * The router lives in memory, since a side panel has no address bar. Any link
 * the borrowed screens make to somewhere other than the workspace (adding a
 * project, a project's page) opens that place in the full dashboard instead.
 */
export function Panel({ onUnauthorized }: { onUnauthorized: () => Promise<boolean> }) {
  const [client] = useState(() => {
    let retrying = false;
    const queryClient: QueryClient = new QueryClient({
      queryCache: new QueryCache({
        onError: (error) => {
          if (!(error instanceof Unauthorized) || retrying) return;
          retrying = true;
          void onUnauthorized()
            .then((renewed) => (renewed ? queryClient.invalidateQueries() : undefined))
            .finally(() => {
              retrying = false;
            });
        },
      }),
      defaultOptions: { queries: { retry: false, refetchOnWindowFocus: true } },
    });
    return queryClient;
  });

  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/workspace"]}>
        <ToastProvider>
          <TerminalsProvider>
            <Shell />
          </TerminalsProvider>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function Shell() {
  const { workspaceFills } = useTerminals();

  return (
    <div className="flex h-full flex-col">
      <Header />
      <main
        className={
          workspaceFills
            ? "flex min-h-0 w-full shrink-0 flex-col overflow-hidden px-3 pt-3"
            : "flex min-h-0 w-full flex-1 flex-col overflow-hidden p-3"
        }
      >
        <Routes>
          <Route path="/workspace" element={<Workspace />} />
          <Route path="*" element={<ElsewhereInDashboard />} />
        </Routes>
      </main>
      <GlobalTerminals />
    </div>
  );
}

function Header() {
  const me = useMe();
  const location = useLocation();
  const [signingOut, setSigningOut] = useState(false);

  return (
    <header className="border-border-subtle flex h-12 shrink-0 items-center justify-between gap-2 border-b px-3">
      <div className="flex min-w-0 items-center gap-2">
        {me.data?.avatarUrl ? (
          <img
            src={me.data.avatarUrl}
            alt=""
            width={24}
            height={24}
            className="border-border size-6 shrink-0 rounded-full border"
          />
        ) : null}
        <span className="text-body-md text-foreground-muted truncate">{me.data?.email ?? ""}</span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          className="btn"
          title="Open this workspace in the dashboard"
          onClick={() => openDashboard(`${location.pathname}${location.search}`)}
        >
          Dashboard
        </button>
        <button
          type="button"
          className="btn"
          disabled={signingOut}
          onClick={() => {
            setSigningOut(true);
            // The panel follows storage, so it switches to the sign-in screen
            // as soon as the session is gone.
            void auth.signOut();
          }}
        >
          Sign out
        </button>
      </div>
    </header>
  );
}

/** Opens the dashboard where a borrowed link pointed, then comes back. */
function ElsewhereInDashboard() {
  const location = useLocation();
  const target = `${location.pathname}${location.search}`;
  // Once per target: StrictMode runs effects twice in development.
  const opened = useRef<string | null>(null);

  useEffect(() => {
    if (opened.current === target) return;
    opened.current = target;
    openDashboard(target);
  }, [target]);

  return <Navigate to="/workspace" replace />;
}
