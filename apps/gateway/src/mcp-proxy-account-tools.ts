import {
  ExeoraError,
  MCP_PROXY_TOOL_NAME_PATTERN,
  type McpToolAnnotations,
  type McpToolDescriptor,
} from "@exeora/protocol";
import type { McpServer } from "@modelcontextprotocol/server";
import {
  type McpProxyInvocation,
  objectRecord,
  registerProxyTool,
  routingField,
  WORKSPACE_SCHEMA,
} from "./mcp-proxy-tools.js";

export interface ProjectMcpCatalog {
  projectId: string;
  project: string;
  tools: readonly McpToolDescriptor[];
}

interface CatalogTool {
  catalog: ProjectMcpCatalog;
  tool: McpToolDescriptor;
}

/**
 * Registers the union of upstream MCP tools an account endpoint reaches.
 *
 * One registration per exposed name, however many projects offer it. A name
 * offered by one project keeps that project's full schema. A name offered by
 * several gets one object schema that merges their properties and requires the
 * project: MCP clients reject a tool whose root schema is a `oneOf`, and the
 * upstream server validates its own arguments anyway.
 */
export function registerAccountMcpProxyTools(
  server: McpServer,
  catalogs: readonly ProjectMcpCatalog[],
  handle: (catalog: ProjectMcpCatalog, invocation: McpProxyInvocation) => Promise<unknown>,
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

  for (const group of groups.values()) {
    const first = group[0];
    if (!first) continue;
    const schemas = group.map((entry) => entry.tool.inputSchema);
    const projectField = routingField(schemas, "project");
    const workspaceField = routingField(schemas, "workspace", new Set([projectField]));
    const schema =
      group.length === 1
        ? singleSchema(first, projectField, workspaceField)
        : mergedSchema(group, projectField, workspaceField);
    const described =
      group.length === 1
        ? first.tool
        : {
            ...first.tool,
            description: `${first.tool.description ?? `Tool \`${first.tool.name}\`.`} Available in: ${group.map((entry) => entry.catalog.project).join(", ")}.`,
            annotations: mergedAnnotations(group),
          };

    registerProxyTool(server, described, schema, async (args, ctx) => {
      const selected = selectProject(group, args[projectField]);
      const workspace = args[workspaceField];
      const upstreamArgs = { ...args };
      delete upstreamArgs[projectField];
      delete upstreamArgs[workspaceField];
      return handle(selected.catalog, {
        tool: selected.tool,
        workspace: typeof workspace === "string" ? workspace : undefined,
        upstreamArgs,
        args,
        ctx,
      });
    });
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

/**
 * What several projects' variants of one tool can honestly claim together.
 *
 * A client may run a tool marked read only without asking, so a hint survives
 * the merge only when every variant states the same value; otherwise it is
 * left out and the MCP default applies, which is the cautious reading for each
 * of them. Dispatch still applies the policy to the variant a call selects.
 */
function mergedAnnotations(group: readonly CatalogTool[]): McpToolAnnotations {
  const hints = group.map((entry) => entry.tool.annotations ?? {});
  const agreed = (key: keyof McpToolAnnotations) => {
    const first = hints[0]?.[key];
    return first !== undefined && hints.every((hint) => hint[key] === first)
      ? { [key]: first }
      : {};
  };
  return {
    ...agreed("readOnlyHint"),
    ...agreed("destructiveHint"),
    ...agreed("idempotentHint"),
    ...agreed("openWorldHint"),
  };
}

function projectSchema(group: readonly CatalogTool[]) {
  return {
    type: "string",
    enum: [...new Set(group.flatMap((entry) => [entry.catalog.project, entry.catalog.projectId]))],
    description: "The project this MCP tool runs in, by slug or id.",
  };
}

/** One project's upstream schema, with optional routing fields added. */
function singleSchema(
  entry: CatalogTool,
  projectField: string,
  workspaceField: string,
): Record<string, unknown> {
  const schema = entry.tool.inputSchema;
  return {
    ...schema,
    type: schema.type ?? "object",
    properties: {
      ...objectRecord(schema.properties),
      [projectField]: projectSchema([entry]),
      [workspaceField]: WORKSPACE_SCHEMA,
    },
  };
}

/**
 * Several projects' schemas for the same name, as one object schema.
 *
 * A property every project describes the same way keeps its schema; one they
 * disagree about accepts anything, since only the project chosen at call time
 * knows which shape applies, and its server checks it. Only the project is
 * required, for the same reason.
 */
function mergedSchema(
  group: readonly CatalogTool[],
  projectField: string,
  workspaceField: string,
): Record<string, unknown> {
  const properties = new Map<string, unknown>();
  const conflicting = new Set<string>();
  for (const entry of group) {
    for (const [name, property] of Object.entries(
      objectRecord(entry.tool.inputSchema.properties),
    )) {
      const existing = properties.get(name);
      if (existing === undefined) properties.set(name, property);
      else if (JSON.stringify(existing) !== JSON.stringify(property)) conflicting.add(name);
    }
  }
  for (const name of conflicting) {
    properties.set(name, { description: "Its shape depends on the project this call runs in." });
  }

  return {
    type: "object",
    properties: {
      ...Object.fromEntries(properties),
      [projectField]: projectSchema(group),
      [workspaceField]: WORKSPACE_SCHEMA,
    },
    required: [projectField],
  };
}
