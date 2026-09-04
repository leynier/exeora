import { ExeoraError, MCP_PROXY_TOOL_NAME_PATTERN, type McpToolDescriptor } from "@exeora/protocol";
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
  const registered = new Set<string>();
  for (const tool of tools) {
    // Defense in depth: catalog decoding enforces the namespace too, but the
    // handler must stay safe even when called directly in tests or by a future
    // catalog source. A bad proxy entry must never shadow a native Exeora tool.
    if (!MCP_PROXY_TOOL_NAME_PATTERN.test(tool.exposedName) || registered.has(tool.exposedName)) {
      continue;
    }
    registered.add(tool.exposedName);
    const workspaceField = routingField([tool.inputSchema], "workspace");

    server.registerTool(
      tool.exposedName,
      {
        ...(tool.title ? { title: tool.title } : {}),
        description:
          tool.description ??
          `Tool ${tool.name} proxied from the configured MCP server ${tool.server}.`,
        inputSchema: fromJsonSchema<Record<string, unknown>>(
          withRoutingProperty(tool.inputSchema, workspaceField, WORKSPACE_SCHEMA) as JsonSchemaType,
        ),
      },
      async (args, ctx) => {
        const record = objectRecord(args);
        const workspace = record[workspaceField];
        const rest = { ...record };
        delete rest[workspaceField];
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

/** Add a routing property without replacing an upstream property of the same name. */
function withRoutingProperty(
  schema: Record<string, unknown>,
  field: string,
  routingSchema: Record<string, unknown>,
): Record<string, unknown> {
  const properties = objectRecord(schema.properties);
  return {
    ...schema,
    type: schema.type ?? "object",
    properties: { ...properties, [field]: routingSchema },
  };
}

/** Prefer the familiar field name, but never steal a name the upstream tool owns. */
function routingField(schemas: readonly Record<string, unknown>[], preferred: string): string {
  if (schemas.every((schema) => !hasProperty(schema, preferred))) return preferred;
  const base = `__exeora_${preferred}`;
  let candidate = base;
  let suffix = 2;
  while (schemas.some((schema) => hasProperty(schema, candidate))) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function hasProperty(schema: Record<string, unknown>, name: string): boolean {
  return Object.hasOwn(objectRecord(schema.properties), name);
}

function objectRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}
