import { describe, expect, it, vi } from "vitest";
import { PANEL_REQUEST_TOOL, type ToolAnswer, toolTransport } from "./transport.js";

function answering(answer: ToolAnswer) {
  const call = vi.fn(async () => answer);
  return { call, send: toolTransport(call) };
}

describe("toolTransport", () => {
  it("sends the method, path and JSON body as the tool's arguments", async () => {
    const { call, send } = answering({ structuredContent: { status: 200, body: { ok: true } } });
    const signal = new AbortController().signal;
    const response = await send("/api/projects/p1/workspace/reads?workspace=w", {
      method: "post",
      body: JSON.stringify({ action: "tree", path: "" }),
      signal,
    });
    expect(call).toHaveBeenCalledWith(
      PANEL_REQUEST_TOOL,
      {
        method: "POST",
        path: "/api/projects/p1/workspace/reads?workspace=w",
        body: { action: "tree", path: "" },
      },
      signal,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("defaults to GET with no body", async () => {
    const { call, send } = answering({ structuredContent: { status: 200, body: [] } });
    await send("/api/projects", {});
    expect(call).toHaveBeenCalledWith(
      PANEL_REQUEST_TOOL,
      { method: "GET", path: "/api/projects" },
      undefined,
    );
  });

  it("passes a refusal through as its status, for request() to read", async () => {
    const { send } = answering({
      structuredContent: { status: 403, body: { error: "forbidden" } },
    });
    const response = await send("/api/me", {});
    expect(response.ok).toBe(false);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
  });

  it("gives a bodiless status a JSON body anyway", async () => {
    const { send } = answering({ structuredContent: { status: 204 } });
    const response = await send("/api/projects/p1/terminal", { method: "DELETE" });
    expect(response.ok).toBe(true);
    expect(await response.json()).toBeNull();
  });

  it("throws the tool's own words when the call itself failed", async () => {
    const { send } = answering({
      isError: true,
      content: [{ type: "text", text: "Not allowed." }],
    });
    await expect(send("/api/admin/overview", {})).rejects.toThrow("Not allowed.");
  });

  it.each([{}, { status: "200" }, { status: 42 }])(
    "refuses an unreadable answer %j",
    async (content) => {
      const { send } = answering({ structuredContent: content });
      await expect(send("/api/me", {})).rejects.toThrow(/unreadable/);
    },
  );

  it("refuses a body that is not JSON", async () => {
    const { call, send } = answering({ structuredContent: { status: 200 } });
    await expect(send("/api/x", { method: "POST", body: new Blob(["x"]) })).rejects.toThrow(/JSON/);
    await expect(send("/api/x", { method: "POST", body: "{nope" })).rejects.toThrow(/JSON/);
    expect(call).not.toHaveBeenCalled();
  });
});
