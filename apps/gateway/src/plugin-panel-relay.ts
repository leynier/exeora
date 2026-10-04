import { ExeoraError } from "@exeora/protocol";
import { PanelId, RelayNavigation, RelayTicketRequest } from "@exeora/protocol/panel-relay";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { PanelPrincipal, RelayFailure } from "./panel-relay-do.js";
import type { PluginAccess } from "./plugin-access.js";
import { navigationSelection, PanelNavigation } from "./plugin-navigation.js";
import { trustedPanelOrigin } from "./plugin-panel-routes.js";

export function panelPrincipal(access: PluginAccess): PanelPrincipal {
  const { userId, clientId } = access.props;
  if (!userId || !clientId || access.props.deviceId)
    throw new ExeoraError("FORBIDDEN", "This connection cannot control a panel.");
  return { userId, clientId, endpoint: access.projectId ?? "account" };
}
export async function createPanel(access: PluginAccess): Promise<string> {
  await access.projects();
  const panelId = crypto.randomUUID();
  await access.env.WORKSPACE_PANEL_RELAY.getByName(panelId).register(
    panelPrincipal(access),
    panelId,
  );
  return panelId;
}
export function panelTicketResult(
  env: Env,
  panelId: string,
  ticket: { ticket: string; expiresAt: number },
  pairing = false,
) {
  const url = new URL("/panel-relay/connect", env.EXEORA_BASE_URL);
  // Keep the gateway's HTTP(S) origin; the UI validates it before upgrading to WS(S).
  url.searchParams.set("panelId", panelId);
  if (!pairing) url.searchParams.set("ticket", ticket.ticket);
  return {
    panelId,
    protocol: 1 as const,
    url: url.toString(),
    expiresAt: ticket.expiresAt,
    ...(pairing ? { pairingTicket: ticket.ticket } : {}),
  };
}
function answer(value: Record<string, unknown>, isError = false) {
  return {
    ...(isError ? { isError: true } : {}),
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent: value,
  };
}
function failure(value: RelayFailure, panelId?: string) {
  return answer({ ...value, ...(panelId ? { panelId } : {}) }, true);
}
async function safe(fn: () => Promise<ReturnType<typeof answer>>) {
  try {
    return await fn();
  } catch (error) {
    return failure({
      error: "panel_error",
      message:
        error instanceof ExeoraError
          ? error.message
          : "The panel command could not complete. Check its state before retrying.",
    });
  }
}
async function checkPanel(access: PluginAccess, panelId: string) {
  await access.projects();
  const relay = access.env.WORKSPACE_PANEL_RELAY.getByName(panelId);
  const principal = panelPrincipal(access);
  if (!(await relay.authorized(principal)))
    throw new ExeoraError("FORBIDDEN", "This panel is not available on this connection.");
  return { relay, principal };
}
async function checkState(
  access: PluginAccess,
  state: {
    projectId: string | null;
    workspace: string | null;
    pendingConfirmation?: { projectId: string | null; workspace: string | null } | null;
  },
) {
  for (const target of [state, state.pendingConfirmation]) {
    if (!target?.projectId) continue;
    // Explicit routing avoids settings defaults, including the root represented as null.
    await access.selection({ project: target.projectId, workspace: target.workspace ?? "main" });
  }
}

/** Ordinary server tools: the host does not need to discover UI-instance tools. */
export function registerPanelRelayTools(server: McpServer, access: () => PluginAccess) {
  for (const operation of ["get_state", "navigate"] as const) {
    const navigating = operation === "navigate";
    server.registerTool(
      `exeora_workspace_${operation}`,
      {
        title: navigating ? "Navigate Exeora Workspace" : "Get Exeora Workspace state",
        description: navigating
          ? "Change an already-open Exeora Workspace instance without opening another widget. Use its panelId from exeora_open_panel or the workspace context. Choose a tab, relative Explorer file, working/staged diff or Search filters. Omitted fields keep their current values. Leaving unsaved edits asks the person to confirm; inspect the returned status. Never assume applied after a timeout."
          : "Read the actual state of an already-open Exeora Workspace instance identified by panelId from its opening result or workspace context. Returns project, workspace, tab, open/dirty paths, diff, Search and confirmation state; no file contents. Does not open a widget.",
        inputSchema: navigating
          ? RelayNavigation.extend({ panelId: PanelId })
          : z.object({ panelId: PanelId }).strict(),
        annotations: { readOnlyHint: !navigating, destructiveHint: false, openWorldHint: false },
      },
      (input, ctx) =>
        safe(async () => {
          const { panelId, ...rawArgs } = input;
          const args = RelayNavigation.parse(rawArgs);
          const a = access();
          const { relay, principal } = await checkPanel(a, panelId);
          // Reject malformed combinations and paths before sending them to the UI.
          if (navigating) {
            const full = args.search ? { ...args, search: { query: "", ...args.search } } : args;
            navigationSelection(PanelNavigation.parse(full));
            if (args.project)
              await a.selection({
                project: args.project,
                ...(args.workspace ? { workspace: args.workspace } : {}),
              });
          }
          const requestId = crypto.randomUUID();
          const signal = ctx.mcpReq.signal;
          if (signal?.aborted)
            return failure(
              { error: "panel_cancelled", message: "The request was cancelled before dispatch." },
              panelId,
            );
          const pending = relay.command(principal, operation, args, requestId);
          const cancel = () => {
            void relay.cancel(principal, requestId).catch(() => {});
          };
          signal?.addEventListener("abort", cancel, { once: true });
          try {
            const outcome = await pending;
            if ("error" in outcome) return failure(outcome, panelId);
            if (navigating && outcome.result.status === undefined)
              return failure(
                {
                  error: "panel_protocol",
                  message:
                    "The panel did not report a navigation outcome. Check its state before retrying.",
                },
                panelId,
              );
            await checkState(a, outcome.result.state);
            return answer({ panelId, ...outcome.result }, outcome.result.status === "error");
          } finally {
            signal?.removeEventListener("abort", cancel);
          }
        }),
    );
  }

  server.registerTool(
    "exeora_panel_relay_ticket",
    {
      title: "Connect Workspace relay",
      description:
        "For the plugin UI only: mint a one-use, short-lived relay ticket for this panel and trusted sandbox origin. Dashboard tickets require exchange with its independent Sideapp bearer of the same account.",
      inputSchema: RelayTicketRequest,
      annotations: { readOnlyHint: false, destructiveHint: false },
      _meta: { ui: { visibility: ["app"] } },
    },
    (args) =>
      safe(async () => {
        const origin = trustedPanelOrigin(args.origin);
        if (!origin)
          throw new ExeoraError("FORBIDDEN", "The panel must run in a trusted ChatGPT sandbox.");
        const a = access();
        const panelId = args.panelId ?? (await createPanel(a));
        const { relay, principal } = await checkPanel(a, panelId);
        const pairing = args.surface === "dashboard";
        const ticket = await relay.issueTicket(principal, origin, pairing ? "pairing" : "socket");
        if ("error" in ticket) return failure(ticket, panelId);
        return answer(panelTicketResult(a.env, panelId, ticket, pairing));
      }),
  );

  server.registerTool(
    "exeora_panel_resolve_navigation",
    {
      title: "Validate Workspace destination",
      description:
        "For the existing plugin UI only: validate a complete navigation destination against current MCP grants and return its selection. Does not open or render a widget. The UI supplies its current values for omitted incremental fields.",
      inputSchema: PanelNavigation.extend({ panelId: PanelId.optional() }),
      annotations: { readOnlyHint: true },
      _meta: { ui: { visibility: ["app"] } },
    },
    (args) =>
      safe(async () => {
        const { panelId, ...navigation } = args;
        const a = access();
        if (panelId) await checkPanel(a, panelId);
        return answer({ ...(await a.selection(navigation)), ...(panelId ? { panelId } : {}) });
      }),
  );
}
