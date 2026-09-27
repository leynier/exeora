import { CLOUD_MIN_CLI_VERSION } from "@exeora/protocol";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import "../env.js";
import type { GitHubEnv } from "../github/app.js";
import { hasProjectCredential } from "../github/credentials.js";
import type { CloudEnv } from "./access.js";
import { cliConfigFor } from "./bootstrap.js";
import { type MachineSeed, provisionInput } from "./machine-do.js";
import type { Credential, ProvisionError } from "./provisioning.js";
import { previousUrls } from "./repository.js";

/**
 * How a machine starts: the device row that reserves its slot, the refusal
 * for a gateway whose CLI release cannot run one, and the hand-off to the
 * `CloudMachine` object. Split from `provisioning.ts`, which keeps the
 * mutations themselves.
 */

/**
 * The bootstrap installs the release the gateway announces, and a release
 * from before cloud mode would leave a machine whose service cannot start.
 * Refused up front, with the version to publish, rather than ten minutes
 * later as a machine that never connected.
 */
export function cliUnsupported(env: Pick<Env, "LATEST_CLI_VERSION">): ProvisionError {
  return {
    error: "cli_unsupported",
    message: `This gateway announces CLI ${env.LATEST_CLI_VERSION || "(unset)"}, which predates Exeora Cloud. Publish CLI ${CLOUD_MIN_CLI_VERSION} or later and set LATEST_CLI_VERSION before creating machines.`,
  };
}

export function insertCloudDevice(
  env: Pick<Env, "DB">,
  userId: string,
  deviceId: string,
  name: string,
  max: number | null,
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO devices (id, user_id, name, platform, kind)
     SELECT ?1, ?2, ?3, 'linux', 'cloud'
      WHERE (?4 IS NULL OR (
        SELECT COUNT(*) FROM devices WHERE user_id = ?2 AND kind = 'cloud' AND revoked_at IS NULL
      ) < ?4)`,
  ).bind(deviceId, userId, name, max);
}

export async function startMachine(
  env: CloudEnv & GitHubEnv,
  input: {
    seed: MachineSeed;
    project: { id: string; slug: string; name: string };
    workspace: { id: string; slug: string; branch: string };
    repoUrl: string;
    branch: string;
    createBranchFrom?: string | undefined;
    machineToken: string;
    credential?: Credential | undefined;
  },
): Promise<void> {
  const gatewayUrl = env.EXEORA_BASE_URL;
  try {
    // A project connected to GitHub clones with tokens that last an hour,
    // asked for by the machine each time git needs one. A token written into
    // the machine would be the one credential there that never expires, so
    // none is sent, even where one is stored from before the connection.
    const connected = await hasProjectCredential(env, input.project.id);
    // Read here rather than handed in, so every caller that starts a
    // machine tells it the same: the addresses the repository used to have.
    const cloud = await db(env)
      .select({ previousRepoUrls: schema.cloudProjects.previousRepoUrls })
      .from(schema.cloudProjects)
      .where(eq(schema.cloudProjects.projectId, input.project.id))
      .get();
    const previousRepoUrls = previousUrls(cloud?.previousRepoUrls);
    await env.CLOUD_MACHINE.getByName(input.seed.deviceId).provision({
      ...provisionInput({
        seed: input.seed,
        gatewayUrl,
        cliVersion: env.LATEST_CLI_VERSION,
        repoUrl: input.repoUrl,
        branch: input.branch,
        createBranchFrom: input.createBranchFrom,
        cliConfig: cliConfigFor({
          gatewayUrl,
          deviceId: input.seed.deviceId,
          project: input.project,
          workspace: input.workspace,
        }),
        machineToken: input.machineToken,
        credential: connected ? undefined : input.credential,
      }),
      ...(connected ? { credentialHelper: { projectId: input.project.id } } : {}),
      ...(previousRepoUrls.length > 0 ? { previousRepoUrls } : {}),
    });
  } catch (error) {
    // The rows are there and say `creating`; make them say what happened,
    // so the person can retry rather than wait for a step that never ran.
    await db(env)
      .update(schema.cloudMachines)
      .set({
        status: "error",
        step: null,
        error: `Provisioning could not start: ${error instanceof Error ? error.message : String(error)}`,
        updatedAt: new Date(),
      })
      .where(eq(schema.cloudMachines.deviceId, input.seed.deviceId))
      .run();
  }
}
