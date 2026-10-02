import { describe, expect, it } from "vitest";
import { R2_SQL_TIMEOUT_MS, runQuery, type WarehouseConfig } from "./r2-sql.js";

const config: WarehouseConfig = {
  accountId: "account",
  bucket: "audit",
  warehouse: "warehouse",
  table: "audit.events",
  token: "r2-sql-token",
  startDay: "2026-01-01",
};

describe("R2 SQL reads", () => {
  it("uses a bounded request without following redirects", async () => {
    let request: Request | undefined;
    const rows = await runQuery(config, "SELECT 1", async (input, init) => {
      request = new Request(input, init);
      return Response.json({ success: true, result: { rows: [{ value: 1 }] } });
    });

    expect(rows).toEqual([{ value: 1 }]);
    expect(request?.redirect).toBe("manual");
    expect(request?.signal).toBeDefined();
    expect(request?.headers.get("authorization")).toBe("Bearer r2-sql-token");
    expect(R2_SQL_TIMEOUT_MS).toBe(15_000);
  });

  it("fails closed on redirects, transport errors, and malformed responses", async () => {
    await expect(
      runQuery(
        config,
        "SELECT 1",
        async () =>
          new Response(null, {
            status: 302,
            headers: { Location: "https://attacker.example/collect" },
          }),
      ),
    ).rejects.toThrow("redirected");
    await expect(
      runQuery(config, "SELECT 1", async () => {
        throw new Error("private transport detail");
      }),
    ).rejects.toThrow("could not be reached");
    await expect(
      runQuery(config, "SELECT 1", async () => new Response("not json")),
    ).rejects.toThrow("invalid response");
    await expect(
      runQuery(config, "SELECT secret_column FROM audit.events", async () =>
        Response.json({ success: false, errors: [{ message: "secret_column leaked" }] }),
      ),
    ).rejects.toThrow("rejected the query");
  });
});
