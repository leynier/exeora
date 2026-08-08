import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, schema } from "./db/client.js";
import { rollupUsageDailyFromWarehouse } from "./warehouse-usage.js";

const USER = "usr_warehouse_rollup";
const USER_B = "usr_warehouse_rollup_b";
const config = {
  accountId: "account",
  bucket: "audit",
  warehouse: "audit",
  table: "default.tool_calls",
  token: "secret",
  startDay: "2026-01-02",
};

beforeEach(async () => {
  const database = db(env);
  await database.delete(schema.users).where(eq(schema.users.id, USER)).run();
  await database.delete(schema.users).where(eq(schema.users.id, USER_B)).run();
  await database.delete(schema.usageRollupState).run();
  await database.delete(schema.usageDaily).where(eq(schema.usageDaily.userId, USER)).run();
  await database.delete(schema.usageDaily).where(eq(schema.usageDaily.userId, USER_B)).run();
  await database.insert(schema.users).values({ id: USER, email: "warehouse@example.com" }).run();
  await database
    .insert(schema.users)
    .values({ id: USER_B, email: "warehouse-b@example.com" })
    .run();
});

describe("warehouse usage rollup", () => {
  it("upserts complete days and replays them without double counting", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        success: true,
        result: {
          rows: [
            {
              user_id: USER,
              tool_calls: 2,
              errors: 1,
              last_activity_at: "2026-01-02T12:00:00.000Z",
            },
          ],
        },
      }),
    );

    const first = await rollupUsageDailyFromWarehouse(env, {
      config,
      fetcher,
      now: new Date("2026-01-05T04:17:00.000Z"),
    });
    const second = await rollupUsageDailyFromWarehouse(env, {
      config,
      fetcher,
      now: new Date("2026-01-05T04:17:00.000Z"),
    });

    expect(first).toEqual({ days: 3, rows: 3 });
    expect(second).toEqual({ days: 3, rows: 3 });
    expect(fetcher).toHaveBeenCalledTimes(6);

    const usage = await db(env)
      .select()
      .from(schema.usageDaily)
      .where(eq(schema.usageDaily.userId, USER))
      .all();
    expect(usage).toEqual([
      expect.objectContaining({ day: "2026-01-02", toolCalls: 2, errors: 1 }),
      expect.objectContaining({ day: "2026-01-03", toolCalls: 2, errors: 1 }),
      expect.objectContaining({ day: "2026-01-04", toolCalls: 2, errors: 1 }),
    ]);

    const state = await db(env).select().from(schema.usageRollupState).get();
    expect(state?.lastCompleteDay).toBe("2026-01-04");
  });

  it("does not erase prior usage_daily rows when the sink returns empty", async () => {
    await db(env)
      .insert(schema.usageDaily)
      .values({
        userId: USER,
        day: "2026-01-02",
        toolCalls: 9,
        errors: 3,
        lastActivityAt: new Date("2026-01-02T10:00:00.000Z"),
      })
      .run();

    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ success: true, result: { rows: [] } }),
    );

    await rollupUsageDailyFromWarehouse(env, {
      config,
      fetcher,
      now: new Date("2026-01-03T04:17:00.000Z"),
    });

    const usage = await db(env)
      .select()
      .from(schema.usageDaily)
      .where(eq(schema.usageDaily.userId, USER))
      .get();
    expect(usage).toEqual(expect.objectContaining({ day: "2026-01-02", toolCalls: 9, errors: 3 }));
  });

  it("drops rows for accounts that no longer exist, rather than failing the batch", async () => {
    // The archive outlives the account: a day queried after someone deletes
    // theirs still has their calls in it. `usage_daily.user_id` is a foreign
    // key, so an unguarded insert would fail the whole statement, leave the
    // checkpoint where it was, and repeat forever on the same day.
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        success: true,
        result: {
          rows: [
            { user_id: USER, tool_calls: 2, errors: 0, last_activity_at: 1767355200000 },
            { user_id: "usr_deleted", tool_calls: 7, errors: 1, last_activity_at: 1767355200000 },
          ],
        },
      }),
    );

    const result = await rollupUsageDailyFromWarehouse(env, {
      config,
      fetcher,
      now: new Date("2026-01-03T04:17:00.000Z"),
    });

    expect(result).toEqual({ days: 1, rows: 1 });

    const usage = await db(env).select().from(schema.usageDaily).all();
    expect(usage.map((row) => row.userId)).not.toContain("usr_deleted");
    expect(usage).toContainEqual(
      expect.objectContaining({ userId: USER, day: "2026-01-02", toolCalls: 2 }),
    );

    const state = await db(env).select().from(schema.usageRollupState).get();
    expect(state?.lastCompleteDay).toBe("2026-01-02");
  });

  it("keeps the higher of warehouse and existing counters", async () => {
    await db(env)
      .insert(schema.usageDaily)
      .values({
        userId: USER,
        day: "2026-01-02",
        toolCalls: 9,
        errors: 3,
        lastActivityAt: new Date("2026-01-02T10:00:00.000Z"),
      })
      .run();

    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        success: true,
        result: {
          rows: [
            {
              user_id: USER,
              tool_calls: 2,
              errors: 1,
              last_activity_at: "2026-01-02T12:00:00.000Z",
            },
          ],
        },
      }),
    );

    await rollupUsageDailyFromWarehouse(env, {
      config,
      fetcher,
      now: new Date("2026-01-03T04:17:00.000Z"),
    });

    const usage = await db(env)
      .select()
      .from(schema.usageDaily)
      .where(eq(schema.usageDaily.userId, USER))
      .get();
    expect(usage).toEqual(
      expect.objectContaining({
        day: "2026-01-02",
        toolCalls: 9,
        errors: 3,
        lastActivityAt: new Date("2026-01-02T12:00:00.000Z"),
      }),
    );
  });

  it("pages past the R2 SQL LIMIT with cursor filters", async () => {
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { query: string };
      if (body.query.includes(`user_id > '${USER_B}'`)) {
        return Response.json({ success: true, result: { rows: [] } });
      }
      if (body.query.includes(`user_id > '${USER}'`)) {
        return Response.json({
          success: true,
          result: {
            rows: [
              {
                user_id: USER_B,
                tool_calls: 4,
                errors: 0,
                last_activity_at: "2026-01-02T13:00:00.000Z",
              },
            ],
          },
        });
      }
      return Response.json({
        success: true,
        result: {
          rows: [
            {
              user_id: USER,
              tool_calls: 3,
              errors: 1,
              last_activity_at: "2026-01-02T12:00:00.000Z",
            },
          ],
        },
      });
    });

    await rollupUsageDailyFromWarehouse(env, {
      config,
      fetcher,
      pageSize: 1,
      now: new Date("2026-01-03T04:17:00.000Z"),
    });

    expect(fetcher).toHaveBeenCalledTimes(3);
    const secondQuery = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body)).query as string;
    expect(secondQuery).toContain(`user_id > '${USER}'`);
    expect(secondQuery).toContain("LIMIT 1");
    expect(secondQuery).toContain("COUNT(*)");
    expect(secondQuery).not.toContain("COUNT(DISTINCT");
    const thirdQuery = JSON.parse(String(fetcher.mock.calls[2]?.[1]?.body)).query as string;
    expect(thirdQuery).toContain(`user_id > '${USER_B}'`);

    const usage = await db(env).select().from(schema.usageDaily).all();
    expect(usage).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: USER, toolCalls: 3 }),
        expect.objectContaining({ userId: USER_B, toolCalls: 4 }),
      ]),
    );
  });

  it("does not advance the checkpoint when R2 SQL fails", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ success: false, errors: [{ message: "sink unavailable" }] }, { status: 503 }),
    );

    await expect(
      rollupUsageDailyFromWarehouse(env, {
        config,
        fetcher,
        now: new Date("2026-01-05T04:17:00.000Z"),
      }),
    ).rejects.toThrow("sink unavailable");

    expect(await db(env).select().from(schema.usageRollupState).get()).toBeUndefined();
  });

  it("rejects incomplete R2 SQL payloads before mutating usage", async () => {
    await db(env)
      .insert(schema.usageDaily)
      .values({
        userId: USER,
        day: "2026-01-02",
        toolCalls: 9,
        errors: 0,
        lastActivityAt: new Date("2026-01-02T10:00:00.000Z"),
      })
      .run();

    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ success: true, result: {} }));

    await expect(
      rollupUsageDailyFromWarehouse(env, {
        config,
        fetcher,
        now: new Date("2026-01-03T04:17:00.000Z"),
      }),
    ).rejects.toThrow("incomplete response");

    const usage = await db(env)
      .select()
      .from(schema.usageDaily)
      .where(eq(schema.usageDaily.userId, USER))
      .get();
    expect(usage?.toolCalls).toBe(9);
    expect(await db(env).select().from(schema.usageRollupState).get()).toBeUndefined();
  });

  it("advances only across contiguous days when catch-up exceeds one cron", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ success: true, result: { rows: [] } }),
    );

    const result = await rollupUsageDailyFromWarehouse(env, {
      config: { ...config, startDay: "2026-01-01" },
      fetcher,
      now: new Date("2026-03-20T04:17:00.000Z"),
    });

    expect(result.days).toBe(31);
    const state = await db(env).select().from(schema.usageRollupState).get();
    expect(state?.lastCompleteDay).toBe("2026-01-31");
  });
});
