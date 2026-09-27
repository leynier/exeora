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
    /**
     * Addresses the repository had before it was renamed or moved, as a JSON
     * array, oldest first. A machine that cloned from one of them holds the
     * same repository under its old name, and is let through to the new one
     * rather than refused as holding something else. Null until a rename.
     */
    previousRepoUrls: text("previous_repo_urls"),
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
    /**
     * What is being removed: the whole `project`, or only its Cloud
     * `location`, which leaves the project where else it lives. Read only
     * while `deletingAt` is set.
     */
    deletingScope: text("deleting_scope", { enum: ["project", "location"] })
      .notNull()
      .default("project"),
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
    /** Why provisioning stopped, when `status` is `error`: a sentence to act on. */
    error: text("error"),
    /** The kind of failure, which is what decides the action offered next to it. */
    errorCode: text("error_code"),
    /** What the machine itself said, kept for when the sentence is not enough. */
    errorDetail: text("error_detail"),
    /**
     * The ref a workspace branch was asked to start from, kept here so a
     * retry starts it there too, even one after the first hand-off to the
     * machine's object never stored anything. Null for the main machine.
     */
    createdFrom: text("created_from"),
    /**
     * The last run of each of the project's scripts on this machine, as
     * `CloudHookRun` JSON. They are what happened after the machine was made,
     * so they never touch `status`: a machine whose install script failed is
     * a machine that is ready and has something to say.
     */
    installHook: text("install_hook"),
    resumeHook: text("resume_hook"),
    /** What the machine came with and what was added to it, as `ToolsReport` JSON. */
    toolsReport: text("tools_report"),
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

/**
 * The scripts a project runs in its instances, as written on its page.
 *
 * On the project rather than on its Cloud row, which goes when the project is
 * taken off Exeora Cloud: somebody who puts it back should find what they
 * wrote. Null is no script, which leaves the file in the repository to run.
 */
export const projectCloudScripts = sqliteTable(
  "project_cloud_scripts",
  {
    projectId: text("project_id")
      .primaryKey()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    installScript: text("install_script"),
    resumeScript: text("resume_script"),
    /**
     * Whether the files in the repository may run. They are not tool calls,
     * so the project's policy and approvals do not reach them: whoever can
     * push to the branch runs code in the instance. This is how that is
     * switched off without giving up the scripts written on the page.
     */
    runRepositoryScripts: integer("run_repository_scripts", { mode: "boolean" })
      .notNull()
      .default(true),
    updatedAt: stamp("updated_at"),
  },
  (table) => [index("project_cloud_scripts_user").on(table.userId)],
);

export type CloudProject = typeof cloudProjects.$inferSelect;
export type CloudMachine = typeof cloudMachines.$inferSelect;
