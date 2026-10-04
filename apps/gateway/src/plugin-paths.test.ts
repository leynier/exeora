import { describe, expect, it } from "vitest";
import { allowedPanelRoute, trustedPanelOrigin } from "./plugin-panel-routes.js";
import { relativeWorkspacePath, safeRelativePath } from "./plugin-paths.js";

describe("workspace file routing", () => {
  it("opens POSIX and Windows files relative to their checkout", () => {
    expect(relativeWorkspacePath("/work/app/", "/work/app/src/a.ts")).toBe("src/a.ts");
    expect(relativeWorkspacePath("C:\\work\\app", "c:\\work\\APP\\src\\a.ts")).toBe("src/a.ts");
  });
  it.each([
    "/work/app-old/a.ts",
    "/work/app/../secret",
    "/work/app/./a.ts",
    "/work/app",
    "relative/a.ts",
    "/work/app/\0a",
  ])("rejects an outside or noncanonical path: %s", (path) => {
    expect(relativeWorkspacePath("/work/app", path)).toBeNull();
  });
  it.each(["../secret", "/etc/passwd", "C:/secret", "a/../../secret", "a\\b", "a//b", "a/./b"])(
    "rejects unsafe relative panel paths: %s",
    (path) => {
      expect(safeRelativePath(path)).toBe(false);
    },
  );
});

describe("panel route boundary", () => {
  it("admits workspace reads and refuses credentials, account mutation and AI generation", () => {
    expect(allowedPanelRoute("/api/projects/prj_a/workspace/reads", "POST")).toBe(true);
    for (const path of [
      "/api/admin/users",
      "/api/ai/providers",
      "/api/projects/prj_a/gh-token",
      "/api/projects/prj_a/git-credential",
      "/api/projects/prj_a/ai/commit-message",
      "/api/me",
    ])
      expect(allowedPanelRoute(path, "POST")).toBe(false);
    expect(allowedPanelRoute("/api/projects/prj_a/workspace/actions", "GET")).toBe(false);
  });
  it("binds sockets only to supported isolated host origins", () => {
    expect(trustedPanelOrigin("https://exeora.web-sandbox.oaiusercontent.com")).toBe(
      "https://exeora.web-sandbox.oaiusercontent.com",
    );
    for (const origin of [
      "null",
      "https://evil.example",
      "https://web-sandbox.oaiusercontent.com.evil.example",
      "http://exeora.web-sandbox.oaiusercontent.com",
      "https://exeora.web-sandbox.oaiusercontent.com/path",
    ])
      expect(trustedPanelOrigin(origin)).toBeUndefined();
  });
});
