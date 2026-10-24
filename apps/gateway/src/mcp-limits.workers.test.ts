import { createExecutionContext } from "cloudflare:test";
import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  PROTOCOL_VERSION_META_KEY,
} from "@modelcontextprotocol/server";
import { describe, expect, it, vi } from "vitest";
import { createProjectMcpHandler } from "./mcp.js";
import { createAccountMcpHandler } from "./mcp-account.js";
import { payload } from "./mcp-fixtures.js";
import { MAX_MCP_BODY_BYTES, MAX_MCP_INPUT_ELEMENTS } from "./mcp-limits.js";

const secret = { REQUEST_STATE_SECRET: "test-secret-that-is-at-least-32-bytes-long" };

describe.each(["account", "project"] as const)("%s MCP resource limits", (endpoint) => {
  const path = endpoint === "account" ? "/mcp" : "/p/prj_test/mcp";

  function setup() {
    const dispatch = vi.fn(async (context: { userId: string }, _tool: string, args: unknown) => ({
      kind: "value" as const,
      value: { userId: context.userId, args },
    }));
    const handler =
      endpoint === "account"
        ? createAccountMcpHandler(dispatch, async () => ({}), secret)
        : createProjectMcpHandler("prj_test", dispatch, secret);

    function post(
      args: unknown,
      options: { modern?: boolean; name?: string; userId?: string } = {},
    ) {
      const name = options.name ?? "read_file";
      const body = {
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: {
          name,
          arguments: args,
          ...(options.modern && {
            _meta: {
              [PROTOCOL_VERSION_META_KEY]: "2026-07-28",
              [CLIENT_INFO_META_KEY]: { name: "limits-test", version: "1" },
              [CLIENT_CAPABILITIES_META_KEY]: {},
            },
          }),
        },
      };
      const ctx = createExecutionContext();
      (ctx as { props?: Record<string, string> }).props = { userId: options.userId ?? "usr_test" };
      return handler(
        new Request(`https://exeora.dev${path}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
            "MCP-Protocol-Version": options.modern ? "2026-07-28" : "2025-06-18",
            ...(options.modern && { "Mcp-Method": "tools/call", "Mcp-Name": name }),
          },
          body: JSON.stringify(body),
        }),
        {},
        ctx,
      );
    }
    return { dispatch, post };
  }

  it.each([false, true])(
    "rejects excess input elements before dispatch (modern: %s)",
    async (modern) => {
      const { dispatch, post } = setup();
      const response = await payload(
        await post(
          { path: "readme.md", extra: Array(MAX_MCP_INPUT_ELEMENTS).fill(null) },
          { modern },
        ),
      );
      expect(response.result).toMatchObject({ isError: true });
      expect(JSON.stringify(response.result)).toContain(
        `maximum of ${MAX_MCP_INPUT_ELEMENTS} elements`,
      );
      expect(dispatch).not.toHaveBeenCalled();
    },
  );

  it.each([false, true])("preserves ordinary 1 MB file writes (modern: %s)", async (modern) => {
    const { dispatch, post } = setup();
    const args = { path: "large.txt", content: "x".repeat(1_000_000) };
    const response = await payload(await post(args, { modern, name: "write_file" }));
    expect(response.result).not.toHaveProperty("isError", true);
    expect(dispatch).toHaveBeenCalledExactlyOnceWith(expect.anything(), "write_file", args);
  });

  it("rejects oversized modern envelopes before dispatch", async () => {
    const { dispatch, post } = setup();
    const response = await post(
      { path: "large.txt", content: "x".repeat(MAX_MCP_BODY_BYTES) },
      { modern: true, name: "write_file" },
    );
    expect(response.status).toBe(413);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "isolates concurrent clients with the same RPC id (modern: %s)",
    async (modern) => {
      const { post } = setup();
      const responses = await Promise.all(
        ["usr_first", "usr_second"].map(async (userId) =>
          payload(await post({ path: `${userId}.txt` }, { modern, userId })),
        ),
      );
      for (const [i, userId] of ["usr_first", "usr_second"].entries()) {
        expect(responses[i]?.result).toMatchObject({
          structuredContent: { userId, args: { path: `${userId}.txt` } },
        });
      }
    },
  );
});
