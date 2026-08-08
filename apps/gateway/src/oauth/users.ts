import { and, eq, sql } from "drizzle-orm";
import { type Db, schema } from "../db/client.js";
import { newId } from "../ids.js";
import { type ProviderId, UpstreamAuthError, type UpstreamIdentity } from "./providers/index.js";

/**
 * Maps an upstream login onto an Exeora user, creating one on first sign-in.
 *
 * Existing identities are looked up by `(provider, providerUserId)`, so a user
 * changing their address at the provider keeps the same account. A new
 * identity may link by verified email only when exactly one account matches.
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

  // Both providers guarantee this address is verified before it reaches here.
  // Matching it case-insensitively lets a person add Google after GitHub
  // without creating a second account that owns none of their existing work.
  const normalisedEmail = identity.email.trim().toLowerCase();
  const matchingUsers = await database
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(sql`lower(${schema.users.email}) = ${normalisedEmail}`)
    .limit(2);

  if (matchingUsers.length > 1) {
    // Picking one would attach a verified identity to projects without a
    // defensible way to know which account is theirs. Fail closed instead.
    throw new UpstreamAuthError(
      "This email matches more than one Exeora account. Contact support before signing in.",
    );
  }

  const matchingUser = matchingUsers[0];
  if (matchingUser) {
    await database
      .insert(schema.oauthIdentities)
      .values({ userId: matchingUser.id, provider, providerUserId: identity.providerUserId })
      .run();
    await database
      .update(schema.users)
      .set({ email: identity.email, name: identity.name, avatarUrl: identity.avatarUrl })
      .where(eq(schema.users.id, matchingUser.id))
      .run();
    return { id: matchingUser.id, email: identity.email };
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
