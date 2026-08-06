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
    /**
     * What an agent is allowed to do here, as `CommandPolicy` JSON from
     * `@exeora/protocol`. Null means the project predates the setting, which
     * reads as `allow_all`: turning a policy on is always a decision someone
     * made, never something that happened to a project on its own.
     *
     * JSON in one column rather than three, because it is read and written
     * whole, never queried by its parts, and the shape is versioned by the
     * schema in the shared package rather than by a migration.
     */
    commandPolicy: text("command_policy"),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("projects_user_slug").on(table.userId, table.slug),
    index("projects_device").on(table.deviceId),
  ],
);

/**
 * An MCP client that has been authorized against one project's endpoint.
 *
 * A row is written when the user approves a consent screen naming that project,
 * which is the only moment we learn the client's registered name. It is
 * deliberately per project rather than per account: a token here is bound to
 * one endpoint, so "Claude may read this repository" has to be answerable one
 * repository at a time.
 *
 * The authoritative record of access is the OAuth grant in KV; this table is
 * what makes it nameable, listable and revocable from the dashboard.
 */
export const projectClients = sqliteTable(
  "project_clients",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** Opaque when the client registered through DCR; a metadata URL under CIMD. */
    clientId: text("client_id").notNull(),
    /** RFC 7591 `client_name`, copied here so no tool call has to read KV. */
    clientName: text("client_name"),
    clientUri: text("client_uri"),
    /**
     * MCP's own `clientInfo`. Learned from the per-request envelope on
     * 2026-07-28 clients and from the `initialize` handshake on 2025-era ones,
     * so it stays null until a client actually connects.
     */
    mcpName: text("mcp_name"),
    mcpVersion: text("mcp_version"),
    /** Refreshed every time consent is granted again, which also clears `revokedAt`. */
    authorizedAt: integer("authorized_at", { mode: "timestamp_ms" }).notNull(),
    lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
    /** Set when revoked from the dashboard; the MCP endpoint refuses the call after. */
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("project_clients_project_client").on(table.projectId, table.clientId),
    index("project_clients_user").on(table.userId),
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
    /**
     * That client's name at the time of the call, denormalised on purpose: the
     * activity log spans every project, and this keeps it readable with one
     * query and no join, even after the client has been removed.
     */
    clientName: text("client_name"),
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
export type ProjectClient = typeof projectClients.$inferSelect;
export type ToolCall = typeof toolCalls.$inferSelect;
