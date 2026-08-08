import { eq } from "drizzle-orm";
import { observeD1 } from "./cost-metrics.js";
import { db, schema } from "./db/client.js";
import "./env.js";

const REPLAY_DAYS = 3;
const MAX_CATCHUP_DAYS = 31;
const USERS_PER_STATEMENT = 500;
/** R2 SQL's maximum LIMIT; the engine defaults to 500 when omitted. */
const R2_SQL_PAGE_SIZE = 10_000;
const R2_SQL_MAX_PAGES = 100;

interface WarehouseConfig {
  accountId: string;
  bucket: string;
  warehouse: string;
  table: string;
  token: string;
  startDay: string;
}

interface QueryResponse {
  success: boolean;
  result?: { rows?: Record<string, unknown>[] };
  errors?: { message?: string }[];
}

export interface WarehouseRollupResult {
  days: number;
  rows: number;
}

type DayCount = {
  userId: string;
  toolCalls: number;
  errors: number;
  lastActivityAt: number;
};

/**
 * Rebuilds complete UTC days from the Iceberg source of truth.
 *
 * Each day is upserted monotonically (`max` of counters and activity) so a
 * lagging or empty sink read cannot erase earlier `usage_daily` rows. The
 * checkpoint advances only after a successful full read. The last three days
 * are deliberately replayed for events that reached the sink late.
 */
export async function rollupUsageDailyFromWarehouse(
  env: Pick<Env, "DB">,
  options: {
    config?: WarehouseConfig;
    fetcher?: typeof fetch;
    now?: Date;
    /** Override R2 SQL page size (tests only). */
    pageSize?: number;
  } = {},
): Promise<WarehouseRollupResult> {
  const config = options.config ?? warehouseConfig(env as Env);
  const source = sourceKey(config);
  const now = options.now ?? new Date();
  const yesterday = addUtcDays(utcDay(now), -1);
  const checkpoint = await db(env)
    .select({ day: schema.usageRollupState.lastCompleteDay })
    .from(schema.usageRollupState)
    .where(eq(schema.usageRollupState.source, source))
    .get();

  const days = daysToProcess(config.startDay, checkpoint?.day, yesterday);
  let rowsWritten = 0;
  let highWater = checkpoint?.day;

  for (const day of days) {
    const counts = await queryDay(config, day, options.fetcher ?? fetch, options.pageSize);
    if (!highWater || day > highWater) highWater = day;

    const statements = [
      // The `exists` guard is what drops rows for accounts that have since been
      // deleted, and it is asked of the index rather than of a `users` snapshot
      // read into memory: the whole point of this path is an account list too
      // large to page through, and that read is capped by D1's response size.
      ...chunks(counts, USERS_PER_STATEMENT).map((rows) =>
        env.DB.prepare(
          `INSERT INTO usage_daily (user_id, day, tool_calls, errors, last_activity_at)
           SELECT
             json_extract(value, '$.userId'),
             ?2,
             json_extract(value, '$.toolCalls'),
             json_extract(value, '$.errors'),
             json_extract(value, '$.lastActivityAt')
           FROM json_each(?1)
           WHERE exists (select 1 from users where users.id = json_extract(value, '$.userId'))
           ON CONFLICT(user_id, day) DO UPDATE SET
             tool_calls = max(usage_daily.tool_calls, excluded.tool_calls),
             errors = max(usage_daily.errors, excluded.errors),
             last_activity_at = max(coalesce(usage_daily.last_activity_at, 0), excluded.last_activity_at)`,
        ).bind(JSON.stringify(rows), day),
      ),
      env.DB.prepare(
        `INSERT INTO usage_rollup_state (source, last_complete_day, updated_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(source) DO UPDATE SET
           last_complete_day = excluded.last_complete_day,
           updated_at = excluded.updated_at`,
      ).bind(source, highWater, Date.now()),
    ];

    const results = await env.DB.batch(statements);
    const meta = results.reduce(
      (total, result) => ({
        rows_read: total.rows_read + (result.meta.rows_read ?? 0),
        rows_written: total.rows_written + (result.meta.rows_written ?? 0),
        changes: total.changes + (result.meta.changes ?? 0),
        duration: total.duration + (result.meta.duration ?? 0),
      }),
      { rows_read: 0, rows_written: 0, changes: 0, duration: 0 },
    );
    // Unsampled: the nightly run emits one point per day processed, so a
    // sampled key that is constant for a deployment would fire about once every
    // three years and the metric would never exist at all.
    observeD1(null, "usage.upsert", meta);
    // The upserts, not the checkpoint statement that closes the batch.
    rowsWritten += results
      .slice(0, -1)
      .reduce((total, result) => total + (result.meta.changes ?? 0), 0);
  }

  return { days: days.length, rows: rowsWritten };
}

function warehouseConfig(
  env: Pick<
    Env,
    | "CLOUDFLARE_ACCOUNT_ID"
    | "AUDIT_R2_BUCKET"
    | "AUDIT_R2_WAREHOUSE"
    | "AUDIT_R2_SQL_TOKEN"
    | "AUDIT_R2_TABLE"
    | "AUDIT_WAREHOUSE_START_DAY"
  >,
): WarehouseConfig {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const bucket = env.AUDIT_R2_BUCKET;
  const warehouse = env.AUDIT_R2_WAREHOUSE;
  const token = env.AUDIT_R2_SQL_TOKEN;
  const startDay = env.AUDIT_WAREHOUSE_START_DAY;
  const table = env.AUDIT_R2_TABLE ?? "default.tool_calls";

  if (!accountId || !bucket || !warehouse || !token || !startDay) {
    throw new Error("R2 SQL usage rollup is not configured");
  }
  if (!validDay(startDay)) throw new Error("AUDIT_WAREHOUSE_START_DAY must be YYYY-MM-DD");
  if (!/^[a-zA-Z_][\w]*(\.[a-zA-Z_][\w]*)?$/.test(table)) {
    throw new Error("AUDIT_R2_TABLE must be namespace.table");
  }

  return { accountId, bucket, warehouse, table, token, startDay };
}

async function queryDay(
  config: WarehouseConfig,
  day: string,
  fetcher: typeof fetch,
  pageSize = R2_SQL_PAGE_SIZE,
): Promise<DayCount[]> {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > R2_SQL_PAGE_SIZE) {
    throw new Error(`R2 SQL page size must be between 1 and ${R2_SQL_PAGE_SIZE}`);
  }

  const rows: DayCount[] = [];
  let afterUserId: string | undefined;

  for (let page = 0; page < R2_SQL_MAX_PAGES; page += 1) {
    const pageRows = await queryDayPage(config, day, fetcher, pageSize, afterUserId);
    rows.push(...pageRows);
    if (pageRows.length < pageSize) return rows;
    const cursor = pageRows.at(-1)?.userId;
    if (!cursor) throw new Error(`R2 SQL usage rollup for ${day} returned an empty full page`);
    afterUserId = cursor;
  }

  throw new Error(
    `R2 SQL usage rollup for ${day} exceeded ${R2_SQL_MAX_PAGES} pages of ${pageSize}`,
  );
}

async function queryDayPage(
  config: WarehouseConfig,
  day: string,
  fetcher: typeof fetch,
  pageSize: number,
  afterUserId: string | undefined,
): Promise<DayCount[]> {
  const end = addUtcDays(day, 1);
  const afterClause = afterUserId ? `\n  AND user_id > ${sqlString(afterUserId)}` : "";
  const query = `SELECT
  user_id,
  COUNT(*) AS tool_calls,
  SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors,
  MAX(created_at) AS last_activity_at
FROM ${config.table}
WHERE created_at >= '${day}T00:00:00.000Z'
  AND created_at < '${end}T00:00:00.000Z'${afterClause}
GROUP BY user_id
ORDER BY user_id
LIMIT ${pageSize}`;
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
  if (!body.result?.rows) {
    throw new Error("R2 SQL returned an incomplete usage response");
  }

  const dayStart = Date.parse(`${day}T00:00:00.000Z`);
  const dayEnd = Date.parse(`${end}T00:00:00.000Z`);

  return body.result.rows.map((row) => {
    const userId = row.user_id;
    const toolCalls = Number(row.tool_calls);
    const errors = Number(row.errors);
    const lastActivityAt = epochMsWithin(row.last_activity_at, dayStart, dayEnd);
    if (
      typeof userId !== "string" ||
      !Number.isSafeInteger(toolCalls) ||
      toolCalls < 0 ||
      !Number.isSafeInteger(errors) ||
      errors < 0 ||
      lastActivityAt === null
    ) {
      throw new Error("R2 SQL returned an invalid usage row");
    }
    return { userId, toolCalls, errors, lastActivityAt };
  });
}

/**
 * The queried day's `MAX(created_at)` as epoch milliseconds.
 *
 * An Iceberg timestamp reaches JSON either as an ISO string or as an integer,
 * and the integer's unit is not part of the response. `new Date(String(n))` is
 * an Invalid Date for every one of those integers, which would fail the rollup
 * for good, so the numeric form is read directly and its unit is settled by the
 * one fact this query guarantees: the value belongs to the day being read.
 */
function epochMsWithin(value: unknown, dayStart: number, dayEnd: number): number | null {
  if (typeof value !== "number") {
    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? parsed : null;
  }

  for (const candidate of [value, value / 1_000, value * 1_000]) {
    if (candidate >= dayStart && candidate < dayEnd) return Math.floor(candidate);
  }
  return null;
}

function daysToProcess(
  startDay: string,
  checkpoint: string | undefined,
  yesterday: string,
): string[] {
  if (startDay > yesterday) return [];

  const days: string[] = [];
  const catchupStart = checkpoint ? addUtcDays(checkpoint, 1) : startDay;
  let next = catchupStart;
  while (next <= yesterday && days.length < MAX_CATCHUP_DAYS) {
    days.push(next);
    next = addUtcDays(next, 1);
  }

  // Never jump the high-water mark over an unprocessed gap. A later cron
  // continues catch-up from the contiguous checkpoint.
  if (next <= yesterday) return days;

  for (let offset = REPLAY_DAYS - 1; offset >= 0; offset -= 1) {
    const day = addUtcDays(yesterday, -offset);
    if (day >= startDay && !days.includes(day)) days.push(day);
  }

  return days.sort();
}

function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function validDay(day: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && utcDay(new Date(`${day}T00:00:00.000Z`)) === day;
}

function addUtcDays(day: string, amount: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return utcDay(date);
}

function sourceKey(config: WarehouseConfig): string {
  return `r2-sql:${config.accountId}:${config.bucket}:${config.warehouse}:${config.table}`;
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}
