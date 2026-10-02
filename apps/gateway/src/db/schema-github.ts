import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { projects, users } from "./schema.js";

/**
 * An account's connection to GitHub, through the Exeora GitHub App.
 *
 * Nothing here can clone anything by itself. What is stored is who may ask:
 * which installations an account was shown by GitHub, and which of its
 * projects is which repository. The tokens that clone are minted on demand
 * from the app's key, live an hour and are never written down.
 *
 * Kept beside `schema.ts` for the same reason as `schema-cloud.ts`: that file
 * is at its length limit, and `client.ts` merges them into one object.
 */

export const GITHUB_ACCOUNT_TYPES = ["User", "Organization"] as const;
export type GitHubAccountType = (typeof GITHUB_ACCOUNT_TYPES)[number];

export const GITHUB_REPOSITORY_SELECTIONS = ["all", "selected"] as const;
export type GitHubRepositorySelection = (typeof GITHUB_REPOSITORY_SELECTIONS)[number];

const stamp = (name: string) =>
  integer(name, { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`);

/**
 * One row per account and installation. An organisation installs the app
 * once and every member who connects sees that same installation, so the
 * installation id repeats across accounts and is unique only within one.
 */
export const githubInstallations = sqliteTable(
  "github_installations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** GitHub's id for the installation, which is what its API is asked with. */
    installationId: integer("installation_id").notNull(),
    /** The person or organisation the app is installed on. */
    accountLogin: text("account_login").notNull(),
    accountType: text("account_type", { enum: GITHUB_ACCOUNT_TYPES }).notNull(),
    repositorySelection: text("repository_selection", { enum: GITHUB_REPOSITORY_SELECTIONS })
      .notNull()
      .default("selected"),
    /** Set while the account's owner has the app suspended: GitHub mints nothing for it. */
    suspendedAt: integer("suspended_at", { mode: "timestamp_ms" }),
    /**
     * What the installation has granted the app, as GitHub's own JSON. The
     * app may ask for more than an installation has accepted yet, and this is
     * how the dashboard knows to say so. Null until GitHub has said.
     */
    permissions: text("permissions"),
    createdAt: stamp("created_at"),
    updatedAt: stamp("updated_at"),
  },
  (table) => [
    uniqueIndex("github_installations_user_installation").on(table.userId, table.installationId),
    // A webhook names the installation and nothing else, and has to reach
    // every account that holds it.
    index("github_installations_installation").on(table.installationId),
  ],
);

/** Which repository a project is, for the projects that were connected. */
export const githubRepositories = sqliteTable(
  "github_repositories",
  {
    projectId: text("project_id")
      .primaryKey()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    installationId: integer("installation_id").notNull(),
    /** GitHub's id for the repository, which survives a rename and a transfer. */
    repoId: integer("repo_id").notNull(),
    fullName: text("full_name").notNull(),
    private: integer("private", { mode: "boolean" }).notNull().default(false),
    /**
     * Set when the repository left the installation, was deleted, or the
     * installation itself went away. The row stays, so the dashboard can say
     * what happened and the link comes back when the access does.
     */
    lostAccessAt: integer("lost_access_at", { mode: "timestamp_ms" }),
    createdAt: stamp("created_at"),
    updatedAt: stamp("updated_at"),
  },
  (table) => [
    index("github_repositories_user").on(table.userId),
    index("github_repositories_repo").on(table.repoId),
    index("github_repositories_installation").on(table.installationId),
  ],
);

/**
 * The person on GitHub behind an account, and the token that speaks as them.
 *
 * An installation reaches every repository it was given, and the person who
 * connected may reach only some of those. What they may list, link and clone
 * is therefore asked of GitHub as them, with this token, and never as the
 * installation alone. Everything secret here is encrypted under
 * `CLOUD_CREDENTIALS_KEY`, without which the connection is off.
 */
export const githubUserTokens = sqliteTable("github_user_tokens", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  /**
   * Null once GitHub stopped accepting the token and it could not be
   * renewed: the account has to connect again, and until then reaches
   * nothing through GitHub.
   */
  accessCiphertext: text("access_ciphertext"),
  /** Null for an app whose user tokens do not expire. */
  accessExpiresAt: integer("access_expires_at", { mode: "timestamp_ms" }),
  /** Null for an app whose user tokens do not expire, which is given none. */
  refreshCiphertext: text("refresh_ciphertext"),
  login: text("login").notNull(),
  /**
   * GitHub's id for the person, which is what a webhook about them is
   * matched on: a login can be changed, and then taken by somebody else.
   * Null on rows stored before it was kept.
   */
  githubUserId: integer("github_user_id"),
  updatedAt: stamp("updated_at"),
});

export type GitHubInstallation = typeof githubInstallations.$inferSelect;
export type GitHubRepository = typeof githubRepositories.$inferSelect;
