import { describe, expect, it } from "vitest";
import { slugFromBranch, validBranch } from "./naming.js";

describe("validBranch", () => {
  it("accepts what git accepts", () => {
    for (const branch of ["main", "feature/login-form", "release-1.2", "a/b/c", "x.y", "@x"]) {
      expect(validBranch(branch), branch).toBe(true);
    }
  });

  it("refuses every name git check-ref-format --branch refuses", () => {
    for (const branch of [
      "",
      "-x",
      "x/",
      "/x",
      "a//b",
      "a..b",
      "a b",
      "a~b",
      "a^b",
      "a:b",
      "a?b",
      "a*b",
      "a[b",
      "a\\b",
      "a@{b",
      "@",
      "HEAD",
      "topic.",
      ".hidden",
      "a/.b",
      "x.lock",
      "feature/x.lock/y",
      "tab\tname",
      "x".repeat(256),
    ]) {
      expect(validBranch(branch), JSON.stringify(branch)).toBe(false);
    }
  });
});

describe("slugFromBranch", () => {
  it("derives the slug the CLI would", () => {
    expect(slugFromBranch("feature/Login Form")).toBe("feature-login-form");
    expect(slugFromBranch("main")).toBe("main-branch");
    expect(slugFromBranch("///")).toBe("workspace-branch");
  });
});
