import { and, eq, isNotNull, ne } from "drizzle-orm";
import { ownedProjectDeletionStatement } from "../audit-deletions.js";
import { db, schema } from "../db/client.js";
import "../env.js";
import type { CloudEnv } from "./access.js";
import type { MachineSeed } from "./machine-do.js";

/**
 * Taking Exeora Cloud away: one workspace, the Cloud location of a project,
 * or the whole project.
 *
 * Every removal is a mark first and machines afterwards. The mark is the
 * intent, written before the machines are read so none can be added behind
 * it; each machine's object then takes its Sprite down, and the last one to go
 * finishes what the mark asked for. Nothing here deletes a row that a machine
 * still standing is recorded in.
 */

export type RemovalScope = "project" | "location";

/** Takes every machine of the project down, and the project with the last of them. */
export function destroyCloudProject(
  env: CloudEnv,
  userId: string,
  projectId: string,
): Promise<boolean> {
  return removeCloud(env, userId, projectId, "project");
}

/**
 * Takes the project off Exeora Cloud and leaves it where else it lives.
 *
 * Refused by the caller when Cloud is the only place the project is: that is
 * removing the project, and it is asked for as such.
 */
export function destroyCloudLocation(
  env: CloudEnv,
  userId: string,
  projectId: string,
): Promise<boolean> {
  return removeCloud(env, userId, projectId, "location");
}

async function removeCloud(
  env: CloudEnv,
  userId: string,
  projectId: string,
  scope: RemovalScope,
): Promise<boolean> {
  const marked = await db(env)
    .update(schema.cloudProjects)
    .set({ deletingAt: new Date(), deletingScope: scope })
    .where(
      and(eq(schema.cloudProjects.projectId, projectId), eq(schema.cloudProjects.userId, userId)),
    )
    .run();
  if (marked.meta.changes === 0) return false;

  const machines = await db(env)
    .select({
      deviceId: schema.cloudMachines.deviceId,
      workspaceId: schema.cloudMachines.workspaceId,
      spriteName: schema.cloudMachines.spriteName,
    })
    .from(schema.cloudMachines)
    .where(
      and(eq(schema.cloudMachines.projectId, projectId), eq(schema.cloudMachines.userId, userId)),
    )
    .all();

  // Cloud that holds no machine has nothing to wait for.
  if (machines.length === 0) {
    await finishCloudRemoval(env, userId, projectId);
    return true;
  }

  const ordered = [...machines].sort(
    (a, b) => Number(a.workspaceId === null) - Number(b.workspaceId === null),
  );
  // One machine's object refusing does not spare the others: the mark above
  // is the intent, and the sweep takes down whatever this loop left.
  for (const machine of ordered) {
    try {
      await env.CLOUD_MACHINE.getByName(machine.deviceId).destroy({
        userId,
        projectId,
        ...machine,
      });
    } catch {
      // Left for `reconcileCloud`, which finishes removals.
    }
  }
  return true;
}

export async function destroyCloudWorkspace(
  env: CloudEnv,
  userId: string,
  projectId: string,
  workspaceId: string,
): Promise<boolean> {
  const machine = await machineOf(env, userId, { projectId, workspaceId });
  if (!machine) return false;
  await env.CLOUD_MACHINE.getByName(machine.deviceId).destroy(machine);
  return true;
}

/**
 * What a removal that was marked is waiting to do, done once no machine of the
 * project is left. Called by each machine as the last thing its destruction
 * does, and by the sweep; harmless when there is nothing marked or a machine
 * is still standing.
 *
 * Returns what it removed, for the tests and the sweep's count.
 */
export async function finishCloudRemoval(
  env: Pick<Env, "DB">,
  userId: string,
  projectId: string,
  /** A machine that is going away in this same moment and so does not count. */
  leaving?: string,
): Promise<RemovalScope | null> {
  const cloud = await db(env)
    .select({ scope: schema.cloudProjects.deletingScope })
    .from(schema.cloudProjects)
    .where(
      and(
        eq(schema.cloudProjects.projectId, projectId),
        eq(schema.cloudProjects.userId, userId),
        isNotNull(schema.cloudProjects.deletingAt),
      ),
    )
    .get();
  if (!cloud) return null;

  const standing = await db(env)
    .select({ deviceId: schema.cloudMachines.deviceId })
    .from(schema.cloudMachines)
    .where(
      and(
        eq(schema.cloudMachines.projectId, projectId),
        leaving ? ne(schema.cloudMachines.deviceId, leaving) : undefined,
      ),
    )
    .limit(1)
    .all();
  if (standing.length > 0) return null;

  if (cloud.scope === "location") {
    await env.DB.batch([
      env.DB.prepare(
        "DELETE FROM project_locations WHERE project_id = ?1 AND user_id = ?2 AND kind = 'cloud'",
      ).bind(projectId, userId),
      env.DB.prepare("DELETE FROM cloud_projects WHERE project_id = ?1 AND user_id = ?2").bind(
        projectId,
        userId,
      ),
    ]);
    return "location";
  }

  await env.DB.batch([
    ownedProjectDeletionStatement(env, userId, projectId),
    env.DB.prepare("DELETE FROM audit_outbox WHERE project_id = ?1 AND user_id = ?2").bind(
      projectId,
      userId,
    ),
    env.DB.prepare("DELETE FROM projects WHERE id = ?1 AND user_id = ?2").bind(projectId, userId),
  ]);
  return "project";
}

async function machineOf(
  env: Pick<Env, "DB">,
  userId: string,
  by: { projectId: string; workspaceId: string },
): Promise<MachineSeed | null> {
  const row = await db(env)
    .select({
      deviceId: schema.cloudMachines.deviceId,
      projectId: schema.cloudMachines.projectId,
      workspaceId: schema.cloudMachines.workspaceId,
      spriteName: schema.cloudMachines.spriteName,
    })
    .from(schema.cloudMachines)
    .where(
      and(
        eq(schema.cloudMachines.workspaceId, by.workspaceId),
        eq(schema.cloudMachines.projectId, by.projectId),
        eq(schema.cloudMachines.userId, userId),
      ),
    )
    .get();
  return row ? { userId, ...row } : null;
}
