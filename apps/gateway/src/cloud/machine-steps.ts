import type { CloudCliConfig, CloudMachineStatus } from "@exeora/protocol";
import { and, eq, ne } from "drizzle-orm";
import { permanentlyDeleteDevice, relayName, revokeDevice } from "../api/ops.js";
import { db, schema } from "../db/client.js";
import "../env.js";
import {
  bootstrapFatalReason,
  bootstrapSucceeded,
  renderBootstrap,
  serviceSpecFor,
} from "./bootstrap.js";
import {
  createSprite,
  deleteSprite,
  execSprite,
  putService,
  readServiceLog,
  type SpritesConfig,
} from "./sprites.js";

/**
 * The steps a `CloudMachine` walks through, one per alarm.
 *
 * Each is idempotent, because the alarm that ran it may fire again: a Sprite
 * that already exists is looked up, a bootstrap that already ran finds its
 * files in place, a service that exists is replaced. And each re-reads the
 * record after its slow call, so a `destroy()` that landed meanwhile is
 * noticed before anything is written back.
 */

export type MachinePhase =
  | "create"
  | "bootstrap"
  | "service"
  | "wait-hello"
  | "ready"
  | "destroy"
  | "error";

export interface MachineRecord {
  userId: string;
  deviceId: string;
  projectId: string;
  workspaceId: string | null;
  spriteName: string;
  spriteUrl?: string;
  phase: MachinePhase;
  phaseStartedAt: number;
  attempts: number;
  lastError?: string;
}

export interface ProvisionInput {
  userId: string;
  deviceId: string;
  projectId: string;
  workspaceId: string | null;
  spriteName: string;
  gatewayUrl: string;
  cliVersion: string;
  repoUrl: string;
  branch: string;
  createBranchFrom?: string | undefined;
  cliConfig: CloudCliConfig;
  secrets: {
    machineToken: string;
    credential?: { username: string; secret: string } | undefined;
  };
}

export interface StepContext {
  env: Env;
  storage: DurableObjectStorage;
  sprites: SpritesConfig;
  fetcher: typeof fetch;
}

/** A step that no retry can get past: the request itself is wrong. */
export class FatalStepError extends Error {}

export type StepOutcome =
  | {
      kind: "advance";
      phase: MachinePhase;
      patch?: Partial<MachineRecord>;
      /** Delete the secrets in the same write as the phase: delivered, or not at all. */
      forgetSecrets?: boolean;
    }
  | { kind: "again"; delayMs: number }
  | { kind: "done" };

/** How long the CLI has to connect after the service was registered. */
const HELLO_BUDGET_MS = 10 * 60_000;
const HELLO_POLL_MS = 5_000;
const BOOTSTRAP_TIMEOUT_MS = 120_000;

export async function runStep(context: StepContext, record: MachineRecord): Promise<StepOutcome> {
  switch (record.phase) {
    case "create":
      return create(context, record);
    case "bootstrap":
      return bootstrap(context, record);
    case "service":
      return service(context, record);
    case "wait-hello":
      return waitHello(context, record);
    case "destroy":
      return destroy(context, record);
    default:
      return { kind: "done" };
  }
}

async function create(context: StepContext, record: MachineRecord): Promise<StepOutcome> {
  const sprite = await createSprite(context.sprites, record.spriteName, context.fetcher);
  if (!(await stillIn(context, record))) return { kind: "done" };
  await context.env.DEVICE_RELAY.getByName(
    relayName(record.userId, record.deviceId),
  ).configureCloud({
    url: sprite.url,
    spriteName: record.spriteName,
  });
  await db(context.env)
    .update(schema.cloudMachines)
    .set({ spriteUrl: sprite.url, step: "Installing", updatedAt: new Date() })
    .where(eq(schema.cloudMachines.deviceId, record.deviceId))
    .run();
  return { kind: "advance", phase: "bootstrap", patch: { spriteUrl: sprite.url } };
}

async function bootstrap(context: StepContext, record: MachineRecord): Promise<StepOutcome> {
  const input = await context.storage.get<Omit<ProvisionInput, "secrets">>("input");
  const secrets = await context.storage.get<ProvisionInput["secrets"]>("secrets");
  if (!input || !secrets) {
    throw new Error("This machine's bootstrap material is gone; retry from the dashboard.");
  }
  const script = renderBootstrap({
    gatewayUrl: input.gatewayUrl,
    installUrl: `${input.gatewayUrl.replace(/\/$/, "")}/linux/install.sh`,
    cliVersion: input.cliVersion,
    machineToken: secrets.machineToken,
    repoUrl: input.repoUrl,
    branch: input.branch,
    createBranchFrom: input.createBranchFrom,
    credential: secrets.credential,
    cliConfig: input.cliConfig,
  });
  const result = await execSprite(
    context.sprites,
    record.spriteName,
    { script, timeoutMs: BOOTSTRAP_TIMEOUT_MS },
    context.fetcher,
  );
  if (!(await stillIn(context, record))) return { kind: "done" };
  if (!bootstrapSucceeded(result)) {
    const fatal = bootstrapFatalReason(result.output);
    if (fatal) throw new FatalStepError(fatal);
    throw new Error(`The machine could not be set up: ${tail(result.output) || "no output"}`);
  }
  // The secrets are not deleted here: a failure past this line, in the row
  // write or in the object itself, would retry this step without them. They
  // go in the same write that moves the phase on.
  await writeMachineRow(context.env, record.deviceId, { step: "Starting" });
  return { kind: "advance", phase: "service", forgetSecrets: true };
}

async function service(context: StepContext, record: MachineRecord): Promise<StepOutcome> {
  const input = await context.storage.get<Omit<ProvisionInput, "secrets">>("input");
  if (!input)
    throw new Error("This machine's bootstrap material is gone; retry from the dashboard.");
  await putService(
    context.sprites,
    record.spriteName,
    "exeora",
    serviceSpecFor(input.gatewayUrl),
    context.fetcher,
  );
  if (!(await stillIn(context, record))) return { kind: "done" };
  await writeMachineRow(context.env, record.deviceId, {
    step: "Cloning the repository and starting the CLI",
  });
  return { kind: "advance", phase: "wait-hello" };
}

async function waitHello(context: StepContext, record: MachineRecord): Promise<StepOutcome> {
  // A machine goes to sleep with nothing inbound, and a clone of a large
  // repository is a long quiet stretch before the CLI holds it awake itself.
  // Each poll reaches the machine over its URL so the clone can finish; what
  // it answers does not matter, the relay is what says the CLI is up.
  if (record.spriteUrl) {
    await context
      .fetcher(`${record.spriteUrl}/wake`, {
        headers: { authorization: `Bearer ${context.sprites.token}` },
        signal: AbortSignal.timeout(HELLO_POLL_MS),
      })
      .catch(() => undefined);
  }
  const online = await context.env.DEVICE_RELAY.getByName(
    relayName(record.userId, record.deviceId),
  ).isOnline();
  if (!(await stillIn(context, record))) return { kind: "done" };
  if (online) {
    await writeMachineRow(context.env, record.deviceId, {
      status: "ready",
      step: null,
      error: null,
      readyAt: new Date(),
    });
    return { kind: "advance", phase: "ready" };
  }
  if (Date.now() - record.phaseStartedAt > HELLO_BUDGET_MS) {
    const log = await readServiceLog(context.sprites, record.spriteName, "exeora", context.fetcher);
    throw new Error(`The CLI never connected. ${tail(log) || "The service wrote no log."}`);
  }
  return { kind: "again", delayMs: HELLO_POLL_MS };
}

/** How long the main machine waits before looking at its children again. */
const CHILDREN_RECHECK_MS = 10_000;

async function destroy(context: StepContext, record: MachineRecord): Promise<StepOutcome> {
  // The main machine carries the project: deleting its device cascades the
  // project's rows away, and with them the record of every other machine.
  // So it goes last, and only once each of those has a destruction of its own
  // under way; one whose object was never told is told here, and the main
  // waits until the row says so.
  if (record.workspaceId === null) {
    const children = await db(context.env)
      .select({
        deviceId: schema.cloudMachines.deviceId,
        userId: schema.cloudMachines.userId,
        projectId: schema.cloudMachines.projectId,
        workspaceId: schema.cloudMachines.workspaceId,
        spriteName: schema.cloudMachines.spriteName,
        status: schema.cloudMachines.status,
      })
      .from(schema.cloudMachines)
      .where(
        and(
          eq(schema.cloudMachines.projectId, record.projectId),
          ne(schema.cloudMachines.deviceId, record.deviceId),
        ),
      )
      .all();
    const waiting = children.filter((child) => child.status !== "destroying");
    for (const { status: _status, ...seed } of waiting) {
      await context.env.CLOUD_MACHINE.getByName(seed.deviceId)
        .destroy(seed)
        .catch(() => undefined);
    }
    if (waiting.length > 0) return { kind: "again", delayMs: CHILDREN_RECHECK_MS };
  }
  // Order matters: the socket first, so nothing runs while the rest happens;
  // the Sprite next, which is the part that costs money; the rows last, since
  // they are what everyone else reads to know the machine still exists.
  await revokeDevice(context.env, record.userId, record.deviceId);
  await deleteSprite(context.sprites, record.spriteName, context.fetcher);
  await permanentlyDeleteDevice(context.env, record.userId, record.deviceId);
  await context.storage.deleteAll();
  // The one thing kept: a mark that refuses a `provision()` arriving late.
  await context.storage.put("tombstone", Date.now());
  return { kind: "done" };
}

/** Whether the record is still in the phase this step started in. */
async function stillIn(context: StepContext, record: MachineRecord): Promise<boolean> {
  const current = await context.storage.get<MachineRecord>("machine");
  return current?.phase === record.phase;
}

/** The read model in D1, which the dashboard and the CLI poll. */
export async function writeMachineRow(
  env: Pick<Env, "DB">,
  deviceId: string,
  patch: {
    status?: CloudMachineStatus;
    step?: string | null;
    error?: string | null;
    readyAt?: Date;
  },
): Promise<void> {
  await db(env)
    .update(schema.cloudMachines)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(schema.cloudMachines.deviceId, deviceId))
    .run();
}

function tail(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > 600 ? `…${trimmed.slice(-600)}` : trimmed;
}
