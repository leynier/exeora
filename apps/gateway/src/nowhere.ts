import "./env.js";

/**
 * Where a project is kept while it lives nowhere.
 *
 * A project is a repository, and it outlives the last machine that held a
 * copy of it: its address, its policy and the clients let into it belong to
 * the account, not to a machine. `projects.device_id` cannot be empty, and
 * SQLite cannot be told otherwise without making the table again, which would
 * take every row that hangs off a project with it. So an account has one
 * machine that is no machine. Nothing connects as it, because it is made
 * revoked; nothing lists it, because it is of a kind of its own; and a
 * project whose machine is this one has no default location until it is given
 * a place to live again.
 *
 * Its id is made from the account's, so a statement can name it without
 * reading it first.
 */

export const NOWHERE_KIND = "none";

const PREFIX = "dev_none_";

export function nowhereId(userId: string): string {
  return `${PREFIX}${userId.replace(/^usr_/, "")}`;
}

/** Whether a machine is the one that stands for no machine. */
export function isNowhere(deviceId: string | null | undefined): boolean {
  return deviceId?.startsWith(PREFIX) ?? false;
}

/** Makes the account's one, when it has none yet. */
export function nowhereStatement(env: Pick<Env, "DB">, userId: string): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT OR IGNORE INTO devices (id, user_id, name, platform, kind, revoked_at)
     VALUES (?1, ?2, 'nowhere', 'none', ?3, ?4)`,
  ).bind(nowhereId(userId), userId, NOWHERE_KIND, Date.now());
}
