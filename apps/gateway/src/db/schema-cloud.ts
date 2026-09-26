import { CLOUD_MACHINE_STATUSES } from "@exeora/protocol";
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { devices, projects, users, workspaces } from "./schema.js";

/**
 * Exeora Cloud: projects whose workspaces are machines Exeora provisions.
 *
 * Kept beside `schema.ts` rather than inside it only because that file is at
 * its length limit. Both are merged into one schema object in `client.ts`, so
 * queries join across them freely.
 *
 * A cloud project is an ordinary `projects` row plus a row here. Its machines
 * are ordinary `devices` rows (kind `cloud`) plus a row here each: the main
 * machine is the project's own `device_id` and has no workspace row, every
 * other machine is one `workspaces` row whose `device_id` points at it.
 */

const stamp = (name: string) =>
  integer(name, { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`);

export const cloudProjects = sqliteTable(
  "cloud_projects",
  {
    projectId: text("project_id")
      .primaryKey()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** HTTPS clone URL. Every machine of the project clones this. */
    repoUrl: text("repo_url").notNull(),
    /** The branch the main machine checks out and new workspaces branch from. */
    defaultBranch: text("default_branch").notNull(),
    /**
     * An access token for a private repository, encrypted under
     * `CLOUD_CREDENTIALS_KEY` and decrypted only while a machine is being
     * bootstrapped. Stored so a workspace created months later can still
     * clone; deleted with the project. Null for a public repository.
     */
    credentialUsername: text("credential_username"),
    credentialCiphertext: text("credential_ciphertext"),
    /**
     * Set the moment the project's removal is accepted, before its machines
     * are enumerated: a workspace asked for after this would be a machine
     * the removal never saw, left behind with its slot on the plan.
     */
    deletingAt: integer("deleting_at", { mode: "timestamp_ms" }),
    createdAt: stamp("created_at"),
    updatedAt: stamp("updated_at"),
  },
  (table) => [index("cloud_projects_user").on(table.userId)],
);

export const cloudMachines = sqliteTable(
  "cloud_machines",
  {
    deviceId: text("device_id")
      .primaryKey()
      .references(() => devices.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** Null for the main machine, which serves the project root. */
    workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    /** The Sprite's name at the provider, unique within the organisation. */
    spriteName: text("sprite_name").notNull(),
    /** The Sprite's URL once created; the relay fetches it to wake the machine. */
    spriteUrl: text("sprite_url"),
    /**
     * SHA-256 of the machine token the CLI presents on its relay socket. One
     * token per machine, replaced on retry, gone with the row.
     */
    tokenHash: text("token_hash"),
    status: text("status", { enum: CLOUD_MACHINE_STATUSES }).notNull().default("creating"),
    /** What provisioning is doing right now, for the dashboard. */
    step: text("step"),
    /** Why provisioning stopped, when `status` is `error`. */
    error: text("error"),
    /**
     * The ref a workspace branch was asked to start from, kept here so a
     * retry starts it there too, even one after the first hand-off to the
     * machine's object never stored anything. Null for the main machine.
     */
    createdFrom: text("created_from"),
    createdAt: stamp("created_at"),
    updatedAt: stamp("updated_at"),
    readyAt: integer("ready_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("cloud_machines_sprite").on(table.spriteName),
    uniqueIndex("cloud_machines_token").on(table.tokenHash),
    uniqueIndex("cloud_machines_workspace").on(table.workspaceId),
    index("cloud_machines_project").on(table.projectId),
    index("cloud_machines_user_status").on(table.userId, table.status),
  ],
);

export type CloudProject = typeof cloudProjects.$inferSelect;
export type CloudMachine = typeof cloudMachines.$inferSelect;
