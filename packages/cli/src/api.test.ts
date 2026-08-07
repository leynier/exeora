import { afterEach, describe, expect, it, vi } from "vitest";
import type { ToolCallsPage, ToolCallView } from "./api.js";

// `config.ts` builds a `conf` store at import time and `tokens.ts` would go
// looking for a keychain; neither may run in a test, so both are replaced.
vi.mock("./config.js", () => ({ gatewayUrl: () => "https://gateway.test" }));
vi.mock("./auth/tokens.js", () => ({ accessToken: async () => "test-token" }));

const { gateway } = await import("./api.js");

function call(id: string): ToolCallView {
  return {
    id,
    projectId: "project-1",
    tool: "run_command",
    status: "ok",
    durationMs: 12,
    errorCode: null,
    clientId: null,
    clientName: null,
    createdAt: 1_700_000_000_000,
  };
}

function respond(page: ToolCallsPage): Response {
  return new Response(JSON.stringify(page), { status: 200 });
}

/** A fetch that answers each page from the queue, in order. */
function stubFetch(pages: ToolCallsPage[]) {
  const urls: string[] = [];
  const mock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    urls.push(String(input));
    const page = pages.shift();
    if (!page) throw new Error(`Unexpected fetch to ${String(input)}`);
    return respond(page);
  });
  vi.stubGlobal("fetch", mock);
  return urls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("listToolCalls", () => {
  it("returns a single page without asking for another", async () => {
    const urls = stubFetch([{ items: [call("a"), call("b")], cursor: null }]);

    const calls = await gateway.listToolCalls(30);

    expect(calls.map((c) => c.id)).toEqual(["a", "b"]);
    expect(urls).toEqual(["https://gateway.test/api/tool-calls"]);
  });

  it("sends the bearer token", async () => {
    const mock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      respond({ items: [], cursor: null }),
    );
    vi.stubGlobal("fetch", mock);

    await gateway.listToolCalls(10);

    const headers = new Headers(mock.mock.calls[0]?.[1]?.headers);
    expect(headers.get("Authorization")).toBe("Bearer test-token");
  });

  it("follows the cursor until the limit is met", async () => {
    // Pages are smaller than any real page so the walk shows up in one test.
    const urls = stubFetch([
      { items: [call("a"), call("b")], cursor: "cursor-1" },
      { items: [call("c"), call("d")], cursor: "cursor-2" },
    ]);

    const calls = await gateway.listToolCalls(3);

    expect(calls.map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(urls[1]).toBe("https://gateway.test/api/tool-calls?cursor=cursor-1");
  });

  it("stops at the end of the log even when short of the limit", async () => {
    stubFetch([
      { items: [call("a")], cursor: "cursor-1" },
      { items: [call("b")], cursor: null },
    ]);

    const calls = await gateway.listToolCalls(50);

    expect(calls.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("stops on an empty page rather than chasing its cursor forever", async () => {
    const urls = stubFetch([{ items: [], cursor: "cursor-1" }]);

    const calls = await gateway.listToolCalls(50);

    expect(calls).toEqual([]);
    expect(urls).toHaveLength(1);
  });

  it("encodes a cursor that is not URL-safe", async () => {
    const urls = stubFetch([
      { items: [call("a")], cursor: "a+b/c=" },
      { items: [call("b")], cursor: null },
    ]);

    await gateway.listToolCalls(50);

    expect(urls[1]).toBe("https://gateway.test/api/tool-calls?cursor=a%2Bb%2Fc%3D");
  });

  it("throws with the status and detail when the gateway refuses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 401 })),
    );

    await expect(gateway.listToolCalls(10)).rejects.toThrow(
      "GET /api/tool-calls failed (401): nope",
    );
  });
});
