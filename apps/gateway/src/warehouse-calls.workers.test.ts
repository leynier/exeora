import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { queryWarehouseCalls } from "./warehouse-calls.js";

/**
 * Activity read from the archive.
 *
 * The queries are asserted rather than only their results, because two of the
 * properties that matter are invisible in the output: that paging is keyset
 * (R2 SQL has no `OFFSET`) and that every query carries a time bound (each one
 * is billed on bytes scanned, with a floor).
 */

const config = {
  accountId: "account",
  bucket: "audit",
  warehouse: "audit",
  table: "default.tool_calls",
  token: "secret",
  startDay: "2026-01-01",
};

const NOW = new Date("2026-03-01T12:00:00.000Z");

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "call_1",
    project_id: "prj_1",
    tool: "read_file",
    status: "ok",
    duration_ms: 12,
    error_code: null,
    client_id: "client_claude",
    client_name: "Claude",
    created_at: "2026-02-01T10:00:00.000Z",
    ...overrides,
  };
}

function sink(rows: Record<string, unknown>[]) {
  const queries: string[] = [];
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    queries.push(JSON.parse(String((init as RequestInit).body)).query);
    return Response.json({ success: true, result: { rows } });
  });
  return { fetcher, queries };
}

async function page(
  rows: Record<string, unknown>[],
  filter: Parameters<typeof queryWarehouseCalls>[1],
) {
  const { fetcher, queries } = sink(rows);
  const result = await queryWarehouseCalls(env, filter, { config, fetcher, now: NOW });
  return { ...result, query: queries[0] ?? "" };
}

describe("reading a page", () => {
  it("maps a row into the shape the dashboard already renders", async () => {
    const { items } = await page([row()], { userId: "usr_1", pageSize: 50 });

    expect(items).toEqual([
      {
        id: "call_1",
        projectId: "prj_1",
        worktreeId: null,
        worktreeSlug: null,
        tool: "read_file",
        status: "ok",
        durationMs: 12,
        errorCode: null,
        clientId: "client_claude",
        clientName: "Claude",
        createdAt: Date.parse("2026-02-01T10:00:00.000Z"),
      },
    ]);
  });

  it("reads a numeric timestamp, whatever unit the archive used", async () => {
    // Iceberg stores timestamps as int64 and the unit is not in the response.
    const micros = Date.parse("2026-02-01T10:00:00.000Z") * 1_000;
    const { items } = await page([row({ created_at: micros })], {
      userId: "usr_1",
      pageSize: 50,
    });

    expect(items[0]?.createdAt).toBe(Date.parse("2026-02-01T10:00:00.000Z"));
  });

  it("scopes every query to the caller", async () => {
    const { query } = await page([], { userId: "usr_1", pageSize: 50 });
    expect(query).toContain("user_id = 'usr_1'");
  });

  it("escapes a value rather than letting it close the quote", async () => {
    const { query } = await page([], {
      userId: "usr_1",
      projectId: "prj' OR '1'='1",
      pageSize: 50,
    });

    expect(query).toContain("project_id = 'prj'' OR ''1''=''1'");
  });

  it("bounds the scan at the archive's first day", async () => {
    const { query } = await page([], { userId: "usr_1", pageSize: 50 });
    expect(query).toContain("created_at >= '2026-01-01T00:00:00.000Z'");
  });

  it("passes the filters through", async () => {
    const { query } = await page([], {
      userId: "usr_1",
      projectId: "prj_1",
      status: "error",
      clientId: "client_x",
      pageSize: 50,
    });

    expect(query).toContain("project_id = 'prj_1'");
    expect(query).toContain("status = 'error'");
    expect(query).toContain("client_id = 'client_x'");
  });
});

describe("paging", () => {
  it("reports no next page when the archive returns less than a full one", async () => {
    const { items, last } = await page([row()], { userId: "usr_1", pageSize: 2 });

    expect(items).toHaveLength(1);
    expect(last).toBeUndefined();
  });

  it("asks for one more than the page, and hands back the row to page from", async () => {
    const rows = [row({ id: "call_3" }), row({ id: "call_2" }), row({ id: "call_1" })];
    const { items, last, query } = await page(rows, { userId: "usr_1", pageSize: 2 });

    expect(query).toContain("LIMIT 3");
    expect(items.map((call) => call.id)).toEqual(["call_3", "call_2"]);
    // The last row of the page, not the extra row that was only a probe.
    expect(last?.id).toBe("call_2");
  });

  it("pages by keyset rather than by offset, breaking ties on id", async () => {
    // Two calls can land in the same millisecond, and R2 SQL has no OFFSET,
    // so the tiebreak is what keeps the boundary row from being skipped.
    const at = Date.parse("2026-02-01T10:00:00.000Z");
    const { query } = await page([], {
      userId: "usr_1",
      cursor: { createdAt: at, id: "call_2" },
      pageSize: 50,
    });

    expect(query).not.toContain("OFFSET");
    expect(query).toContain("created_at < '2026-02-01T10:00:00.000Z'");
    expect(query).toContain("created_at = '2026-02-01T10:00:00.000Z' AND id < 'call_2'");
    expect(query).toContain("ORDER BY created_at DESC, id DESC");
  });
});

describe("a row the archive should never have returned", () => {
  it("refuses an unreadable timestamp instead of inventing one", async () => {
    await expect(
      page([row({ created_at: "not a date" })], { userId: "usr_1", pageSize: 50 }),
    ).rejects.toThrow("invalid tool call row");
  });

  it("refuses a status outside the two it can be", async () => {
    await expect(
      page([row({ status: "maybe" })], { userId: "usr_1", pageSize: 50 }),
    ).rejects.toThrow("invalid tool call row");
  });
});
