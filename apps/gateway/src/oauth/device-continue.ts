import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { db, schema } from "../db/client.js";
import { denyDeviceAuthorization } from "./device.js";
import { errorPage } from "./pages.js";
import { claimAuthorization, peekAuthorization } from "./pending.js";
import { getSessionUserId, hasDeviceContinuation } from "./session.js";

/**
 * Ends a device-code login whose browser path can no longer finish.
 *
 * Peek then claim, so a concurrent approval still wins the DELETE. Only a
 * winning claim may flip the grant to denied.
 */
export async function abandonParkedDeviceGrant(env: Env, state: string): Promise<boolean> {
  const pending = await peekAuthorization(env, state);
  if (!pending?.deviceCodeHash) return false;
  const claimed = await claimAuthorization(env, state);
  if (!claimed?.deviceCodeHash) return false;
  await denyDeviceAuthorization(env, claimed.deviceCodeHash);
  return true;
}

/**
 * A device-code continuation is bound to the browser that typed the code.
 * Possession of the parked `state` in a URL is not enough: that is how a
 * phishing page would skip the terminal-code warning.
 */
export async function refuseUnboundDeviceGrant(
  c: Context<{ Bindings: Env }>,
  state: string,
): Promise<Response | null> {
  const pending = await peekAuthorization(c.env, state);
  if (!pending?.deviceCodeHash) return null;
  if (await hasDeviceContinuation(c, state)) return null;
  await abandonParkedDeviceGrant(c.env, state);
  return c.html(errorPage("That sign-in could not be completed."), 400);
}

/** Session from a previous callback visit, if this is still a device grant. */
export async function deviceCallbackSession(
  c: Context<{ Bindings: Env }>,
  deviceCodeHash: string | undefined,
): Promise<{ userId: string; userEmail: string } | null> {
  if (!deviceCodeHash) return null;
  const userId = await getSessionUserId(c);
  if (!userId) return null;
  const user = await db(c.env)
    .select({ email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .get();
  return user ? { userId, userEmail: user.email } : null;
}
