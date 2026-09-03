import { ExeoraError } from "@exeora/protocol";
import { and, eq } from "drizzle-orm";
import { relayName } from "./api/ops.js";
import { beginAudit } from "./audit.js";
import { resolveAccountTarget, resolveTarget } from "./client-targets.js";
import type { CallerIdentity } from "./clients.js";
import { db, schema } from "./db/client.js";
import { record } from "./dispatch.js";
import "./env.js";
import { newId } from "./ids.js";
import { callRelayMcpTool } from "./relay-client.js";
import { decodeMcpCatalog } from "./relay-mcp.js";

/**
 * Dynamic MCP tools deliberately do not pass through Exeora's native command
 * policy. Their allow-list is the user's MCP configuration itself: only a tool
 * announced by the executor for this project can reach the device.
 */
export async function dispatchMcpToDevice(
  env: Env,
  call: {
    userId: string;
    projectId: string;
    workspace?: string | undefined;
    exposedName: string;
    args: unknown;
    caller: CallerIdentity;
    signal?: AbortSignal | undefined;
    endpoint?: "project" | "account";
  },
): Promise<unknown> {
  const { userId, projectId, exposedName, args, caller, signal, endpoint = "project" } = call;
  const target =
    endpoint === "account"
      ? caller.clientId
        ? await resolveAccountTarget(env, { userId, projectId, clientId: caller.clientId })
        : null
      : await resolveTarget(env, { userId, projectId, clientId: caller.clientId });
  if (!target) throw new ExeoraError("UNKNOWN_PROJECT", "That project is not available.");
  if ("clientRevokedAt" in target && target.clientRevokedAt) {
    throw new ExeoraError(
      "FORBIDDEN",
      "This application's access to the project was revoked. Authorize it again to restore it.",
    );
  }

  const workspace = await resolveMcpWorkspace(env, projectId, call.workspace);
  const relay = env.DEVICE_RELAY.getByName(relayName(userId, target.deviceId));
  const descriptor = decodeMcpCatalog(await relay.mcpTools(projectId)).find(
    (tool) => tool.exposedName === exposedName,
  );
  if (!descriptor) {
    throw new ExeoraError(
      "UNKNOWN_TOOL",
      `MCP tool \`${exposedName}\` is not exposed by this project's executor.`,
    );
  }

  let audit: Awaited<ReturnType<typeof beginAudit>>;
  try {
    audit = await beginAudit(env, {
      userId,
      projectId,
      tool: exposedName,
      caller,
      endpoint,
      ...(workspace ? { workspaceId: workspace.id, workspaceSlug: workspace.slug } : {}),
    });
  } catch (error) {
    console.error("audit outbox begin failed", error);
    throw new ExeoraError(
      "INTERNAL_ERROR",
      "The audit service is unavailable, so no MCP tool was run. Try again later.",
    );
  }

  try {
    const value = await callRelayMcpTool(relay, {
      requestId: newId("req"),
      projectId,
      ...(workspace ? { workspaceId: workspace.id, workspaceSlug: workspace.slug } : {}),
      server: descriptor.server,
      tool: descriptor.name,
      args,
      client: callerLabel(caller),
      signal,
    });
    await record(env, {
      userId,
      projectId,
      tool: exposedName,
      caller,
      audit,
      status: "ok",
      endpoint,
    });
    return value;
  } catch (error) {
    await record(env, {
      userId,
      projectId,
      tool: exposedName,
      caller,
      audit,
      status: "error",
      errorCode: error instanceof ExeoraError ? error.code : "INTERNAL_ERROR",
      endpoint,
    });
    throw error;
  }
}

async function resolveMcpWorkspace(
  env: Pick<Env, "DB">,
  projectId: string,
  selector: string | undefined,
): Promise<{ id: string; slug: string } | null> {
  if (!selector || selector.toLowerCase() === "main") return null;
  const row = await db(env)
    .select({ id: schema.workspaces.id, slug: schema.workspaces.slug })
    .from(schema.workspaces)
    .where(
      and(
        eq(schema.workspaces.projectId, projectId),
        selector.startsWith("wsp_")
          ? eq(schema.workspaces.id, selector)
          : eq(schema.workspaces.slug, selector),
      ),
    )
    .get();
  if (!row) {
    throw new ExeoraError("UNKNOWN_WORKSPACE", "That workspace is not available in this project.");
  }
  return row;
}

function callerLabel(
  caller: CallerIdentity,
): { id?: string; name?: string; version?: string } | undefined {
  const id = caller.clientId;
  const name = caller.clientName ?? caller.mcp?.name;
  const version = caller.mcp?.version;
  if (!id && !name && !version) return undefined;
  return {
    ...(id ? { id } : {}),
    ...(name ? { name } : {}),
    ...(version ? { version } : {}),
  };
}
