import { type McpServerTools, mcpToolName } from "@exeora/protocol";
import {
  type CallToolResult,
  fromJsonSchema,
  type InputRequiredResult,
  type JsonSchemaType,
  type McpServer,
  type ServerContext,
} from "@modelcontextprotocol/server";

/**
 * Republishing downstream MCP tools on an Exeora endpoint.
 *
 * A configured server's tools arrive as an announcement the relay stored, and
 * are registered here under `mcp__<server>__<tool>`: prefixed, because two
 * servers offering a tool with the same name is normal, and this endpoint also
 * carries seventeen tools of its own that neither server knows about.
 *
 * Kept apart from `mcp.ts` to keep both files inside the length budget. The
 * endpoint hands in the same kind of `run` callback `registerExecutorTools`
 * takes, so everything about identity, policy and confirmation stays with the
 * side that already owns it for the canonical tools.
 */

/** What one registered downstream tool calls back into, per `tools/call`. */
export type McpRun = (
  server: string,
  tool: string,
  args: unknown,
  readOnlyHint: boolean | undefined,
  ctx: ServerContext,
) => Promise<CallToolResult | InputRequiredResult>;

/**
 * Registers every ready server's tools.
 *
 * A server that announced an error registers none of its tools: an agent that
 * cannot see a broken server does not try it, and the person who broke it sees
 * the reason in `exeora connect`'s output instead of a tool that fails.
 */
export function registerMcpTools(server: McpServer, servers: McpServerTools[], run: McpRun) {
  for (const entry of servers) {
    if (entry.status !== "ready") continue;
    for (const tool of entry.tools) {
      registerOne(server, entry, tool, run);
    }
  }
}

/**
 * One tool, registered in its own try so a schema the SDK cannot accept costs
 * that tool alone. The endpoint answers either way; an announcement a gateway
 * could not register would otherwise take its whole project offline.
 */
function registerOne(
  server: McpServer,
  entry: McpServerTools,
  tool: McpServerTools["tools"][number],
  run: McpRun,
) {
  const name = mcpToolName(entry.name, tool.name);
  const readOnlyHint = tool.annotations?.readOnlyHint;

  try {
    server.registerTool(
      name,
      {
        title: tool.title ?? tool.name,
        description:
          tool.description === undefined
            ? `A tool from the \`${entry.name}\` MCP server configured on this machine.`
            : `${tool.description} (from the \`${entry.name}\` MCP server)`,
        inputSchema: fromJsonSchema(tool.inputSchema as JsonSchemaType),
        annotations: {
          // Absent is read as "changes something": the annotation is a claim by
          // the server, and the safe reading of no claim is the cautious one.
          readOnlyHint: readOnlyHint ?? false,
          ...(tool.annotations?.destructiveHint === undefined
            ? {}
            : { destructiveHint: tool.annotations.destructiveHint }),
          ...(tool.annotations?.idempotentHint === undefined
            ? {}
            : { idempotentHint: tool.annotations.idempotentHint }),
          ...(tool.annotations?.openWorldHint === undefined
            ? {}
            : { openWorldHint: tool.annotations.openWorldHint }),
        },
      },
      (args, ctx) => run(entry.name, tool.name, args, readOnlyHint, ctx),
    );
  } catch {
    // A schema the SDK refused at registration time. The tool is absent rather
    // than broken, and the next announcement retries it.
  }
}

/**
 * A downstream tool's answer, passed through as MCP content rather than
 * re-wrapped as JSON.
 *
 * The executor returns the server's own `content` array and `isError` flag;
 * handing them back untouched is what preserves an image or a structured
 * result, and `isError` is a result a model can read, not a failure to hide.
 * Anything that is not that shape — an older CLI, an unexpected value — falls
 * back to the canonical JSON wrap, which is readable and honest.
 */
export function mcpToolResult(value: unknown): CallToolResult {
  if (isToolResultShape(value)) {
    return {
      content: value.content as CallToolResult["content"],
      ...(value.isError ? { isError: true } : {}),
    };
  }
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent: value as Record<string, unknown>,
  };
}

function isToolResultShape(value: unknown): value is { content: unknown[]; isError?: boolean } {
  if (!value || typeof value !== "object") return false;
  const { content, isError } = value as { content?: unknown; isError?: unknown };
  if (!Array.isArray(content)) return false;
  if (isError !== undefined && typeof isError !== "boolean") return false;
  return content.every((item) => item !== null && typeof item === "object" && "type" in item);
}
