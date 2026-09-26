import { DurableObject } from "cloudflare:workers";
import type { CloudCliConfig } from "@exeora/protocol";
import { revokeDevice } from "../api/ops.js";
import "../env.js";
import {
  FatalStepError,
  type MachineRecord,
  type ProvisionInput,
  runStep,
  type StepContext,
  type StepOutcome,
  writeMachineRow,
} from "./machine-steps.js";
import { SpritesError } from "./sprites.js";

/**
 * One instance per cloud machine, keyed by its device id. Drives the machine
 * through provisioning and, later, destruction, one alarm-driven step at a
 * time.
 *
 * A Durable Object rather than the request that created the machine, because
 * provisioning outlives any request: a bootstrap can take a minute, the CLI's
 * first connection longer, and each step may have to be retried. Alarms give
 * that a place to run with retries the runtime itself guarantees, and storage
 * gives every step a record to read back so a `destroy()` that arrives midway
 * wins over whatever the step was about to write.
 *
 * The machine's secrets (its token, a repository credential) live in storage
 * only until the bootstrap has delivered them, then are deleted.
 */

const MAX_ATTEMPTS = 6;
/** Left behind once a machine is destroyed, so nothing recreates it. */
const TOMBSTONE = "tombstone";
/** How long one phase may keep failing before the machine is marked broken. */
const PHASE_BUDGET_MS = 30 * 60_000;

export type { MachineRecord, ProvisionInput } from "./machine-steps.js";

/** Enough to destroy a machine whose provisioning never reached this object. */
export interface MachineSeed {
  userId: string;
  deviceId: string;
  projectId: string;
  workspaceId: string | null;
  spriteName: string;
}

export class CloudMachine extends DurableObject<Env> {
  /** A field so a test can hand the object a fetcher; see `relay-do.ts`. */
  private fetcher: typeof fetch = fetch;
  /**
   * The soonest any alarm is set for. Zero in production; a test raises it so
   * alarms wait to be run by hand instead of firing the moment they are set.
   */
  private alarmFloorMs = 0;

  /**
   * Starts, or restarts from the beginning, the provisioning of this machine.
   *
   * Refused once the machine is being destroyed or is gone: a request that
   * was accepted before the destruction and lands after it must not bring the
   * machine back, and a device id is never reused, so the refusal is final.
   */
  async provision(input: ProvisionInput): Promise<void> {
    const existing = await this.ctx.storage.get<MachineRecord>("machine");
    if (existing?.phase === "destroy" || (await this.ctx.storage.get(TOMBSTONE)) !== undefined) {
      return;
    }
    const record: MachineRecord = {
      userId: input.userId,
      deviceId: input.deviceId,
      projectId: input.projectId,
      workspaceId: input.workspaceId,
      spriteName: input.spriteName,
      phase: "create",
      phaseStartedAt: Date.now(),
      attempts: 0,
    };
    const { secrets, ...rest } = input;
    await this.ctx.storage.put({ machine: record, input: rest, secrets });
    await writeMachineRow(this.env, record.deviceId, {
      status: "creating",
      step: "Creating machine",
      error: null,
    });
    await this.schedule(0);
  }

  /**
   * Tears the machine down: revokes the device, deletes the Sprite, deletes
   * the rows. Safe to call at any point, including during a step, which then
   * finds the phase changed under it and stops.
   */
  async destroy(seed: MachineSeed): Promise<void> {
    const existing = await this.ctx.storage.get<MachineRecord>("machine");
    const record: MachineRecord = {
      ...(existing ?? { ...seed }),
      phase: "destroy",
      phaseStartedAt: Date.now(),
      attempts: 0,
    };
    await this.ctx.storage.put("machine", record);
    await this.ctx.storage.delete("secrets");
    await writeMachineRow(this.env, record.deviceId, { status: "destroying", step: null });
    await this.schedule(0);
    // Revoked now rather than when the step runs: from this moment the
    // machine takes no calls and frees its slot on the plan, so a person who
    // removed one to make room can make room without waiting on the alarm.
    // Best effort here, since the alarm above revokes again as its first act.
    await revokeDevice(this.env, record.userId, record.deviceId).catch(() => undefined);
  }

  /** Re-arms the alarm if the chain was lost, for the reconcile job. */
  async poke(): Promise<void> {
    const record = await this.ctx.storage.get<MachineRecord>("machine");
    if (!record || record.phase === "ready" || record.phase === "error") return;
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.schedule(0);
    }
  }

  async status(): Promise<Pick<MachineRecord, "phase" | "attempts" | "lastError"> | null> {
    const record = await this.ctx.storage.get<MachineRecord>("machine");
    if (!record) return null;
    return {
      phase: record.phase,
      attempts: record.attempts,
      ...(record.lastError !== undefined ? { lastError: record.lastError } : {}),
    };
  }

  override async alarm(): Promise<void> {
    const record = await this.ctx.storage.get<MachineRecord>("machine");
    if (!record || record.phase === "ready" || record.phase === "error") return;
    if (!this.env.SPRITES_TOKEN) {
      await this.fail(record, "Exeora Cloud is not configured on this gateway.", true);
      return;
    }

    const context: StepContext = {
      env: this.env,
      storage: this.ctx.storage,
      sprites: { token: this.env.SPRITES_TOKEN },
      fetcher: this.fetcher,
    };

    let outcome: StepOutcome;
    try {
      outcome = await runStep(context, record);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const fatal =
        error instanceof FatalStepError || (error instanceof SpritesError && !error.retryable);
      await this.fail(record, message, fatal);
      return;
    }

    if (outcome.kind === "done") return;
    if (outcome.kind === "again") {
      await this.schedule(outcome.delayMs);
      return;
    }
    // A step that advanced re-reads the record first: a destroy that arrived
    // meanwhile has already rewritten the phase, and must not be undone.
    const current = await this.ctx.storage.get<MachineRecord>("machine");
    if (!current || current.phase !== record.phase) return;
    const next = {
      ...current,
      ...outcome.patch,
      phase: outcome.phase,
      phaseStartedAt: Date.now(),
      attempts: 0,
    } satisfies MachineRecord;
    await this.ctx.storage.transaction(async (txn) => {
      await txn.put("machine", next);
      if (outcome.forgetSecrets) await txn.delete("secrets");
    });
    if (outcome.phase !== "ready") await this.schedule(0);
  }

  private async schedule(delayMs: number): Promise<void> {
    await this.ctx.storage.setAlarm(Date.now() + Math.max(delayMs, this.alarmFloorMs));
  }

  private async fail(record: MachineRecord, message: string, fatal: boolean): Promise<void> {
    const current = await this.ctx.storage.get<MachineRecord>("machine");
    if (!current || current.phase !== record.phase) return;
    const attempts = current.attempts + 1;
    const exhausted =
      attempts >= MAX_ATTEMPTS || Date.now() - current.phaseStartedAt > PHASE_BUDGET_MS;

    // Destruction never gives up: the reconcile job keeps poking it, and a
    // machine that costs money is worth every further attempt.
    if (current.phase !== "destroy" && (fatal || exhausted)) {
      await this.ctx.storage.put("machine", {
        ...current,
        phase: "error",
        attempts,
        lastError: message,
      } satisfies MachineRecord);
      await this.ctx.storage.delete("secrets");
      await writeMachineRow(this.env, current.deviceId, {
        status: "error",
        step: null,
        error: message,
      });
      return;
    }

    await this.ctx.storage.put("machine", {
      ...current,
      attempts,
      lastError: message,
    } satisfies MachineRecord);
    await this.schedule(Math.min(60_000, 5_000 * 2 ** attempts));
  }
}

/** Everything the API knows when it asks for a machine, for `provision()`. */
export function provisionInput(input: {
  seed: MachineSeed;
  gatewayUrl: string;
  cliVersion: string;
  repoUrl: string;
  branch: string;
  createBranchFrom?: string | undefined;
  cliConfig: CloudCliConfig;
  machineToken: string;
  credential?: { username: string; secret: string } | undefined;
}): ProvisionInput {
  return {
    ...input.seed,
    gatewayUrl: input.gatewayUrl,
    cliVersion: input.cliVersion,
    repoUrl: input.repoUrl,
    branch: input.branch,
    createBranchFrom: input.createBranchFrom,
    cliConfig: input.cliConfig,
    secrets: { machineToken: input.machineToken, credential: input.credential },
  };
}
