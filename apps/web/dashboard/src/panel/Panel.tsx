import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { MemoryRouter, Navigate, Route, Routes, useLocation } from "react-router";
import { Unauthorized } from "../api.js";
import { GlobalTerminals, TerminalsProvider } from "../components/Terminals.js";
import { ToastProvider } from "../components/toast.js";
import { Workspace } from "../pages/Workspace.js";
import { useMe } from "../queries.js";
import type { Bridge } from "./bridge.js";

/**
 * The signed-in side panel: the dashboard's Workspace screen under a header of
 * its own.
 *
 * The router lives in memory, since a side panel has no address bar. Any link
 * the screens make to somewhere other than the workspace (adding a project, a
 * project's page) opens that place in the full dashboard instead.
 */
export function Panel({ bridge }: { bridge: Bridge }) {
  const [client] = useState(() => {
    let retrying = false;
    const queryClient: QueryClient = new QueryClient({
      queryCache: new QueryCache({
        onError: (error) => {
          if (!(error instanceof Unauthorized) || retrying) return;
          retrying = true;
          // An access token the gateway refused before it expired: revoked
          // with its grant, most likely. A forced refresh says whether the
          // session is over; when it is, the shell swaps this panel for its
          // sign-in screen on its own.
          void bridge
            .request({ kind: "token", force: true })
            .then(({ token }) => (token ? queryClient.invalidateQueries() : undefined))
            .catch(() => undefined)
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
            <Shell bridge={bridge} />
          </TerminalsProvider>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function Shell({ bridge }: { bridge: Bridge }) {
  const open = useCallback(
    (path: string) => void bridge.request({ kind: "open", path }).catch(() => undefined),
    [bridge],
  );
  return (
    <div className="flex h-full flex-col">
      <Header bridge={bridge} open={open} />
      <main className="flex min-h-0 w-full flex-1 flex-col overflow-hidden p-3">
        <Routes>
          <Route path="/workspace" element={<Workspace />} />
          <Route path="*" element={<ElsewhereInDashboard open={open} />} />
        </Routes>
      </main>
      <GlobalTerminals />
    </div>
  );
}

function Header({ bridge, open }: { bridge: Bridge; open: (path: string) => void }) {
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
          onClick={() => open(`${location.pathname}${location.search}`)}
        >
          Dashboard
        </button>
        <button
          type="button"
          className="btn"
          disabled={signingOut}
          onClick={() => {
            setSigningOut(true);
            // The shell follows its storage, so it replaces this frame with
            // its sign-in screen as soon as the session is gone.
            void bridge.request({ kind: "signOut" }).catch(() => setSigningOut(false));
          }}
        >
          Sign out
        </button>
      </div>
    </header>
  );
}

/** Opens the dashboard where a link pointed, then comes back. */
function ElsewhereInDashboard({ open }: { open: (path: string) => void }) {
  const location = useLocation();
  const target = `${location.pathname}${location.search}`;
  // Once per target: StrictMode runs effects twice in development.
  const opened = useRef<string | null>(null);

  useEffect(() => {
    if (opened.current === target) return;
    opened.current = target;
    open(target);
  }, [target, open]);

  return <Navigate to="/workspace" replace />;
}
