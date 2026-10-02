import {
  CLOUD_HOOKS_FEATURE,
  CLOUD_INSTALL_TIMEOUT_MS,
  type CloudCliConfig,
  type CloudHookRun,
  type CloudMachineStatus,
} from "@exeora/protocol";
import { and, eq, ne } from "drizzle-orm";
import { permanentlyDeleteDevice, relayName, revokeDevice } from "../api/ops.js";
import { db, schema } from "../db/client.js";
import { newId } from "../ids.js";
import { hookRunOf, settled } from "./hooks.js";
import { explainFailure } from "./machine-errors.js";
import { finishCloudRemoval } from "./teardown.js";
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
  spriteEndpoint,
} from "./sprites.js";
import {
  parseToolsReport,
  TOOLS_SCRIPT,
  TOOLS_TIMEOUT_MS,
  toolsFailure,
  toolsSucceeded,
} from "./tools.js";

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
  | "tools"
  | "service"
  | "wait-hello"
  | "wait-install"
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
  /**
   * Set for a project connected to GitHub: git on the machine asks the
   * gateway for a token through the CLI, for this project, instead of reading
   * one that was written there.
   */
  credentialHelper?: { projectId: string } | undefined;
  /** Addresses the repository had before it was renamed or moved. */
  previousRepoUrls?: string[] | undefined;
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
/**
 * How long a machine is waited for to say how its install script went: the
 * script's own limit, and the time to notice it ran out. Past this the
 * machine is handed over with the wait itself recorded as what went wrong.
 */
const INSTALL_BUDGET_MS = CLOUD_INSTALL_TIMEOUT_MS + 2 * 60_000;
/** The row is touched this often while waiting, so the sweep sees a machine at work. */
const INSTALL_TOUCH_MS = 60_000;

export async function runStep(context: StepContext, record: MachineRecord): Promise<StepOutcome> {
  switch (record.phase) {
    case "create":
      return create(context, record);
    case "bootstrap":
      return bootstrap(context, record);
    case "tools":
      return tools(context, record);
    case "service":
      return service(context, record);
    case "wait-hello":
      return waitHello(context, record);
    case "wait-install":
      return waitInstall(context, record);
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
    credentialHelper: input.credentialHelper,
    previousRepoUrls: input.previousRepoUrls,
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
  await writeMachineRow(context.env, record.deviceId, { step: "Installing tools" });
  return { kind: "advance", phase: "tools", forgetSecrets: true };
}

/**
 * Gives the machine what a person expects to find on one: `gh`, `uv`, `jq`
 * and the rest. The script looks before it installs, so a machine that came
 * with a tool keeps its own, and running it again costs a few seconds.
 *
 * Only `gh` stops a machine from being handed over. Anything else that could
 * not be installed is written down for the page and the machine goes on.
 */
async function tools(context: StepContext, record: MachineRecord): Promise<StepOutcome> {
  const result = await execSprite(
    context.sprites,
    record.spriteName,
    { script: TOOLS_SCRIPT, timeoutMs: TOOLS_TIMEOUT_MS },
    context.fetcher,
  );
  if (!(await stillIn(context, record))) return { kind: "done" };
  await db(context.env)
    .update(schema.cloudMachines)
    .set({ toolsReport: JSON.stringify(parseToolsReport(result.output)), updatedAt: new Date() })
    .where(eq(schema.cloudMachines.deviceId, record.deviceId))
    .run();
  if (!toolsSucceeded(result)) {
    // Retried like any other step: what stops a download today is most often
    // a network that is back a minute later. The sentence comes first, and
    // what the machine printed after it, which is how it is told apart.
    const sentence = toolsFailure(result.output) ?? NO_TOOLS;
    throw new Error(`${sentence}\n${tail(result.output)}`);
  }
  await writeMachineRow(context.env, record.deviceId, { step: "Starting" });
  return { kind: "advance", phase: "service" };
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
    const target = spriteEndpoint(record.spriteUrl);
    if (!target) throw new FatalStepError("The machine returned an invalid address; retry it.");
    // Called as a plain function: the runtime's fetch refuses a `this`.
    const { fetcher } = context;
    await fetcher(`${target}/wake`, {
      headers: { authorization: `Bearer ${context.sprites.token}` },
      // The URL came from an upstream Sprite response; never replay the
      // bearer at a redirect target.
      redirect: "manual",
      signal: AbortSignal.timeout(HELLO_POLL_MS),
    }).catch(() => undefined);
  }
  const relay = context.env.DEVICE_RELAY.getByName(relayName(record.userId, record.deviceId));
  const online = await relay.isOnline();
  if (!(await stillIn(context, record))) return { kind: "done" };
  if (online) {
    // A CLI that runs the project's scripts is running the install one now.
    // The machine is handed over once it says how that went, so nobody
    // starts work in a checkout whose dependencies are still arriving.
    const capabilities = await relay.capabilities();
    if (capabilities?.features?.includes(CLOUD_HOOKS_FEATURE)) {
      await writeMachineRow(context.env, record.deviceId, { step: INSTALL_STEP });
      return { kind: "advance", phase: "wait-install" };
    }
    return handOver(context, record);
  }
  if (Date.now() - record.phaseStartedAt > HELLO_BUDGET_MS) {
    const log = await readServiceLog(context.sprites, record.spriteName, "exeora", context.fetcher);
    throw new Error(`The CLI never connected. ${tail(log) || "The service wrote no log."}`);
  }
  return { kind: "again", delayMs: HELLO_POLL_MS };
}

const INSTALL_STEP = "Running the install script";
const NO_TOOLS =
  "The GitHub CLI (gh) could not be installed on the machine: the step did not finish. Retry to try again.";

async function handOver(context: StepContext, record: MachineRecord): Promise<StepOutcome> {
  await writeMachineRow(context.env, record.deviceId, {
    status: "ready",
    step: null,
    error: null,
    readyAt: new Date(),
  });
  return { kind: "advance", phase: "ready" };
}

/**
 * Waits for the machine to say how its install script went, and hands it
 * over whichever way that was: a script that failed is something the page
 * says about a machine that is ready, not a machine that could not be made.
 */
async function waitInstall(context: StepContext, record: MachineRecord): Promise<StepOutcome> {
  const row = await db(context.env)
    .select({ installHook: schema.cloudMachines.installHook })
    .from(schema.cloudMachines)
    .where(eq(schema.cloudMachines.deviceId, record.deviceId))
    .get();
  if (!(await stillIn(context, record))) return { kind: "done" };
  const run = hookRunOf(row?.installHook ?? null);
  if (settled(run)) return handOver(context, record);

  const waited = Date.now() - record.phaseStartedAt;
  if (waited > INSTALL_BUDGET_MS) {
    const silent: CloudHookRun = {
      runId: run?.runId ?? newId("req"),
      status: "timed_out",
      source: run?.source ?? "none",
      trigger: run?.trigger ?? "setup",
      scriptSha256: run?.scriptSha256 ?? null,
      exitCode: null,
      startedAt: run?.startedAt ?? record.phaseStartedAt,
      finishedAt: Date.now(),
      output: "The machine never said how the install script ended.",
      truncated: false,
    };
    await db(context.env)
      .update(schema.cloudMachines)
      .set({ installHook: JSON.stringify(silent), updatedAt: new Date() })
      .where(eq(schema.cloudMachines.deviceId, record.deviceId))
      .run();
    return handOver(context, record);
  }
  if (
    Math.floor(waited / INSTALL_TOUCH_MS) !==
    Math.floor((waited - HELLO_POLL_MS) / INSTALL_TOUCH_MS)
  ) {
    await writeMachineRow(context.env, record.deviceId, { step: INSTALL_STEP });
  }
  return { kind: "again", delayMs: HELLO_POLL_MS };
}

/** How long the main machine waits before looking at its children again. */
const CHILDREN_RECHECK_MS = 10_000;

async function destroy(context: StepContext, record: MachineRecord): Promise<StepOutcome> {
  // When the project itself is being removed, the machine that holds its root
  // goes last: deleting its device can cascade the project's rows away, and
  // with them the record of every other machine. So it waits until each of
  // those has a destruction of its own under way; one whose object was never
  // told is told here. A root machine that goes on its own takes nothing
  // with it and waits for nobody.
  if (record.workspaceId === null && (await removingProject(context.env, record))) {
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
  // The last machine to go finishes what the removal asked for.
  await finishCloudRemoval(context.env, record.userId, record.projectId, record.deviceId);
  await context.storage.deleteAll();
  // The one thing kept: a mark that refuses a `provision()` arriving late.
  await context.storage.put("tombstone", Date.now());
  return { kind: "done" };
}

async function removingProject(env: Pick<Env, "DB">, record: MachineRecord): Promise<boolean> {
  const cloud = await db(env)
    .select({
      deletingAt: schema.cloudProjects.deletingAt,
      scope: schema.cloudProjects.deletingScope,
    })
    .from(schema.cloudProjects)
    .where(eq(schema.cloudProjects.projectId, record.projectId))
    .get();
  // Only a removal that was asked for takes the project. A root machine that
  // goes on its own leaves it where else it lives, or nowhere, with the rest
  // of its machines standing.
  return cloud?.deletingAt ? cloud.scope === "project" : false;
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
  // The one place a failure is put into words. `error: null` clears all three
  // columns, so a machine that recovered carries nothing of what went wrong.
  const failure = typeof patch.error === "string" ? explainFailure(patch.error) : undefined;
  const explained =
    patch.error === undefined
      ? {}
      : {
          error: failure?.message ?? null,
          errorCode: failure?.code ?? null,
          errorDetail: failure?.detail ?? null,
        };
  await db(env)
    .update(schema.cloudMachines)
    .set({ ...patch, ...explained, updatedAt: new Date() })
    .where(eq(schema.cloudMachines.deviceId, deviceId))
    .run();
}

function tail(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > 600 ? `…${trimmed.slice(-600)}` : trimmed;
}
