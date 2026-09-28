import { ExeoraError, type WorkspaceAction, type WorkspaceValue } from "@exeora/protocol";
import { and, eq, or } from "drizzle-orm";
import type { Context } from "hono";
import { z } from "zod";
import { db, schema } from "../db/client.js";
import { newId } from "../ids.js";
import {
  defaultRootSelector,
  ROOT_SELECTOR,
  resolveLocationRoot,
  rootLocation,
} from "../location-roots.js";
import { callRelayWorkspace } from "../relay-client.js";
import { relayName } from "./ops.js";
import type { ApiEnv } from "./router.js";

/**
 * Where a workspace request goes: the machine that holds the checkout it
 * names, resolved for the owner and nobody else. Shared by the reads route,
 * the actions route and the terminal routes.
 */

export const targetQuery = z.object({ workspace: z.string().min(1).max(128).optional() });

export type ResolvedTarget = {
  deviceId: string;
  workspaceId?: string;
  workspaceSlug?: string;
  /** What the audit trail keeps: the workspace, or the root with its location. */
  recordedAs: string;
};

export async function dispatch(
  env: Env,
  userId: string,
  projectId: string,
  target: ResolvedTarget,
  action: WorkspaceAction,
  signal: AbortSignal,
): Promise<WorkspaceValue> {
  return callRelayWorkspace(env.DEVICE_RELAY.getByName(relayName(userId, target.deviceId)), {
    requestId: newId("req"),
    projectId,
    workspaceId: target.workspaceId,
    workspaceSlug: target.workspaceSlug,
    action,
    signal,
  });
}

export async function ownedTarget(
  env: Env,
  userId: string,
  projectId: string,
  selector?: string,
): Promise<ResolvedTarget | null> {
  const project = await db(env)
    .select({
      deviceId: schema.projects.deviceId,
      removedAt: schema.devices.revokedAt,
    })
    .from(schema.projects)
    .innerJoin(schema.devices, eq(schema.projects.deviceId, schema.devices.id))
    .where(
      and(
        eq(schema.projects.id, projectId),
        eq(schema.projects.userId, userId),
        eq(schema.devices.userId, userId),
      ),
    )
    .get();
  if (!project) return null;
  // Only the project root needs the default location's machine. A workspace
  // on another machine is served there whatever became of the default.
  if (!selector || selector === ROOT_SELECTOR) {
    if (project.removedAt !== null) return null;
    return {
      deviceId: project.deviceId,
      recordedAs: await defaultRootSelector(env, projectId),
    };
  }
  // The root of another location: the same kind of call, to the machine that
  // holds that copy, and with no workspace named either.
  const location = rootLocation(selector);
  if (location !== null) {
    const root = await resolveLocationRoot(env, projectId, location).catch(() => null);
    return root ? { deviceId: root.deviceId, recordedAs: root.slug } : null;
  }

  const ws = await db(env)
    .select({
      id: schema.workspaces.id,
      slug: schema.workspaces.slug,
      deviceId: schema.workspaces.deviceId,
      deviceRevokedAt: schema.devices.revokedAt,
    })
    .from(schema.workspaces)
    .leftJoin(schema.devices, eq(schema.devices.id, schema.workspaces.deviceId))
    .where(
      and(
        eq(schema.workspaces.projectId, projectId),
        or(eq(schema.workspaces.id, selector), eq(schema.workspaces.slug, selector)),
      ),
    )
    .get();
  if (!ws) return null;
  // A workspace is served by the machine that holds it and nowhere else;
  // once that machine is revoked the workspace is gone with it.
  if (ws.deviceId !== null && ws.deviceRevokedAt !== null) return null;
  if (ws.deviceId === null && project.removedAt !== null) return null;
  return {
    deviceId: ws.deviceId ?? project.deviceId,
    workspaceId: ws.id,
    workspaceSlug: ws.slug,
    recordedAs: ws.slug,
  };
}

export function workspaceError(c: Context<ApiEnv>, error: unknown) {
  if (error instanceof ExeoraError) {
    const status =
      error.code === "LOCAL_EXECUTOR_OFFLINE" ||
      error.code === "EXECUTOR_WAKING" ||
      error.code === "UNKNOWN_WORKSPACE" ||
      error.code === "WORKSPACE_UNAVAILABLE"
        ? 409
        : error.code === "FORBIDDEN"
          ? 403
          : 422;
    return c.json({ error: error.code, message: error.message }, status);
  }
  console.error("workspace request failed", error);
  return c.json({ error: "INTERNAL_ERROR", message: "Workspace request failed." }, 500);
}
