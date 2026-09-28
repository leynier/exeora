import { describe, expect, it } from "vitest";
import { baseName, fileIconId } from "./fileIconModel.js";
import { FILE_ICON_SVGS } from "./fileIcons/svgs.generated.js";

describe("fileIconId", () => {
  it("names a file by its whole name before its extension", () => {
    expect(fileIconId("package.json", "file")).toBe("nodejs");
    expect(fileIconId("tsconfig.json", "file")).toBe("tsconfig");
    expect(fileIconId("other.json", "file")).toBe("json");
  });

  it("prefers the longest extension the theme knows", () => {
    expect(fileIconId("route.test.ts", "file")).toBe("test-ts");
    expect(fileIconId("route.workers.test.ts", "file")).toBe("test-ts");
    expect(fileIconId("env.d.ts", "file")).toBe("typescript-def");
    expect(fileIconId("route.ts", "file")).toBe("typescript");
    expect(fileIconId("App.tsx", "file")).toBe("react_ts");
  });

  it("compares names without regard to case", () => {
    expect(fileIconId("README.md", "file")).toBe(fileIconId("readme.md", "file"));
    expect(fileIconId("Dockerfile", "file")).toBe(fileIconId("dockerfile", "file"));
    expect(fileIconId("MAIN.RS", "file")).toBe("rust");
  });

  it("reads a path by its last segment", () => {
    expect(fileIconId("apps/web/package.json", "file")).toBe("nodejs");
    expect(fileIconId("apps/web/src/", "directory")).toBe("folder-src");
  });

  it("reads a dotfile's name as its extension", () => {
    expect(fileIconId(".dockerignore", "file")).toBe("docker");
    expect(fileIconId(".gitignore", "file")).toBe("git");
  });

  it("falls back to the plain file and folder", () => {
    expect(fileIconId("notes.unknownext", "file")).toBe("file");
    expect(fileIconId("Makefile.bak", "file")).toBe("file");
    expect(fileIconId("somewhere", "directory")).toBe("folder");
    expect(fileIconId("somewhere", "directory", true)).toBe("folder-open");
  });

  it("names a folder, open and closed", () => {
    expect(fileIconId("src", "directory")).toBe("folder-src");
    expect(fileIconId("src", "directory", true)).toBe("folder-src-open");
    expect(fileIconId(".github", "directory")).toBe("folder-github");
    expect(fileIconId("Components", "directory")).toBe("folder-components");
  });

  it("has markup for every icon it can name", () => {
    const ids = new Set(FILE_ICON_SVGS.map((entry) => entry.slice(0, entry.indexOf(" "))));
    for (const [name, kind] of [
      ["package.json", "file"],
      ["route.test.ts", "file"],
      ["x.unknownext", "file"],
      ["src", "directory"],
      ["nothing-special", "directory"],
    ] as const) {
      expect(ids.has(fileIconId(name, kind))).toBe(true);
      expect(ids.has(fileIconId(name, kind, true))).toBe(true);
    }
    for (const entry of FILE_ICON_SVGS) {
      expect(entry.slice(entry.indexOf(" ") + 1)).toMatch(/^<svg[\s\S]*<\/svg>$/);
    }
  });
});

describe("baseName", () => {
  it("takes the last segment of a path", () => {
    expect(baseName("apps/web/src/main.tsx")).toBe("main.tsx");
    expect(baseName("apps/web/")).toBe("web");
    expect(baseName("README.md")).toBe("README.md");
  });
});
