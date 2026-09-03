import {
  type McpToolDescriptor,
  McpToolDescriptor as McpToolDescriptorSchema,
} from "@exeora/protocol";

const CATALOG_PREFIX = "mcp:catalog:";

/**
 * Dynamic MCP schemas live in Durable Object storage rather than on the
 * hibernating WebSocket attachment. A catalog can contain hundreds of JSON
 * Schemas and is not connection metadata.
 */
export async function replaceMcpCatalog(
  ctx: DurableObjectState,
  projectId: string,
  tools: McpToolDescriptor[],
): Promise<void> {
  await ctx.storage.put(`${CATALOG_PREFIX}${projectId}`, tools);
}

export async function readMcpCatalog(
  ctx: DurableObjectState,
  projectId: string,
): Promise<McpToolDescriptor[]> {
  return (await ctx.storage.get<McpToolDescriptor[]>(`${CATALOG_PREFIX}${projectId}`)) ?? [];
}

export function decodeMcpCatalog(raw: string): McpToolDescriptor[] {
  try {
    const parsed = McpToolDescriptorSchema.array().safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

/** A new executor session must not inherit schemas announced by an older CLI. */
export async function clearMcpCatalogs(ctx: DurableObjectState): Promise<void> {
  const stored = await ctx.storage.list({ prefix: CATALOG_PREFIX });
  if (stored.size > 0) await ctx.storage.delete([...stored.keys()]);
}
