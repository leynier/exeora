import { expect, it, vi } from "vitest";
import { MAX_OUTPUT_TEXT_CHARS } from "./http.js";
import { grantOf, openai } from "./openai.js";

const request = {
  model: "gpt-5.5",
  system: "Write a commit",
  user: "Staged patch",
  signal: new AbortController().signal,
};
const credential = { kind: "oauth" as const, access: "test-access", accountId: "acct_test" };
const event = (type: string, fields = {}) => `data: ${JSON.stringify({ type, ...fields })}\n\n`;

it("derives Codex expiry from the access JWT when expires_in is absent", () => {
  const exp = Math.floor(Date.now() / 1000) + 60;
  const access = `e30.${btoa(JSON.stringify({ exp }))}.test-signature`;
  expect(grantOf({ access_token: access, refresh_token: "test-refresh" }).expiresAt).toBe(
    exp * 1000,
  );
  expect(grantOf({ access_token: access, expires_in: 3600 }).expiresAt).toBe(exp * 1000);
});

function generate(text: string, keepOpen = false) {
  const cancelled = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      if (!keepOpen) controller.close();
    },
    cancel: cancelled,
  });
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    expect(url).toBe("https://chatgpt.com/backend-api/codex/responses");
    expect(init?.redirect).toBe("manual");
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer test-access");
    expect(headers.get("chatgpt-account-id")).toBe("acct_test");
    expect(headers.get("originator")).toBe("codex_cli_rs");
    expect(JSON.parse(String(init?.body))).toMatchObject({ store: false, stream: true });
    return new Response(body);
  });
  return { result: openai.generate(fetcher, credential, request), cancelled };
}

it("uses canonical completed text and stops reading a completed Codex stream", async () => {
  const { result, cancelled } = generate(
    event("response.output_text.delta", { delta: "partial" }) +
      event("response.completed", {
        response: {
          output: [
            { type: "message", content: [{ type: "output_text", text: "Complete message" }] },
          ],
        },
      }),
    true,
  );
  await expect(result).resolves.toBe("Complete message");
  expect(cancelled).toHaveBeenCalledOnce();
});

it.each(["response.failed", "response.incomplete", "error", "EOF"])(
  "rejects partial output followed by %s",
  async (terminal) => {
    const { result } = generate(
      event("response.output_text.delta", { delta: "partial" }) +
        (terminal === "EOF" ? "" : event(terminal)),
    );
    await expect(result).rejects.toMatchObject({ kind: "unavailable" });
  },
);

it("bounds output and cancels an unfinished provider stream", async () => {
  const { result, cancelled } = generate(
    event("response.output_text.delta", { delta: "x".repeat(MAX_OUTPUT_TEXT_CHARS + 1) }),
    true,
  );
  await expect(result).rejects.toMatchObject({ kind: "unavailable" });
  expect(cancelled).toHaveBeenCalledOnce();
});
