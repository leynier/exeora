import { and, eq } from "drizzle-orm";
import { type Db, schema } from "../db/client.js";
import { newId } from "../ids.js";
import type { ProviderId, UpstreamIdentity } from "./providers/index.js";

/**
 * Maps an upstream login onto an Exeora user, creating one on first sign-in.
 *
 * Lookup is by `(provider, providerUserId)` and never by email, so a user
 * changing their address at the provider keeps the same account, and someone
 * who later acquires a recycled address does not inherit it.
 *
 * `adminEmails` is the optional `ADMIN_EMAILS` binding: a comma-separated list
 * of addresses that become administrators the first time they register. When
 * it is unset, the first account to register is promoted instead, which is
 * how a fresh self-hosted install gets an operator without a seed migration.
 */
export async function resolveUser(
  database: Db,
  provider: ProviderId,
  identity: UpstreamIdentity,
  adminEmails?: string,
): Promise<{ id: string; email: string }> {
  const existing = await database
    .select({ userId: schema.oauthIdentities.userId })
    .from(schema.oauthIdentities)
    .where(
      and(
        eq(schema.oauthIdentities.provider, provider),
        eq(schema.oauthIdentities.providerUserId, identity.providerUserId),
      ),
    )
    .get();

  if (existing) {
    // Refresh the profile so the dashboard does not show a stale avatar.
    await database
      .update(schema.users)
      .set({ email: identity.email, name: identity.name, avatarUrl: identity.avatarUrl })
      .where(eq(schema.users.id, existing.userId))
      .run();
    return { id: existing.userId, email: identity.email };
  }

  const userId = newId("usr");
  await database
    .insert(schema.users)
    .values({
      id: userId,
      email: identity.email,
      name: identity.name,
      avatarUrl: identity.avatarUrl,
    })
    .run();
  await database
    .insert(schema.oauthIdentities)
    .values({ userId, provider, providerUserId: identity.providerUserId })
    .run();

  await maybeBootstrapAdmin(database, identity.email, adminEmails);

  return { id: userId, email: identity.email };
}

/**
 * Parses `ADMIN_EMAILS`: comma-separated, trimmed, lower-cased, empties dropped.
 */
export function parseAdminEmails(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0);
}

/**
 * Promotes a newly registered account into `admin_users` when appropriate.
 *
 * Two modes, chosen by whether `ADMIN_EMAILS` is set:
 *
 * - **Allow-list.** Only the named addresses are promoted, each on their own
 *   first registration. Useful when the operator is known ahead of time.
 * - **First user.** With no list, the first account to register becomes the
 *   admin. Subsequent accounts are ordinary users. This is the self-hosted
 *   default: a fresh database has no operator until someone signs in.
 *
 * Inserts are idempotent so a concurrent sign-in cannot trip the primary key.
 */
export async function maybeBootstrapAdmin(
  database: Db,
  email: string,
  adminEmails?: string,
): Promise<void> {
  const allowList = parseAdminEmails(adminEmails);
  const normalised = email.trim().toLowerCase();
  if (!normalised) return;

  if (allowList.length > 0) {
    if (!allowList.includes(normalised)) return;
  } else {
    const existing = await database
      .select({ email: schema.adminUsers.email })
      .from(schema.adminUsers)
      .get();
    if (existing) return;
  }

  await database
    .insert(schema.adminUsers)
    .values({ email: normalised })
    .onConflictDoNothing()
    .run();
}
