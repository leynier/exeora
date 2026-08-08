import "./env.js";
import {
  epochMsWithin,
  runQuery,
  sqlString,
  type WarehouseConfig,
  warehouseConfig,
} from "./r2-sql.js";

/**
 * Activity, read from the archive instead of from D1.
 *
 * The alternative was telling people their history is an archive and showing
 * them nothing, which is a worse product than the one this replaces. R2 SQL can
 * answer the question, so it answers it.
 *
 * Two properties of that engine shape everything here. There is no `OFFSET`, so
 * paging is keyset on `(created_at, id)`, which is what the D1 version already
 * did and why the cursor format is unchanged. And every query is billed on
 * compressed bytes scanned with a 10 MB floor, so each one carries the tightest
 * time bounds it can honestly claim.
 */

export interface WarehouseCall {
  id: string;
  projectId: string;
  tool: string;
  status: "ok" | "error";
  durationMs: number;
  errorCode: string | null;
  clientId: string | null;
  clientName: string | null;
  createdAt: number;
}

export interface WarehouseCallsPage {
  items: WarehouseCall[];
  /** The last row of a full page, for the caller to encode as a cursor. */
  last: WarehouseCall | undefined;
}

export async function queryWarehouseCalls(
  env: Pick<
    Env,
    | "CLOUDFLARE_ACCOUNT_ID"
    | "AUDIT_R2_BUCKET"
    | "AUDIT_R2_WAREHOUSE"
    | "AUDIT_R2_SQL_TOKEN"
    | "AUDIT_R2_TABLE"
    | "AUDIT_WAREHOUSE_START_DAY"
  >,
  filter: {
    userId: string;
    projectId?: string | undefined;
    status?: "ok" | "error" | undefined;
    clientId?: string | undefined;
    cursor?: { createdAt: number; id: string } | undefined;
    pageSize: number;
  },
  options: { config?: WarehouseConfig; fetcher?: typeof fetch; now?: Date } = {},
): Promise<WarehouseCallsPage> {
  const config = options.config ?? warehouseConfig(env);
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? new Date();

  // Every value is escaped, including `userId`. It arrives from a validated
  // token rather than from the query string, but the difference between the two
  // is a fact about today's call sites, not about this function.
  const conditions = [`user_id = ${sqlString(filter.userId)}`];
  if (filter.projectId) conditions.push(`project_id = ${sqlString(filter.projectId)}`);
  if (filter.status) conditions.push(`status = ${sqlString(filter.status)}`);
  if (filter.clientId) conditions.push(`client_id = ${sqlString(filter.clientId)}`);

  // The lower bound is the table's own first day: always true, and the point is
  // that it is stated, so nothing older than the archive is ever scanned. The
  // cursor supplies the upper bound and prunes everything newer than the page.
  const from = `${config.startDay}T00:00:00.000Z`;
  const to = filter.cursor ? new Date(filter.cursor.createdAt).toISOString() : null;

  conditions.push(`created_at >= ${sqlString(from)}`);
  if (to) {
    // `<=` then a tiebreak, rather than `<`: two calls can land in the same
    // millisecond, and dropping the boundary row would hide it behind the seam.
    conditions.push(
      `(created_at < ${sqlString(to)} OR (created_at = ${sqlString(to)} AND id < ${sqlString(filter.cursor?.id ?? "")}))`,
    );
  }

  // One more than the page, so the caller learns whether a next page exists
  // without a second, separately billed query.
  const query = `SELECT id, project_id, tool, status, duration_ms, error_code, client_id, client_name, created_at
FROM ${config.table}
WHERE ${conditions.join("\n  AND ")}
ORDER BY created_at DESC, id DESC
LIMIT ${filter.pageSize + 1}`;

  const rows = await runQuery(config, query, fetcher);

  const windowStart = Date.parse(from);
  const windowEnd = now.getTime() + 86_400_000;
  const parsed = rows.map((row) => toCall(row, windowStart, windowEnd));

  const items = parsed.slice(0, filter.pageSize);
  return { items, last: parsed.length > filter.pageSize ? items.at(-1) : undefined };
}

function toCall(row: Record<string, unknown>, from: number, to: number): WarehouseCall {
  const id = row.id;
  const projectId = row.project_id;
  const tool = row.tool;
  const status = row.status;
  const durationMs = Number(row.duration_ms);
  const createdAt = epochMsWithin(row.created_at, from, to);

  if (
    typeof id !== "string" ||
    typeof projectId !== "string" ||
    typeof tool !== "string" ||
    (status !== "ok" && status !== "error") ||
    !Number.isFinite(durationMs) ||
    createdAt === null
  ) {
    throw new Error("R2 SQL returned an invalid tool call row");
  }

  return {
    id,
    projectId,
    tool,
    status,
    durationMs,
    errorCode: optionalString(row.error_code),
    clientId: optionalString(row.client_id),
    clientName: optionalString(row.client_name),
    createdAt,
  };
}

/** An absent optional column reaches JSON as null or as nothing at all. */
function optionalString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}
