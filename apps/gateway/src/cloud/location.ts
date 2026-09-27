import {
  CLOUD_MAIN_WORKSPACE_SLUG,
  CLOUD_WORKSPACE_ROOT,
  cliSupportsCloud,
} from "@exeora/protocol";
import { and, eq } from "drizzle-orm";
import { planOf } from "../api/plan.js";
import { db, schema } from "../db/client.js";
import "../env.js";
import { newId } from "../ids.js";
import { limitsFor } from "../plans.js";
import { type CloudEnv, cloudAccess, spriteNameFor } from "./access.js";
import { encryptSecret } from "./credentials.js";
import { cliUnsupported, insertCloudDevice, startMachine } from "./machine-start.js";
import { machineTokenHash, mintMachineToken } from "./machine-tokens.js";
import { validBranch } from "./naming.js";
import {
  type Credential,
  cloudProjectOf,
  credentialOf,
  type ProvisionError,
  validRepoUrl,
} from "./provisioning.js";

/**
 * Exeora Cloud as one more place a project lives.
 *
 * A project that started on somebody's laptop is put on Cloud by adding the
 * location, which costs nothing: it records where to clone from and with what.
 * Machines come later, one per workspace made there, and one for the project
 * root only when Cloud is made the default location, since that is the only
 * time a call that names no workspace would land on it.
 */

export type CloudLocationError = ProvisionError | { error: "no_repository"; message: string };

export async function addCloudLocation(
  env: CloudEnv,
  userId: string,
  projectId: string,
  input: { credential?: Credential | undefined } = {},
): Promise<true | CloudLocationError> {
  if (!(await cloudAccess(env, userId))) return { error: "cloud_disabled" };
  if (!cliSupportsCloud(env.LATEST_CLI_VERSION)) return cliUnsupported(env);

  const project = await db(env)
    .select({
      id: schema.projects.id,
      repoUrl: schema.projects.repoUrl,
      defaultBranch: schema.projects.defaultBranch,
    })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)))
    .get();
  if (!project) return { error: "not_found" };
  if (!project.repoUrl || !validRepoUrl(project.repoUrl)) {
    return {
      error: "no_repository",
      message:
        "This project has no repository Exeora Cloud can clone. It needs a remote with an https address.",
    };
  }
  const branch = project.defaultBranch ?? "main";
  if (!validBranch(branch)) {
    return { error: "invalid_branch", message: "That is not a valid branch name." };
  }

  let ciphertext: string | null = null;
  if (input.credential) {
    if (!env.CLOUD_CREDENTIALS_KEY) return { error: "credentials_unavailable" };
    ciphertext = await encryptSecret(env.CLOUD_CREDENTIALS_KEY, input.credential.secret);
  }

  // Both rows or neither. A project already on Cloud keeps what it has: the
  // token is changed through its own route, not by adding the location twice.
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO cloud_projects (project_id, user_id, repo_url, default_branch, credential_username, credential_ciphertext)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    ).bind(
      projectId,
      userId,
      project.repoUrl,
      branch,
      input.credential?.username ?? null,
      ciphertext,
    ),
    env.DB.prepare(
      `INSERT OR IGNORE INTO project_locations (id, project_id, user_id, kind, device_id, local_path, status)
       SELECT ?1, ?2, ?3, 'cloud', NULL, NULL, 'ready'
        WHERE NOT EXISTS (
          SELECT 1 FROM project_locations WHERE project_id = ?2 AND kind = 'cloud'
        )`,
    ).bind(newId("loc"), projectId, userId),
  ]);
  return true;
}

/**
 * Makes the machine that holds the project root on Exeora Cloud, for a project
 * whose Cloud location has none. Answers with the machine that is already
 * there when it has one.
 */
export async function createCloudRoot(
  env: CloudEnv,
  userId: string,
  projectId: string,
): Promise<{ deviceId: string } | ProvisionError> {
  if (!(await cloudAccess(env, userId))) return { error: "cloud_disabled" };
  if (!cliSupportsCloud(env.LATEST_CLI_VERSION)) return cliUnsupported(env);
  const project = await cloudProjectOf(env, userId, projectId);
  if (!project || project.deletingAt) return { error: "not_found" };

  const existing = await db(env)
    .select({ deviceId: schema.projectLocations.deviceId })
    .from(schema.projectLocations)
    .where(
      and(
        eq(schema.projectLocations.projectId, projectId),
        eq(schema.projectLocations.kind, "cloud"),
      ),
    )
    .get();
  if (!existing) return { error: "not_found" };
  if (existing.deviceId) return { deviceId: existing.deviceId };

  const credential = await credentialOf(env, project);
  if (credential === "unavailable") return { error: "credentials_unavailable" };

  const plan = await planOf(env, userId);
  const limits = limitsFor(plan);
  const deviceId = newId("dev");
  const spriteName = spriteNameFor(env, deviceId);
  const token = mintMachineToken(deviceId);

  const results = await env.DB.batch([
    insertCloudDevice(
      env,
      userId,
      deviceId,
      `${project.slug} (${CLOUD_MAIN_WORKSPACE_SLUG})`,
      limits.maxCloudMachines,
    ),
    env.DB.prepare(
      `INSERT INTO cloud_machines (device_id, user_id, project_id, workspace_id, sprite_name, token_hash, status, step)
       SELECT ?1, ?2, ?3, NULL, ?4, ?5, 'creating', 'Creating machine' FROM devices
        WHERE id = ?1
          AND EXISTS (SELECT 1 FROM cloud_projects WHERE project_id = ?3 AND deleting_at IS NULL)`,
    ).bind(deviceId, userId, projectId, spriteName, await machineTokenHash(token)),
    // Taken only while the location still has no machine: two requests at
    // once would otherwise each give it one, and the second would be a
    // machine no location names.
    env.DB.prepare(
      `UPDATE project_locations SET device_id = ?1, local_path = ?4, updated_at = unixepoch() * 1000
        WHERE project_id = ?2 AND user_id = ?3 AND kind = 'cloud' AND device_id IS NULL
          AND EXISTS (SELECT 1 FROM cloud_machines WHERE device_id = ?1)`,
    ).bind(deviceId, projectId, userId, CLOUD_WORKSPACE_ROOT),
  ]);

  if ((results[0]?.meta.changes ?? 0) === 0) {
    return { error: "plan_limit", limit: "cloudMachines", max: limits.maxCloudMachines, plan };
  }
  if ((results[2]?.meta.changes ?? 0) === 0) {
    // Lost to a request that got there first, or to a removal: nothing of
    // this attempt may stay, least of all a slot on the plan.
    await env.DB.prepare("DELETE FROM devices WHERE id = ?1").bind(deviceId).run();
    const winner = await db(env)
      .select({ deviceId: schema.projectLocations.deviceId })
      .from(schema.projectLocations)
      .where(
        and(
          eq(schema.projectLocations.projectId, projectId),
          eq(schema.projectLocations.kind, "cloud"),
        ),
      )
      .get();
    return winner?.deviceId ? { deviceId: winner.deviceId } : { error: "not_found" };
  }

  await startMachine(env, {
    seed: { userId, deviceId, projectId, workspaceId: null, spriteName },
    project: { id: projectId, slug: project.slug, name: project.name },
    workspace: {
      id: `wsp_${deviceId.slice(4)}`,
      slug: CLOUD_MAIN_WORKSPACE_SLUG,
      branch: project.defaultBranch,
    },
    repoUrl: project.repoUrl,
    branch: project.defaultBranch,
    machineToken: token,
    credential,
  });
  return { deviceId };
}
