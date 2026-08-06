import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolOutput } from "@exeora/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executeTool, type ToolContext } from "./index.js";

let root: string;
let context: ToolContext;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "exeora-tools-")));
  context = { root };

  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, "node_modules", "dep"), { recursive: true });
  await mkdir(join(root, "build"), { recursive: true });

  await writeFile(join(root, ".gitignore"), "build/\n*.log\n");
  await writeFile(join(root, "src", "main.ts"), "const NEEDLE = 1;\nconst other = 2;\n");
  await writeFile(join(root, "src", "util.ts"), "export const helper = () => NEEDLE;\n");
  await writeFile(join(root, "README.md"), "# Project\n");
  await writeFile(join(root, "build", "bundle.js"), "const NEEDLE = 'built';\n");
  await writeFile(join(root, "debug.log"), "NEEDLE in a log\n");
  await writeFile(join(root, "node_modules", "dep", "index.js"), "const NEEDLE = 'dep';\n");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const run = <T>(tool: Parameters<typeof executeTool>[1], args: unknown) =>
  executeTool(context, tool, args) as Promise<T>;

describe("read_file", () => {
  it("returns file contents", async () => {
    const result = await run<ToolOutput<"read_file">>("read_file", { path: "src/main.ts" });
    expect(result.content).toContain("const NEEDLE = 1;");
    expect(result.path).toBe("src/main.ts");
    expect(result.truncated).toBe(false);
  });

  it("refuses to leave the project", async () => {
    await expect(run("read_file", { path: "../../etc/passwd" })).rejects.toMatchObject({
      code: "PATH_ESCAPE",
    });
  });
});

describe("list_files", () => {
  it("lists the root without recursing", async () => {
    const result = await run<ToolOutput<"list_files">>("list_files", {});
    const paths = result.entries.map((entry) => entry.path).sort();
    expect(paths).toContain("src");
    expect(paths).toContain("README.md");
    // Present in the directory but excluded by .gitignore and the always-skip list.
    expect(paths).not.toContain("build");
    expect(paths).not.toContain("node_modules");
  });

  it("reports entry types and sizes", async () => {
    const result = await run<ToolOutput<"list_files">>("list_files", {});
    expect(result.entries.find((e) => e.path === "src")?.type).toBe("directory");
    const readme = result.entries.find((e) => e.path === "README.md");
    expect(readme?.type).toBe("file");
    expect(readme?.size).toBeGreaterThan(0);
  });

  it("recurses and filters by glob", async () => {
    const result = await run<ToolOutput<"list_files">>("list_files", {
      recursive: true,
      glob: "**/*.ts",
    });
    expect(result.entries.map((e) => e.path).sort()).toEqual(["src/main.ts", "src/util.ts"]);
  });
});

describe("grep", () => {
  it("skips node_modules and gitignored files, which pi's own grep does not", async () => {
    const result = await run<ToolOutput<"grep">>("grep", { pattern: "NEEDLE" });
    const paths = result.matches.map((match) => match.path).sort();
    expect(paths).toEqual(["src/main.ts", "src/util.ts"]);
  });

  it("reports 1-based line numbers", async () => {
    const result = await run<ToolOutput<"grep">>("grep", { pattern: "other" });
    expect(result.matches).toEqual([{ path: "src/main.ts", line: 2, text: "const other = 2;" }]);
  });

  it("honours caseInsensitive", async () => {
    expect((await run<ToolOutput<"grep">>("grep", { pattern: "needle" })).matches).toHaveLength(0);
    expect(
      (await run<ToolOutput<"grep">>("grep", { pattern: "needle", caseInsensitive: true })).matches
        .length,
    ).toBeGreaterThan(0);
  });

  it("truncates at maxResults instead of returning everything", async () => {
    const result = await run<ToolOutput<"grep">>("grep", { pattern: "NEEDLE", maxResults: 1 });
    expect(result.matches).toHaveLength(1);
    expect(result.truncated).toBe(true);
  });

  it("reports a bad regular expression as invalid arguments", async () => {
    await expect(run("grep", { pattern: "[unclosed" })).rejects.toMatchObject({
      code: "INVALID_ARGUMENTS",
    });
  });
});

describe("edit_file", () => {
  it("replaces a unique string and returns a diff", async () => {
    const result = await run<ToolOutput<"edit_file">>("edit_file", {
      path: "src/main.ts",
      oldString: "const other = 2;",
      newString: "const other = 3;",
    });
    expect(await readFile(join(root, "src", "main.ts"), "utf8")).toContain("const other = 3;");
    expect(result.diff).toContain("const other = 3;");
  });

  it("refuses an ambiguous match rather than guessing", async () => {
    await writeFile(join(root, "src", "dup.ts"), "let x = 1;\nlet x = 1;\n");
    await expect(
      run("edit_file", { path: "src/dup.ts", oldString: "let x = 1;", newString: "let y = 1;" }),
    ).rejects.toThrow(/unique|occurrence/i);
  });
});

describe("write_file", () => {
  it("creates a new file and reports it as created", async () => {
    const result = await run<ToolOutput<"write_file">>("write_file", {
      path: "src/new.ts",
      content: "export const x = 1;\n",
    });
    expect(result.created).toBe(true);
    expect(result.bytesWritten).toBe(20);
    expect(await readFile(join(root, "src", "new.ts"), "utf8")).toBe("export const x = 1;\n");
  });

  it("creates missing parent directories, as the description promises", async () => {
    const result = await run<ToolOutput<"write_file">>("write_file", {
      path: "a/b/c/deep.ts",
      content: "export {};\n",
    });
    expect(result.created).toBe(true);
    expect(await readFile(join(root, "a", "b", "c", "deep.ts"), "utf8")).toBe("export {};\n");
  });

  it("reports an overwrite as not created", async () => {
    const result = await run<ToolOutput<"write_file">>("write_file", {
      path: "README.md",
      content: "# Changed\n",
    });
    expect(result.created).toBe(false);
  });

  it("cannot plant a file outside the project through a symlink", async () => {
    const outside = await mkdtemp(join(tmpdir(), "exeora-outside-"));
    await symlink(outside, join(root, "escape"));
    await expect(
      run("write_file", { path: "escape/planted.txt", content: "x" }),
    ).rejects.toMatchObject({ code: "PATH_ESCAPE" });
    await rm(outside, { recursive: true, force: true });
  });
});

describe("run_command", () => {
  it("runs in the project root and captures stdout", async () => {
    const result = await run<ToolOutput<"run_command">>("run_command", { command: "pwd" });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(root);
    expect(result.timedOut).toBe(false);
  });

  it("reports a non-zero exit without throwing, so the agent can read stderr", async () => {
    const result = await run<ToolOutput<"run_command">>("run_command", {
      command: "echo boom >&2; exit 3",
    });
    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain("boom");
  });

  it("runs in a subdirectory when asked", async () => {
    const result = await run<ToolOutput<"run_command">>("run_command", {
      command: "pwd",
      cwd: "src",
    });
    expect(result.stdout.trim()).toBe(join(root, "src"));
  });

  it("refuses a cwd outside the project", async () => {
    await expect(run("run_command", { command: "pwd", cwd: "../.." })).rejects.toMatchObject({
      code: "PATH_ESCAPE",
    });
  });

  it("kills a command that exceeds its budget", async () => {
    const result = await run<ToolOutput<"run_command">>("run_command", {
      command: "sleep 30",
      timeoutMs: 1_000,
    });
    expect(result.timedOut).toBe(true);
  });

  it("does not hang on a command that reads stdin", async () => {
    const result = await run<ToolOutput<"run_command">>("run_command", {
      command: "cat",
      timeoutMs: 5_000,
    });
    expect(result.timedOut).toBe(false);
  });
});

describe("argument validation", () => {
  it("rejects arguments that do not match the shared schema", async () => {
    await expect(run("read_file", {})).rejects.toMatchObject({ code: "INVALID_ARGUMENTS" });
    await expect(run("run_command", { command: "ls", timeoutMs: 999 })).rejects.toMatchObject({
      code: "INVALID_ARGUMENTS",
    });
  });

  it("rejects an unknown tool", async () => {
    await expect(executeTool(context, "rm_rf" as never, {})).rejects.toBeTruthy();
  });
});
