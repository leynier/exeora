import { eq } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import "../env.js";
import { isAdminUser } from "../oauth/users.js";

/**
 * The bindings Exeora Cloud reads, named so a caller (or a test) can pass
 * exactly those rather than the whole `Env`.
 */
export type CloudEnv = Pick<
  Env,
  | "DB"
  | "DEVICE_RELAY"
  | "CLOUD_MACHINE"
  | "CLOUD_SPRITE_PREFIX"
  | "CLOUD_CREDENTIALS_KEY"
  | "SPRITES_TOKEN"
  | "EXEORA_BASE_URL"
  | "LATEST_CLI_VERSION"
>;

/**
 * Who may create Exeora Cloud machines: administrators, and the accounts an
 * administrator has switched on, but only on a gateway that has a Sprites
 * token to create them with. Every machine costs money, and nothing bills for
 * it yet, so the door is closed until someone opens it for a specific person.
 */
export async function cloudAccess(
  env: Pick<Env, "DB" | "SPRITES_TOKEN">,
  userId: string,
): Promise<boolean> {
  if (!env.SPRITES_TOKEN) return false;
  const user = await db(env)
    .select({ cloudEnabled: schema.users.cloudEnabled })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .get();
  if (!user) return false;
  return user.cloudEnabled || isAdminUser(env, userId);
}

/** The Sprite name every machine of this gateway carries, from its device id. */
export function spriteNameFor(env: Pick<Env, "CLOUD_SPRITE_PREFIX">, deviceId: string): string {
  return `${env.CLOUD_SPRITE_PREFIX || "exeora"}-${deviceId.slice(4)}`;
}

/**
 * Whether a Sprite name is one this gateway would have given: the prefix and
 * then exactly a device id's body, nothing more. A prefix alone is not
 * ownership: another gateway sharing the organisation under `exeora-staging`
 * has names that start with `exeora-` too, and its machines are not ours to
 * sweep.
 */
export function isSpriteNameOfThisGateway(
  env: Pick<Env, "CLOUD_SPRITE_PREFIX">,
  name: string,
): boolean {
  const prefix = `${env.CLOUD_SPRITE_PREFIX || "exeora"}-`;
  if (!name.startsWith(prefix)) return false;
  return /^[0-9a-hjkmnp-tv-z]{22}$/.test(name.slice(prefix.length));
}
