import { CLOUD_WAKE_PATH } from "@exeora/protocol";
import "./env.js";

/**
 * The part of the relay that knows its device may be asleep.
 *
 * A cloud machine is a Fly Sprite: it freezes a minute after the last inbound
 * request to its URL, and nothing the CLI does from inside (its outbound
 * socket, a running build) keeps it up or brings it back. So before the relay
 * dispatches anything to such a device it fetches the machine's URL, which the
 * Sprite proxy turns into "resume the VM and hand the request to the CLI".
 * The CLI answers 200 only once its relay socket is connected again, so a 200
 * here means the executor socket this object holds is live.
 *
 * Everything below is instance memory, not storage: the one fact worth keeping
 * across hibernation is the machine's URL, and that is written once when the
 * machine is provisioned. Waking costs about half a second, and paying it once
 * more after this object was evicted is cheaper than a storage write per call.
 */

export const CLOUD_CONFIG_KEY = "cloud:config";

/** How long to keep trying to wake a machine before failing the caller. */
export const CLOUD_WAKE_TIMEOUT_MS = 20_000;
/** Between attempts: a Sprite answers 503 from the CLI while it reconnects. */
export const CLOUD_WAKE_POLL_MS = 1_000;
/**
 * After a successful wake the Sprite stays up for at least its idle window,
 * which is longer than this; anything dispatched inside it needs no new wake.
 */
export const CLOUD_WAKE_GRACE_MS = 20_000;
/**
 * A result frame from a cloud CLI means it has just refreshed its keep-awake
 * task, which holds the machine for `CLOUD_TASK_HOLD_MS`. This is that hold
 * with a wide margin for the clock drift between here and the VM.
 */
export const CLOUD_HOLD_GRACE_MS = 90_000;

export interface CloudRelayConfig {
  /** The Sprite's URL; fetching `CLOUD_WAKE_PATH` on it wakes the machine. */
  url: string;
  spriteName: string;
}

export interface CloudWakeState {
  /** `undefined` until storage has been read once; `null` for a local device. */
  config?: CloudRelayConfig | null;
  /** Until when the machine is known to be up, as a `Date.now()` value. */
  awakeUntil: number;
  /** The one wake in flight, shared by every caller that arrives meanwhile. */
  inflight?: Promise<WakeOutcome> | undefined;
  /**
   * Whether the attached executor announced `cloud-v1`, and so holds the
   * machine awake itself while it has work. Only then does its activity say
   * anything about the future.
   */
  holdsTasks: boolean;
  /** Overridable so a test does not wait out the real deadline. */
  wakeTimeoutMs: number;
}

export type WakeOutcome = { ok: true } | { ok: false; message: string };

export function createCloudWakeState(): CloudWakeState {
  return { awakeUntil: 0, holdsTasks: false, wakeTimeoutMs: CLOUD_WAKE_TIMEOUT_MS };
}

export async function loadCloudConfig(
  ctx: DurableObjectState,
  state: CloudWakeState,
): Promise<CloudRelayConfig | null> {
  if (state.config === undefined) {
    state.config = (await ctx.storage.get<CloudRelayConfig>(CLOUD_CONFIG_KEY)) ?? null;
  }
  return state.config;
}

export async function storeCloudConfig(
  ctx: DurableObjectState,
  state: CloudWakeState,
  config: CloudRelayConfig | null,
): Promise<void> {
  if (config) await ctx.storage.put(CLOUD_CONFIG_KEY, config);
  else await ctx.storage.delete(CLOUD_CONFIG_KEY);
  state.config = config;
  state.awakeUntil = 0;
}

/**
 * Makes sure the device can receive a frame right now.
 *
 * Free for a local device and for a cloud machine known to be up. Otherwise
 * one wake request is shared by every caller that arrives while it runs, so a
 * burst of calls after an idle spell costs one fetch rather than one each.
 */
export async function ensureAwake(
  ctx: DurableObjectState,
  state: CloudWakeState,
  env: Pick<Env, "SPRITES_TOKEN">,
  fetcher: typeof fetch,
): Promise<WakeOutcome> {
  const config = await loadCloudConfig(ctx, state);
  if (!config) return { ok: true };
  if (Date.now() < state.awakeUntil) return { ok: true };
  if (!env.SPRITES_TOKEN) {
    return { ok: false, message: "Exeora Cloud is not configured on this gateway." };
  }

  if (!state.inflight) {
    state.inflight = wakeSprite(config.url, env.SPRITES_TOKEN, fetcher, state.wakeTimeoutMs)
      .then((outcome) => {
        if (outcome.ok) state.awakeUntil = Date.now() + CLOUD_WAKE_GRACE_MS;
        return outcome;
      })
      .finally(() => {
        state.inflight = undefined;
      });
  }
  return state.inflight;
}

/**
 * A frame that proves the CLI is working: it has refreshed its keep-awake
 * task, so the machine will be up for a while yet. Presence and heartbeats
 * are deliberately not counted: an idle CLI sends those without holding
 * anything, and the machine freezes underneath them.
 */
export function noteExecutorActivity(state: CloudWakeState): void {
  if (!state.holdsTasks) return;
  state.awakeUntil = Math.max(state.awakeUntil, Date.now() + CLOUD_HOLD_GRACE_MS);
}

async function wakeSprite(
  url: string,
  token: string,
  fetcher: typeof fetch,
  timeoutMs: number,
): Promise<WakeOutcome> {
  const deadline = Date.now() + timeoutMs;
  const target = `${url.replace(/\/$/, "")}${CLOUD_WAKE_PATH}`;

  for (;;) {
    const remaining = deadline - Date.now();
    try {
      const response = await fetcher(target, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(Math.max(1_000, Math.min(10_000, remaining))),
      });
      // The body is a few bytes of JSON nobody here reads; let the socket go.
      await response.body?.cancel();
      if (response.ok) return { ok: true };
    } catch {
      // A refused connection or a timeout: the VM may still be booting.
    }
    if (Date.now() + CLOUD_WAKE_POLL_MS >= deadline) {
      return {
        ok: false,
        message: "The cloud workspace did not wake up in time. Try again in a few seconds.",
      };
    }
    await new Promise((resolve) => setTimeout(resolve, CLOUD_WAKE_POLL_MS));
  }
}
