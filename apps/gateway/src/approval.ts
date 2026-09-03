import { mcpToolName, type ToolName } from "@exeora/protocol";
import {
  acceptedContent,
  createRequestStateCodec,
  inputRequired,
  type ServerContext,
} from "@modelcontextprotocol/server";
import "./env.js";

/**
 * Asking before a tool runs.
 *
 * MCP 2026-07-28 answers a call with `input_required` instead of a result: the
 * client fulfils the embedded request and retries the same call, carrying the
 * answer and an opaque `requestState` the server minted. There is no session
 * here to keep the first half in, so that string is the only thing joining the
 * two rounds.
 *
 * Which is why it is signed and bound. It travels through the AI client and
 * comes back as attacker-controlled input, and the SDK verifies nothing by
 * default. Two things matter:
 *
 *  - **The signature**, so a client cannot mint its own approval.
 *  - **The arguments hash**, so an approval is for the call that was shown. A
 *    state that named only the tool would let a client have `ls` approved and
 *    retry with `rm -rf ~` under the same permission.
 */

/** What the signed state carries between the two halves of one call. */
export interface ApprovalState {
  projectId: string;
  workspaceId?: string;
  /**
   * A plain string because it may name a downstream MCP tool
   * (`mcp__server__tool`), which no enum can list. Opaque to the codec: it is
   * compared, never interpreted.
   */
  tool: string;
  /** SHA-256 of the arguments that were shown, so the retry cannot swap them. */
  argsHash: string;
}

/**
 * The key under which the confirmation is requested and read back.
 *
 * One name for both directions: the client echoes the key it was given.
 */
export const APPROVAL_KEY = "approve";

/** Ten minutes. Long enough to read a command, short enough not to sit around. */
const TTL_SECONDS = 600;

export function approvalCodec(env: Pick<Env, "REQUEST_STATE_SECRET">) {
  return createRequestStateCodec<ApprovalState>({
    key: env.REQUEST_STATE_SECRET,
    ttlSeconds: TTL_SECONDS,
    /**
     * Binds the state to the client and method it was minted for, so an
     * approval one application obtained cannot be replayed by another holding
     * a token for the same project.
     */
    bind: (ctx: ServerContext) => `${ctx.mcpReq.method}\x00${ctx.http?.authInfo?.clientId ?? ""}`,
  });
}

/**
 * A stable hash of the arguments a call was approved for.
 *
 * Keys are sorted before hashing, because two JSON objects that differ only in
 * key order are the same call and must not need approving twice.
 */
export async function hashArguments(args: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(stableStringify(args));
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, member]) => member !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, member]) => `${JSON.stringify(key)}:${stableStringify(member)}`);

  return `{${entries.join(",")}}`;
}

/**
 * Asks the client to confirm this exact call, on this exact project.
 *
 * `where` names the project in the question, and is given only where the
 * question needs it. A per-project URL reaches one project and the person
 * approving already knows which; the account URL reaches several, so "Run
 * `rm -rf build`?" on its own asks someone to approve a command without saying
 * which repository it lands in, which is not a question anybody can answer.
 */
export async function askToConfirm(
  codec: ReturnType<typeof approvalCodec>,
  ctx: ServerContext,
  projectId: string,
  tool: ToolName,
  args: unknown,
  where?: string,
  workspaceId?: string,
) {
  const question = describeCall(tool, args);

  return inputRequired({
    inputRequests: {
      [APPROVAL_KEY]: inputRequired.elicit({
        message: where ? `In ${where}: ${question}` : question,
        requestedSchema: APPROVAL_SCHEMA,
      }),
    },
    requestState: await codec.mint(
      {
        projectId,
        ...(workspaceId ? { workspaceId } : {}),
        tool,
        argsHash: await hashArguments(args),
      },
      ctx,
    ),
  });
}

/**
 * The same question for a downstream MCP tool, whose answer names the server
 * and the tool rather than quoting arguments this side never had a schema for.
 *
 * The signed state binds the republished name (`mcp__server__tool`), which is
 * the name the retry will carry, exactly as the canonical question binds the
 * tool it asked about.
 */
export async function askToConfirmMcp(
  codec: ReturnType<typeof approvalCodec>,
  ctx: ServerContext,
  projectId: string,
  server: string,
  tool: string,
  args: unknown,
  where?: string,
) {
  const question = describeMcpCall(server, tool);

  return inputRequired({
    inputRequests: {
      [APPROVAL_KEY]: inputRequired.elicit({
        message: where ? `In ${where}: ${question}` : question,
        requestedSchema: APPROVAL_SCHEMA,
      }),
    },
    requestState: await codec.mint(
      {
        projectId,
        tool: mcpToolName(server, tool),
        argsHash: await hashArguments(args),
      },
      ctx,
    ),
  });
}

/**
 * The confirmation this round carries, if it is one for this exact call, and
 * the project it was given for.
 *
 * Every condition has to hold, and the argument hash is the one that matters
 * most. Without comparing the arguments, a client could have `ls` approved and
 * retry with `rm -rf ~` carrying the same state: the signature would verify,
 * the tool would match, and the approval would be for a call nobody ever saw.
 *
 * The project is returned rather than compared, because the account endpoint
 * does not know which project the call is for until the dispatcher resolves it.
 * Whoever does know still has to compare: an approval carries one project and
 * is worth nothing anywhere else.
 *
 * The state itself has already been verified by the seam, since the server is
 * built with `requestState.verify`; a forged or expired one never reaches here.
 */
export async function approvalFor(
  ctx: Pick<ServerContext, "mcpReq">,
  tool: string,
  args: unknown,
): Promise<{ projectId: string; workspaceId?: string } | null> {
  const state = ctx.mcpReq.requestState<ApprovalState>();
  if (!state || typeof state !== "object") return null;
  if (state.tool !== tool) return null;

  const answer = acceptedContent<{ [APPROVAL_KEY]?: unknown }>(
    ctx.mcpReq.inputResponses,
    APPROVAL_KEY,
  );
  // `undefined` covers a declined or cancelled elicitation as well as a missing
  // one, which is right: none of them is a yes.
  if (answer?.[APPROVAL_KEY] !== true) return null;

  if (state.argsHash !== (await hashArguments(args))) return null;

  return {
    projectId: state.projectId,
    ...(state.workspaceId ? { workspaceId: state.workspaceId } : {}),
  };
}

/** Whether this round confirms this exact call on this project. */
export async function isApproved(
  ctx: Pick<ServerContext, "mcpReq">,
  projectId: string,
  tool: string,
  args: unknown,
): Promise<boolean> {
  const approval = await approvalFor(ctx, tool, args);
  return approval?.projectId === projectId;
}

/**
 * What the user is shown before a call runs.
 *
 * The command is quoted in full for `run_command`, and the path for the file
 * tools, because "approve this edit" with nothing named is a prompt people
 * learn to click through. Nothing here comes from the host: it is the caller's
 * own arguments, shown back.
 */
export function describeCall(tool: ToolName, args: unknown): string {
  const record = (args ?? {}) as Record<string, unknown>;

  if (tool === "create_workspace" && typeof record.branch === "string") {
    const base = typeof record.from === "string" ? ` from ${record.from}` : "";
    const source = typeof record.workspace === "string" ? ` using ${record.workspace}` : "";
    return `Create workspace for branch ${record.branch}${base}${source}?`;
  }

  if (tool === "attach_workspace") {
    if (typeof record.path === "string") return `Attach workspace at ${record.path}?`;
    if (typeof record.branch === "string") return `Attach workspace for branch ${record.branch}?`;
  }

  if (tool === "detach_workspace") {
    const target = typeof record.workspace === "string" ? ` ${record.workspace}` : "";
    return `Detach workspace${target}?`;
  }

  if (tool === "remove_workspace") {
    const target = typeof record.workspace === "string" ? ` ${record.workspace}` : "";
    const force = record.force === true ? " with uncommitted changes allowed" : "";
    const branch = record.deleteBranch === true ? " and delete its branch" : "";
    return `Remove workspace${target}${force}${branch}?`;
  }

  if ((tool === "run_command" || tool === "start_command") && typeof record.command === "string") {
    const where = typeof record.cwd === "string" && record.cwd !== "." ? ` in ${record.cwd}` : "";
    const verb = tool === "start_command" ? "Start" : "Run";
    return `${verb} \`${record.command}\`${where}?`;
  }

  // The two that act on a process someone already approved starting. Naming the
  // handle is not much, but "Allow send_command_input?" is nothing at all.
  if (typeof record.processId === "string") {
    return tool === "kill_command"
      ? `Stop the process ${record.processId}?`
      : `Send input to the process ${record.processId}?`;
  }

  if (typeof record.path === "string") {
    return tool === "write_file" ? `Write ${record.path}?` : `Edit ${record.path}?`;
  }

  return `Allow ${tool}?`;
}

/**
 * The same question for a downstream MCP tool.
 *
 * Nothing of the arguments is quoted, because nothing about them is known
 * here: they belong to another server's schema. The server and tool are
 * named, which is what the person being asked can actually verify against the
 * machine's MCP configuration.
 */
export function describeMcpCall(server: string, tool: string): string {
  return `Use MCP tool \`${tool}\` from server \`${server}\`?`;
}

/** The elicitation schema. One boolean, because one question is being asked. */
export const APPROVAL_SCHEMA = {
  type: "object" as const,
  properties: {
    [APPROVAL_KEY]: {
      type: "boolean" as const,
      title: "Run it",
      description: "Runs on your machine, in this project's directory.",
    },
  },
  required: [APPROVAL_KEY],
};
