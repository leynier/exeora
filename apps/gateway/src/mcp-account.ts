import {
  ACCOUNT_TOOL_DEFINITIONS,
  type AccountToolName,
  ExeoraError,
  ProjectRef,
  serverInstructions,
  TOOL_DEFINITIONS,
  type ToolName,
  WorktreeRef,
} from "@exeora/protocol";
import { McpServer, type ServerContext } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { approvalCodec } from "./approval.js";
import type { CallerIdentity } from "./clients.js";
import "./env.js";
import {
  approvalFor,
  askToConfirm,
  mcpClientInfo,
  propsOf,
  registerAgentPrompt,
  toolResult,
} from "./mcp.js";

/**
 * The account endpoint: one URL, `exeora.dev/mcp`, the same for everyone.
 *
 * The per-project endpoint keeps a project out of reach by never naming it: the
 * id comes from the path and lives in a closure, so the separation is
 * structural rather than something the model is asked to respect. This one
 * cannot make that promise, because one URL has to reach several projects. The
 * boundary moves to the consent screen instead, where the person ticks the
 * projects one at a time and the ticks are the access list. A connection made
 * with a single project ticked is exactly as confined as a per-project one.
 *
 * What it buys is that a client is configured once and keeps working as
 * projects come and go, instead of one entry per repository that has to be
 * added by hand.
 */
export const ACCOUNT_MCP_ROUTE = "/mcp";

/** Where a call should run, once the account endpoint has worked it out. */
export interface AccountCall {
  userId: string;
  caller: CallerIdentity;
  /**
   * The project named by this call, if it named one. The dispatcher permits an
   * omission only when the connection reaches exactly one project.
   */
  project: string | undefined;
  /** Optional worktree selector for this call; omitted means the project's main root. */
  worktree?: string | undefined;
  /** The project an approval on this round was given for, if any. */
  approvedProjectId: string | undefined;
  approvedWorktreeId?: string | undefined;
  canElicit: boolean;
}

export type AccountDispatchResult =
  | { kind: "value"; value: unknown }
  /**
   * `project` is the resolved project's slug, carried alongside its id because
   * the two readers need different things: the signed state binds the id, and
   * the person being asked has to be told, in words, which project the call
   * would land in. The dispatcher is the only side that knows either.
   */
  | { kind: "needs-approval"; projectId: string; project: string; worktreeId?: string };

/** Runs one of the ten tools, wherever the account endpoint decides that is. */
export type AccountDispatcher = (
  call: AccountCall,
  tool: ToolName,
  args: unknown,
) => Promise<AccountDispatchResult>;

/** Answers the account tool that never leaves the gateway. */
export type AccountToolHandler = (
  call: Pick<AccountCall, "userId" | "caller">,
  tool: AccountToolName,
  args: unknown,
) => Promise<unknown>;

/**
 * The `project` argument the account endpoint adds to every executor tool.
 *
 * Only here. On a per-project URL it would be an argument with one legal value
 * and no meaning, and offering the model a field for naming a project is
 * precisely what that endpoint refuses to do.
 */
const projectArg = {
  project: ProjectRef.optional().describe(
    "The project this call runs in, by slug or id. Required when this connection reaches more " +
      "than one project; omit only when it reaches exactly one.",
  ),
};
const routingArgs = {
  ...projectArg,
  worktree: WorktreeRef.optional().describe(
    "Run this call in a connected Git worktree by slug or id. Omit it, or use main, for the project root.",
  ),
};

export function createAccountMcpHandler(
  dispatch: AccountDispatcher,
  answer: AccountToolHandler,
  env: Pick<Env, "REQUEST_STATE_SECRET">,
  /**
   * The executor tools to advertise, or undefined to offer them all. The
   * gateway-only list tools are always offered so a caller can name a target.
   */
  advertised?: ReadonlySet<ToolName>,
) {
  return createMcpHandler(
    (request) => {
      const codec = approvalCodec(env);
      const offers = (name: ToolName) => advertised === undefined || advertised.has(name);

      const server = new McpServer(
        { name: "exeora", version: "0.2.0" },
        {
          // The account variant, which is the one that has projects to choose
          // between and so the only one where saying so is worth the tokens.
          instructions: serverInstructions({ account: true }),
          requestState: { verify: codec.verify },
        },
      );

      registerAgentPrompt(server, true);

      /**
       * One of the ten, forwarded to whichever machine serves the project this
       * call resolves to.
       *
       * `project` is read here and removed before the arguments travel: the
       * executor validates them against the shared schema, which has no such
       * field, and a project's own name is the gateway's business rather than
       * something a machine should be told twice.
       */
      const run = async (tool: ToolName, args: unknown, ctx: ServerContext) => {
        const props = propsOf();
        const { project, worktree, rest } = splitRouting(args);
        const approval = await approvalFor(ctx, tool, args);

        const result = await dispatch(
          {
            userId: String(props.userId ?? ""),
            caller: {
              clientId: props.clientId,
              clientName: props.clientName,
              mcp: mcpClientInfo(ctx),
            },
            project,
            worktree,
            approvedProjectId: approval?.projectId,
            approvedWorktreeId: approval?.worktreeId,
            canElicit: request.era === "modern",
          },
          tool,
          rest,
        );

        if (result.kind === "needs-approval") {
          if (request.era !== "modern") {
            throw new ExeoraError(
              "INTERNAL_ERROR",
              "A confirmation was requested from a client that cannot be asked.",
            );
          }

          // Minted against the arguments as the client sent them, `project`
          // included, because that is what the next round will carry and what
          // the hash has to match. The question names the project as well: this
          // URL reaches several, and the arguments alone do not say which.
          return askToConfirm(
            codec,
            ctx,
            result.projectId,
            tool,
            args,
            result.project,
            result.worktreeId,
          );
        }

        return toolResult(result.value);
      };

      /** The project list, answered from the database without a relay. */
      const manage = async (tool: AccountToolName, args: unknown, ctx: ServerContext) => {
        const props = propsOf();

        const value = await answer(
          {
            userId: String(props.userId ?? ""),
            caller: {
              clientId: props.clientId,
              clientName: props.clientName,
              mcp: mcpClientInfo(ctx),
            },
          },
          tool,
          args,
        );

        return toolResult(value);
      };

      // Registered one by one, as in `mcp.ts` and for the same reason: the SDK
      // infers each callback's argument type from its own schema, and a loop
      // would collapse the schemas into a union that erases that inference.
      const meta = <N extends ToolName>(name: N) => ({
        title: TOOL_DEFINITIONS[name].title,
        description: TOOL_DEFINITIONS[name].description,
        annotations: { readOnlyHint: TOOL_DEFINITIONS[name].readOnly },
      });

      const manageMeta = <N extends AccountToolName>(name: N) => ({
        title: ACCOUNT_TOOL_DEFINITIONS[name].title,
        description: ACCOUNT_TOOL_DEFINITIONS[name].description,
        annotations: { readOnlyHint: ACCOUNT_TOOL_DEFINITIONS[name].readOnly },
      });

      server.registerTool(
        "list_worktrees",
        {
          ...manageMeta("list_worktrees"),
          inputSchema: ACCOUNT_TOOL_DEFINITIONS.list_worktrees.inputSchema,
        },
        (args, ctx) => manage("list_worktrees", args, ctx),
      );
      server.registerTool(
        "list_projects",
        {
          ...manageMeta("list_projects"),
          inputSchema: ACCOUNT_TOOL_DEFINITIONS.list_projects.inputSchema,
        },
        (args, ctx) => manage("list_projects", args, ctx),
      );
      if (offers("read_file")) {
        server.registerTool(
          "read_file",
          {
            ...meta("read_file"),
            inputSchema: TOOL_DEFINITIONS.read_file.inputSchema.extend(routingArgs),
          },
          (args, ctx) => run("read_file", args, ctx),
        );
      }
      if (offers("list_files")) {
        server.registerTool(
          "list_files",
          {
            ...meta("list_files"),
            inputSchema: TOOL_DEFINITIONS.list_files.inputSchema.extend(routingArgs),
          },
          (args, ctx) => run("list_files", args, ctx),
        );
      }
      if (offers("grep")) {
        server.registerTool(
          "grep",
          { ...meta("grep"), inputSchema: TOOL_DEFINITIONS.grep.inputSchema.extend(routingArgs) },
          (args, ctx) => run("grep", args, ctx),
        );
      }
      if (offers("edit_file")) {
        server.registerTool(
          "edit_file",
          {
            ...meta("edit_file"),
            inputSchema: TOOL_DEFINITIONS.edit_file.inputSchema.extend(routingArgs),
          },
          (args, ctx) => run("edit_file", args, ctx),
        );
      }
      if (offers("write_file")) {
        server.registerTool(
          "write_file",
          {
            ...meta("write_file"),
            inputSchema: TOOL_DEFINITIONS.write_file.inputSchema.extend(routingArgs),
          },
          (args, ctx) => run("write_file", args, ctx),
        );
      }
      if (offers("run_command")) {
        server.registerTool(
          "run_command",
          {
            ...meta("run_command"),
            inputSchema: TOOL_DEFINITIONS.run_command.inputSchema.extend(routingArgs),
          },
          (args, ctx) => run("run_command", args, ctx),
        );
      }
      if (offers("start_command")) {
        server.registerTool(
          "start_command",
          {
            ...meta("start_command"),
            inputSchema: TOOL_DEFINITIONS.start_command.inputSchema.extend(routingArgs),
          },
          (args, ctx) => run("start_command", args, ctx),
        );
      }
      if (offers("get_command_output")) {
        server.registerTool(
          "get_command_output",
          {
            ...meta("get_command_output"),
            inputSchema: TOOL_DEFINITIONS.get_command_output.inputSchema.extend(routingArgs),
          },
          (args, ctx) => run("get_command_output", args, ctx),
        );
      }
      if (offers("send_command_input")) {
        server.registerTool(
          "send_command_input",
          {
            ...meta("send_command_input"),
            inputSchema: TOOL_DEFINITIONS.send_command_input.inputSchema.extend(routingArgs),
          },
          (args, ctx) => run("send_command_input", args, ctx),
        );
      }
      if (offers("kill_command")) {
        server.registerTool(
          "kill_command",
          {
            ...meta("kill_command"),
            inputSchema: TOOL_DEFINITIONS.kill_command.inputSchema.extend(routingArgs),
          },
          (args, ctx) => run("kill_command", args, ctx),
        );
      }

      return server;
    },
    { route: ACCOUNT_MCP_ROUTE },
  );
}

/** Lifts gateway-only routing fields out, leaving the canonical executor input. */
function splitRouting(args: unknown): {
  project: string | undefined;
  worktree: string | undefined;
  rest: unknown;
} {
  if (!args || typeof args !== "object") {
    return { project: undefined, worktree: undefined, rest: args };
  }

  const { project, worktree, ...rest } = args as Record<string, unknown>;
  return {
    project: typeof project === "string" ? project : undefined,
    worktree: typeof worktree === "string" ? worktree : undefined,
    rest,
  };
}
