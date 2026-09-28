import { describe, expect, it } from "vitest";
import { parseSse, SseParser, sseEvents } from "./sse.js";

describe("SseParser", () => {
  it("hands back events as their blank line arrives, whatever the chunking", () => {
    const parser = new SseParser();
    expect(parser.push('event: response.output_text.delta\ndata: {"delta":"He')).toEqual([]);
    expect(parser.push('llo"}\n\nevent: x\n')).toEqual([
      { event: "response.output_text.delta", data: '{"delta":"Hello"}' },
    ]);
    expect(parser.push("data: 1\ndata: 2\n\n")).toEqual([{ event: "x", data: "1\n2" }]);
    expect(parser.flush()).toEqual([]);
  });

  it("keeps a final block without a trailing blank line, and drops comments and ids", () => {
    expect(parseSse(": keep-alive\nid: 7\ndata: last")).toEqual([
      { event: undefined, data: "last" },
    ]);
    expect(parseSse("\n\n: only a comment\n\n")).toEqual([]);
  });

  it("takes CRLF and strips one leading space of a value", () => {
    expect(parseSse("event:tick\r\ndata:  two spaces\r\n\r\n")).toEqual([
      { event: "tick", data: " two spaces" },
    ]);
  });

  it("reads a body stream", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("data: a\n\nda"));
        controller.enqueue(encoder.encode("ta: b\n\ndata: c"));
        controller.close();
      },
    });
    const events: string[] = [];
    for await (const event of sseEvents(body)) events.push(event.data);
    expect(events).toEqual(["a", "b", "c"]);
  });
});
