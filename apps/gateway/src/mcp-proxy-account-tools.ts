import { ExeoraError, type McpToolDescriptor } from "@exeora/protocol";
import {
  fromJsonSchema,
  isCallToolResult,
  type JsonSchemaType,
  type McpServer,
  type ServerContext,
} from "@modelcontextprotocol/server";

export interface ProjectMcpCatalog {
  projectId: string;
  project: string;
  tools: readonly McpToolDescriptor[];
}

export type AccountMcpProxyRun = (
  project: ProjectMcpCatalog,
  tool: McpToolDescriptor,
  workspace: string | undefined,
  args: unknown,
  ctx: ServerContext,
) => Promise<unknown>;

interface CatalogTool {
  catalog: ProjectMcpCatalog;
  tool: McpToolDescriptor;
}

const WORKSPACE = {
  type: "string",
  description:
    "Run this call in a connected Git workspace by slug or id. Omit it, or use main, for the project root.",
} as const;

/** Registers the union of upstream MCP tools reachable from an account endpoint. */
export function registerAccountMcpProxyTools(
  server: McpServer,
  catalogs: readonly ProjectMcpCatalog[],
  run: AccountMcpProxyRun,
): void {
  const groups = new Map<string, CatalogTool[]>();
  for (const catalog of catalogs) {
    for (const tool of catalog.tools) {
      const group = groups.get(tool.exposedName) ?? [];
      group.push({ catalog, tool });
      groups.set(tool.exposedName, group);
    }
  }

  for (const [name, group] of groups) {
    const first = group[0];
    if (!first) continue;
    server.registerTool(
      name,
      {
        ...(first.tool.title ? { title: first.tool.title } : {}),
        description:
          first.tool.description ??
          `Tool ${first.tool.name} proxied from the configured MCP server ${first.tool.server}.`,
        inputSchema: fromJsonSchema<Record<string, unknown>>(
          accountSchema(group) as JsonSchemaType,
        ),
      },
      async (args, ctx) => {
        const { project, workspace, ...rest } = args;
        const selected = selectProject(group, project);
        const value = await run(
          selected.catalog,
          selected.tool,
          typeof workspace === "string" ? workspace : undefined,
          rest,
          ctx,
        );
        if (!isCallToolResult(value)) {
          throw new ExeoraError(
            "INTERNAL_ERROR",
            `MCP server \`${selected.tool.server}\` returned an invalid tool result.`,
          );
        }
        return value;
      },
    );
  }
}

function selectProject(group: CatalogTool[], selector: unknown): CatalogTool {
  if (typeof selector === "string") {
    const selected = group.find((entry) => entry.catalog.project === selector);
    if (selected) return selected;
    throw new ExeoraError(
      "UNKNOWN_PROJECT",
      "That project does not expose this MCP tool on this connection.",
    );
  }
  if (group.length === 1 && group[0]) return group[0];
  throw new ExeoraError(
    "INVALID_ARGUMENTS",
    "This MCP tool is available in several projects. Pass the project slug for this call.",
  );
}

function accountSchema(group: CatalogTool[]): Record<string, unknown> {
  if (group.length === 1 && group[0]) {
    return addRouting(group[0], false);
  }
  return { oneOf: group.map((entry) => addRouting(entry, true)) };
}

function addRouting(entry: CatalogTool, requireProject: boolean): Record<string, unknown> {
  const schema = entry.tool.inputSchema;
  const properties = objectRecord(schema.properties);
  const existingRequired = Array.isArray(schema.required)
    ? schema.required.filter((value): value is string => typeof value === "string")
    : [];
  return {
    ...schema,
    type: schema.type ?? "object",
    properties: {
      ...properties,
      project: {
        type: "string",
        enum: [entry.catalog.project],
        description: "The project this MCP tool runs in.",
      },
      workspace: WORKSPACE,
    },
    ...(requireProject
      ? { required: [...new Set([...existingRequired, "project"])] }
      : existingRequired.length > 0
        ? { required: existingRequired }
        : {}),
  };
}

function objectRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}
