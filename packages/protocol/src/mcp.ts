import { z } from "zod";
import { MAX_MCP_INPUT_SCHEMA_BYTES, MAX_MCP_SERVERS, MAX_MCP_TOOLS_PER_SERVER } from "./limits.js";

/**
 * Downstream MCP servers: what the executor announces, and how a call to one
 * travels.
 *
 * Exeora is an MCP *client* of the servers a project (or the user) configures,
 * and republishes their tools through its own MCP endpoint under a prefixed
 * name, so one AI client connection reaches the machine's files, its commands
 * and its other MCP servers at once. The executor owns the connection to each
 * downstream server — they run on the same machine, often as local processes —
 * and the gateway never learns how to reach them directly, which keeps the
 * "nothing dials in, nothing is uploaded" property intact.
 *
 * The frames here are additive to the relay protocol and negotiated by
 * existence: an old gateway drops an `mcp.tools` frame it cannot parse and
 * never sends an `mcp.call`, and a new gateway with an old CLI sees no
 * announcement and offers no downstream tools. Neither side needs a version
 * bump, which is what the version range is for.
 */

/**
 * A server name as it appears in `mcpServers` config and in tool names.
 *
 * Lowercase and dash-bound so the prefixed tool name it produces is one a
 * client will accept: `mcp__context7__resolve-library-id`.
 */
export const MCP_SERVER_NAME = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,31}$/, "lowercase letters, digits and dashes");

/** A tool name from a downstream server, already compatible with MCP naming. */
export const MCP_TOOL_NAME = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);

/** The prefix and separator a downstream tool is republished under. */
export const MCP_TOOL_PREFIX = "mcp__";
const MCP_TOOL_SEPARATOR = "__";

/** One downstream tool as the executor republishes it. */
export const McpToolDescriptor = z.object({
  name: MCP_TOOL_NAME,
  title: z.string().max(256).optional(),
  description: z.string().max(4_096).optional(),
  /**
   * The tool's arguments, as a JSON Schema the downstream server sent.
   *
   * Kept as a plain object rather than modelled, because it is not ours to
   * model: the gateway hands it straight to the SDK, which both advertises it
   * in `tools/list` and validates `tools/call` arguments against it.
   */
  inputSchema: z.record(z.string(), z.unknown()),
  annotations: z
    .object({
      readOnlyHint: z.boolean().optional(),
      destructiveHint: z.boolean().optional(),
      idempotentHint: z.boolean().optional(),
      openWorldHint: z.boolean().optional(),
    })
    .optional(),
});

export type McpToolDescriptor = z.infer<typeof McpToolDescriptor>;

/**
 * One configured server's contribution to an announcement.
 *
 * `status: "error"` reports a server that was configured but could not be
 * reached, with a reason safe to show a caller: the alternative, silently
 * omitting it, is indistinguishable from never having configured it.
 */
export const McpServerTools = z.object({
  name: MCP_SERVER_NAME,
  status: z.enum(["ready", "error"]),
  error: z.string().max(512).optional(),
  tools: z.array(McpToolDescriptor).max(MAX_MCP_TOOLS_PER_SERVER),
});

export type McpServerTools = z.infer<typeof McpServerTools>;

/** The full tool set of one project, sent after `hello.ack` on every connect. */
export const McpToolsMessage = z.object({
  type: z.literal("mcp.tools"),
  projectId: z.string(),
  /**
   * The complete list, including servers reporting errors. An empty array is a
   * real answer — it clears whatever the relay remembered from a previous
   * connection — rather than "nothing to say".
   */
  servers: z.array(McpServerTools).max(MAX_MCP_SERVERS),
});

export type McpToolsMessage = z.infer<typeof McpToolsMessage>;

/** A call to a downstream tool, as the relay forwards it to the executor. */
export const McpCallMessage = z.object({
  type: z.literal("mcp.call"),
  requestId: z.string(),
  projectId: z.string(),
  server: MCP_SERVER_NAME,
  tool: MCP_TOOL_NAME,
  arguments: z.unknown(),
  client: z
    .object({
      id: z.string().optional(),
      name: z.string().optional(),
      version: z.string().optional(),
    })
    .optional(),
  issuedAt: z.number().int(),
  expiresAt: z.number().int(),
});

export type McpCallMessage = z.infer<typeof McpCallMessage>;

/** The downstream tool's name, as a caller sees it on an Exeora endpoint. */
export function mcpToolName(server: string, tool: string): string {
  return `${MCP_TOOL_PREFIX}${server}${MCP_TOOL_SEPARATOR}${tool}`;
}

/**
 * Splits a prefixed tool name back into its server and tool.
 *
 * The server name cannot contain underscores, so the first separator is the
 * boundary; null when the name is not one of ours.
 */
export function parseMcpToolName(name: string): { server: string; tool: string } | null {
  if (!name.startsWith(MCP_TOOL_PREFIX)) return null;
  const rest = name.slice(MCP_TOOL_PREFIX.length);
  const split = rest.indexOf(MCP_TOOL_SEPARATOR);
  if (split <= 0) return null;
  const server = rest.slice(0, split);
  const tool = rest.slice(split + MCP_TOOL_SEPARATOR.length);
  if (!tool) return null;
  return MCP_SERVER_NAME.safeParse(server).success && MCP_TOOL_NAME.safeParse(tool).success
    ? { server, tool }
    : null;
}

/** Largest serialized input schema the executor will put in an announcement. */
export const MCP_INPUT_SCHEMA_LIMIT = MAX_MCP_INPUT_SCHEMA_BYTES;
