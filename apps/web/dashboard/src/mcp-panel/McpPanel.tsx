import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import {
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { MemoryRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router";
import { GlobalTerminals, TerminalsProvider } from "../components/Terminals.js";
import { ToastProvider } from "../components/toast.js";
import { WorkspaceSurfaceProvider } from "../components/workspace/surface.js";
import type { Host } from "./host.js";
import { dashboardUrl, deepLinkRoute, gatewayOrigin, selectionRoute } from "./selection.js";
import { useOpening } from "./useOpening.js";

const Workspace = lazy(() =>
  import("../pages/Workspace.js").then((module) => ({ default: module.Workspace })),
);

/**
 * The Workspace screen inside ChatGPT: opened from the sidebar, a thread's
 * tab, a file in a thread, or by the model. ChatGPT shows entrypoints
 * fullscreen; a model's call starts inline, where the panel is a card that
 * asks for fullscreen rather than a cramped editor.
 */
export function McpPanel({ host }: { host: Host }) {
  const state = useSyncExternalStore(host.subscribe, host.state);
  const phase = useOpening(host, state);

  const inline = state.context.displayMode === "inline";
  const canFullscreen = state.context.availableDisplayModes?.includes("fullscreen") === true;
  const card = inline && canFullscreen;

  // Opened by the model, the panel starts inline. It asks for fullscreen
  // once per call that opened it, and stays a card with the same request on
  // a button when the host says no.
  const sequence = phase.kind === "ready" ? phase.sequence : null;
  const askedFor = useRef<number | null>(null);
  useEffect(() => {
    if (sequence === null || !card || askedFor.current === sequence) return;
    askedFor.current = sequence;
    void host.requestDisplayMode("fullscreen");
  }, [sequence, card, host]);
  // Inline, the host sizes the frame to the page; elsewhere the page fills it.
  useEffect(() => {
    document.documentElement.classList.toggle("mcp-inline", inline);
  }, [inline]);

  const insets = state.context.safeAreaInsets;
  const style = insets
    ? {
        paddingTop: insets.top,
        paddingRight: insets.right,
        paddingBottom: insets.bottom,
        paddingLeft: insets.left,
      }
    : undefined;

  let body: ReactNode;
  if (state.connection === "failed") {
    body = <Notice title="ChatGPT did not connect to Exeora" text={state.error ?? ""} />;
  } else if (phase.kind === "waiting" || phase.kind === "opening") {
    body = (
      <Notice text={state.connection === "connecting" ? "Connecting…" : "Opening workspace…"} />
    );
  } else if (phase.kind === "failed") {
    body = (
      <Notice
        title={phase.file ? `Could not open ${phase.file.name}` : "Could not open the workspace"}
        text={phase.message}
        actions={[
          { label: "Try again", run: phase.retry },
          { label: "Choose a workspace", run: phase.browse },
        ]}
      />
    );
  } else if (card) {
    body = (
      <InlineCard
        title={phase.file?.name ?? "Exeora Workspace"}
        detail={phase.selection.path ?? undefined}
        open={() => void host.requestDisplayMode("fullscreen")}
      />
    );
  } else {
    const deepLink = deepLinkRoute(state.context["openai/deepLink"]);
    const route = selectionRoute(phase.selection);
    body = (
      <PanelWorkspace
        host={host}
        initial={deepLink ?? route}
        deepLink={deepLink}
        selection={{ route, sequence: phase.sequence }}
        gatewayOrigin={gatewayOrigin(phase.selection)}
        title={phase.file?.name ?? null}
        fixedHeight={inline}
      />
    );
  }

  return (
    <div className="flex h-full flex-col" style={style}>
      {body}
    </div>
  );
}

function PanelWorkspace({
  host,
  initial,
  deepLink,
  selection,
  gatewayOrigin,
  title,
  fixedHeight,
}: {
  host: Host;
  initial: string;
  deepLink: string | null;
  /** Where the latest opening points; a new `sequence` moves there. */
  selection: { route: string; sequence: number };
  gatewayOrigin: string | null;
  title: string | null;
  fixedHeight: boolean;
}) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false, refetchOnWindowFocus: true } },
      }),
  );
  const open = useCallback(
    (path: string) => {
      const url = gatewayOrigin ? dashboardUrl(gatewayOrigin, path) : null;
      if (url) void host.openLink(url);
    },
    [host, gatewayOrigin],
  );
  const surface = useMemo(() => ({ openDashboard: open }), [open]);

  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initial]}>
        <ToastProvider>
          <TerminalsProvider>
            <Follow route={deepLink} version={deepLink} />
            <Follow route={selection.route} version={selection.sequence} />
            <WorkspaceSurfaceProvider value={surface}>
              <div className={`flex flex-col ${fixedHeight ? "h-[640px]" : "h-full"}`}>
                <Header title={title} open={gatewayOrigin ? open : undefined} />
                <main className="flex min-h-0 w-full flex-1 flex-col overflow-hidden p-3">
                  <Routes>
                    <Route
                      path="/workspace"
                      element={
                        <Suspense fallback={<Notice text="Loading workspace…" />}>
                          <Workspace />
                        </Suspense>
                      }
                    />
                    <Route path="*" element={<ElsewhereInDashboard open={open} />} />
                  </Routes>
                </main>
              </div>
            </WorkspaceSurfaceProvider>
            <GlobalTerminals />
          </TerminalsProvider>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/**
 * Moves the open Workspace when `version` changes: a deep link clicked, or a
 * later call that opened another file, without reloading the panel.
 */
function Follow({ route, version }: { route: string | null; version: unknown }) {
  const navigate = useNavigate();
  const seen = useRef(version);
  useEffect(() => {
    if (!route || Object.is(seen.current, version)) return;
    seen.current = version;
    navigate(route);
  }, [route, version, navigate]);
  return null;
}

function Header({ title, open }: { title: string | null; open?: (path: string) => void }) {
  const location = useLocation();
  return (
    <header className="border-border-subtle flex h-12 shrink-0 items-center justify-between gap-2 border-b px-3">
      <span className="text-body-md text-foreground-muted flex min-w-0 items-center gap-2">
        {title ? <FileText aria-hidden className="size-4 shrink-0" /> : null}
        <span className="truncate">{title ?? "Exeora Workspace"}</span>
      </span>
      <div className="flex shrink-0 items-center gap-2">
        {open ? (
          <button
            type="button"
            className="btn"
            title="Open this workspace in the dashboard"
            onClick={() => open(`${location.pathname}${location.search}`)}
          >
            Dashboard
          </button>
        ) : null}
      </div>
    </header>
  );
}

/** Opens the dashboard where a link pointed, then comes back. */
function ElsewhereInDashboard({ open }: { open: (path: string) => void }) {
  const location = useLocation();
  const target = `${location.pathname}${location.search}`;
  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (opened.current === target) return;
    opened.current = target;
    open(target);
  }, [target, open]);
  return <Navigate to="/workspace" replace />;
}

function InlineCard({ title, detail, open }: { title: string; detail?: string; open: () => void }) {
  return (
    <div className="border-border flex items-center justify-between gap-4 rounded-xl border p-4">
      <div className="min-w-0">
        <p className="text-title-md truncate">{title}</p>
        {detail ? (
          <p className="text-body-md text-foreground-muted truncate font-mono">{detail}</p>
        ) : null}
      </div>
      <button type="button" className="btn btn-primary shrink-0" onClick={open}>
        Open workspace
      </button>
    </div>
  );
}

function Notice({
  title,
  text,
  actions = [],
}: {
  title?: string;
  text: string;
  actions?: { label: string; run: () => void }[];
}) {
  return (
    <div
      role={actions.length > 0 ? "alert" : "status"}
      className="flex min-h-40 flex-1 flex-col items-center justify-center gap-3 p-6 text-center"
    >
      {title ? <p className="text-title-md">{title}</p> : null}
      {text ? <p className="text-body-md text-foreground-muted max-w-md">{text}</p> : null}
      {actions.length > 0 ? (
        <div className="flex flex-wrap justify-center gap-2">
          {actions.map((action) => (
            <button key={action.label} type="button" className="btn" onClick={action.run}>
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
