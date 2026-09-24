import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AUDIT_INCOMPLETE_CODE } from "./audit-stream.js";
import { db, schema } from "./db/client.js";
import { queryWarehouseCalls } from "./warehouse-calls.js";
import { rollupUsageDailyFromWarehouse } from "./warehouse-usage.js";

/** Execute the generated SQL, rather than making a mock agree with a query. */
const USER = "usr_audit_sql";
const NOW = new Date("2026-03-01T12:00:00.000Z");
const config = {
  accountId: "account",
  bucket: "audit",
  warehouse: "audit",
  table: "audit_test_events",
  token: "secret",
  startDay: "2026-02-28",
};

beforeEach(async () => {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS audit_test_events (
    id TEXT, user_id TEXT, project_id TEXT, worktree_id TEXT, worktree_slug TEXT,
    tool TEXT, status TEXT, duration_ms INTEGER, error_code TEXT, client_id TEXT,
    client_name TEXT, endpoint TEXT, created_at TEXT
  )`).run();
  await env.DB.prepare("DELETE FROM audit_test_events").run();
  await db(env).delete(schema.users).where(eq(schema.users.id, USER)).run();
  await db(env).delete(schema.usageRollupState).run();
  await db(env).insert(schema.users).values({ id: USER, email: "audit-sql@example.com" }).run();
});

async function insert(
  id: string,
  status: "ok" | "error",
  errorCode: string | null = null,
  at = "2026-03-01T10:00:00.000Z",
  userId = USER,
) {
  await env.DB.prepare(`INSERT INTO audit_test_events
    (id, user_id, project_id, tool, status, duration_ms, error_code, endpoint, created_at)
    VALUES (?1, ?2, 'prj_1', 'read_file', ?3, 12, ?4, 'project', ?5)`)
    .bind(id, userId, status, errorCode, at)
    .run();
}

function sqlFetcher() {
  return vi.fn<typeof fetch>(async (_url, init) => {
    const { query } = JSON.parse(String((init as RequestInit).body)) as { query: string };
    const result = await env.DB.prepare(query).all<Record<string, unknown>>();
    return Response.json({ success: true, result: { rows: result.results } });
  });
}

async function page(filter: Partial<Parameters<typeof queryWarehouseCalls>[1]> = {}) {
  return queryWarehouseCalls(
    env,
    { userId: USER, pageSize: 50, ...filter },
    { config, now: NOW, fetcher: sqlFetcher() },
  );
}

describe("resolved audit history", () => {
  it("collapses duplicate outcomes and intents before paging", async () => {
    await insert("call_c", "ok");
    await insert("call_c", "ok");
    // Deliberately after the outcome: arrival order is not authority.
    await insert("call_c", "error", AUDIT_INCOMPLETE_CODE);
    await insert("call_b", "error", "TOOL_FAILED");
    await insert("call_b", "error", AUDIT_INCOMPLETE_CODE);
    await insert("call_a", "ok");
    await insert("call_other", "ok", null, undefined, "usr_other");

    const first = await page({ pageSize: 2 });
    expect(first.items.map((item) => [item.id, item.status])).toEqual([
      ["call_c", "ok"],
      ["call_b", "error"],
    ]);
    expect(first.last?.id).toBe("call_b");
    const next = await page({
      cursor: { id: "call_b", createdAt: Date.parse("2026-03-01T10:00:00.000Z") },
      pageSize: 2,
    });
    expect(next.items.map((item) => item.id)).toEqual(["call_a"]);
  });

  it("does not return a successful call's intent under the error filter", async () => {
    await insert("call_success", "error", AUDIT_INCOMPLETE_CODE);
    await insert("call_success", "ok");
    await insert("call_failure", "error", AUDIT_INCOMPLETE_CODE);
    await insert("call_failure", "error", "TOOL_FAILED");
    expect((await page({ status: "error" })).items.map((item) => item.id)).toEqual([
      "call_failure",
    ]);
  });

  it("hides recent pending intents but exposes interrupted execution after the deadline", async () => {
    await insert("call_old", "error", AUDIT_INCOMPLETE_CODE, "2026-03-01T11:44:00.000Z");
    await insert("call_pending", "error", AUDIT_INCOMPLETE_CODE, "2026-03-01T11:59:00.000Z");
    const result = await page();
    expect(result.items.map((item) => item.id)).toEqual(["call_old"]);
    expect(result.items[0]?.errorCode).toBe(AUDIT_INCOMPLETE_CODE);
  });

  it("enforces a rolling 24 hours for Free while keeping the target Pro account's history", async () => {
    await insert("call_expired", "ok", null, "2026-02-28T11:59:59.999Z");
    await insert("call_boundary", "ok", null, "2026-02-28T12:00:00.000Z");
    await insert("call_recent", "ok");
    expect((await page()).items.map((item) => item.id)).toEqual(["call_recent", "call_boundary"]);

    await db(env).update(schema.users).set({ plan: "pro" }).where(eq(schema.users.id, USER)).run();
    expect((await page()).items.map((item) => item.id)).toEqual([
      "call_recent",
      "call_boundary",
      "call_expired",
    ]);
  });

  it("does not consult the archive for a cursor older than retention", async () => {
    const fetcher = sqlFetcher();
    const result = await queryWarehouseCalls(
      env,
      {
        userId: USER,
        pageSize: 50,
        cursor: { id: "call_old", createdAt: Date.parse("2026-02-28T11:00:00.000Z") },
      },
      { config, now: NOW, fetcher },
    );
    expect(result.items).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("exact usage with paired events", () => {
  it("counts attempts once and never permanently counts an intent as a failed tool", async () => {
    const at = "2026-02-28T18:00:00.000Z";
    await insert("call_success", "error", AUDIT_INCOMPLETE_CODE, at);
    await insert("call_success", "ok", null, at);
    await insert("call_success", "ok", null, at);
    await insert("call_failure", "error", AUDIT_INCOMPLETE_CODE, at);
    await insert("call_failure", "error", "TOOL_FAILED", at);
    await insert("call_pending", "error", AUDIT_INCOMPLETE_CODE, at);

    const options = { config, now: NOW, fetcher: sqlFetcher() };
    await rollupUsageDailyFromWarehouse(env, options);
    let usage = await db(env)
      .select()
      .from(schema.usageDaily)
      .where(eq(schema.usageDaily.userId, USER))
      .get();
    expect(usage).toMatchObject({ toolCalls: 3, errors: 1, day: "2026-02-28" });

    await insert("call_pending", "ok", null, at);
    await rollupUsageDailyFromWarehouse(env, options);
    usage = await db(env)
      .select()
      .from(schema.usageDaily)
      .where(eq(schema.usageDaily.userId, USER))
      .get();
    expect(usage).toMatchObject({ toolCalls: 3, errors: 1 });
  });
});
