import { PRESENCE_TIMEOUT_MS } from "@exeora/protocol";
import { and, gt, isNull, type SQL, sql } from "drizzle-orm";
import { schema } from "./db/client.js";

/**
 * The one definition of "this machine is reachable", read from D1.
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
