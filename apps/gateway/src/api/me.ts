import { and, count, eq, gte, isNull, sum } from "drizzle-orm";
import { Hono } from "hono";
import { db, schema } from "../db/client.js";
import "../env.js";
import { ACCOUNT_MCP_ROUTE } from "../mcp-account.js";
import { normalizeEmail } from "../oauth/users.js";
import { limitsFor } from "../plans.js";
import { deleteAccount } from "./ops.js";
import { normalizePlan } from "./plan.js";
import type { ApiEnv } from "./router.js";

/**
 * The caller's own account: who they are, what plan they are on, and how much
 * of it they have used this month. The dashboard reads this on every load, so
 * the counts are three cheap aggregates rather than three list endpoints.
 */

export const me = new Hono<ApiEnv>();

me.get("/api/me", async (c) => {
  const userId = c.get("userId");
  const user = await db(c.env)
    .select({
      id: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
      avatarUrl: schema.users.avatarUrl,
      plan: schema.users.plan,
      cloudEnabled: schema.users.cloudEnabled,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .get();

  if (!user) return c.json({ error: "not_found" }, 404);

  const database = db(c.env);
  const plan = normalizePlan(user.plan);

  const adminRow = await database
    .select({ email: schema.adminUsers.email })
    .from(schema.adminUsers)
    .where(eq(schema.adminUsers.email, normalizeEmail(user.email)))
    .get();
  const isAdmin = adminRow !== undefined;

  // Cloud machines are counted apart from the laptops: each kind has its own
  // cap, and the device figure has always meant machines the person runs.
  const [deviceCount, cloudCount, projectCount, monthCalls] = await Promise.all([
    database
      .select({ n: count() })
      .from(schema.devices)
      .where(
        and(
          eq(schema.devices.userId, userId),
          eq(schema.devices.kind, "local"),
          isNull(schema.devices.revokedAt),
        ),
      )
      .get(),
    database
      .select({ n: count() })
      .from(schema.devices)
      .where(
        and(
          eq(schema.devices.userId, userId),
          eq(schema.devices.kind, "cloud"),
          isNull(schema.devices.revokedAt),
        ),
      )
      .get(),
    database
      .select({ n: count() })
      .from(schema.projects)
      .where(eq(schema.projects.userId, userId))
      .get(),
    database
      .select({ n: sum(schema.usageDaily.toolCalls) })
      .from(schema.usageDaily)
      .where(and(eq(schema.usageDaily.userId, userId), gte(schema.usageDaily.day, monthStartUtc())))
      .get(),
  ]);

  const limits = limitsFor(plan);

  return c.json({
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    plan,
    isAdmin,
    // Whether this account can open Exeora Cloud today: the gateway has to be
    // configured for it, and the person has to be an administrator or have
    // been switched on by one. The dashboard shows the section either way and
    // explains the gate; this decides whether its buttons do anything.
    cloudEnabled: Boolean(c.env.SPRITES_TOKEN) && (isAdmin || user.cloudEnabled),
    // The one URL that is the same for every account. Sent from here rather
    // than written into the dashboard so it follows `EXEORA_BASE_URL` in
    // development, exactly as every project's own URL does.
    accountMcpUrl: new URL(ACCOUNT_MCP_ROUTE, c.env.EXEORA_BASE_URL).toString(),
    limits,
    usage: {
      devices: deviceCount?.n ?? 0,
      cloudMachines: cloudCount?.n ?? 0,
      projects: projectCount?.n ?? 0,
      toolCallsMonth: Number(monthCalls?.n ?? 0),
    },
  });
});

/**
 * Deletes the caller's own account. Same cascade as the admin path; the helper
 * is shared so the order of operations cannot drift between the two doors.
 */
me.delete("/api/me", async (c) => {
  await deleteAccount(c.env, c.get("userId"));
  return c.json({ ok: true });
});
/** UTC calendar day as `YYYY-MM-DD`. */
function _utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** First day of the current UTC month as `YYYY-MM-DD`. */
function monthStartUtc(now = new Date()): string {
  return `${now.toISOString().slice(0, 7)}-01`;
}
