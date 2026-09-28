import { describe, expect, it } from "vitest";
import {
  appendEvent,
  appendNote,
  formatClock,
  formatDuration,
  isHeartbeatAck,
  type LogEvent,
  type LogLine,
  MAX_LINES,
  parseLogEvent,
  runningCount,
} from "./logsModel.js";

const start = (id: string, at = 1_000): LogEvent => ({
  type: "log.start",
  id,
  at,
  kind: "tool",
  tool: "run_command",
  summary: "git status",
  client: "claude-code 2.1.0",
});

const end = (id: string, ok = true): LogEvent => ({
  type: "log.end",
  id,
  at: 2_000,
  tool: "run_command",
  ok,
  durationMs: 840,
  ...(ok ? {} : { errorCode: "TOOL_FAILED" }),
});

describe("parseLogEvent", () => {
  it("reads a start and an end", () => {
    expect(parseLogEvent(JSON.stringify(start("a")))).toEqual(start("a"));
    expect(parseLogEvent(JSON.stringify(end("a", false)))).toEqual(end("a", false));
  });

  it("drops what is not an event", () => {
    expect(parseLogEvent('{"type":"heartbeat.ack"}')).toBeNull();
    expect(parseLogEvent("not json")).toBeNull();
    expect(parseLogEvent('{"type":"log.end","id":"a","at":1,"tool":"x"}')).toBeNull();
    expect(parseLogEvent("null")).toBeNull();
  });
});

describe("appendEvent", () => {
  it("adds a line per event, in order", () => {
    let lines: LogLine[] = [];
    lines = appendEvent(lines, start("a"));
    lines = appendEvent(lines, end("a"));
    expect(lines.map((line) => line.kind)).toEqual(["start", "end"]);
    expect(lines[0]).toMatchObject({ tool: "run_command", summary: "git status", mcp: false });
    expect(lines[1]).toMatchObject({ ok: true, durationMs: 840 });
  });

  it("never shows the same start or end twice, as after a reconnect", () => {
    let lines: LogLine[] = [];
    lines = appendEvent(lines, start("a"));
    const again = appendEvent(lines, start("a"));
    expect(again).toBe(lines);
    lines = appendEvent(lines, end("a"));
    expect(appendEvent(lines, end("a"))).toBe(lines);
  });

  it("keeps the newest lines when there are too many", () => {
    let lines: LogLine[] = [];
    for (let index = 0; index < MAX_LINES + 5; index++)
      lines = appendEvent(lines, start(`c${index}`));
    expect(lines).toHaveLength(MAX_LINES);
    expect(lines[0]?.key).toBe("start:c5");
  });
});

describe("a reconnect", () => {
  it("ends what finished while the tab was away, and nothing it never saw", () => {
    let lines: LogLine[] = [];
    lines = appendEvent(lines, start("gone"));
    lines = appendEvent(lines, start("still"));
    lines = appendEvent(lines, start("done"));
    lines = appendEvent(lines, end("done"));
    lines = appendEvent(lines, { type: "log.sync", at: 5_000, running: ["still", "never-seen"] });
    expect(lines.at(-1)).toEqual({
      key: "end:gone",
      kind: "end",
      at: 5_000,
      tool: "run_command",
      ok: null,
    });
    expect(lines.filter((line) => line.kind === "end")).toHaveLength(2);
    expect(runningCount(lines)).toBe(1);
    const again = appendEvent(lines, { type: "log.sync", at: 6_000, running: ["still"] });
    expect(again).toBe(lines);
  });

  it("reads the list of what runs, and tells a heartbeat's answer apart", () => {
    expect(parseLogEvent('{"type":"log.sync","at":1,"running":["a",2]}')).toEqual({
      type: "log.sync",
      at: 1,
      running: ["a"],
    });
    expect(isHeartbeatAck('{"type":"heartbeat.ack"}')).toBe(true);
    expect(isHeartbeatAck('{"type":"log.start","summary":"heartbeat.ack"}')).toBe(false);
    expect(isHeartbeatAck("nope")).toBe(false);
  });
});

describe("runningCount", () => {
  it("counts the calls that started and have not ended", () => {
    let lines: LogLine[] = [];
    lines = appendEvent(lines, start("a"));
    lines = appendEvent(lines, start("b"));
    lines = appendNote(lines, "Reconnected.");
    lines = appendEvent(lines, end("a"));
    expect(runningCount(lines)).toBe(1);
  });
});

describe("formatting", () => {
  it("writes a duration short at any length", () => {
    expect(formatDuration(0)).toBe("0ms");
    expect(formatDuration(840)).toBe("840ms");
    expect(formatDuration(12_400)).toBe("12.4s");
    expect(formatDuration(185_000)).toBe("3m 05s");
  });

  it("writes the time as hours, minutes and seconds", () => {
    expect(formatClock(new Date(2026, 0, 2, 9, 4, 3).getTime())).toBe("09:04:03");
  });
});
