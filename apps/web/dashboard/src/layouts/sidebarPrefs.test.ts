import { describe, expect, it } from "vitest";
import {
  clampSidebarWidth,
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  parseSidebarWidth,
} from "./sidebarPrefs.js";

describe("clampSidebarWidth", () => {
  it("keeps a value in the allowed range", () => {
    expect(clampSidebarWidth(280)).toBe(280);
    expect(clampSidebarWidth(MIN_SIDEBAR_WIDTH - 40)).toBe(MIN_SIDEBAR_WIDTH);
    expect(clampSidebarWidth(MAX_SIDEBAR_WIDTH + 80)).toBe(MAX_SIDEBAR_WIDTH);
  });

  it("falls back when the value is not a number", () => {
    expect(clampSidebarWidth(Number.NaN)).toBe(DEFAULT_SIDEBAR_WIDTH);
    expect(clampSidebarWidth(Number.POSITIVE_INFINITY)).toBe(DEFAULT_SIDEBAR_WIDTH);
  });
});

describe("parseSidebarWidth", () => {
  it("reads a stored pixel width", () => {
    expect(parseSidebarWidth("320")).toBe(320);
  });

  it("uses the default for missing or junk values", () => {
    expect(parseSidebarWidth(null)).toBe(DEFAULT_SIDEBAR_WIDTH);
    expect(parseSidebarWidth("")).toBe(DEFAULT_SIDEBAR_WIDTH);
    expect(parseSidebarWidth("wide")).toBe(DEFAULT_SIDEBAR_WIDTH);
  });
});
