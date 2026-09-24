import {
  MAX_MCP_CATALOG_BYTES,
  type McpToolDescriptor,
  McpToolDescriptor as McpToolDescriptorSchema,
} from "@exeora/protocol";

const CATALOG_PREFIX = "mcp:catalog:";

/**
 * Dynamic MCP schemas live in Durable Object storage rather than on the
 * hibernating WebSocket attachment. A catalog can contain hundreds of JSON
 * Schemas and is not connection metadata.
 *
 * A catalog above the byte budget is refused rather than stored: the executor
 * trims to the same budget before sending, so one that arrives larger is not a
 * catalog this side should hold, and the write would fail near the value limit
 * anyway. The project then offers no proxied tools, which is the honest state.
 */
export async function replaceMcpCatalog(
  ctx: DurableObjectState,
  projectId: string,
  tools: McpToolDescriptor[],
): Promise<boolean> {
  const key = `${CATALOG_PREFIX}${projectId}`;
  if (new TextEncoder().encode(JSON.stringify(tools)).byteLength > MAX_MCP_CATALOG_BYTES) {
    await ctx.storage.delete(key);
    return false;
  }
  await ctx.storage.put(key, tools);
  return true;
}

/** Every requested project's catalog, keyed by project id, in one storage read. */
export async function readMcpCatalogs(
  ctx: DurableObjectState,
  projectIds: readonly string[],
): Promise<Record<string, McpToolDescriptor[]>> {
  const catalogs: Record<string, McpToolDescriptor[]> = {};
  for (const batch of batches(projectIds)) {
    const stored = await ctx.storage.get<McpToolDescriptor[]>(
      batch.map((projectId) => `${CATALOG_PREFIX}${projectId}`),
    );
    for (const projectId of batch) {
      catalogs[projectId] = stored.get(`${CATALOG_PREFIX}${projectId}`) ?? [];
    }
  }
  return catalogs;
}

/** Parses what `mcpCatalogs` returned, dropping anything that is not a valid descriptor. */
export function decodeMcpCatalogs(raw: string): Record<string, McpToolDescriptor[]> {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).map(([projectId, tools]) => [projectId, decodeMcpCatalog(tools)]),
    );
  } catch {
    return {};
  }
}

function decodeMcpCatalog(values: unknown): McpToolDescriptor[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const tools: McpToolDescriptor[] = [];
  for (const value of values) {
    const parsed = McpToolDescriptorSchema.safeParse(value);
    if (!parsed.success || seen.has(parsed.data.exposedName)) continue;
    seen.add(parsed.data.exposedName);
    tools.push(parsed.data);
  }
  return tools;
}

/**
 * Forgets every stored catalog.
 *
 * On `hello`, because a new executor session must not inherit schemas an older
 * process announced, and on revocation, because a revoked machine offers
 * nothing.
 */
export async function clearMcpCatalogs(ctx: DurableObjectState): Promise<void> {
  const stored = await ctx.storage.list({ prefix: CATALOG_PREFIX });
  for (const batch of batches([...stored.keys()])) await ctx.storage.delete(batch);
}

/** Durable Object storage takes at most 128 keys in one multi-key call. */
function batches<T>(values: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < values.length; index += 128) {
    out.push(values.slice(index, index + 128));
  }
  return out;
}
