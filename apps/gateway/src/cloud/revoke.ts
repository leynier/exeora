import { and, eq } from "drizzle-orm";
import { revokeDevice } from "../api/ops.js";
import { db, schema } from "../db/client.js";
import "../env.js";
import { destroyCloudProject } from "./provisioning.js";

/**
 * Revoking a device, from the owner's dashboard or from the admin panel.
 *
 * For a laptop that is the soft delete `revokeDevice` does. A cloud machine
 * is different: revoked, it is a Sprite nobody can reach that still costs
 * money, so revoking it is a request to take it down. And the machine that
 * holds the default branch carries the project, whose other machines would
 * be orphaned by its deletion: that one takes the whole project with it.
 */
export async function revokeOwnedDevice(
  env: Env,
  userId: string,
  deviceId: string,
): Promise<boolean> {
  const machine = await db(env)
    .select({
      projectId: schema.cloudMachines.projectId,
      workspaceId: schema.cloudMachines.workspaceId,
      spriteName: schema.cloudMachines.spriteName,
    })
    .from(schema.cloudMachines)
    .where(
      and(eq(schema.cloudMachines.deviceId, deviceId), eq(schema.cloudMachines.userId, userId)),
    )
    .get();
  if (!machine) return revokeDevice(env, userId, deviceId);
  // The destruction is asked for before anything else: it records its own
  // intent and revokes the device itself, so a relay that cannot be reached
  // at this moment leaves a machine on its way out, not one that is merely
  // unreachable and still running.
  if (machine.workspaceId === null) {
    if (await destroyCloudProject(env, userId, machine.projectId)) return true;
  }
  await env.CLOUD_MACHINE.getByName(deviceId).destroy({ userId, deviceId, ...machine });
  return true;
}
