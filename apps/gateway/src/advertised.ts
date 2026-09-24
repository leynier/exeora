import { type McpToolDescriptor, TOOL_NAMES, type ToolName } from "@exeora/protocol";
import { and, eq, isNull } from "drizzle-orm";
import { relayName } from "./api/ops.js";
import { accountProjects } from "./client-targets.js";
import { db, schema } from "./db/client.js";
import type { ProjectMcpCatalog } from "./mcp-proxy-account-tools.js";
import { decodeMcpCatalogs } from "./relay-mcp.js";
import "./env.js";

/**
 * Which tools an endpoint offers, asked only for `tools/list` so that a tool
 * call pays neither the lookup nor the round trip to the device.
 *
 * Both functions answer undefined for "offer every tool", and the reason that
 * is the right default rather than an empty list is written above each.
 */

/**
 * The tools the machine serving this project can actually run.
 *
 * Undefined means "offer every tool", and it is the answer to three different
 * situations on purpose: an unresolvable project, a machine that is offline,
 * and a machine too old to have said. None of them is a reason to publish a
 * shorter list. A call that reaches an offline machine already fails with
 * `LOCAL_EXECUTOR_OFFLINE`, which is the true answer; an endpoint that
 * advertised nothing while a laptop slept would look broken instead.
 */
export async function advertisedTools(
  env: Env,
  userId: string | undefined,
  projectId: string,
): Promise<ReadonlySet<ToolName> | undefined> {
  if (!userId) return undefined;

  const project = await db(env)
    .select({ deviceId: schema.projects.deviceId })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)))
    .get();

  if (!project) return undefined;

  const capabilities = await env.DEVICE_RELAY.getByName(
    relayName(userId, project.deviceId),
  ).capabilities();

  if (!capabilities) return undefined;

  // Intersected with what this gateway knows, because the executor may be the
  // newer of the two: a tool this build has no schema for is a name and nothing
  // it could register.
  const announced = new Set<string>(capabilities.tools);
  return new Set(TOOL_NAMES.filter((name) => announced.has(name)));
}

/**
 * The same question on the account endpoint. A single reachable project is
 * unambiguous and can narrow the tool list; several cannot, because each call
 * may name a different one.
 *
 * Undefined means "offer every tool" when zero or several projects are
 * reachable. The list tool remains available either way, and dispatch still
 * checks the named project's executor before anything runs.
 */
export async function advertisedAccountTools(
  env: Env,
  userId: string | undefined,
  clientId: string | undefined,
): Promise<ReadonlySet<ToolName> | undefined> {
  if (!userId || !clientId) return undefined;

  const reachable = await accountProjects(env, { userId, clientId });
  const chosen = reachable.length === 1 ? reachable[0] : undefined;

  return chosen ? advertisedTools(env, userId, chosen.id) : undefined;
}

/** Upstream MCP tools most recently announced by this project's executor. */
export async function advertisedMcpTools(
  env: Env,
  userId: string | undefined,
  projectId: string,
): Promise<McpToolDescriptor[]> {
  if (!userId) return [];
  const project = await db(env)
    .select({ deviceId: schema.projects.deviceId })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)))
    .get();
  if (!project) return [];
  const raw = await env.DEVICE_RELAY.getByName(relayName(userId, project.deviceId)).mcpCatalogs([
    projectId,
  ]);
  return decodeMcpCatalogs(raw)[projectId] ?? [];
}

/**
 * Proxied MCP catalogs for every project an account-level client may reach.
 *
 * One query for the projects and their machines, then one relay round trip per
 * machine rather than per project. Which project a call means is only known
 * once the tool is registered and its routing field read, so every reachable
 * catalog is loaded; the grouping is what keeps that cheap.
 */
export async function advertisedAccountMcpTools(
  env: Env,
  userId: string | undefined,
  clientId: string | undefined,
): Promise<ProjectMcpCatalog[]> {
  if (!userId || !clientId) return [];
  const rows = await db(env)
    .select({
      id: schema.projects.id,
      slug: schema.projects.slug,
      deviceId: schema.projects.deviceId,
    })
    .from(schema.projectClients)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.projectClients.projectId))
    .innerJoin(schema.devices, eq(schema.devices.id, schema.projects.deviceId))
    .where(
      and(
        eq(schema.projectClients.userId, userId),
        eq(schema.projectClients.clientId, clientId),
        eq(schema.projectClients.endpoint, "account"),
        isNull(schema.projectClients.revokedAt),
        isNull(schema.devices.revokedAt),
      ),
    )
    .orderBy(schema.projects.name)
    .all();

  const byDevice = new Map<string, string[]>();
  for (const row of rows)
    byDevice.set(row.deviceId, [...(byDevice.get(row.deviceId) ?? []), row.id]);
  const catalogs = Object.assign(
    {},
    ...(await Promise.all(
      [...byDevice].map(async ([deviceId, projectIds]) =>
        decodeMcpCatalogs(
          await env.DEVICE_RELAY.getByName(relayName(userId, deviceId)).mcpCatalogs(projectIds),
        ),
      ),
    )),
  ) as Record<string, McpToolDescriptor[]>;

  return rows.map((row) => ({
    projectId: row.id,
    project: row.slug,
    tools: catalogs[row.id] ?? [],
  }));
}
