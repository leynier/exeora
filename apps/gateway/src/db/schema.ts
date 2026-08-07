import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * Everything hangs off `userId`. Plans and limits live on the user row; there
 * is still no billing in this release. The schema is multi-tenant from day one
 * so adding organisations later does not require rewriting ownership checks.
 */

const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`);

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  /**
   * Which plan this account is on. There is no billing yet, so the column is
   * a default everyone shares and a place for enforcement to look. Changing
   * it by hand is how a person is moved onto Pro until payments exist.
   */
  plan: text("plan", { enum: ["free", "pro"] })
    .notNull()
    .default("free"),
  createdAt: createdAt(),
});

/**
 * Allow-list of people who can open the administration panel.
 *
 * Keyed by email rather than user id so a person who deletes and recreates
 * their account keeps the privilege. Rows are written at registration time:
 * either the addresses named in `ADMIN_EMAILS`, or the first account to sign
 * in when that binding is unset. There is no endpoint that adds or removes a
 * row.
 */
export const adminUsers = sqliteTable("admin_users", {
  email: text("email").primaryKey(),
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
 * An MCP client that has been authorized to reach one project.
 *
 * A row is written when the user approves a consent screen covering that
 * project, which is the only moment we learn the client's registered name. It
 * is deliberately per project rather than per account: "Claude may read this
 * repository" has to be answerable one repository at a time.
 *
 * The authoritative record of access is the OAuth grant in KV; this table is
 * what makes it nameable, listable and revocable from the dashboard. On the
 * account endpoint it is more than that, because a token there is bound to
 * `/mcp` rather than to any one project: see `endpoint` below.
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
    /**
     * Which URL this access was granted through.
     *
     * `project` is a token bound by audience to `/p/:id/mcp`, so the row is
     * bookkeeping and the token is the authority. `account` is a token bound to
     * `/mcp`, which names no project at all, so there the row **is** the
     * authority and a call to a project without one is refused.
     *
     * The two are kept apart rather than merged into one access list because
     * they are two different consents. Authorizing Claude on one project's URL
     * and later authorizing it on the account URL without ticking that project
     * are two answers to two questions, and a merged list would silently make
     * the first answer the second one too.
     */
    endpoint: text("endpoint", { enum: ["project", "account"] })
      .notNull()
      .default("project"),
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
    uniqueIndex("project_clients_project_client_endpoint").on(
      table.projectId,
      table.clientId,
      table.endpoint,
    ),
    index("project_clients_user").on(table.userId),
  ],
);

/**
 * Which project a client is currently working in, on the account endpoint.
 *
 * One per user per client, which is the granularity the endpoint can actually
 * offer: `/mcp` is stateless, and the clients most people use still speak the
 * 2025 protocol and carry nothing across requests, so there is no session to
 * hang this on and it has to be stored. The cost is that two conversations open
 * in the same client share one selection and can move each other; the `project`
 * argument the account endpoint adds to every tool is the way out of that for a
 * single call.
 *
 * `onDelete: "cascade"` on the project matters: deleting a project must not
 * leave a client pointed at a row that is no longer there.
 */
export const activeProjects = sqliteTable(
  "active_projects",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    clientId: text("client_id").notNull(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [uniqueIndex("active_projects_user_client").on(table.userId, table.clientId)],
);

/**
 * Daily rollup of tool calls per account.
 *
 * Survives the audit-log prune: the row-level trail is retention-limited, but
 * "how much did this account use last month" has to outlive that. Written by
 * the nightly cron from `tool_calls`, never on the request path.
 *
 * `day` is a UTC calendar day as `YYYY-MM-DD`. Counting happens in the cron
 * rather than on every call so the hot path stays one insert into `tool_calls`.
 */
export const usageDaily = sqliteTable(
  "usage_daily",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    day: text("day").notNull(),
    toolCalls: integer("tool_calls").notNull().default(0),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.day] })],
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
export type AdminUser = typeof adminUsers.$inferSelect;
export type Device = typeof devices.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type ProjectClient = typeof projectClients.$inferSelect;
export type ClientEndpoint = ProjectClient["endpoint"];
export type ActiveProject = typeof activeProjects.$inferSelect;
export type ToolCall = typeof toolCalls.$inferSelect;
export type UsageDaily = typeof usageDaily.$inferSelect;
export type UserPlan = User["plan"];
