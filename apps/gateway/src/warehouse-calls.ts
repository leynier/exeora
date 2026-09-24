import { eq } from "drizzle-orm";
import { AUDIT_INCOMPLETE_AFTER_MS, AUDIT_INCOMPLETE_CODE } from "./audit-stream.js";
import { db, schema } from "./db/client.js";
import "./env.js";
import { limitsFor } from "./plans.js";
import {
  auditSource,
  epochMsWithin,
  runQuery,
  sqlString,
  type WarehouseConfig,
  warehouseConfig,
} from "./r2-sql.js";

/**
 * Activity, read from the archive instead of from D1.
 *
 * An intent and its outcome share an id. Resolve them before status filtering
 * or paging, otherwise a successful tool's intent could appear as an error or
 * consume a second row. Legacy one-event records use the same read path.
 * Every query carries the account's retention bound to limit bytes scanned.
 */

export interface WarehouseCall {
  id: string;
  projectId: string;
  workspaceId: string | null;
  workspaceSlug: string | null;
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
    | "DB"
    | "CLOUDFLARE_ACCOUNT_ID"
    | "AUDIT_R2_BUCKET"
    | "AUDIT_R2_WAREHOUSE"
    | "AUDIT_R2_SQL_TOKEN"
    | "AUDIT_R2_TABLE"
    | "AUDIT_R2_LEGACY_TABLE"
    | "AUDIT_WAREHOUSE_START_DAY"
  >,
  filter: {
    userId: string;
    projectId?: string | undefined;
    workspaceId?: string | undefined;
    status?: "ok" | "error" | undefined;
    clientId?: string | undefined;
    cursor?: { createdAt: number; id: string } | undefined;
    /** Derived from the account plan by the gateway, never a query parameter. */
    retentionDays?: number;
    pageSize: number;
  },
  options: { config?: WarehouseConfig; fetcher?: typeof fetch; now?: Date } = {},
): Promise<WarehouseCallsPage> {
  const config = options.config ?? warehouseConfig(env);
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? new Date();
  // Resolve centrally so the user Activity route and the admin detail route
  // enforce the same target account's plan, not the viewing admin's plan.
  const account =
    filter.retentionDays === undefined
      ? await db(env)
          .select({ plan: schema.users.plan })
          .from(schema.users)
          .where(eq(schema.users.id, filter.userId))
          .get()
      : undefined;
  const retentionDays = filter.retentionDays ?? limitsFor(account?.plan).retentionDays;
  if (!Number.isInteger(retentionDays) || retentionDays < 1) {
    throw new Error("Audit retention must be a positive number of days");
  }

  const windowStart = Math.max(
    Date.parse(`${config.startDay}T00:00:00.000Z`),
    now.getTime() - retentionDays * 86_400_000,
  );
  // An old cursor cannot widen retention or force a billed archive scan.
  if (filter.cursor && filter.cursor.createdAt < windowStart) {
    return { items: [], last: undefined };
  }
  const from = new Date(windowStart).toISOString();
  const to = filter.cursor ? new Date(filter.cursor.createdAt).toISOString() : null;

  // Identity filters are invariant between intent and outcome, so push them
  // down into the scan. Status is not invariant and must be applied afterward.
  const conditions = [`user_id = ${sqlString(filter.userId)}`];
  if (filter.projectId) conditions.push(`project_id = ${sqlString(filter.projectId)}`);
  if (filter.workspaceId) conditions.push(`worktree_id = ${sqlString(filter.workspaceId)}`);
  if (filter.clientId) conditions.push(`client_id = ${sqlString(filter.clientId)}`);
  conditions.push(`created_at >= ${sqlString(from)}`);
  conditions.push(`created_at <= ${sqlString(now.toISOString())}`);
  if (to) {
    conditions.push(
      `(created_at < ${sqlString(to)} OR (created_at = ${sqlString(to)} AND id < ${sqlString(filter.cursor?.id ?? "")}))`,
    );
  }

  const stale = sqlString(new Date(now.getTime() - AUDIT_INCOMPLETE_AFTER_MS).toISOString());
  const resolved = [
    "audit_rank = 1",
    `(error_code IS NULL OR error_code <> ${sqlString(AUDIT_INCOMPLETE_CODE)} OR created_at <= ${stale})`,
  ];
  if (filter.status) resolved.push(`status = ${sqlString(filter.status)}`);

  // ROW_NUMBER also collapses at-least-once delivery duplicates. A final
  // outcome wins over an incomplete intent even if it arrived out of order.
  const columns =
    "id, project_id, worktree_id, worktree_slug, tool, status, duration_ms, error_code, client_id, client_name, created_at";
  const query = `WITH ranked_calls AS (
  SELECT ${columns},
    ROW_NUMBER() OVER (
      PARTITION BY id
      ORDER BY CASE WHEN error_code = ${sqlString(AUDIT_INCOMPLETE_CODE)} THEN 0 ELSE 1 END DESC,
        duration_ms DESC, status DESC, COALESCE(error_code, '') DESC
    ) AS audit_rank
  FROM ${auditSource(config, true)}
  WHERE ${conditions.join("\n    AND ")}
)
SELECT ${columns}
FROM ranked_calls
WHERE ${resolved.join("\n  AND ")}
ORDER BY created_at DESC, id DESC
LIMIT ${filter.pageSize + 1}`;

  const rows = await runQuery(config, query, fetcher);
  const parsed = rows.map((row) => toCall(row, windowStart, now.getTime() + 1));
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
    durationMs < 0 ||
    createdAt === null ||
    createdAt < from ||
    createdAt >= to
  ) {
    throw new Error("R2 SQL returned an invalid tool call row");
  }

  return {
    id,
    projectId,
    workspaceId: optionalString(row.worktree_id),
    workspaceSlug: optionalString(row.worktree_slug),
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
