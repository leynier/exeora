import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { devices, projects, users } from "./schema.js";

/**
 * Where a project lives.
 *
 * A project is one repository, and it can be on several machines at once: a
 * laptop, a desktop, Exeora Cloud. Each is a row here. `projects.device_id`
 * names the default among them, which is where a call that names no workspace
 * goes; a workspace carries its own machine and goes there.
 *
 * Kept beside `schema.ts` for the same reason as `schema-cloud.ts`: that file
 * is at its length limit, and `client.ts` merges them into one object.
 */

export const LOCATION_KINDS = ["local", "cloud"] as const;
export type LocationKind = (typeof LOCATION_KINDS)[number];

/**
 * `pending` is a machine that was chosen and has no copy yet: the first
 * workspace made there clones the repository. `cloning` is that clone under
 * way, `ready` is a copy that can serve, `error` is a clone that failed.
 */
export const LOCATION_STATUSES = ["pending", "cloning", "ready", "error"] as const;
export type LocationStatus = (typeof LOCATION_STATUSES)[number];

const stamp = (name: string) =>
  integer(name, { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`);

export const projectLocations = sqliteTable(
  "project_locations",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: LOCATION_KINDS }).notNull().default("local"),
    /**
     * The machine. For Exeora Cloud it is the machine holding the project
     * root there, and null while Cloud only holds workspaces: each of those is
     * a machine of its own and none of them is the location's.
     */
    deviceId: text("device_id").references(() => devices.id, { onDelete: "cascade" }),
    /** Where the copy is on that machine. Display only, like `projects.local_path`. */
    localPath: text("local_path"),
    status: text("status", { enum: LOCATION_STATUSES }).notNull().default("ready"),
    /** Why the clone failed, as a sentence to act on. */
    error: text("error"),
    errorCode: text("error_code"),
    createdAt: stamp("created_at"),
    updatedAt: stamp("updated_at"),
  },
  (table) => [
    uniqueIndex("project_locations_project_device").on(table.projectId, table.deviceId),
    // One Cloud per project. The index above cannot say it, since a Cloud
    // location with no root machine has no device to be unique on.
    uniqueIndex("project_locations_cloud").on(table.projectId).where(sql`kind = 'cloud'`),
    index("project_locations_device").on(table.deviceId),
    index("project_locations_user").on(table.userId),
  ],
);
