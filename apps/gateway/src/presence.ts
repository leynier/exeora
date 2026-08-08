import {
  HEARTBEAT_INTERVAL_MS,
  PRESENCE_CHECKPOINT_INTERVAL_MS,
  PRESENCE_SIGNAL_INTERVAL_MS,
  PRESENCE_TIMEOUT_MS,
} from "@exeora/protocol";
import { and, gt, isNull, type SQL, sql } from "drizzle-orm";
import { observeD1 } from "./cost-metrics.js";
import { schema } from "./db/client.js";
import "./env.js";

/**
 * The one definition of "this machine is reachable", read from D1, and the
 * checkpoint that writes it.
 *
 * Presence has two sources and neither is sufficient alone. `disconnected_at`
 * is set the moment the relay watches a socket close, which is exact but only
 * covers the departures somebody was there to see. `last_seen_at` is a
 * checkpoint written at most once per `PRESENCE_CHECKPOINT_INTERVAL_MS`, so the
 * window that reads it has to be wider than that interval and is therefore
 * always a little behind; what it does cover is the machine that vanished
 * without a close frame. Requiring both means a clean disconnect disappears
 * immediately and an unclean one ages out.
 *
 * This used to be answered by asking every relay, one Durable Object round trip
 * per device on every page load. That is the exact answer, and it is worth
 * paying for a single device; paying it per row of a list that a dashboard
 * polls is not.
 */

/** Rows older than this are stale even if no close was ever recorded. */
export function presenceCutoff(now = Date.now()): Date {
  return new Date(now - PRESENCE_TIMEOUT_MS);
}

/** The predicate for a `devices` row, for queries that filter or count. */
export function deviceOnline(cutoff = presenceCutoff()): SQL {
  return and(
    isNull(schema.devices.revokedAt),
    isNull(schema.devices.disconnectedAt),
    gt(schema.devices.lastSeenAt, cutoff),
  ) as SQL;
}

/**
 * The same predicate as a raw fragment, for the admin panel's counts: those are
 * correlated subselects written in SQL and cannot take a builder condition.
 */
export function deviceOnlineSql(cutoffMs = presenceCutoff().getTime()): SQL {
  return sql`${schema.devices.revokedAt} is null and ${schema.devices.disconnectedAt} is null and ${schema.devices.lastSeenAt} > ${cutoffMs}`;
}

/** The same predicate over a row already in memory. */
export function isDeviceOnline(
  device: {
    revokedAt?: Date | null;
    disconnectedAt: Date | null;
    lastSeenAt: Date | null;
  },
  cutoff = presenceCutoff(),
): boolean {
  return (
    (device.revokedAt ?? null) === null &&
    device.disconnectedAt === null &&
    device.lastSeenAt !== null &&
    device.lastSeenAt.getTime() > cutoff.getTime()
  );
}

/**
 * The write side: the relay recording that it just heard from a machine.
 *
 * `connected` is what separates a machine that left from one that is merely
 * between checkpoints, and it is only passed by the events that know: the
 * hello frame and the two ways a socket ends. Heartbeats leave the column
 * alone, since they say nothing a stale `disconnected_at` would contradict.
 *
 * Raw SQL rather than the query builder because the checkpoint predicate is
 * conditional on `force`, and because presence is the highest-frequency write
 * in the system.
 */
export async function touchDevice(
  env: Pick<Env, "DB">,
  deviceId: string,
  options: { cliVersion?: string | undefined; force?: boolean; connected?: boolean } = {},
): Promise<void> {
  const { cliVersion, force = false, connected } = options;
  const assignments = ["last_seen_at = ?1"];
  const bindings: unknown[] = [Date.now(), deviceId];
  if (cliVersion) {
    assignments.push(`cli_version = ?${bindings.push(cliVersion)}`);
  }
  if (connected !== undefined) {
    assignments.push(connected ? "disconnected_at = NULL" : "disconnected_at = ?1");
  }
  // The debounce fires one signal early on purpose. It is only ever evaluated
  // when a presence frame arrives, and those arrive every
  // `PRESENCE_SIGNAL_INTERVAL_MS`; comparing against the full checkpoint
  // interval would mean the first eligible frame is the one after it, pushing
  // the real write cadence out to checkpoint + signal. `PRESENCE_TIMEOUT_MS`
  // is sized against the checkpoint interval alone, so that extra signal
  // would come straight out of the slack the window has for a missed write.
  const staleness = PRESENCE_CHECKPOINT_INTERVAL_MS - PRESENCE_SIGNAL_INTERVAL_MS;
  const checkpoint = force
    ? ""
    : ` AND (last_seen_at IS NULL OR last_seen_at < ${Date.now() - staleness})`;

  try {
    const result = await env.DB.prepare(
      `UPDATE devices SET ${assignments.join(", ")} WHERE id = ?2${checkpoint}`,
    )
      .bind(...bindings)
      .run();
    observeD1(
      `${deviceId}:${Math.floor(Date.now() / HEARTBEAT_INTERVAL_MS)}`,
      "presence.touch",
      result.meta,
    );
  } catch {
    // Presence is cosmetic; never fail a tool call because of it.
  }
}
