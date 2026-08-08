import { zValidator } from "@hono/zod-validator";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db, schema } from "../db/client.js";
import "../env.js";
import { deviceOnline } from "../presence.js";
import { queryWarehouseCalls } from "../warehouse-calls.js";
import { relayName } from "./ops.js";
import type { ApiEnv } from "./router.js";

/**
 * What was called, and what is waiting to be allowed.
 *
 * Two halves of the same question at two ages. The log is history, read from
 * the warehouse and paginated by cursor; the approvals are the live present,
 * held for ninety seconds inside the Durable Objects and fanned out to on read.
 */

export const audit = new Hono<ApiEnv>();

/** Rows per page. Small enough to render at once, large enough to fill a screen. */
const CALLS_PAGE_SIZE = 50;

/**
 * The audit log, paginated and filtered here rather than in the browser.
 *
 * Filtering used to happen in the dashboard over whatever one request returned,
 * which quietly meant "the most recent fifty" rather than "everything": a
 * filter that found nothing could not be told apart from one whose matches were
 * all just off the end.
 *
 * The cursor is `(createdAt, id)` rather than an offset, so rows arriving while
 * someone pages through do not shift the window and hide a row behind the seam.
 * `id` breaks ties, because two calls can land in the same millisecond and the
 * index orders by the timestamp alone.
 */
audit.get("/api/tool-calls", async (c) => {
  const userId = c.get("userId");
  const cursor = parseCallsCursor(c.req.query("cursor"));
  const projectId = c.req.query("projectId");
  const status = c.req.query("status");
  const clientId = c.req.query("clientId");
  const narrowStatus = status === "ok" || status === "error" ? status : undefined;

  const page = await queryWarehouseCalls(c.env, {
    userId,
    projectId,
    status: narrowStatus,
    clientId,
    cursor,
    pageSize: CALLS_PAGE_SIZE,
  });

  return c.json({
    items: page.items,
    cursor: page.last ? encodeCallsCursor(page.last.createdAt, page.last.id) : null,
  });
});

/**
 * Calls waiting on someone to confirm them, across every machine.
 *
 * A fan-out rather than a table, because a pending approval lives for ninety
 * seconds inside the Durable Object that is already holding the caller's
 * request. Writing it to D1 would mean a row whose whole purpose is to be
 * deleted before anyone could page through it.
 *
 * The fan-out is bounded twice over: only machines that have been seen recently
 * can be holding one, and a person has a handful of machines. A machine that
 * has been asleep for a week is not asked.
 */
audit.get("/api/approvals", async (c) => {
  const userId = c.get("userId");

  const devices = await db(c.env)
    .select({ id: schema.devices.id, name: schema.devices.name })
    .from(schema.devices)
    .where(and(eq(schema.devices.userId, userId), deviceOnline()))
    .all();

  const perDevice = await Promise.all(
    devices.map(async (device) => {
      try {
        const approvals = await c.env.DEVICE_RELAY.getByName(
          relayName(userId, device.id),
        ).listApprovals();

        return approvals.map((approval) => ({ ...approval, deviceName: device.name }));
      } catch {
        // One unreachable object must not empty the whole list: the other
        // machines may well have a question waiting.
        return [];
      }
    }),
  );

  // Oldest first, because the oldest is the one closest to expiring and so the
  // one the person needs to answer next.
  const items = perDevice.flat().sort((a, b) => a.requestedAt - b.requestedAt);

  return c.json({ items });
});

/**
 * Answers one, from the browser.
 *
 * The device is named by the caller rather than parsed out of the approval id.
 * Both the id and the device come from the listing above, so nothing is being
 * trusted that was not just handed out, and the id keeps no structure that a
 * later change would have to preserve.
 *
 * A miss answers 409 rather than 404: the usual reason is that the terminal got
 * there first, which is a race the person should see as one, not as a thing
 * that was never there.
 */
audit.post(
  "/api/approvals/:id",
  zValidator("json", z.object({ deviceId: z.string(), approved: z.boolean() })),
  async (c) => {
    const userId = c.get("userId");
    const { deviceId, approved } = c.req.valid("json");

    // The device has to be the caller's, or an approval id plus a guessed
    // device id would reach into another account's relay.
    const device = await db(c.env)
      .select({ id: schema.devices.id })
      .from(schema.devices)
      .where(and(eq(schema.devices.id, deviceId), eq(schema.devices.userId, userId)))
      .get();

    if (!device) return c.json({ error: "not_found" }, 404);

    const answered = await c.env.DEVICE_RELAY.getByName(relayName(userId, deviceId)).answerApproval(
      c.req.param("id"),
      approved,
    );

    if (!answered) {
      return c.json({ error: "already_answered" }, 409);
    }

    return c.json({ ok: true });
  },
);
/**
 * The cursor is opaque to the client but deliberately not signed: it carries
 * nothing the caller does not already have, and every query it feeds is still
 * bounded by the caller's own user id. The worst a forged one can do is page
 * through their own rows in an odd order.
 */
function encodeCallsCursor(createdAt: number, id: string): string {
  return `${createdAt}.${id}`;
}

function parseCallsCursor(raw: string | undefined): { createdAt: number; id: string } | undefined {
  if (!raw) return undefined;

  const separator = raw.indexOf(".");
  if (separator < 1) return undefined;

  const createdAt = Number(raw.slice(0, separator));
  const id = raw.slice(separator + 1);
  if (!Number.isFinite(createdAt) || !id) return undefined;

  return { createdAt, id };
}
