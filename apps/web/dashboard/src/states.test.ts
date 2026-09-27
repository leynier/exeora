import { describe, expect, it } from "vitest";
import {
  instanceExceptions,
  instanceSummary,
  isInFlight,
  isReachable,
  runtimeHint,
  STATES,
  stateView,
} from "./states.js";

describe("stateView", () => {
  it("draws every state of the vocabulary under its own word", () => {
    expect(STATES).toEqual([
      "online",
      "asleep",
      "offline",
      "setting up",
      "failed",
      "not cloned",
      "removing",
      "removed",
    ]);
    for (const state of STATES) {
      expect(stateView(state).label).toBe(state);
      expect(stateView(state).meaning.length).toBeGreaterThan(0);
    }
  });

  it("keeps red for what failed and green for what answers", () => {
    expect(stateView("online")).toMatchObject({ tone: "success", live: true });
    expect(stateView("failed").tone).toBe("error");
    expect(stateView("setting up").tone).toBe("brand");
    for (const state of ["asleep", "offline", "not cloned", "removing", "removed"]) {
      expect(stateView(state)).toMatchObject({ tone: "neutral", live: false });
    }
  });

  it("shows a state it has never heard of as it came", () => {
    expect(stateView("hibernating")).toEqual({
      label: "hibernating",
      tone: "neutral",
      live: false,
      meaning: "",
    });
  });
});

describe("isReachable", () => {
  it("opens what is running or a call away from it, and nothing else", () => {
    expect(isReachable("online")).toBe(true);
    expect(isReachable("asleep")).toBe(true);
    expect(isReachable("setting up")).toBe(false);
    expect(isReachable("failed")).toBe(false);
    expect(isReachable("removing")).toBe(false);
  });
});

describe("isInFlight", () => {
  it("names the two states that settle on their own", () => {
    expect(STATES.filter(isInFlight)).toEqual(["setting up", "removing"]);
  });
});

describe("runtimeHint", () => {
  it("says what the provider reports and nothing when it was not asked", () => {
    expect(runtimeHint("running")).toBe("running");
    expect(runtimeHint("warm")).toContain("warm");
    expect(runtimeHint("cold")).toContain("cold");
    expect(runtimeHint(null)).toBeNull();
    expect(runtimeHint("unknown")).toBeNull();
  });
});

describe("instanceSummary", () => {
  it("counts what is running and what is asleep", () => {
    expect(instanceSummary(["online", "online", "asleep"])).toBe("2 running · 1 asleep");
    expect(instanceSummary(["asleep", "failed"])).toBe("0 running · 1 asleep");
    expect(instanceSummary([])).toBe("none");
  });

  it("names the rest apart, and says nothing when there is none", () => {
    expect(instanceExceptions(["online", "failed", "setting up", "failed"])).toBe(
      "2 failed · 1 setting up",
    );
    expect(instanceExceptions(["online", "asleep"])).toBe("");
  });
});
