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
import { MemoryRouter, Navigate, Route, Routes, useLocation } from "react-router";
import { type Annotations, AnnotationsProvider } from "../components/comments/annotations.js";
import { GlobalTerminals, TerminalsProvider } from "../components/Terminals.js";
import { ToastProvider } from "../components/toast.js";
import { WorkspaceSurfaceProvider } from "../components/workspace/surface.js";
import { AgentControl } from "./AgentControl.js";
import type { ContextWriter } from "./comments/contextWriter.js";
import { Follow, LeaveDialog, useWorkspaceContext } from "./control.js";
import type { PanelController } from "./controller.js";
import type { Host } from "./host.js";
import type { PanelRelay } from "./relay.js";
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
export function McpPanel({
  host,
  controller,
  annotations,
  writer,
  relay,
}: {
  host: Host;
  controller: PanelController;
  /** This conversation's comments, and adding them to the model's context. */
  annotations: Annotations;
  writer: ContextWriter;
  /** How the model's public Workspace tools reach this panel. */
  relay: PanelRelay;
}) {
  const state = useSyncExternalStore(host.subscribe, host.state);
  const phase = useOpening(host, state);
  useWorkspaceContext(controller, writer, relay);

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
  // Every opening, and every deep link, goes where the controller says, so
  // unsaved edits are asked about whoever moves the panel. A deep link
  // present from the start wins over the opening, as it is asked for last.
  const route = phase.kind === "ready" ? selectionRoute(phase.selection) : null;
  const requested = useRef<number | null>(null);
  useEffect(() => {
    if (sequence === null || route === null || requested.current === sequence) return;
    requested.current = sequence;
    controller.request(route);
  }, [sequence, route, controller]);
  // The relay answers as the panel each opening names: the model holds the
  // newest id. A panel opened without one gets one from the gateway.
  const panelId = phase.kind === "ready" ? (phase.selection.panelId ?? null) : undefined;
  useEffect(() => {
    if (panelId !== undefined) relay.start(panelId);
  }, [panelId, relay]);
  const deepLink = deepLinkRoute(state.context["openai/deepLink"]);
  useEffect(() => {
    if (deepLink) controller.request(deepLink);
  }, [deepLink, controller]);

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
    body = (
      <PanelWorkspace
        host={host}
        controller={controller}
        annotations={annotations}
        relay={relay}
        fallback={deepLink ?? selectionRoute(phase.selection)}
        gatewayOrigin={gatewayOrigin(phase.selection)}
        title={phase.file?.name ?? null}
        fixedHeight={inline}
      />
    );
  }

  return (
    <div className="flex h-full flex-col" style={style}>
      {body}
      <LeaveDialog controller={controller} />
    </div>
  );
}

function PanelWorkspace({
  host,
  controller,
  annotations,
  relay,
  fallback,
  gatewayOrigin,
  title,
  fixedHeight,
}: {
  host: Host;
  controller: PanelController;
  annotations: Annotations;
  relay: PanelRelay;
  /** Where to start if the controller has not been asked anywhere yet. */
  fallback: string;
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
  const surface = useMemo(
    () => ({
      openDashboard: open,
      report: controller.report,
      changeTarget: controller.changeTarget,
    }),
    [open, controller],
  );
  const [initial] = useState(() => controller.route().route ?? fallback);

  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initial]}>
        <ToastProvider>
          <TerminalsProvider>
            <Follow controller={controller} />
            <WorkspaceSurfaceProvider value={surface}>
              <AnnotationsProvider value={annotations}>
                <div className={`flex flex-col ${fixedHeight ? "h-[640px]" : "h-full"}`}>
                  <Header title={title} open={gatewayOrigin ? open : undefined} relay={relay} />
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
              </AnnotationsProvider>
            </WorkspaceSurfaceProvider>
            <GlobalTerminals />
          </TerminalsProvider>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function Header({
  title,
  open,
  relay,
}: {
  title: string | null;
  open?: (path: string) => void;
  relay: PanelRelay;
}) {
  const location = useLocation();
  return (
    <header className="border-border-subtle flex h-12 shrink-0 items-center justify-between gap-2 border-b px-3">
      <span className="text-body-md text-foreground-muted flex min-w-0 items-center gap-2">
        {title ? <FileText aria-hidden className="size-4 shrink-0" /> : null}
        <span className="truncate">{title ?? "Exeora Workspace"}</span>
      </span>
      <div className="flex min-w-0 shrink items-center gap-2">
        <AgentControl relay={relay} />
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
