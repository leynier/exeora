import { ExeoraError, MCP_PROXY_TOOL_NAME_PATTERN, type McpToolDescriptor } from "@exeora/protocol";
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
  const seen = new Set<string>();
  for (const catalog of catalogs) {
    for (const tool of catalog.tools) {
      if (!MCP_PROXY_TOOL_NAME_PATTERN.test(tool.exposedName)) continue;
      const key = `${catalog.projectId}\0${tool.exposedName}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const group = groups.get(tool.exposedName) ?? [];
      group.push({ catalog, tool });
      groups.set(tool.exposedName, group);
    }
  }

  for (const [name, group] of groups) {
    const first = group[0];
    if (!first) continue;
    const schemas = group.map((entry) => entry.tool.inputSchema);
    const projectField = routingField(schemas, "project");
    const workspaceField = routingField(schemas, "workspace", new Set([projectField]));

    server.registerTool(
      name,
      {
        ...(first.tool.title ? { title: first.tool.title } : {}),
        description:
          first.tool.description ??
          `Tool ${first.tool.name} proxied from the configured MCP server ${first.tool.server}.`,
        inputSchema: fromJsonSchema<Record<string, unknown>>(
          accountSchema(group, projectField, workspaceField) as JsonSchemaType,
        ),
      },
      async (args, ctx) => {
        const record = objectRecord(args);
        const selected = selectProject(group, record[projectField]);
        const workspace = record[workspaceField];
        const rest = { ...record };
        delete rest[projectField];
        delete rest[workspaceField];
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
    const selected = group.find(
      (entry) => entry.catalog.project === selector || entry.catalog.projectId === selector,
    );
    if (selected) return selected;
    throw new ExeoraError(
      "UNKNOWN_PROJECT",
      "That project does not expose this MCP tool on this connection.",
    );
  }
  if (group.length === 1 && group[0]) return group[0];
  throw new ExeoraError(
    "INVALID_ARGUMENTS",
    "This MCP tool is available in several projects. Pass the project slug or id for this call.",
  );
}

function accountSchema(
  group: CatalogTool[],
  projectField: string,
  workspaceField: string,
): Record<string, unknown> {
  if (group.length === 1 && group[0]) {
    return addRouting(group[0], false, projectField, workspaceField);
  }
  return {
    oneOf: group.map((entry) => addRouting(entry, true, projectField, workspaceField)),
  };
}

function addRouting(
  entry: CatalogTool,
  requireProject: boolean,
  projectField: string,
  workspaceField: string,
): Record<string, unknown> {
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
      [projectField]: {
        type: "string",
        enum: [entry.catalog.project, entry.catalog.projectId],
        description: "The project this MCP tool runs in, by slug or id.",
      },
      [workspaceField]: WORKSPACE,
    },
    ...(requireProject
      ? { required: [...new Set([...existingRequired, projectField])] }
      : existingRequired.length > 0
        ? { required: existingRequired }
        : {}),
  };
}

/** Choose one routing field that is absent from every upstream schema in this tool group. */
function routingField(
  schemas: readonly Record<string, unknown>[],
  preferred: string,
  forbidden: ReadonlySet<string> = new Set(),
): string {
  if (!forbidden.has(preferred) && schemas.every((schema) => !hasProperty(schema, preferred))) {
    return preferred;
  }
  const base = `__exeora_${preferred}`;
  let candidate = base;
  let suffix = 2;
  while (forbidden.has(candidate) || schemas.some((schema) => hasProperty(schema, candidate))) {
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
