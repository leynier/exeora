import { type ReactNode, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useLocation } from "react-router";
import { ApiError, request } from "../api.js";
import { WorkspaceControlProvider } from "../components/workspace/surface.js";
import { AgentControl } from "../mcp-panel/AgentControl.js";
import type { ContextWriter } from "../mcp-panel/comments/contextWriter.js";
import { Follow, LeaveDialog, useWorkspaceContext } from "../mcp-panel/control.js";
import { PanelController } from "../mcp-panel/controller.js";
import type { Host } from "../mcp-panel/host.js";
import { PanelRelay, pairedTickets, RelayUnavailable } from "../mcp-panel/relay.js";
import { readPanelId } from "../mcp-panel/selection.js";
import type { SideappSession } from "./session.js";

/**
 * ChatGPT's control of the Dashboard's Workspace, only while the Dashboard
 * is signed in on its own, and only once the gateway has paired that sign-in
 * with the ChatGPT connection as the same account. Mounted per sign-in
 * generation: signing out or running out ends the relay, and whoever signs
 * in next is paired afresh, never handed the last account's control. Once
 * the host tears the view down, it is never paired again.
 */
export function SideappControl({
  host,
  session,
  writer,
  children,
}: {
  host: Host;
  session: SideappSession;
  writer: ContextWriter;
  children: ReactNode;
}) {
  const signedIn = useSyncExternalStore(session.subscribe, () => session.token() !== null);
  // Torn down by the host, the Dashboard is never paired again, signed in or not.
  const tornDown = useSyncExternalStore(host.subscribe, () => host.state().tornDown);
  const [paired, setPaired] = useState<{ controller: PanelController; relay: PanelRelay } | null>(
    null,
  );
  useEffect(() => {
    if (!signedIn || tornDown) return;
    const controller = new PanelController(
      (name, args, signal) => host.call(name, args, signal),
      undefined,
      () => relay.get().panelId,
    );
    const relay: PanelRelay = new PanelRelay({
      controller,
      ticket: pairedTickets(host.call, window.origin, (body) => exchange(body, session.signal())),
    });
    setPaired({ controller, relay });
    // Synchronously, before the host hears the view is done.
    const offTeardown = host.onTeardown(() => relay.dispose());
    return () => {
      offTeardown();
      relay.dispose();
      setPaired(null);
    };
  }, [signedIn, tornDown, host, session]);
  const control = useMemo(
    () =>
      paired
        ? { report: paired.controller.report, changeTarget: paired.controller.changeTarget }
        : null,
    [paired],
  );
  return (
    <WorkspaceControlProvider value={control}>
      {paired ? (
        <Paired host={host} writer={writer} controller={paired.controller} relay={paired.relay} />
      ) : null}
      {children}
    </WorkspaceControlProvider>
  );
}

function Paired({
  host,
  writer,
  controller,
  relay,
}: {
  host: Host;
  writer: ContextWriter;
  controller: PanelController;
  relay: PanelRelay;
}) {
  const state = useSyncExternalStore(host.subscribe, host.state);
  const result = state.result?.structuredContent as { panelId?: unknown } | undefined;
  const panelId = readPanelId(result?.panelId);
  const connected = state.connection === "connected";
  useEffect(() => {
    if (connected) relay.start(panelId);
  }, [connected, panelId, relay]);
  useWorkspaceContext(controller, writer, relay);
  // Each screen of the Dashboard the person goes to without the Workspace
  // shows none, whatever it last showed, and overtakes the model's moves.
  const { pathname } = useLocation();
  useEffect(() => {
    if (!/\/workspace$/.test(pathname)) controller.forget();
  }, [pathname, controller]);
  return (
    <>
      <Follow controller={controller} />
      <LeaveDialog controller={controller} />
      <div className="bg-surface fixed right-3 bottom-3 z-40 max-w-[calc(100vw-1.5rem)] rounded-lg shadow-lg">
        <AgentControl relay={relay} />
      </div>
    </>
  );
}

export const OTHER_ACCOUNT =
  "This Dashboard is signed in to another Exeora account than ChatGPT's connection, so ChatGPT cannot control it.";

/**
 * The pairing ticket, exchanged with the Dashboard's own sign-in. A refusal
 * (another account, or a sign-in this Dashboard no longer has) is not
 * retried: the person signs in again, as the account ChatGPT is connected to.
 */
async function exchange(
  body: { panelId: string; ticket: string; origin: string },
  signal: AbortSignal,
): Promise<unknown> {
  try {
    return await request<unknown>("/api/panel-relay/ticket", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error instanceof ApiError && (error.status === 403 || error.status === 409)) {
      throw new RelayUnavailable(
        typeof error.body?.message === "string" ? error.sentence : OTHER_ACCOUNT,
      );
    }
    throw error;
  }
}
