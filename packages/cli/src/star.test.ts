import { afterEach, describe, expect, it, vi } from "vitest";
import type { StarPrompt } from "./config.js";
import { afterDecline, afterUnavailable, interactive, tick } from "./star.js";

// Importing `star.js` would otherwise construct the real `Conf` and write to
// the developer's own configuration directory. Only the pure rationing is
// under test here; the store it is persisted to is not.
vi.mock("./config.js", () => ({ config: { get: () => undefined, set: () => {} } }));

const fresh: StarPrompt = { runs: 0, askAt: 3, asked: 0, done: false };

/** Runs the CLI `times` times over, answering nothing, and reports the asks. */
function run(state: StarPrompt, times: number): { state: StarPrompt; asks: number } {
  let current = state;
  let asks = 0;

  for (let index = 0; index < times; index += 1) {
    const { next, consider } = tick(current);
    current = next;
    if (consider) asks += 1;
  }

  return { state: current, asks };
}

describe("tick", () => {
  it("says nothing on the first two runs and asks on the third", () => {
    const first = tick(fresh);
    expect(first.consider).toBe(false);
    expect(first.next.runs).toBe(1);

    const second = tick(first.next);
    expect(second.consider).toBe(false);

    const third = tick(second.next);
    expect(third.consider).toBe(true);
    expect(third.next.runs).toBe(3);
  });

  it("counts the run whether or not it asks", () => {
    expect(run(fresh, 10).state.runs).toBe(10);
  });

  it("is silent forever once the subject is closed", () => {
    expect(run({ ...fresh, done: true }, 100).asks).toBe(0);
  });
});

describe("afterUnavailable", () => {
  it("waits ten runs rather than probing for gh on every one", () => {
    const { next } = tick(run(fresh, 2).state);
    const waiting = afterUnavailable(next);

    expect(waiting.askAt).toBe(13);
    expect(waiting.done).toBe(false);
    expect(waiting.asked).toBe(0);
    // Nine quiet runs, then it looks again.
    expect(run(waiting, 9).asks).toBe(0);
    expect(run(waiting, 10).asks).toBe(1);
  });
});

describe("afterDecline", () => {
  it("goes quiet for thirty runs after the first no", () => {
    const { next } = tick(run(fresh, 2).state);
    const declined = afterDecline(next);

    expect(declined.asked).toBe(1);
    expect(declined.done).toBe(false);
    expect(run(declined, 29).asks).toBe(0);
    expect(run(declined, 30).asks).toBe(1);
  });

  it("closes the subject after the second no", () => {
    const { next } = tick(run(fresh, 2).state);
    const again = tick(run(afterDecline(next), 30).state);
    const twice = afterDecline(again.next);

    expect(twice.asked).toBe(2);
    expect(twice.done).toBe(true);
    expect(run(twice, 1000).asks).toBe(0);
  });
});

describe("interactive", () => {
  const stdin = process.stdin.isTTY;
  const stdout = process.stdout.isTTY;

  function terminal(value: boolean): void {
    process.stdin.isTTY = value;
    process.stdout.isTTY = value;
  }

  afterEach(() => {
    process.stdin.isTTY = stdin;
    process.stdout.isTTY = stdout;
    vi.unstubAllEnvs();
  });

  it("wants a terminal at both ends", () => {
    vi.stubEnv("CI", "");
    terminal(true);
    expect(interactive(false)).toBe(true);

    process.stdout.isTTY = false;
    expect(interactive(false)).toBe(false);
  });

  it("stays out of the way of --json, CI and the opt-out", () => {
    terminal(true);
    vi.stubEnv("CI", "");
    expect(interactive(true)).toBe(false);

    vi.stubEnv("CI", "true");
    expect(interactive(false)).toBe(false);

    vi.stubEnv("CI", "");
    vi.stubEnv("EXEORA_NO_STAR_PROMPT", "1");
    expect(interactive(false)).toBe(false);
  });
});
