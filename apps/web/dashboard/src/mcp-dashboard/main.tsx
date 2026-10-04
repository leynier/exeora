import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useNavigate } from "react-router";
import { configureApiSession } from "../api.js";
import { type AuthAdapter, AuthProvider } from "../authContext.js";
import { searchStore } from "../components/search/searchStore.js";
import { ToastProvider } from "../components/toast.js";
import { bufferStore } from "../components/workspace/bufferStore.js";
import { configureWorkspaceScope } from "../components/workspace/scope.js";
import { configureExternalOpener, configureLeave } from "../external-url.js";
import "../index.css";
import { connectHost } from "../mcp-panel/host.js";
import { ensureStorage, routeLinksToHost } from "../mcp-panel/sandbox.js";
import { dashboardDeepLink, gatewayOrigin } from "../mcp-panel/selection.js";
import { DashboardRoutes } from "../routes.js";
import { configureTicketOrigin } from "../socket-url.js";
import { DeviceSignIn, NoCallback, SideappContext, type SideappEnv } from "./DeviceSignIn.js";
import { createSession, type SideappSession } from "./session.js";

/**
 * The full Exeora Dashboard inside ChatGPT, served by the gateway as an MCP
 * App resource behind the plugin's global entrypoint.
 *
 * Every screen and route is the dashboard's own, under a router in memory.
 * It signs in on its own, with a code, as the person's Exeora account, not
 * through the ChatGPT connection, whose credentials it never sees; and it
 * talks to the gateway directly with that token. ChatGPT only frames it and
 * opens its links.
 */

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");

ensureStorage(window);
configureWorkspaceScope(`sideapp-${crypto.randomUUID()}`);
const host = connectHost({ name: "Exeora Dashboard" });
const gateway = gatewayOrigin(null);
const session = createSession(window.sessionStorage);
configureApiSession({ origin: gateway ?? "", token: async () => session.token() });
configureTicketOrigin(gateway);
const open = (url: string) => void host.openLink(url);
configureExternalOpener(open);
configureLeave(open);
routeLinksToHost(document, open);

const adapter: AuthAdapter = {
  token: session.token,
  subscribe: session.subscribe,
  signOut: session.signOut,
  SignIn: DeviceSignIn,
  Callback: NoCallback,
  returnPrefix: "",
};

createRoot(root).render(
  <StrictMode>
    {gateway ? (
      <Sideapp env={{ session, gateway, openLink: open }} />
    ) : (
      <p className="text-body-md text-foreground-muted p-6 text-center">
        Open the Exeora Dashboard from ChatGPT.
      </p>
    )}
  </StrictMode>,
);

function Sideapp({ env }: { env: SideappEnv }) {
  const generation = useSyncExternalStore(env.session.subscribe, env.session.generation);
  const client = useAccountClient(env.session, generation);
  const hostState = useSyncExternalStore(host.subscribe, host.state);
  const deepLink = dashboardDeepLink(hostState.context["openai/deepLink"]);
  // Where a new tree starts: the deep link it was opened with, if any, so
  // the router waits for the host to say. One that needs signing in first is
  // kept through it by the sign-in guard.
  const [first, setFirst] = useState<string | null>(null);
  const settled = hostState.connection !== "connecting";
  useEffect(() => {
    if (settled) setFirst((current) => current ?? deepLink ?? "/");
  }, [settled, deepLink]);
  if (first === null) return null;
  return (
    <SideappContext.Provider value={env}>
      <AuthProvider value={adapter}>
        {/* A new generation (signed out, or the token ran out) starts from a
            clean tree: no screen, terminal or cached answer of the old one. */}
        <QueryClientProvider client={client} key={generation}>
          <MemoryRouter initialEntries={[generation === 0 ? first : "/"]}>
            <FollowDeepLink route={deepLink} />
            <ToastProvider>
              <DashboardRoutes />
            </ToastProvider>
          </MemoryRouter>
        </QueryClientProvider>
      </AuthProvider>
    </SideappContext.Provider>
  );
}

/** A deep link clicked while the Dashboard is open moves it, signed in or not yet. */
function FollowDeepLink({ route }: { route: string | null }) {
  const navigate = useNavigate();
  const seen = useRef(route);
  useEffect(() => {
    if (!route || seen.current === route) return;
    seen.current = route;
    navigate(route);
  }, [route, navigate]);
  return null;
}

/** A query cache per generation, emptied with everything else when it ends. */
function useAccountClient(session: SideappSession, generation: number): QueryClient {
  const [clients] = useState(() => new Map<number, QueryClient>());
  const client = useMemo(() => {
    const fresh = new QueryClient({
      defaultOptions: { queries: { retry: false, refetchOnWindowFocus: true } },
    });
    clients.set(generation, fresh);
    return fresh;
  }, [clients, generation]);
  useEffect(() => {
    return () => {
      // The generation ended: nothing it read or typed outlives it.
      clients.get(generation)?.clear();
      clients.delete(generation);
      if (session.generation() !== generation) {
        bufferStore.clearAll();
        searchStore.clearAll();
      }
    };
  }, [clients, generation, session]);
  return client;
}
