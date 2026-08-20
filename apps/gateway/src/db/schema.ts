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

/** Revocable browser login sessions used only by the OAuth consent UI. */
export const browserSessions = sqliteTable(
  "browser_sessions",
  {
    /** HMAC of the opaque cookie value; the bearer value itself is never stored. */
    idHash: text("id_hash").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
  },
  (table) => [
    index("browser_sessions_user_expiry").on(table.userId, table.expiresAt),
    index("browser_sessions_expiry").on(table.expiresAt),
  ],
);

/** One-time OAuth requests parked while the browser visits an identity provider. */
export const oauthPending = sqliteTable(
  "oauth_pending",
  {
    state: text("state").primaryKey(),
    payload: text("payload").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("oauth_pending_expiry").on(table.expiresAt)],
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
    /**
     * When the relay last saw this machine's socket close, and null while it
     * believes one is open.
     *
     * `lastSeenAt` alone cannot answer presence: it is checkpointed every
     * `PRESENCE_CHECKPOINT_INTERVAL_MS`, so the window that reads it has to be
     * wider than that interval, and a machine that disconnected cleanly would
     * keep reading online until the window passed. A close is a fact the relay
     * knows immediately, so it is recorded rather than inferred. The window
     * still covers the disconnects nobody witnessed: a crash, a dropped
     * network, an evicted Durable Object.
     */
    disconnectedAt: integer("disconnected_at", { mode: "timestamp_ms" }),
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

/** Git worktrees exposed as routable subspaces of one project. */
export const worktrees = sqliteTable(
  "worktrees",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    branch: text("branch"),
    /** Display and reconciliation metadata only; the executor resolves the trusted local root. */
    localPath: text("local_path").notNull(),
    managed: integer("managed", { mode: "boolean" }).notNull().default(false),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("worktrees_project_slug").on(table.projectId, table.slug),
    index("worktrees_project").on(table.projectId),
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
 * Daily rollup of tool calls per account.
 *
 * Survives the archive's retention: the row-level trail is retention-limited,
 * but "how much did this account use last month" has to outlive that. Written by
 * the nightly cron from the Iceberg archive, never on the request path.
 *
 * `day` is a UTC calendar day as `YYYY-MM-DD`. Counting happens in the cron
 * rather than on every call; the request path only writes the bounded producer
 * outbox that makes delivery recoverable.
 */
export const usageDaily = sqliteTable(
  "usage_daily",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    day: text("day").notNull(),
    toolCalls: integer("tool_calls").notNull().default(0),
    errors: integer("errors").notNull().default(0),
    lastActivityAt: integer("last_activity_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.day] })],
);

/** Durable checkpoint for replaying late warehouse events idempotently. */
export const usageRollupState = sqliteTable("usage_rollup_state", {
  source: text("source").primaryKey(),
  lastCompleteDay: text("last_complete_day").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

/**
 * Durable producer-side audit outbox.
 *
 * A row is inserted before a tool can touch the executor. Pipeline delivery is
 * at-least-once; `id` is stable across retries and warehouse queries deduplicate
 * it. There are deliberately no foreign keys: deletion may remove the account
 * while an already-started call is being reconciled.
 */
export const auditOutbox = sqliteTable(
  "audit_outbox",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    projectId: text("project_id").notNull(),
    worktreeId: text("worktree_id"),
    worktreeSlug: text("worktree_slug"),
    tool: text("tool").notNull(),
    status: text("status", { enum: ["ok", "error"] }),
    durationMs: integer("duration_ms"),
    errorCode: text("error_code"),
    clientId: text("client_id"),
    clientName: text("client_name"),
    endpoint: text("endpoint", { enum: ["project", "account", "dashboard"] }).notNull(),
    readyAt: integer("ready_at", { mode: "timestamp_ms" }),
    acceptedAt: integer("accepted_at", { mode: "timestamp_ms" }),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: integer("next_attempt_at", { mode: "timestamp_ms" }).notNull(),
    leaseToken: text("lease_token"),
    leaseUntil: integer("lease_until", { mode: "timestamp_ms" }),
    lastError: text("last_error"),
    createdAt: createdAt(),
  },
  (table) => [
    index("audit_outbox_delivery").on(table.acceptedAt, table.nextAttemptAt),
    index("audit_outbox_started").on(table.status, table.createdAt),
    index("audit_outbox_user_project").on(table.userId, table.projectId),
  ],
);

/**
 * Rows the archive still has to forget.
 *
 * The audit trail lives in an append-only Iceberg table that the Worker cannot
 * delete from: R2 SQL is read-only, so a row only goes when a maintenance job
 * commits a transaction through the catalog. Deletion is therefore not one
 * statement but an intent recorded here and drained later.
 *
 * Deliberately no foreign key to `users`. `deleteAccount` removes the user row
 * and the cascade would take this row with it, erasing the very instruction to
 * erase. `target_id` is a bare string for the same reason: it has to outlive
 * whatever it names.
 */
export const auditDeletions = sqliteTable(
  "audit_deletions",
  {
    id: text("id").primaryKey(),
    /**
     * What `target_id` names. A machine is not a scope of its own: the archive
     * has no device column, so deleting one enqueues its projects instead,
     * which the gateway can still enumerate at the moment of deletion.
     */
    scope: text("scope", { enum: ["user", "project"] }).notNull(),
    targetId: text("target_id").notNull(),
    requestedAt: integer("requested_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    /** Null until two successful catalog deletes have committed at least 24 hours apart. */
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
    /** Counted so a target that keeps failing can be found rather than retried forever. */
    attempts: integer("attempts").notNull().default(0),
    /** Two committed deletes catch events that were still in the Pipeline when erasure began. */
    successfulPasses: integer("successful_passes").notNull().default(0),
    nextAttemptAt: integer("next_attempt_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    leaseToken: text("lease_token"),
    leaseUntil: integer("lease_until", { mode: "timestamp_ms" }),
    lastError: text("last_error"),
  },
  (table) => [
    index("audit_deletions_pending").on(table.completedAt, table.nextAttemptAt),
    uniqueIndex("audit_deletions_target").on(table.scope, table.targetId),
  ],
);

export type User = typeof users.$inferSelect;
export type AdminUser = typeof adminUsers.$inferSelect;
export type Device = typeof devices.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Worktree = typeof worktrees.$inferSelect;
export type ProjectClient = typeof projectClients.$inferSelect;
export type ClientEndpoint = ProjectClient["endpoint"];
export type UsageDaily = typeof usageDaily.$inferSelect;
export type AuditDeletion = typeof auditDeletions.$inferSelect;
export type AuditDeletionScope = AuditDeletion["scope"];
export type AuditOutbox = typeof auditOutbox.$inferSelect;
export type UserPlan = User["plan"];
