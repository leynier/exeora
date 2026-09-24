import { ExeoraError, MCP_PROXY_TOOL_NAME_PATTERN, type McpToolDescriptor } from "@exeora/protocol";
import {
  type CallToolResult,
  fromJsonSchema,
  isCallToolResult,
  type JsonSchemaType,
  type McpServer,
  type ServerContext,
} from "@modelcontextprotocol/server";
import { type approvalCodec, approvalFor, askToConfirmMcp } from "./approval.js";
import type { CallerIdentity } from "./clients.js";
import type { DispatchResult } from "./mcp.js";

/**
 * Tools proxied from the upstream MCP servers a machine configured.
 *
 * Each is registered under the collision-free name the executor announced
 * (`mcp__server__tool`), with the upstream schema plus Exeora's own routing
 * fields. The call itself takes the same road as a native tool: the dispatcher
 * holds the project's policy, and a confirmation comes back as a question.
 */

export const WORKSPACE_SCHEMA = {
  type: "string",
  description:
    "Run this call in a connected Git workspace by slug or id. Omit it, or use main, for the project root.",
} as const;

/** One proxied call, as the dispatcher receives it. */
export interface McpProxyCall {
  userId: string;
  projectId: string;
  workspace?: string | undefined;
  caller: CallerIdentity;
  /** The descriptor this endpoint registered, read from the executor's catalog. */
  tool: McpToolDescriptor;
  /** Only what the upstream server receives: routing fields are removed. */
  args: unknown;
  approved: boolean;
  approvedWorkspaceId?: string | undefined;
  canElicit: boolean;
}

export type McpProxyDispatcher = (call: McpProxyCall) => Promise<DispatchResult>;

/** What a registered proxy tool hands its endpoint on each call. */
export interface McpProxyInvocation {
  tool: McpToolDescriptor;
  workspace: string | undefined;
  /** As the upstream server will receive them. */
  upstreamArgs: Record<string, unknown>;
  /** As the client sent them, routing included: what an approval is bound to. */
  args: Record<string, unknown>;
  ctx: ServerContext;
}

/**
 * Runs one proxied call through the dispatcher and shapes its answer.
 *
 * Shared by both endpoints. `where` names the project in a confirmation, which
 * only the account endpoint needs, since its URL reaches several.
 */
export async function answerMcpProxyCall(
  invocation: McpProxyInvocation,
  options: {
    codec: ReturnType<typeof approvalCodec>;
    canElicit: boolean;
    dispatch: McpProxyDispatcher;
    userId: string;
    caller: CallerIdentity;
    projectId: string;
    where?: string | undefined;
  },
) {
  const { tool, workspace, upstreamArgs, args, ctx } = invocation;
  const approval = await approvalFor(ctx, tool.exposedName, args);
  const result = await options.dispatch({
    userId: options.userId,
    projectId: options.projectId,
    workspace,
    caller: options.caller,
    tool,
    args: upstreamArgs,
    approved: approval?.projectId === options.projectId,
    approvedWorkspaceId: approval?.workspaceId,
    canElicit: options.canElicit,
  });

  if (result.kind === "needs-approval") {
    if (!options.canElicit) {
      throw new ExeoraError(
        "INTERNAL_ERROR",
        "A confirmation was requested from a client that cannot be asked.",
      );
    }
    return askToConfirmMcp(options.codec, ctx, {
      projectId: result.projectId,
      workspaceId: result.workspaceId,
      exposedName: tool.exposedName,
      server: tool.server,
      tool: tool.name,
      args,
      upstreamArgs,
      where: options.where,
    });
  }

  return mcpToolResult(result.value);
}

/** Registers tools discovered from upstream MCP servers on a project endpoint. */
export function registerMcpProxyTools(
  server: McpServer,
  tools: readonly McpToolDescriptor[],
  handle: (invocation: McpProxyInvocation) => Promise<unknown>,
): void {
  const registered = new Set<string>();
  for (const tool of tools) {
    // Catalog decoding enforces the namespace too, but a bad entry must never
    // shadow a native Exeora tool, whatever source the catalog came from.
    if (!MCP_PROXY_TOOL_NAME_PATTERN.test(tool.exposedName) || registered.has(tool.exposedName)) {
      continue;
    }
    const workspaceField = routingField([tool.inputSchema], "workspace");
    const schema = {
      ...tool.inputSchema,
      type: tool.inputSchema.type ?? "object",
      properties: {
        ...objectRecord(tool.inputSchema.properties),
        [workspaceField]: WORKSPACE_SCHEMA,
      },
    };

    const ok = registerProxyTool(server, tool, schema, async (input, ctx) => {
      const args = objectRecord(input);
      const workspace = args[workspaceField];
      const upstreamArgs = { ...args };
      delete upstreamArgs[workspaceField];
      return handle({
        tool,
        workspace: typeof workspace === "string" ? workspace : undefined,
        upstreamArgs,
        args,
        ctx,
      });
    });
    if (ok) registered.add(tool.exposedName);
  }
}

/**
 * Registers one proxied tool in its own try.
 *
 * The SDK compiles a validator for the schema at registration, and one upstream
 * schema it cannot handle must cost that tool alone. Without the try, a single
 * bad schema would fail `tools/list` and every `tools/call` on the endpoint.
 */
export function registerProxyTool(
  server: McpServer,
  tool: McpToolDescriptor,
  inputSchema: Record<string, unknown>,
  handler: (args: Record<string, unknown>, ctx: ServerContext) => Promise<unknown>,
): boolean {
  if (inputSchema.type !== "object") return false;
  try {
    server.registerTool(
      tool.exposedName,
      {
        ...(tool.title ? { title: tool.title } : {}),
        description: tool.description
          ? `${tool.description} (from the \`${tool.server}\` MCP server)`
          : `Tool \`${tool.name}\` from the \`${tool.server}\` MCP server configured on this machine.`,
        inputSchema: fromJsonSchema<Record<string, unknown>>(inputSchema as JsonSchemaType),
        annotations: {
          ...tool.annotations,
          // Absent reads as "changes something", the cautious side of a claim
          // nobody made, and the same reading the policy check gives it.
          readOnlyHint: tool.annotations?.readOnlyHint === true,
        },
      },
      // The SDK's handler type is a union with the elicitation result, which
      // the value from `answerMcpProxyCall` already is one side of.
      handler as never,
    );
    return true;
  } catch (error) {
    console.error(`MCP proxy tool ${tool.exposedName} could not be registered`, error);
    return false;
  }
}

/**
 * An upstream tool's answer, passed through as MCP content.
 *
 * The executor returns the upstream `CallToolResult` untouched, which is what
 * preserves images, structured content and `isError`, a result a model can
 * read rather than a failure to hide. Anything else is wrapped as JSON text,
 * which is readable and honest about what arrived.
 */
export function mcpToolResult(value: unknown): CallToolResult {
  if (isCallToolResult(value)) return value;
  const structured =
    value && typeof value === "object" && !Array.isArray(value)
      ? { structuredContent: value as Record<string, unknown> }
      : {};
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) ?? "null" }],
    ...structured,
  };
}

/** Prefer the familiar field name, but never steal a name an upstream tool owns. */
export function routingField(
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

export function objectRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}
