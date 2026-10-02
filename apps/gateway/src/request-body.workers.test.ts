import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  limitRequestBody,
  MAX_API_BODY_BYTES,
  MAX_AUTH_BODY_BYTES,
  MAX_WEBHOOK_BODY_BYTES,
  requestBodyLimit,
} from "./request-body.js";

function chunked(parts: string[], headers?: HeadersInit): Request {
  const encoder = new TextEncoder();
  return new Request("https://exeora.dev/oauth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (const part of parts) controller.enqueue(encoder.encode(part));
        controller.close();
      },
    }),
  });
}

describe("request body memory boundaries", () => {
  it("keeps file and MCP payload capacity separate from small OAuth forms", () => {
    expect(requestBodyLimit("/oauth/register")).toBe(MAX_AUTH_BODY_BYTES);
    expect(requestBodyLimit("/api/projects/p/workspace")).toBe(MAX_API_BODY_BYTES);
    expect(requestBodyLimit("/p/p/mcp")).toBe(MAX_API_BODY_BYTES);
    expect(requestBodyLimit("/mcp")).toBe(MAX_API_BODY_BYTES);
    expect(requestBodyLimit("/api/github/webhook")).toBe(MAX_WEBHOOK_BODY_BYTES);
    expect(requestBodyLimit("/docs/security/")).toBeUndefined();
  });

  it("preserves exact bytes at the limit and request authentication metadata", async () => {
    const original = chunked(["ab", "é"], { Authorization: "Bearer test" });
    const bounded = limitRequestBody(original, 4);
    expect(await bounded.request.text()).toBe("abé");
    expect(bounded.request.headers.get("Authorization")).toBe("Bearer test");
    expect(bounded.request.url).toBe(original.url);
    expect(bounded.exceeded()).toBe(false);
  });

  it.each([undefined, { "Content-Length": "1" }])(
    "counts actual chunked bytes with absent or understated lengths: %s",
    async (headers) => {
      const bounded = limitRequestBody(chunked(["ab", "é", "x"], headers), 4);
      await expect(bounded.request.text()).rejects.toThrow();
      expect(bounded.exceeded()).toBe(true);
    },
  );

  it("refuses a declared oversized payload before any body read", async () => {
    let reads = 0;
    const request = new Request("https://exeora.dev/oauth/register", {
      method: "POST",
      headers: { "Content-Length": String(MAX_AUTH_BODY_BYTES + 1) },
      body: new ReadableStream<Uint8Array>(
        {
          pull() {
            reads++;
          },
        },
        { highWaterMark: 0 },
      ),
    });
    const bounded = limitRequestBody(request, MAX_AUTH_BODY_BYTES);
    expect(bounded.exceeded()).toBe(true);
    expect(reads).toBe(0);
  });

  it("returns 413 for oversized OAuth bodies even when JSON parsing catches the error", async () => {
    const response = await SELF.fetch("https://exeora.dev/oauth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: `${" ".repeat(MAX_AUTH_BODY_BYTES)}{}`,
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "request_too_large" });
  });

  it("lets normal small OAuth requests reach the existing provider validation", async () => {
    const response = await SELF.fetch("https://exeora.dev/oauth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    // A valid small DCR request reaches the existing provider validation.
    expect(response.status).toBe(400);
  });
});
