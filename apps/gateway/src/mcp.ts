import {
  ACCOUNT_TOOL_DEFINITIONS,
  AGENT_PROMPT_NAME,
  AGENT_PROMPT_TITLE,
  AGENT_PROMPT_TOOL,
  agentPrompt,
  ExeoraError,
  type McpServerTools,
  mcpToolName,
  serverInstructions,
  type ToolName,
} from "@exeora/protocol";
import { CLIENT_INFO_META_KEY, McpServer, type ServerContext } from "@modelcontextprotocol/server";
import { createMcpHandler, getMcpAuthContext } from "agents/mcp/server";
import { approvalCodec, approvalFor, askToConfirm, askToConfirmMcp } from "./approval.js";
import type { CallerIdentity, McpClientInfo } from "./clients.js";
import "./env.js";
import { registerExecutorTools } from "./mcp-executor-tools.js";
import { type McpRun, mcpToolResult, registerMcpTools } from "./mcp-servers.js";

// Re-exported because both endpoints' handlers import them from this module;
// they live in `approval.ts` beside the signed state they mint and verify.
export { approvalFor, askToConfirm, isApproved } from "./approval.js";

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
  workspace?: string | undefined;
  caller: CallerIdentity;
  /** True once the user has confirmed this exact call. */
  approved: boolean;
  approvedWorkspaceId?: string | undefined;
  /**
   * Whether this client can be asked over MCP.
   *
   * Only 2026-07-28 carries the mechanism. Passed down rather than decided here
   * because the dispatcher is the side that knows the project's policy, and so
   * the only side that can tell "no confirmation needed" from "needs one, and
   * this client cannot give it". The second is not a failure: it means ask
   * somewhere else.
   */
  canElicit: boolean;
}

/**
 * What a dispatch came back with.
 *
 * `needs-approval` rather than an exception because it is not a failure: the
 * project asked for the call to be confirmed, and the answer to that is a
 * question, not an error. Keeping it a return value also keeps this file free
 * of any knowledge of where policies are stored.
 *
 * It only ever comes back for a client that can be asked over MCP. When one
 * cannot, the dispatcher asks the machine or the dashboard instead and answers
 * with a value or an error, so this file never learns that path exists.
 */
export type DispatchResult =
  | { kind: "value"; value: unknown }
  /**
   * `projectId` rides along because on the account endpoint the dispatcher is
   * the only side that knows which project the call resolved to, and the
   * approval has to be bound to it. Without that binding, a confirmation given
   * for `run_command` in one project would verify against the same arguments in
   * another.
   */
  | {
      kind: "needs-approval";
      projectId: string;
      workspaceId?: string;
      workspaceSlug?: string;
    };

/** Runs a tool on the user's machine, through the relay. */
export type ToolDispatcher = (
  context: McpToolContext,
  tool: ToolName,
  args: unknown,
) => Promise<DispatchResult>;

/**
 * Runs a downstream MCP tool, through the same relay.
 *
 * `readOnlyHint` travels with the call because it is the one fact about the
 * tool the dispatcher needs for policy and only the announcement side holds:
 * a project set to read only refuses a downstream tool that never claimed to
 * be read only.
 */
export type McpDispatcher = (
  context: McpToolContext,
  server: string,
  tool: string,
  args: unknown,
  readOnlyHint: boolean | undefined,
) => Promise<DispatchResult>;

/**
 * `env` is threaded in rather than reached for. The handler factory runs inside
 * the SDK, and `getMcpAuthContext()` carries only the grant's props, so this is
 * the sole route by which a binding reaches a tool.
 */
export function createProjectMcpHandler(
  projectId: string,
  dispatch: ToolDispatcher,
  env: Pick<Env, "REQUEST_STATE_SECRET">,
  /**
   * The tools the connected executor announced, or undefined to offer them all.
   *
   * Undefined is the answer for an offline machine as well as for a request
   * that is not `tools/list`, and both are deliberate. Hiding tools because a
   * laptop is asleep would answer a question nobody asked: the call fails with
   * `LOCAL_EXECUTOR_OFFLINE`, which says the true thing.
   */
  advertised?: ReadonlySet<ToolName>,
  listWorkspaces?: (
    context: Pick<McpToolContext, "userId" | "projectId" | "caller">,
  ) => Promise<unknown>,
  /**
   * The downstream MCP servers this project's machine announced, and where a
   * call to one of their tools goes.
   *
   * Absent offers no downstream tools, which is the state for a machine that
   * never announced any and for a request that is not `tools/list` — the same
   * deliberate omissions as `advertised`, for the same reasons.
   */
  mcp?: { dispatch: McpDispatcher; servers: McpServerTools[] },
) {
  return createMcpHandler(
    (request) => {
      const codec = approvalCodec(env);
      const offers = (name: ToolName) => advertised === undefined || advertised.has(name);

      const server = new McpServer(
        { name: "exeora", version: "0.2.0" },
        {
          instructions: serverInstructions(),
          // Without this hook the SDK hands the handler whatever string the
          // client echoed, unverified, which for state that decides whether a
          // command runs is the whole vulnerability.
          requestState: { verify: codec.verify },
        },
      );

      registerAgentPrompt(server, false);

      if (listWorkspaces) {
        server.registerTool(
          "list_workspaces",
          {
            title: ACCOUNT_TOOL_DEFINITIONS.list_workspaces.title,
            description: ACCOUNT_TOOL_DEFINITIONS.list_workspaces.description,
            inputSchema: ACCOUNT_TOOL_DEFINITIONS.list_workspaces.inputSchema.omit({
              project: true,
            }),
            annotations: { readOnlyHint: true },
          },
          async (_args, ctx) => {
            const props = propsOf();
            return toolResult(
              await listWorkspaces({
                userId: String(props.userId ?? ""),
                projectId,
                caller: {
                  clientId: props.clientId,
                  clientName: props.clientName,
                  mcp: mcpClientInfo(ctx),
                },
              }),
            );
          },
        );
      }

      // Every tool is forwarded verbatim to the executor, which validates the
      // arguments again against the same schema before touching the disk.
      const run = async (tool: ToolName, args: unknown, ctx: ServerContext) => {
        const props = propsOf();
        const { workspace, rest } = splitWorkspace(args);
        const approval = await approvalFor(ctx, tool, args);

        const result = await dispatch(
          {
            userId: String(props.userId ?? ""),
            projectId,
            workspace,
            caller: {
              clientId: props.clientId,
              clientName: props.clientName,
              mcp: mcpClientInfo(ctx),
            },
            approved: approval?.projectId === projectId,
            approvedWorkspaceId: approval?.workspaceId,
            canElicit: request.era === "modern",
          },
          tool,
          rest,
        );

        if (result.kind === "needs-approval") {
          // The dispatcher asks for this only when it was told the client can be
          // asked, so reaching it otherwise is a bug here rather than a state a
          // caller can produce. Answering a 2025-era client with an
          // `input_required` it cannot read would look like a hang.
          if (request.era !== "modern") {
            throw new ExeoraError(
              "INTERNAL_ERROR",
              "A confirmation was requested from a client that cannot be asked.",
            );
          }

          return askToConfirm(
            codec,
            ctx,
            result.projectId,
            tool,
            args,
            undefined,
            result.workspaceId,
          );
        }

        return toolResult(result.value);
      };

      registerExecutorTools(server, offers, run);

      if (mcp) {
        // The same shape of run callback as the canonical tools, so identity
        // and confirmation behave identically on both paths. No workspace
        // argument is stripped because none was registered: downstream servers
        // are machine-scoped processes, not checkout-scoped work.
        const runMcp: McpRun = async (server, tool, args, readOnlyHint, ctx) => {
          const props = propsOf();
          const name = mcpToolName(server, tool);
          const approval = await approvalFor(ctx, name, args);

          const result = await mcp.dispatch(
            {
              userId: String(props.userId ?? ""),
              projectId,
              caller: {
                clientId: props.clientId,
                clientName: props.clientName,
                mcp: mcpClientInfo(ctx),
              },
              approved: approval?.projectId === projectId,
              canElicit: request.era === "modern",
            },
            server,
            tool,
            args,
            readOnlyHint,
          );

          if (result.kind === "needs-approval") {
            if (request.era !== "modern") {
              throw new ExeoraError(
                "INTERNAL_ERROR",
                "A confirmation was requested from a client that cannot be asked.",
              );
            }

            return askToConfirmMcp(codec, ctx, result.projectId, server, tool, args);
          }

          return mcpToolResult(result.value);
        };

        registerMcpTools(server, mcp.servers, runMcp);
      }

      return server;
    },
    { route: mcpRoute(projectId) },
  );
}

function splitWorkspace(args: unknown): { workspace: string | undefined; rest: unknown } {
  if (!args || typeof args !== "object") return { workspace: undefined, rest: args };
  const { workspace, ...rest } = args as Record<string, unknown>;
  return { workspace: typeof workspace === "string" ? workspace : undefined, rest };
}

/**
 * Offers Exeora's coding-agent prompt, as a prompt and as a tool.
 *
 * Three channels for one text, because clients disagree about which they have.
 * `instructions` on the handshake is the only one that arrives without anyone
 * asking, but it is charged to the context of every request, so it carries the
 * brief and not the whole thing. `prompts/get` is what a person invokes, and it
 * is the right shape: a prompt is a message the user sends, not a tool result.
 * The tool is for everything that never grew prompt support, ChatGPT included,
 * and for the model that decides on its own it should read the manual first.
 *
 * Answered here in the Worker, so both work with the machine asleep. Neither is
 * gated by what the executor advertises: `advertised` describes the tools a CLI
 * serves, and this is not one of them.
 */
export function registerAgentPrompt(server: McpServer, account: boolean): void {
  const text = agentPrompt({ account });

  server.registerPrompt(
    AGENT_PROMPT_NAME,
    { title: AGENT_PROMPT_TITLE, description: AGENT_PROMPT_TOOL.description },
    () => ({
      messages: [{ role: "user" as const, content: { type: "text" as const, text } }],
    }),
  );

  server.registerTool(
    AGENT_PROMPT_TOOL.name,
    {
      title: AGENT_PROMPT_TOOL.title,
      description: AGENT_PROMPT_TOOL.description,
      annotations: { readOnlyHint: AGENT_PROMPT_TOOL.readOnly },
    },
    () => toolResult({ prompt: text }),
  );
}

/** The shape every tool answers with, so the two endpoints build it once. */
export function toolResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent: value as Record<string, unknown>,
  };
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

/**
 * The JSON-RPC method this request carries, when knowing it is cheap.
 *
 * Only `tools/list` has an answer that depends on which machine is connected,
 * and only that answer is worth a round trip to find out. Everything else, this
 * one included when it cannot tell, says undefined and the caller offers every
 * tool.
 *
 * Bounded by the same ceiling as the handshake, and for a stronger reason here:
 * a `tools/list` body is a few hundred bytes, so anything larger is certainly
 * not one and never needs buffering to rule out. That is what keeps this off
 * the path a `write_file` carrying a whole file takes.
 */
export async function peekMethod(request: Request): Promise<string | undefined> {
  if (request.method !== "POST") return undefined;

  const declared = Number(request.headers.get("Content-Length") ?? Number.NaN);
  if (!Number.isFinite(declared) || declared > MAX_HANDSHAKE_BYTES) return undefined;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return undefined;
  }

  const method = (body as { method?: unknown } | null)?.method;
  return typeof method === "string" ? method : undefined;
}

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
export function mcpClientInfo(ctx: ServerContext): McpClientInfo | undefined {
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

export function propsOf(): { userId?: string; clientId?: string; clientName?: string } {
  return (getMcpAuthContext()?.props ?? {}) as {
    userId?: string;
    clientId?: string;
    clientName?: string;
  };
}
