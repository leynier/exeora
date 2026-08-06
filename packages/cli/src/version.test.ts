import { describe, expect, it } from "vitest";
import { isOutdated } from "./version.js";

describe("isOutdated", () => {
  it("sees a newer patch, minor and major", () => {
    expect(isOutdated("0.2.1", "0.2.2")).toBe(true);
    expect(isOutdated("0.2.1", "0.3.0")).toBe(true);
    expect(isOutdated("0.2.1", "1.0.0")).toBe(true);
  });

  it("is quiet on the current version and on a newer one", () => {
    expect(isOutdated("0.2.1", "0.2.1")).toBe(false);
    expect(isOutdated("0.3.0", "0.2.9")).toBe(false);
  });

  it("compares numerically rather than as text", () => {
    // The whole reason this is not a string comparison: "0.10.0" < "0.9.0".
    expect(isOutdated("0.9.0", "0.10.0")).toBe(true);
    expect(isOutdated("0.10.0", "0.9.0")).toBe(false);
  });

  it("treats the development version as behind everything published", () => {
    expect(isOutdated("0.0.0-dev", "0.2.1")).toBe(true);
  });

  it("says nothing when either side is not a version", () => {
    // A gateway sending something unexpected must not produce a nonsense line
    // on someone's terminal; saying nothing is the safe direction for a notice.
    expect(isOutdated("0.2.1", "latest")).toBe(false);
    expect(isOutdated("", "0.2.1")).toBe(false);
  });
});
