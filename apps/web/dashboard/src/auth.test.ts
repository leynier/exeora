import { describe, expect, it } from "vitest";
import { safeReturnTo } from "./auth.js";

const ORIGIN = "https://exeora.dev";

describe("safeReturnTo", () => {
  it("keeps dashboard deep links, queries and hashes", () => {
    expect(safeReturnTo("/dashboard/projects/p1?tab=activity#history", ORIGIN)).toBe(
      "/dashboard/projects/p1?tab=activity#history",
    );
  });

  it("normalizes the dashboard root", () => {
    expect(safeReturnTo("/dashboard", ORIGIN)).toBe("/dashboard/");
  });

  it.each([
    "https://evil.example/steal",
    "//evil.example/steal",
    "javascript:alert(1)",
    "/settings",
    "dashboard/projects",
    "",
    null,
  ])("falls back for an unsafe destination %s", (value) => {
    expect(safeReturnTo(value, ORIGIN)).toBe("/dashboard/");
  });
});
