import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Everything hangs off `userId`. There is no billing in this release, but the
 * schema is multi-tenant from day one so adding organisations later does not
 * require rewriting ownership checks.
 */

const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`);

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  createdAt: createdAt(),
});

/**
 * One row per upstream login. A user who signs in with both GitHub and Google
 * on the same verified email gets two rows and one `users` row.
 */
export const oauthIdentities = sqliteTable(
  "oauth_identities",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: ["github", "google"] }).notNull(),
    providerUserId: text("provider_user_id").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("oauth_identities_provider_subject").on(table.provider, table.providerUserId),
    index("oauth_identities_user").on(table.userId),
  ],
);

export const devices = sqliteTable(
  "devices",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    platform: text("platform").notNull(),
    cliVersion: text("cli_version"),
    /** Updated on connect, heartbeat and disconnect. Drives the online badge. */
    lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }),
    /** Set when revoked from the dashboard; the relay refuses the socket after. */
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
  },
  (table) => [index("devices_user").on(table.userId)],
);

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deviceId: text("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    /**
     * Absolute path on the user's machine. Stored for display only; the
     * executor is the authority on where a project lives and confines every
     * path to it. The gateway never sends this value to a tool.
     */
    localPath: text("local_path").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("projects_user_slug").on(table.userId, table.slug),
    index("projects_device").on(table.deviceId),
  ],
);

/** Audit trail shown in the dashboard. Never stores tool arguments or output. */
export const toolCalls = sqliteTable(
  "tool_calls",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    tool: text("tool").notNull(),
    status: text("status", { enum: ["ok", "error"] }).notNull(),
    durationMs: integer("duration_ms").notNull(),
    errorCode: text("error_code"),
    /** OAuth client that made the call, so a user can tell Claude from ChatGPT. */
    clientId: text("client_id"),
    createdAt: createdAt(),
  },
  (table) => [
    index("tool_calls_user_created").on(table.userId, table.createdAt),
    index("tool_calls_project_created").on(table.projectId, table.createdAt),
  ],
);

export type User = typeof users.$inferSelect;
export type Device = typeof devices.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type ToolCall = typeof toolCalls.$inferSelect;
