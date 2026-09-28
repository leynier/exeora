import { and, eq } from "drizzle-orm";
import { decryptSecret, encryptSecret } from "../cloud/credentials.js";
import { db, schema } from "../db/client.js";
import type { AiProviderId } from "../db/schema-ai.js";
import "../env.js";
import type { CredentialEnv, CredentialKey } from "./credentials.js";
import type { DeviceLogin, DeviceLoginStart } from "./providers/types.js";

/**
 * A device login between its start and its grant: one per account and
 * provider, replaced by the next start and gone once granted. What the flow
 * has to keep secret in the meantime is encrypted like a credential.
 */

export interface PendingLogin extends DeviceLogin {
  verificationUrl: string;
  interval: number;
  expiresAt: number;
}

export async function storeLogin(
  env: CredentialEnv,
  key: CredentialKey,
  userId: string,
  provider: AiProviderId,
  start: DeviceLoginStart,
): Promise<void> {
  const values = {
    deviceId: start.deviceId,
    userCode: start.userCode,
    verificationUrl: start.verificationUrl,
    intervalS: start.interval,
    expiresAt: new Date(start.expiresAt),
    secretCiphertext: start.secret ? await encryptSecret(key.credentialsKey, start.secret) : null,
  };
  await db(env)
    .insert(schema.aiDeviceLogins)
    .values({ userId, provider, ...values })
    .onConflictDoUpdate({
      target: [schema.aiDeviceLogins.userId, schema.aiDeviceLogins.provider],
      set: values,
    })
    .run();
}

/** The login in progress, or null when none was started or the one started could not be read. */
export async function readLogin(
  env: CredentialEnv,
  key: CredentialKey,
  userId: string,
  provider: AiProviderId,
): Promise<PendingLogin | null> {
  const row = await db(env)
    .select()
    .from(schema.aiDeviceLogins)
    .where(
      and(eq(schema.aiDeviceLogins.userId, userId), eq(schema.aiDeviceLogins.provider, provider)),
    )
    .get();
  if (!row) return null;
  let secret: string | undefined;
  if (row.secretCiphertext) {
    try {
      secret = await decryptSecret(key.credentialsKey, row.secretCiphertext);
    } catch {
      await deleteLogin(env, userId, provider);
      return null;
    }
  }
  return {
    deviceId: row.deviceId,
    userCode: row.userCode,
    secret,
    verificationUrl: row.verificationUrl,
    interval: row.intervalS,
    expiresAt: row.expiresAt.getTime(),
  };
}

export async function deleteLogin(
  env: CredentialEnv,
  userId: string,
  provider: AiProviderId,
): Promise<void> {
  await db(env)
    .delete(schema.aiDeviceLogins)
    .where(
      and(eq(schema.aiDeviceLogins.userId, userId), eq(schema.aiDeviceLogins.provider, provider)),
    )
    .run();
}
