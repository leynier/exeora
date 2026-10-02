import { sql } from "drizzle-orm";
import { integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { users } from "./schema.js";

/**
 * AI Assist: the accounts that linked ChatGPT or Grok, and what they asked
 * each operation to be generated with.
 *
 * Nothing here is ever a diff. The gateway reads staged changes from the
 * machine, sends them to the provider and keeps the answer nowhere; what is
 * kept is the credential that lets it ask, encrypted under
 * `CLOUD_CREDENTIALS_KEY` the way a GitHub token is, and the person's
 * preferences.
 *
 * Kept beside `schema.ts` for the same reason as `schema-github.ts`: that
 * file is at its length limit, and `client.ts` merges them into one object.
 */

export const AI_PROVIDER_IDS = ["openai", "xai", "chatgpt"] as const;
export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

export const AI_AUTH_KINDS = ["oauth", "api_key"] as const;
export type AiAuthKind = (typeof AI_AUTH_KINDS)[number];

export const AI_OPERATIONS = ["commit", "pull_request"] as const;
export type AiOperation = (typeof AI_OPERATIONS)[number];

const stamp = (name: string) =>
  integer(name, { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`);

/**
 * One row per account and provider: the credential that speaks to it as the
 * person. An OAuth credential expires and carries a refresh token; an API
 * key is kept as the access secret with nothing beside it.
 */
export const aiProviders = sqliteTable(
  "ai_providers",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: AI_PROVIDER_IDS }).notNull(),
    authKind: text("auth_kind", { enum: AI_AUTH_KINDS }).notNull(),
    accessCiphertext: text("access_ciphertext").notNull(),
    /** Null for an API key, and for an OAuth grant that came without one. */
    refreshCiphertext: text("refresh_ciphertext"),
    /** Null for a credential that does not expire. */
    accessExpiresAt: integer("access_expires_at", { mode: "timestamp_ms" }),
    /** What the provider needs beside the token to route a request, such as a ChatGPT account id. */
    accountId: text("account_id"),
    /** Something to show the person, such as the email of the linked account. */
    accountLabel: text("account_label"),
    updatedAt: stamp("updated_at"),
  },
  (table) => [uniqueIndex("ai_providers_user_provider").on(table.userId, table.provider)],
);

/**
 * A device login in progress: the code the person was shown, and what the
 * gateway needs to ask the provider whether they have entered it yet.
 * Replaced by a new start, deleted once granted, and ignored once expired.
 */
export const aiDeviceLogins = sqliteTable(
  "ai_device_logins",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: AI_PROVIDER_IDS }).notNull(),
    /** The provider's handle for the login, which is what redeems it: encrypted like a credential. */
    deviceCiphertext: text("device_ciphertext").notNull(),
    userCode: text("user_code").notNull(),
    verificationUrl: text("verification_url").notNull(),
    intervalS: integer("interval_s").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    /** Whatever the flow has to keep secret until it is granted, such as a PKCE verifier. */
    secretCiphertext: text("secret_ciphertext"),
  },
  (table) => [primaryKey({ columns: [table.userId, table.provider] })],
);

/** Account-wide choices. */
export const aiSettings = sqliteTable("ai_settings", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  /** The provider a generate button uses unless told otherwise. */
  defaultProvider: text("default_provider", { enum: AI_PROVIDER_IDS }),
});

/** How each operation is generated: which provider and model, and what else to tell it. */
export const aiOperationSettings = sqliteTable(
  "ai_operation_settings",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    operation: text("operation", { enum: AI_OPERATIONS }).notNull(),
    provider: text("provider", { enum: AI_PROVIDER_IDS }),
    model: text("model"),
    /** Added to the base prompt as "Additional user instructions". At most 4000 characters. */
    instructions: text("instructions"),
  },
  (table) => [primaryKey({ columns: [table.userId, table.operation] })],
);

export type AiProviderRow = typeof aiProviders.$inferSelect;
export type AiDeviceLoginRow = typeof aiDeviceLogins.$inferSelect;
