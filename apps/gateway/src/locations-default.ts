import "./env.js";

/**
 * Moving a project's default location off a machine that is going away.
 *
 * `projects.device_id` cascades on delete, which is right for a project that
 * lives on one machine and wrong for one that lives on several: losing the
 * laptop must not take a project that is also on the desktop. These run in the
 * same batch as the deletion, ahead of it.
 *
 * The next default is a location whose machine still stands, a copy that is
 * ready before one that is not, the user's own machine before Exeora Cloud,
 * the oldest first. A project marked for removal is skipped, so the cascade
 * still takes what was meant to go.
 */
export function moveDefaultLocationStatements(
  env: Pick<Env, "DB">,
  userId: string,
  deviceId: string,
): D1PreparedStatement[] {
  const next = (column: "device_id" | "local_path") => `
    SELECT l.${column}
      FROM project_locations l
      JOIN devices d ON d.id = l.device_id
     WHERE l.project_id = projects.id
       AND l.device_id != ?2
       AND d.revoked_at IS NULL
     ORDER BY (l.status = 'ready') DESC, (l.kind = 'local') DESC, l.created_at
     LIMIT 1`;

  return [
    pinLegacyWorkspacesStatement(env, userId, deviceId),
    env.DB.prepare(
      `UPDATE projects
          SET local_path = COALESCE((${next("local_path")}), local_path),
              device_id = (${next("device_id")})
        WHERE user_id = ?1
          AND device_id = ?2
          AND EXISTS (${next("device_id")})
          AND NOT EXISTS (
            SELECT 1 FROM cloud_projects c
             WHERE c.project_id = projects.id
               AND c.deleting_at IS NOT NULL
               AND c.deleting_scope = 'project'
          )`,
    ).bind(userId, deviceId),
    // Exeora Cloud outlives the machine that held its root: the location row
    // would otherwise go with the device, and the workspaces there with it.
    env.DB.prepare(
      `UPDATE project_locations
          SET device_id = NULL, local_path = NULL, updated_at = unixepoch() * 1000
        WHERE user_id = ?1 AND device_id = ?2 AND kind = 'cloud'
          AND EXISTS (SELECT 1 FROM projects p WHERE p.id = project_locations.project_id AND p.device_id != ?2)`,
    ).bind(userId, deviceId),
  ];
}

/**
 * Workspaces older than locations carry no machine and read as the default's.
 * Before the default moves they are given the machine they have been on all
 * along, so they stay there instead of following the default to a machine
 * that never held them.
 */
export function pinLegacyWorkspacesStatement(
  env: Pick<Env, "DB">,
  userId: string,
  deviceId: string,
): D1PreparedStatement {
  return env.DB.prepare(
    `UPDATE workspaces
        SET device_id = ?2
      WHERE device_id IS NULL
        AND project_id IN (SELECT id FROM projects WHERE user_id = ?1 AND device_id = ?2)`,
  ).bind(userId, deviceId);
}
