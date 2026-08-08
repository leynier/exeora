import { eq } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import "../env.js";
import { isPlanId, type PlanId } from "../plans.js";

/**
 * Which plan an account is on, as the routes need to ask it.
 *
 * Shared because three routes ask and they must agree: `/api/me` reports the
 * plan, and registering a machine or a project checks its limit before writing.
 */

/** Canonical plan id, defaulting unknown or missing values to free. */
export function normalizePlan(plan: string | null | undefined): PlanId {
  return isPlanId(plan) ? plan : "free";
}

/** The caller's plan, defaulting to free if the row is somehow missing. */
export async function planOf(env: Pick<Env, "DB">, userId: string): Promise<PlanId> {
  const row = await db(env)
    .select({ plan: schema.users.plan })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .get();
  return normalizePlan(row?.plan);
}
