import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import "../env.js";
import { CLI_SCOPES } from "../oauth/clients.js";
import { randomToken } from "../oauth/device.js";
import type { Props } from "../props.js";

/**
 * The credential a cloud machine dials the relay with.
 *
 * A machine cannot hold a user's OAuth token: that token reaches every device
 * on the account and can register more, and minting one server-side would
 * revoke the user's own CLI grant on the way (the provider defaults to one
 * grant per user and client). So a machine gets a token of its own, bound to
 * its device id, valid for exactly one thing: `GET /api/relay/<that device>`.
 *
 * The provider hands any bearer it does not recognise to `resolveMachineToken`
 * (its `resolveExternalToken` hook), which is where this shape is checked. The
 * shape is deliberately not the provider's own `a:b:c` form, so a machine token
 * never costs a KV lookup before it gets here.
 *
 * Only the SHA-256 of the token is stored. A keyed hash would add nothing to
 * 256 bits of random secret, and keying it to a rotating signing secret would
 * take every machine offline the day that secret changed.
 */

const PREFIX = "exm_";

/** `exm_` + the body of a device id + `_` + 32 random bytes as base64url. */
export const MACHINE_TOKEN_PATTERN = /^exm_([0-9a-hjkmnp-tv-z]{22})_([A-Za-z0-9_-]{43})$/;

export function mintMachineToken(deviceId: string): string {
  if (!deviceId.startsWith("dev_")) throw new Error("A machine token needs a device id.");
  return `${PREFIX}${deviceId.slice(4)}_${randomToken(32)}`;
}

export async function machineTokenHash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * The props a valid machine token carries into the API handler, or null.
 *
 * Null for anything that is not a machine token as well as for a token that
 * is, so the provider's generic `invalid_token` covers both: a caller must not
 * learn from the response whether a device id exists.
 */
export async function resolveMachineToken(
  env: Pick<Env, "DB">,
  token: string,
): Promise<{ props: Props } | null> {
  const match = MACHINE_TOKEN_PATTERN.exec(token);
  if (!match) return null;
  const deviceId = `dev_${match[1]}`;

  const row = await db(env)
    .select({
      userId: schema.cloudMachines.userId,
      tokenHash: schema.cloudMachines.tokenHash,
    })
    .from(schema.cloudMachines)
    .innerJoin(schema.devices, eq(schema.devices.id, schema.cloudMachines.deviceId))
    .where(and(eq(schema.cloudMachines.deviceId, deviceId), isNull(schema.devices.revokedAt)))
    .get();
  if (!row?.tokenHash) return null;

  if (!timingSafeEqual(await machineTokenHash(token), row.tokenHash)) return null;

  return {
    props: {
      userId: row.userId,
      deviceId,
      clientName: "Exeora Cloud",
      scopes: [...CLI_SCOPES],
    },
  };
}

/** Constant-time compare so the hash cannot be matched byte by byte. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
