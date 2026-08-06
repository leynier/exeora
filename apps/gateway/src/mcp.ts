import { TOOL_DEFINITIONS, type ToolName } from "@exeora/protocol";
import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler, getMcpAuthContext } from "agents/mcp/server";
import "./env.js";

/**
 * One MCP endpoint per project: `exeora.dev/p/:projectId/mcp`.
 *
 * The handler is stateless, so building one per request costs nothing and lets
 * `route` carry the project id. Isolating projects at the URL means an agent
 * connected to one project has no way to name another — the separation is
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
  clientId: string | undefined;
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
      const run = async (tool: ToolName, args: unknown) => {
        const props = (getMcpAuthContext()?.props ?? {}) as {
          userId?: string;
          clientId?: string;
        };
        const value = await dispatch(
          { userId: String(props.userId ?? ""), projectId, clientId: props.clientId },
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
        (args) => run("read_file", args),
      );
      server.registerTool(
        "list_files",
        { ...meta("list_files"), inputSchema: TOOL_DEFINITIONS.list_files.inputSchema },
        (args) => run("list_files", args),
      );
      server.registerTool(
        "grep",
        { ...meta("grep"), inputSchema: TOOL_DEFINITIONS.grep.inputSchema },
        (args) => run("grep", args),
      );
      server.registerTool(
        "edit_file",
        { ...meta("edit_file"), inputSchema: TOOL_DEFINITIONS.edit_file.inputSchema },
        (args) => run("edit_file", args),
      );
      server.registerTool(
        "write_file",
        { ...meta("write_file"), inputSchema: TOOL_DEFINITIONS.write_file.inputSchema },
        (args) => run("write_file", args),
      );
      server.registerTool(
        "run_command",
        { ...meta("run_command"), inputSchema: TOOL_DEFINITIONS.run_command.inputSchema },
        (args) => run("run_command", args),
      );

      return server;
    },
    { route: mcpRoute(projectId) },
  );
}
