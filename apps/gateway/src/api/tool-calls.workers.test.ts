import { createExecutionContext, env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "../db/client.js";
import { api, pruneToolCalls } from "./index.js";

/**
 * Reading and pruning the audit log.
 *
 * Both halves exist because the log is the one table nothing bounds: every tool
 * call writes a row, and an agent working through a repository writes hundreds
 * a minute. The paging has to survive rows arriving mid-scroll, and the pruning
 * has to leave the window it promises to keep.
 */

const USER = "usr_calls_test";
const OTHER = "usr_calls_other";

const DAY = 24 * 60 * 60 * 1000;

interface CallView {
  id: string;
  projectId: string;
  status: "ok" | "error";
  clientId: string | null;
}

function call(path: string, userId = USER) {
  const request = new Request(`https://exeora.dev${path}`);
  const ctx = createExecutionContext();
  // What the OAuth provider attaches once it has validated the bearer token.
  (ctx as { props?: Record<string, string> }).props = { userId };

  return api.fetch(request, env, ctx);
}

const page = async (path: string, userId = USER) =>
  (await (await call(path, userId)).json()) as { items: CallView[]; cursor: string | null };

/**
 * Seeds `count` calls one millisecond apart, newest last.
 *
 * The spacing is deliberate: two rows in the same millisecond are the case the
 * cursor's tiebreak exists for, and one of the tests below leans on it.
 */
async function seed(options: {
  count: number;
  startedAt?: number;
  userId?: string;
  projectId?: string;
  status?: "ok" | "error";
  clientId?: string | null;
  prefix?: string;
}) {
  const database = db(env);
  const startedAt = options.startedAt ?? Date.now() - options.count;

  const rows = Array.from({ length: options.count }, (_unused, index) => ({
    id: `${options.prefix ?? "call"}_${String(index).padStart(4, "0")}`,
    userId: options.userId ?? USER,
    projectId: options.projectId ?? "prj_one",
    tool: "read_file",
    status: options.status ?? ("ok" as const),
    durationMs: 5,
    clientId: options.clientId === undefined ? "client_claude" : options.clientId,
    clientName: "Claude",
    createdAt: new Date(startedAt + index),
  }));

  // Ten at a time, because D1 caps a statement at 100 bound variables and each
  // row here binds nine. Worth knowing outside this file too: any bulk insert
  // against D1 needs the same treatment.
  for (let start = 0; start < rows.length; start += 10) {
    await database
      .insert(schema.toolCalls)
      .values(rows.slice(start, start + 10))
      .run();
  }
}

/**
 * The owners the calls hang off.
 *
 * Audit rows carry foreign keys to a user and a project, so there is no seeding
 * calls without them. Deleting the users first takes everything below in the
 * cascade, which is also what makes each test independent of its neighbours.
 */
beforeEach(async () => {
  const database = db(env);

  for (const id of [USER, OTHER]) {
    await database.delete(schema.users).where(eq(schema.users.id, id)).run();
  }

  await database
    .insert(schema.users)
    .values([
      { id: USER, email: "you@example.com" },
      { id: OTHER, email: "someone@example.com" },
    ])
    .run();

  await database
    .insert(schema.devices)
    .values([
      { id: "dev_mine", userId: USER, name: "laptop", platform: "linux" },
      { id: "dev_theirs", userId: OTHER, name: "laptop", platform: "linux" },
    ])
    .run();

  await database
    .insert(schema.projects)
    .values([
      {
        id: "prj_one",
        userId: USER,
        deviceId: "dev_mine",
        name: "one",
        slug: "one",
        localPath: "/one",
      },
      {
        id: "prj_two",
        userId: USER,
        deviceId: "dev_mine",
        name: "two",
        slug: "two",
        localPath: "/two",
      },
      {
        id: "prj_theirs",
        userId: OTHER,
        deviceId: "dev_theirs",
        name: "theirs",
        slug: "theirs",
        localPath: "/theirs",
      },
    ])
    .run();
});

describe("paging", () => {
  it("answers a page and a cursor, newest first", async () => {
    await seed({ count: 60 });

    const first = await page("/api/tool-calls");

    expect(first.items).toHaveLength(50);
    expect(first.cursor).not.toBeNull();
    // Newest first: the last seeded row is the highest numbered one.
    expect(first.items[0]?.id).toBe("call_0059");
  });

  it("continues from the cursor without repeating or skipping a row", async () => {
    await seed({ count: 60 });

    const first = await page("/api/tool-calls");
    const second = await page(`/api/tool-calls?cursor=${encodeURIComponent(first.cursor ?? "")}`);

    expect(second.items).toHaveLength(10);
    // Nothing on the last page was on the first one.
    const seen = new Set(first.items.map((row) => row.id));
    expect(second.items.every((row) => !seen.has(row.id))).toBe(true);
    // And together they are the whole set, in order, with no gap at the seam.
    expect([...first.items, ...second.items].map((row) => row.id)).toEqual(
      Array.from({ length: 60 }, (_unused, index) => `call_${String(59 - index).padStart(4, "0")}`),
    );
  });

  it("stops paging when the last page is exactly full", async () => {
    await seed({ count: 50 });

    const only = await page("/api/tool-calls");

    expect(only.items).toHaveLength(50);
    // The extra row the query asks for was not there, so there is no next page
    // and the dashboard does not offer a button that returns nothing.
    expect(only.cursor).toBeNull();
  });

  it("does not hide a row behind the seam when writes arrive mid-scroll", async () => {
    const base = Date.now() - 1_000;
    await seed({ count: 60, startedAt: base });

    const first = await page("/api/tool-calls");

    // A call lands while someone is reading. With an offset this would push a
    // row across the boundary and the next page would skip it.
    await seed({ count: 1, startedAt: Date.now(), prefix: "fresh" });

    const second = await page(`/api/tool-calls?cursor=${encodeURIComponent(first.cursor ?? "")}`);

    expect(second.items.map((row) => row.id)).toEqual(
      Array.from({ length: 10 }, (_unused, index) => `call_${String(9 - index).padStart(4, "0")}`),
    );
  });

  it("keeps rows that share a millisecond apart, ordered by id", async () => {
    const sameMoment = Date.now() - 5_000;
    await seed({ count: 60, startedAt: sameMoment - 0 });
    // Every row above is one millisecond apart; these three are not.
    await seed({ count: 3, startedAt: sameMoment, prefix: "tie" });

    const first = await page("/api/tool-calls");
    const second = await page(`/api/tool-calls?cursor=${encodeURIComponent(first.cursor ?? "")}`);

    const ids = [...first.items, ...second.items].map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(63);
  });

  it("ignores a cursor it cannot make sense of rather than failing", async () => {
    await seed({ count: 3 });

    const first = await page("/api/tool-calls?cursor=nonsense");

    expect(first.items).toHaveLength(3);
  });
});

describe("filtering", () => {
  beforeEach(async () => {
    await seed({ count: 5, projectId: "prj_one", prefix: "one" });
    await seed({ count: 4, projectId: "prj_two", prefix: "two" });
    await seed({ count: 3, status: "error", prefix: "bad" });
    await seed({ count: 2, clientId: "client_chatgpt", prefix: "gpt" });
  });

  it("narrows by project", async () => {
    const result = await page("/api/tool-calls?projectId=prj_two");

    expect(result.items).toHaveLength(4);
    expect(result.items.every((row) => row.projectId === "prj_two")).toBe(true);
  });

  it("narrows by outcome", async () => {
    const result = await page("/api/tool-calls?status=error");

    expect(result.items).toHaveLength(3);
    expect(result.items.every((row) => row.status === "error")).toBe(true);
  });

  it("narrows by client", async () => {
    const result = await page("/api/tool-calls?clientId=client_chatgpt");

    expect(result.items).toHaveLength(2);
  });

  it("ignores a status that is neither outcome", async () => {
    const result = await page("/api/tool-calls?status=maybe");

    expect(result.items).toHaveLength(14);
  });

  it("combines filters rather than picking one", async () => {
    const result = await page("/api/tool-calls?projectId=prj_one&status=error");

    // The three error rows were seeded against prj_one, the default.
    expect(result.items).toHaveLength(3);
  });
});

describe("isolation", () => {
  it("never returns another account's calls", async () => {
    await seed({ count: 3, userId: USER });
    await seed({ count: 7, userId: OTHER, prefix: "theirs" });

    expect((await page("/api/tool-calls")).items).toHaveLength(3);
    expect((await page("/api/tool-calls", OTHER)).items).toHaveLength(7);
  });

  it("does not let a filter reach across accounts", async () => {
    await seed({ count: 4, userId: OTHER, projectId: "prj_theirs", prefix: "theirs" });

    // A project id belonging to someone else, guessed correctly, still answers
    // with nothing: the user id is in the same where clause.
    expect((await page("/api/tool-calls?projectId=prj_theirs")).items).toHaveLength(0);
  });
});

describe("retention", () => {
  it("drops rows past the window and keeps the rest", async () => {
    await seed({ count: 5, startedAt: Date.now() - 200 * DAY, prefix: "ancient" });
    await seed({ count: 4, startedAt: Date.now() - 91 * DAY, prefix: "old" });
    await seed({ count: 3, startedAt: Date.now() - 89 * DAY, prefix: "recent" });

    const deleted = await pruneToolCalls(env);

    expect(deleted).toBe(9);
    const kept = (await page("/api/tool-calls")).items;
    expect(kept).toHaveLength(3);
    expect(kept.every((row) => row.id.startsWith("recent_"))).toBe(true);
  });

  it("does nothing when everything is inside the window", async () => {
    await seed({ count: 6 });

    expect(await pruneToolCalls(env)).toBe(0);
    expect((await page("/api/tool-calls")).items).toHaveLength(6);
  });

  it("prunes every account, not only the one that happened to be asked for", async () => {
    await seed({ count: 2, userId: USER, startedAt: Date.now() - 200 * DAY, prefix: "mine" });
    await seed({ count: 2, userId: OTHER, startedAt: Date.now() - 200 * DAY, prefix: "theirs" });

    expect(await pruneToolCalls(env)).toBe(4);
  });
});
