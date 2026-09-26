import { zValidator } from "@hono/zod-validator";
import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { revokeOwnedDevice } from "../cloud/revoke.js";
import { db, schema } from "../db/client.js";
import "../env.js";
import { newId } from "../ids.js";
import { limitsFor } from "../plans.js";
import { isDeviceOnline, presenceCutoff } from "../presence.js";
import { permanentlyDeleteDevice } from "./ops.js";
import { planOf } from "./plan.js";
import type { ApiEnv } from "./router.js";

/**
 * The machines an account has registered, and the two-step way one leaves.
 *
 * Revocation is a soft delete: the row stays so the dashboard can offer the
 * second step, and the relay refuses a call for a device with `revokedAt` set.
 */

export const devices = new Hono<ApiEnv>();

const deviceInput = z.object({
  name: z.string().min(1).max(100),
  platform: z.string().min(1).max(50),
  cliVersion: z.string().max(50).optional(),
});

devices.post("/api/devices", zValidator("json", deviceInput), async (c) => {
  const body = c.req.valid("json");
  const userId = c.get("userId");
  const plan = await planOf(c.env, userId);
  const limits = limitsFor(plan);
  const id = newId("dev");
  const cliVersion = body.cliVersion ?? null;

  // Cap and insert are one statement when limited, so two concurrent registers
  // cannot both pass a separate count and both land. SQLite serialises writers;
  // the WHERE sees the other insert or it does not, never a stale mid-count.
  if (limits.maxDevices !== null) {
    const result = await db(c.env).run(
      sql`
          INSERT INTO devices (id, user_id, name, platform, cli_version)
          SELECT ${id}, ${userId}, ${body.name}, ${body.platform}, ${cliVersion}
          WHERE (
            SELECT COUNT(*) FROM devices
            WHERE user_id = ${userId} AND kind = 'local' AND revoked_at IS NULL
          ) < ${limits.maxDevices}
        `,
    );

    if ((result.meta.changes ?? 0) === 0) {
      return c.json({ error: "plan_limit", limit: "devices", max: limits.maxDevices, plan }, 403);
    }
  } else {
    await db(c.env)
      .insert(schema.devices)
      .values({
        id,
        userId,
        name: body.name,
        platform: body.platform,
        cliVersion,
      })
      .run();
  }

  return c.json({ id, name: body.name, platform: body.platform }, 201);
});

/**
 * Presence here is read from D1 rather than asked of each relay.
 *
 * Asking is the exact answer, but it is one Durable Object round trip per
 * machine on a route the dashboard polls and `exeora device list` also calls,
 * including for machines that have never dialled in and whose object holds no
 * state at all. The relay now records a close as it happens, so the column is
 * exact for every departure anybody witnessed and only lags on the ones nobody
 * did. See `presence.ts`.
 */
devices.get("/api/devices", async (c) => {
  const rows = await db(c.env)
    .select()
    .from(schema.devices)
    .where(eq(schema.devices.userId, c.get("userId")))
    .all();

  const cutoff = presenceCutoff();
  return c.json(rows.map((device) => toDeviceView(device, isDeviceOnline(device, cutoff))));
});

/**
 * Revocation is a soft delete: the row stays so the audit log keeps its
 * references, and the relay refuses a socket whose device has `revokedAt` set.
 */
devices.delete("/api/devices/:id", async (c) => {
  const ok = await revokeOwnedDevice(c.env, c.get("userId"), c.req.param("id"));
  if (!ok) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});

/**
 * Permanent deletion, allowed only once a machine is revoked.
 *
 * Two steps rather than one on purpose: revoking is the urgent action and has
 * to stay a single click, while this one cannot be undone and takes the
 * machine's projects and their audit history with it through the foreign keys.
 * Requiring the machine to be stopped first means nobody reaches this by
 * misclicking next to `Revoke`.
 */
devices.delete("/api/devices/:id/permanently", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");

  const device = await db(c.env)
    .select({ revokedAt: schema.devices.revokedAt })
    .from(schema.devices)
    .where(and(eq(schema.devices.id, id), eq(schema.devices.userId, userId)))
    .get();

  if (!device) return c.json({ error: "not_found" }, 404);
  if (device.revokedAt === null) return c.json({ error: "not_revoked" }, 409);

  await permanentlyDeleteDevice(c.env, userId, id);

  return c.json({ ok: true });
});
function toDeviceView(device: typeof schema.devices.$inferSelect, online = false) {
  return {
    id: device.id,
    name: device.name,
    platform: device.platform,
    kind: device.kind,
    cliVersion: device.cliVersion,
    online,
    lastSeenAt: device.lastSeenAt?.getTime() ?? null,
    revokedAt: device.revokedAt?.getTime() ?? null,
    createdAt: device.createdAt.getTime(),
  };
}
