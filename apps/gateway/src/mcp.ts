import { ExeoraError, TOOL_DEFINITIONS, type ToolName } from "@exeora/protocol";
import {
  acceptedContent,
  CLIENT_INFO_META_KEY,
  inputRequired,
  McpServer,
  type ServerContext,
} from "@modelcontextprotocol/server";
import { createMcpHandler, getMcpAuthContext } from "agents/mcp/server";
import {
  APPROVAL_KEY,
  APPROVAL_SCHEMA,
  type ApprovalState,
  approvalCodec,
  describeCall,
  hashArguments,
} from "./approval.js";
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
  /** True once the user has confirmed this exact call. */
  approved: boolean;
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
export type DispatchResult = { kind: "value"; value: unknown } | { kind: "needs-approval" };

/** Runs a tool on the user's machine, through the relay. */
export type ToolDispatcher = (
  context: McpToolContext,
  tool: ToolName,
  args: unknown,
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
) {
  return createMcpHandler(
    (request) => {
      const codec = approvalCodec(env);
      const offers = (name: ToolName) => advertised === undefined || advertised.has(name);

      const server = new McpServer(
        { name: "exeora", version: "0.2.0" },
        // Without this hook the SDK hands the handler whatever string the
        // client echoed, unverified, which for state that decides whether a
        // command runs is the whole vulnerability.
        { requestState: { verify: codec.verify } },
      );

      // Every tool is forwarded verbatim to the executor, which validates the
      // arguments again against the same schema before touching the disk.
      const run = async (tool: ToolName, args: unknown, ctx: ServerContext) => {
        const props = propsOf();

        const result = await dispatch(
          {
            userId: String(props.userId ?? ""),
            projectId,
            caller: {
              clientId: props.clientId,
              clientName: props.clientName,
              mcp: mcpClientInfo(ctx),
            },
            approved: await isApproved(ctx, projectId, tool, args),
            canElicit: request.era === "modern",
          },
          tool,
          args,
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

          return inputRequired({
            inputRequests: {
              [APPROVAL_KEY]: inputRequired.elicit({
                message: describeCall(tool, args),
                requestedSchema: APPROVAL_SCHEMA,
              }),
            },
            requestState: await codec.mint(
              { projectId, tool, argsHash: await hashArguments(args) },
              ctx,
            ),
          });
        }

        const { value } = result;
        return {
          content: [{ type: "text" as const, text: JSON.stringify(value) }],
          structuredContent: value as Record<string, unknown>,
        };
      };

      // Registered one by one rather than in a loop: the SDK infers the
      // argument type of each callback from its own schema, and a loop would
      // collapse the schemas into a union that erases that inference.
      const meta = <N extends ToolName>(name: N) => ({
        title: TOOL_DEFINITIONS[name].title,
        description: TOOL_DEFINITIONS[name].description,
        annotations: { readOnlyHint: TOOL_DEFINITIONS[name].readOnly },
      });

      if (offers("read_file")) {
        server.registerTool(
          "read_file",
          { ...meta("read_file"), inputSchema: TOOL_DEFINITIONS.read_file.inputSchema },
          (args, ctx) => run("read_file", args, ctx),
        );
      }
      if (offers("list_files")) {
        server.registerTool(
          "list_files",
          { ...meta("list_files"), inputSchema: TOOL_DEFINITIONS.list_files.inputSchema },
          (args, ctx) => run("list_files", args, ctx),
        );
      }
      if (offers("grep")) {
        server.registerTool(
          "grep",
          { ...meta("grep"), inputSchema: TOOL_DEFINITIONS.grep.inputSchema },
          (args, ctx) => run("grep", args, ctx),
        );
      }
      if (offers("edit_file")) {
        server.registerTool(
          "edit_file",
          { ...meta("edit_file"), inputSchema: TOOL_DEFINITIONS.edit_file.inputSchema },
          (args, ctx) => run("edit_file", args, ctx),
        );
      }
      if (offers("write_file")) {
        server.registerTool(
          "write_file",
          { ...meta("write_file"), inputSchema: TOOL_DEFINITIONS.write_file.inputSchema },
          (args, ctx) => run("write_file", args, ctx),
        );
      }
      if (offers("run_command")) {
        server.registerTool(
          "run_command",
          { ...meta("run_command"), inputSchema: TOOL_DEFINITIONS.run_command.inputSchema },
          (args, ctx) => run("run_command", args, ctx),
        );
      }
      if (offers("start_command")) {
        server.registerTool(
          "start_command",
          { ...meta("start_command"), inputSchema: TOOL_DEFINITIONS.start_command.inputSchema },
          (args, ctx) => run("start_command", args, ctx),
        );
      }
      if (offers("get_command_output")) {
        server.registerTool(
          "get_command_output",
          {
            ...meta("get_command_output"),
            inputSchema: TOOL_DEFINITIONS.get_command_output.inputSchema,
          },
          (args, ctx) => run("get_command_output", args, ctx),
        );
      }
      if (offers("send_command_input")) {
        server.registerTool(
          "send_command_input",
          {
            ...meta("send_command_input"),
            inputSchema: TOOL_DEFINITIONS.send_command_input.inputSchema,
          },
          (args, ctx) => run("send_command_input", args, ctx),
        );
      }
      if (offers("kill_command")) {
        server.registerTool(
          "kill_command",
          { ...meta("kill_command"), inputSchema: TOOL_DEFINITIONS.kill_command.inputSchema },
          (args, ctx) => run("kill_command", args, ctx),
        );
      }

      return server;
    },
    { route: mcpRoute(projectId) },
  );
}

/**
 * Whether this round carries a confirmation for this exact call.
 *
 * All four conditions have to hold, and the last is the one that matters most.
 * Without comparing the arguments, a client could have `ls` approved and retry
 * with `rm -rf ~` carrying the same state: the signature would verify, the tool
 * would match, and the approval would be for a call nobody ever saw.
 *
 * The state itself has already been verified by the seam, since the server is
 * built with `requestState.verify`; a forged or expired one never reaches here.
 */
export async function isApproved(
  ctx: Pick<ServerContext, "mcpReq">,
  projectId: string,
  tool: ToolName,
  args: unknown,
): Promise<boolean> {
  const state = ctx.mcpReq.requestState<ApprovalState>();
  if (!state || typeof state !== "object") return false;
  if (state.projectId !== projectId || state.tool !== tool) return false;

  const answer = acceptedContent<{ [APPROVAL_KEY]?: unknown }>(
    ctx.mcpReq.inputResponses,
    APPROVAL_KEY,
  );
  // `undefined` covers a declined or cancelled elicitation as well as a missing
  // one, which is right: none of them is a yes.
  if (answer?.[APPROVAL_KEY] !== true) return false;

  return state.argsHash === (await hashArguments(args));
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
