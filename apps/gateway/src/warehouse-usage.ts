import { eq } from "drizzle-orm";
import { observeD1 } from "./cost-metrics.js";
import { db, schema } from "./db/client.js";
import "./env.js";
import {
  addUtcDays,
  auditSource,
  epochMsWithin,
  R2_SQL_PAGE_SIZE,
  runQuery,
  sqlString,
  utcDay,
  type WarehouseConfig,
  warehouseConfig,
} from "./r2-sql.js";

const REPLAY_DAYS = 3;
const MAX_CATCHUP_DAYS = 31;
const USERS_PER_STATEMENT = 500;
const R2_SQL_MAX_PAGES = 100;

export interface WarehouseRollupResult {
  days: number;
  rows: number;
}

export interface WarehouseRollupStatus {
  lastCompleteDay: string | null;
  targetDay: string;
  backlogDays: number;
  pruneAllowed: boolean;
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
  let checkpoint = await db(env)
    .select({ day: schema.usageRollupState.lastCompleteDay })
    .from(schema.usageRollupState)
    .where(eq(schema.usageRollupState.source, source))
    .get();
  if (!checkpoint && config.legacyTable) {
    checkpoint = await db(env)
      .select({ day: schema.usageRollupState.lastCompleteDay })
      .from(schema.usageRollupState)
      .where(eq(schema.usageRollupState.source, legacySourceKey(config)))
      .get();
  }

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

/** Retention must not remove a day the durable rollup has not consumed. */
export async function warehouseRollupStatus(
  env: Pick<Env, "DB">,
  options: { config?: WarehouseConfig; now?: Date } = {},
): Promise<WarehouseRollupStatus> {
  const config = options.config ?? warehouseConfig(env as Env);
  const targetDay = addUtcDays(utcDay(options.now ?? new Date()), -1);
  let checkpoint = await db(env)
    .select({ day: schema.usageRollupState.lastCompleteDay })
    .from(schema.usageRollupState)
    .where(eq(schema.usageRollupState.source, sourceKey(config)))
    .get();
  if (!checkpoint && config.legacyTable) {
    checkpoint = await db(env)
      .select({ day: schema.usageRollupState.lastCompleteDay })
      .from(schema.usageRollupState)
      .where(eq(schema.usageRollupState.source, legacySourceKey(config)))
      .get();
  }
  const lastCompleteDay = checkpoint?.day ?? null;
  const neededStart = lastCompleteDay ? addUtcDays(lastCompleteDay, 1) : config.startDay;
  return {
    lastCompleteDay,
    targetDay,
    backlogDays: neededStart > targetDay ? 0 : dayDistance(neededStart, targetDay) + 1,
    pruneAllowed:
      config.startDay > targetDay || (lastCompleteDay !== null && lastCompleteDay >= targetDay),
  };
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
  COUNT(DISTINCT id) AS tool_calls,
  COUNT(DISTINCT CASE WHEN status = 'error' THEN id END) AS errors,
  MAX(created_at) AS last_activity_at
FROM ${auditSource(config, false)}
WHERE created_at >= '${day}T00:00:00.000Z'
  AND created_at < '${end}T00:00:00.000Z'${afterClause}
GROUP BY user_id
ORDER BY user_id
LIMIT ${pageSize}`;
  const rows = await runQuery(config, query, fetcher);

  const dayStart = Date.parse(`${day}T00:00:00.000Z`);
  const dayEnd = Date.parse(`${end}T00:00:00.000Z`);

  return rows.map((row) => {
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

function sourceKey(config: WarehouseConfig): string {
  const current = `r2-sql:${config.accountId}:${config.bucket}:${config.warehouse}:${config.table}`;
  return config.legacyTable ? `${current}:${config.legacyTable}` : current;
}

function legacySourceKey(config: WarehouseConfig): string {
  return `r2-sql:${config.accountId}:${config.bucket}:${config.warehouse}:${config.legacyTable}`;
}

function dayDistance(from: string, to: string): number {
  return Math.max(
    0,
    Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000),
  );
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}
