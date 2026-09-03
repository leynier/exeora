import { encodeMessage, MAX_MCP_ANNOUNCEMENT_BYTES, type McpToolsMessage } from "@exeora/protocol";
import {
  attachmentOf,
  executorSocket,
  offline,
  relayError,
  settleCaller,
  type ToolCallerState,
} from "./relay-do-callers.js";
import type { CallerRequest } from "./relay-internal.js";

/**
 * The relay's downstream-MCP half: storing what the executor announced and
 * forwarding caller requests to it.
 *
 * Split from `relay-do.ts` to keep the Durable Object class inside the file
 * length budget; every function here reads or writes through `ctx`, like the
 * `relay-do-callers.ts` half it sits beside.
 */

/** Storage keys under which one project's MCP announcement lives. */
const MCP_KEY_PREFIX = "mcp:";

function mcpKey(projectId: string): string {
  return `${MCP_KEY_PREFIX}${projectId}`;
}

/**
 * One project's announcement, or null when this machine never announced any.
 *
 * Read by the gateway only for `tools/list`, so a tool call pays neither the
 * storage read nor the size of the schemas. The last announcement survives a
 * disconnect on purpose — tools that cannot run fail with
 * `LOCAL_EXECUTOR_OFFLINE`, which says the true thing, rather than vanishing
 * from `tools/list` and looking like a broken endpoint — and the next
 * connection overwrites the whole entry, including back to empty.
 */
export async function readMcpTools(
  ctx: DurableObjectState,
  projectId: string,
): Promise<McpToolsMessage["servers"] | null> {
  return (await ctx.storage.get<McpToolsMessage["servers"]>(mcpKey(projectId))) ?? null;
}

/**
 * Keeps one announcement per project, refusing anything past the byte budget
 * so a single frame can never crowd the storage value ceiling.
 *
 * Storage rather than a socket attachment: attachments are capped at 16 KiB by
 * workerd and a tool schema alone can pass that, while a storage value has
 * 128 KiB and the frame is bounded under it.
 */
export async function storeMcpTools(
  ctx: DurableObjectState,
  message: McpToolsMessage,
  raw: string,
): Promise<void> {
  if (raw.length > MAX_MCP_ANNOUNCEMENT_BYTES) return;
  if (message.servers.length === 0) {
    await ctx.storage.delete(mcpKey(message.projectId));
    return;
  }
  await ctx.storage.put(mcpKey(message.projectId), message.servers);
}

/** Drops every stored announcement, for a device nobody may serve anymore. */
export async function forgetStoredMcpTools(ctx: DurableObjectState): Promise<void> {
  const announced = [...(await ctx.storage.list({ prefix: MCP_KEY_PREFIX })).keys()];
  if (announced.length > 0) await ctx.storage.delete(announced);
}

/**
 * Forwards a caller's downstream-tool request to the connected executor.
 *
 * The same bookkeeping as a canonical `tool.start`: the caller's `issuedAt` is
 * recorded for the metrics, and the answer comes back as an ordinary
 * `tool.result` that settles the same caller socket.
 */
export function forwardMcpStart(
  ctx: DurableObjectState,
  socket: WebSocket,
  state: ToolCallerState,
  message: Extract<CallerRequest, { type: "mcp.start" }>,
): void {
  if (message.requestId !== state.id || state.issuedAt !== undefined) return;
  if (message.expiresAt <= Date.now()) {
    settleCaller(socket, relayError("TOOL_TIMEOUT", "The tool call expired before dispatch."));
    return;
  }

  const executor = executorSocket(ctx);
  if (!executor) {
    settleCaller(socket, offline("No Exeora CLI is connected for this project."));
    return;
  }
  const executorState = attachmentOf(executor);
  if (executorState?.role !== "executor") {
    settleCaller(socket, offline("No Exeora CLI is connected for this project."));
    return;
  }

  socket.serializeAttachment({
    ...state,
    issuedAt: message.issuedAt,
  } satisfies ToolCallerState);
  try {
    executor.send(encodeMessage({ ...message, type: "mcp.call" }));
  } catch {
    settleCaller(socket, offline("The connection to the device failed."));
  }
}
