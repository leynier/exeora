import { TOOL_DEFINITIONS, type ToolName } from "@exeora/protocol";
import { CLIENT_INFO_META_KEY, McpServer, type ServerContext } from "@modelcontextprotocol/server";
import { createMcpHandler, getMcpAuthContext } from "agents/mcp/server";
import type { CallerIdentity, McpClientInfo } from "./clients.js";
import "./env.js";

/**
 * One MCP endpoint per project: `exeora.dev/p/:projectId/mcp`.
 *
 * The handler is stateless, so building one per request costs nothing and lets
 * `route` carry the project id. Isolating projects at the URL means an agent
 * connected to one project has no way to name another; the separation is
 * structural rather than something the model is asked to respect.
 *
 * `legacy: "stateless"` is the SDK default and is what makes today's clients
 * work: claude.ai and ChatGPT still speak the 2025-era protocol, and the same
 * endpoint answers both them and 2026-07-28 clients.
 */
export function mcpRoute(projectId: string): string {
  return `/p/${projectId}/mcp`;
}

export interface McpToolContext {
  userId: string;
  projectId: string;
  caller: CallerIdentity;
}

/** Runs a tool on the user's machine. Wired to the relay in M5. */
export type ToolDispatcher = (
  context: McpToolContext,
  tool: ToolName,
  args: unknown,
) => Promise<unknown>;

export function createProjectMcpHandler(projectId: string, dispatch: ToolDispatcher) {
  return createMcpHandler(
    () => {
      const server = new McpServer({ name: "exeora", version: "0.1.0" });

      // Every tool is forwarded verbatim to the executor, which validates the
      // arguments again against the same schema before touching the disk.
      const run = async (tool: ToolName, args: unknown, ctx: ServerContext) => {
        const props = propsOf();
        const value = await dispatch(
          {
            userId: String(props.userId ?? ""),
            projectId,
            caller: {
              clientId: props.clientId,
              clientName: props.clientName,
              mcp: mcpClientInfo(ctx),
            },
          },
          tool,
          args,
        );
        return {
          content: [{ type: "text" as const, text: JSON.stringify(value) }],
          structuredContent: value as Record<string, unknown>,
        };
      };

      // Registered one by one rather than in a loop: the SDK infers the
      // argument type of each callback from its own schema, and a loop would
      // collapse the six schemas into a union that erases that inference.
      const meta = <N extends ToolName>(name: N) => ({
        title: TOOL_DEFINITIONS[name].title,
        description: TOOL_DEFINITIONS[name].description,
        annotations: { readOnlyHint: TOOL_DEFINITIONS[name].readOnly },
      });

      server.registerTool(
        "read_file",
        { ...meta("read_file"), inputSchema: TOOL_DEFINITIONS.read_file.inputSchema },
        (args, ctx) => run("read_file", args, ctx),
      );
      server.registerTool(
        "list_files",
        { ...meta("list_files"), inputSchema: TOOL_DEFINITIONS.list_files.inputSchema },
        (args, ctx) => run("list_files", args, ctx),
      );
      server.registerTool(
        "grep",
        { ...meta("grep"), inputSchema: TOOL_DEFINITIONS.grep.inputSchema },
        (args, ctx) => run("grep", args, ctx),
      );
      server.registerTool(
        "edit_file",
        { ...meta("edit_file"), inputSchema: TOOL_DEFINITIONS.edit_file.inputSchema },
        (args, ctx) => run("edit_file", args, ctx),
      );
      server.registerTool(
        "write_file",
        { ...meta("write_file"), inputSchema: TOOL_DEFINITIONS.write_file.inputSchema },
        (args, ctx) => run("write_file", args, ctx),
      );
      server.registerTool(
        "run_command",
        { ...meta("run_command"), inputSchema: TOOL_DEFINITIONS.run_command.inputSchema },
        (args, ctx) => run("run_command", args, ctx),
      );

      return server;
    },
    { route: mcpRoute(projectId) },
  );
}

/**
 * The `clientInfo` from an `initialize` body, if that is what this is.
 *
 * Reading the raw request is the only seam that works here. `initialize` is
 * the sole message carrying client identity on the 2025-era wire, which is what
 * every client speaks today, and this endpoint is stateless: the tool call that
 * follows arrives at a fresh server instance that never saw the handshake. The
 * SDK's `oninitialized` hook is no help either, since it fires on the
 * `notifications/initialized` that comes in on its own request, later, to a
 * third instance.
 *
 * Bounded by content length rather than trusted: a handshake is a couple of
 * kilobytes, and refusing to buffer anything larger keeps this off the hot path
 * where a `write_file` carries a whole file.
 */
const MAX_HANDSHAKE_BYTES = 64 * 1024;

export async function handshakeClientInfo(request: Request): Promise<McpClientInfo | undefined> {
  if (request.method !== "POST") return undefined;

  const declared = Number(request.headers.get("Content-Length") ?? Number.NaN);
  if (Number.isFinite(declared) && declared > MAX_HANDSHAKE_BYTES) return undefined;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return undefined;
  }

  const message = body as { method?: unknown; params?: { clientInfo?: unknown } } | null;
  if (message?.method !== "initialize") return undefined;

  return readClientInfo(message.params?.clientInfo);
}

/**
 * What the client called itself on this request.
 *
 * Present only from protocol revision 2026-07-28, which moved client identity
 * into a per-request `_meta` envelope; and even there the spec demoted it to a
 * SHOULD, so an absent value is normal rather than an error.
 */
function mcpClientInfo(ctx: ServerContext): McpClientInfo | undefined {
  const envelope = ctx.mcpReq.envelope as Record<string, unknown> | undefined;
  return readClientInfo(envelope?.[CLIENT_INFO_META_KEY]);
}

function readClientInfo(value: unknown): McpClientInfo | undefined {
  if (!value || typeof value !== "object") return undefined;

  const { name, version } = value as { name?: unknown; version?: unknown };
  if (typeof name !== "string" && typeof version !== "string") return undefined;

  return {
    ...(typeof name === "string" ? { name } : {}),
    ...(typeof version === "string" ? { version } : {}),
  };
}

function propsOf(): { userId?: string; clientId?: string; clientName?: string } {
  return (getMcpAuthContext()?.props ?? {}) as {
    userId?: string;
    clientId?: string;
    clientName?: string;
  };
}
