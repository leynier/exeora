import { and, eq } from "drizzle-orm";
import { type Db, schema } from "../db/client.js";
import { newId } from "../ids.js";
import type { ProviderId, UpstreamIdentity } from "./providers/index.js";

/**
 * Maps an upstream login onto an Exeora user, creating one on first sign-in.
 *
 * Lookup is by `(provider, providerUserId)` and never by email, so a user
 * changing their address at the provider keeps the same account — and someone
 * who later acquires a recycled address does not inherit it.
 */
export async function resolveUser(
  database: Db,
  provider: ProviderId,
  identity: UpstreamIdentity,
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

  return { id: userId, email: identity.email };
}
