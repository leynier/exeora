import {
  type AccountToolName,
  ExeoraError,
  type McpServerTools,
  mcpToolName,
  serverInstructions,
  type ToolName,
} from "@exeora/protocol";
import { McpServer, type ServerContext } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { approvalCodec, askToConfirmMcp } from "./approval.js";
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
import { registerAccountTools, splitRouting } from "./mcp-account-tools.js";
import { type McpRun, mcpToolResult, registerMcpTools } from "./mcp-servers.js";

/**
 * The account endpoint: one URL, `exeora.dev/mcp`, the same for everyone.
 *
 * The per-project endpoint keeps a project out of reach by never naming it: the
 * id comes from the path and lives in a closure, so the separation is
 * structural rather than something the model is asked to respect. This one
 * offers the model a field for naming a project on every call, and gives it a
 * tool for discovering what those names are.
 */
export const ACCOUNT_MCP_ROUTE = "/mcp";

export type AccountCall = {
  userId: string;
  caller: CallerIdentity;
  /** Optional project selector for this call; omitted only when the token reaches one project. */
  project: string | undefined;
  /** Optional workspace selector for this call; omitted means the project's main root. */
  workspace?: string | undefined;
  /** The project an approval on this round was given for, if any. */
  approvedProjectId: string | undefined;
  approvedWorkspaceId?: string | undefined;
  canElicit: boolean;
};

export type AccountDispatchResult =
  | { kind: "value"; value: unknown }
  /**
   * `project` is the resolved project's slug, carried alongside its id because
   * the two readers need different things: the signed state binds the id, and
   * the person being asked has to be told, in words, which project the call
   * would land in. The dispatcher is the only side that knows either.
   */
  | {
      kind: "needs-approval";
      projectId: string;
      project: string;
      workspaceId?: string;
    };

/** Runs one executor tool, wherever the account endpoint decides that is. */
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
 * Runs one downstream MCP tool on the account endpoint. The project is already
 * settled — downstream tools are only offered when the connection reaches
 * exactly one — so the dispatcher receives it rather than resolving it.
 */
export type AccountMcpDispatch = (
  call: Pick<AccountCall, "userId" | "caller" | "approvedProjectId" | "canElicit">,
  server: string,
  tool: string,
  args: unknown,
  readOnlyHint: boolean | undefined,
) => Promise<AccountDispatchResult>;

export function createAccountMcpHandler(
  dispatch: AccountDispatcher,
  answer: AccountToolHandler,
  env: Pick<Env, "REQUEST_STATE_SECRET">,
  /**
   * The executor tools to advertise, or undefined to offer them all. The
   * gateway-only list tools are always offered so a caller can name a target.
   */
  advertised?: ReadonlySet<ToolName>,
  /**
   * The downstream MCP servers of the one project this connection reaches,
   * offered only when there is exactly one, and where a call to their tools
   * goes. Absent offers none.
   */
  mcp?: { projectId: string; servers: McpServerTools[]; dispatch: AccountMcpDispatch },
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
       * One executor tool, forwarded to whichever machine serves the project this
       * call resolves to.
       *
       * `project` is read here and removed before the arguments travel: the
       * executor validates them against the shared schema, which has no such
       * field, and a project's own name is the gateway's business rather than
       * something a machine should be told twice.
       */
      const run = async (tool: ToolName, args: unknown, ctx: ServerContext) => {
        const props = propsOf();
        const { project, workspace, rest } = splitRouting(args);
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
            workspace,
            approvedProjectId: approval?.projectId,
            approvedWorkspaceId: approval?.workspaceId,
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
            result.workspaceId,
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

      registerAccountTools(server, offers, run, manage);

      if (mcp) {
        // The run wrapper the project endpoint has, with the one difference the
        // account endpoint always carries: the question names the project,
        // because this URL reaches the projects the client was granted and the
        // person approving should be told which one a server would run in.
        const runMcp: McpRun = async (server, tool, args, readOnlyHint, ctx) => {
          const props = propsOf();
          const name = mcpToolName(server, tool);
          const approval = await approvalFor(ctx, name, args);

          const result = await mcp.dispatch(
            {
              userId: String(props.userId ?? ""),
              caller: {
                clientId: props.clientId,
                clientName: props.clientName,
                mcp: mcpClientInfo(ctx),
              },
              approvedProjectId: approval?.projectId,
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

            return askToConfirmMcp(
              codec,
              ctx,
              result.projectId,
              server,
              tool,
              args,
              result.project,
            );
          }

          return mcpToolResult(result.value);
        };

        registerMcpTools(server, mcp.servers, runMcp);
      }

      return server;
    },
    { route: ACCOUNT_MCP_ROUTE },
  );
}
