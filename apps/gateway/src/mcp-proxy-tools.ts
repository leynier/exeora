import { ExeoraError, type McpToolDescriptor } from "@exeora/protocol";
import {
  fromJsonSchema,
  isCallToolResult,
  type JsonSchemaType,
  type McpServer,
  type ServerContext,
} from "@modelcontextprotocol/server";

const WORKSPACE_SCHEMA = {
  type: "string",
  description:
    "Run this call in a connected Git workspace by slug or id. Omit it, or use main, for the project root.",
} as const;

export type McpProxyRun = (
  tool: McpToolDescriptor,
  workspace: string | undefined,
  args: unknown,
  ctx: ServerContext,
) => Promise<unknown>;

/** Registers tools discovered from upstream MCP servers on Exeora's MCP server. */
export function registerMcpProxyTools(
  server: McpServer,
  tools: readonly McpToolDescriptor[],
  run: McpProxyRun,
): void {
  for (const tool of tools) {
    server.registerTool(
      tool.exposedName,
      {
        ...(tool.title ? { title: tool.title } : {}),
        description:
          tool.description ??
          `Tool ${tool.name} proxied from the configured MCP server ${tool.server}.`,
        inputSchema: fromJsonSchema<Record<string, unknown>>(
          withWorkspace(tool.inputSchema) as JsonSchemaType,
        ),
      },
      async (args, ctx) => {
        const { workspace, ...rest } = args;
        const value = await run(
          tool,
          typeof workspace === "string" ? workspace : undefined,
          rest,
          ctx,
        );
        if (!isCallToolResult(value)) {
          throw new ExeoraError(
            "INTERNAL_ERROR",
            `MCP server \`${tool.server}\` returned an invalid tool result.`,
          );
        }
        return value;
      },
    );
  }
}

/** MCP tool input schemas are objects; add Exeora's routing property without weakening them. */
function withWorkspace(schema: Record<string, unknown>): Record<string, unknown> {
  const properties = objectRecord(schema.properties);
  return {
    ...schema,
    type: schema.type ?? "object",
    properties: { ...properties, workspace: WORKSPACE_SCHEMA },
  };
}

function objectRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}
