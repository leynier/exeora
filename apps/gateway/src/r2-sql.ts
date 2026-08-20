import "./env.js";

/**
 * The read side of the audit archive.
 *
 * R2 SQL answers `SELECT` and nothing else: no `INSERT`, `UPDATE` or `DELETE`,
 * and no `OFFSET`. Both absences shape everything built on this module. Rows
 * leave the table only through a maintenance job committing a transaction to
 * the catalog, and paging has to be keyset rather than offset-based.
 *
 * Extracted from the nightly rollup so Activity can ask the same archive the
 * same way. The two differ in the query they send and in nothing else, which
 * is the point of the split: one place knows the endpoint, the credentials and
 * the failure shapes.
 */

/** R2 SQL's maximum LIMIT; the engine defaults to 500 when omitted. */
export const R2_SQL_PAGE_SIZE = 10_000;

export interface WarehouseConfig {
  accountId: string;
  bucket: string;
  warehouse: string;
  table: string;
  legacyTable?: string;
  token: string;
  startDay: string;
}

interface QueryResponse {
  success: boolean;
  result?: { rows?: Record<string, unknown>[] };
  errors?: { message?: string }[];
}

type WarehouseEnv = Pick<
  Env,
  | "CLOUDFLARE_ACCOUNT_ID"
  | "AUDIT_R2_BUCKET"
  | "AUDIT_R2_WAREHOUSE"
  | "AUDIT_R2_SQL_TOKEN"
  | "AUDIT_R2_TABLE"
  | "AUDIT_R2_LEGACY_TABLE"
  | "AUDIT_WAREHOUSE_START_DAY"
>;

/**
 * Resolves and validates the archive's coordinates.
 *
 * Throws rather than returning null: every caller needs all six values, and a
 * half-configured archive read as an empty one would report zero usage for an
 * account that has been busy, which is worse than a loud failure.
 */
export function warehouseConfig(env: WarehouseEnv): WarehouseConfig {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const bucket = env.AUDIT_R2_BUCKET;
  const warehouse = env.AUDIT_R2_WAREHOUSE;
  const token = env.AUDIT_R2_SQL_TOKEN;
  const startDay = env.AUDIT_WAREHOUSE_START_DAY;
  const table = env.AUDIT_R2_TABLE ?? "default.tool_calls";
  const legacyTable = env.AUDIT_R2_LEGACY_TABLE;

  if (!accountId || !bucket || !warehouse || !token || !startDay) {
    throw new Error("R2 SQL usage rollup is not configured");
  }
  if (!validDay(startDay)) throw new Error("AUDIT_WAREHOUSE_START_DAY must be YYYY-MM-DD");
  // The table name is interpolated into every query, so it is checked here
  // rather than trusted: it is the one part of the SQL that comes from config.
  if (!/^[a-zA-Z_][\w]*(\.[a-zA-Z_][\w]*)?$/.test(table)) {
    throw new Error("AUDIT_R2_TABLE must be namespace.table");
  }
  if (legacyTable && !/^[a-zA-Z_][\w]*(\.[a-zA-Z_][\w]*)?$/.test(legacyTable)) {
    throw new Error("AUDIT_R2_LEGACY_TABLE must be namespace.table");
  }

  return {
    accountId,
    bucket,
    warehouse,
    table,
    token,
    startDay,
    ...(legacyTable ? { legacyTable } : {}),
  };
}

export function auditSource(config: WarehouseConfig, includeWorktree: boolean): string {
  const current = includeWorktree
    ? `SELECT id, user_id, project_id, worktree_id, worktree_slug, tool, status, duration_ms, error_code, client_id, client_name, endpoint, created_at FROM ${config.table}`
    : `SELECT id, user_id, project_id, tool, status, duration_ms, error_code, client_id, client_name, endpoint, created_at FROM ${config.table}`;
  if (!config.legacyTable) return `(${current}) AS audit_events`;
  const legacy = includeWorktree
    ? `SELECT id, user_id, project_id, NULL AS worktree_id, NULL AS worktree_slug, tool, status, duration_ms, error_code, client_id, client_name, endpoint, created_at FROM ${config.legacyTable}`
    : `SELECT id, user_id, project_id, tool, status, duration_ms, error_code, client_id, client_name, endpoint, created_at FROM ${config.legacyTable}`;
  return `(${current} UNION ALL ${legacy}) AS audit_events`;
}

/** Runs one statement and returns its rows untyped, for the caller to validate. */
export async function runQuery(
  config: WarehouseConfig,
  query: string,
  fetcher: typeof fetch,
): Promise<Record<string, unknown>[]> {
  const response = await fetcher(
    `https://api.sql.cloudflarestorage.com/api/v1/accounts/${encodeURIComponent(config.accountId)}/r2-sql/query/${encodeURIComponent(config.bucket)}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ warehouse: config.warehouse, query }),
    },
  );

  const body = (await response.json()) as QueryResponse;
  if (!response.ok || !body.success) {
    throw new Error(body.errors?.[0]?.message ?? `R2 SQL returned ${response.status}`);
  }
  // An absent `rows` is not an empty result: it means the response did not have
  // the shape this code reads, and treating it as "no data" would silently
  // report an empty archive.
  if (!body.result?.rows) {
    throw new Error("R2 SQL returned an incomplete response");
  }

  return body.result.rows;
}

/** Single-quoted literal, for the values interpolated into a query. */
export function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function validDay(day: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && utcDay(new Date(`${day}T00:00:00.000Z`)) === day;
}

export function addUtcDays(day: string, amount: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return utcDay(date);
}

/**
 * An Iceberg timestamp as epoch milliseconds, or null if it cannot be read.
 *
 * The value reaches JSON either as an ISO string or as an integer, and the
 * integer's unit is not part of the response. `new Date(String(n))` is an
 * Invalid Date for every one of those integers, so the numeric form is read
 * directly and its unit settled against a window the query already guarantees
 * the value falls inside.
 */
export function epochMsWithin(value: unknown, from: number, to: number): number | null {
  if (typeof value !== "number") {
    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? parsed : null;
  }

  for (const candidate of [value, value / 1_000, value * 1_000]) {
    if (candidate >= from && candidate < to) return Math.floor(candidate);
  }
  return null;
}
