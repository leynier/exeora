import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { relativeToRoot, resolveInProject } from "./paths.js";

/**
 * The specification for the only security control in this release. Every case
 * here is an escape someone would actually try.
 */

let sandbox: string;
let root: string;
let outside: string;

beforeAll(async () => {
  // realpath because macOS hands out /var/... which is a symlink to /private/var.
  sandbox = await realpath(await mkdtemp(join(tmpdir(), "exeora-paths-")));
  root = join(sandbox, "project");
  outside = join(sandbox, "outside");

  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(join(root, "src", "main.ts"), "export {};\n");
  await writeFile(join(outside, "secrets.txt"), "top secret\n");

  // A sibling whose name merely starts with the root's name.
  await mkdir(`${root}-other`, { recursive: true });
  await writeFile(join(`${root}-other`, "leak.txt"), "leak\n");

  await symlink(outside, join(root, "escape-dir"));
  await symlink(join(outside, "secrets.txt"), join(root, "escape-file"));
  await symlink(join(root, "src"), join(root, "inside-link"));
});

afterAll(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

const escapes = (relativePath: string) =>
  expect(resolveInProject({ root, relativePath })).rejects.toMatchObject({
    code: "PATH_ESCAPE",
  });

describe("paths that are allowed", () => {
  it("accepts a plain relative path", async () => {
    await expect(resolveInProject({ root, relativePath: "src/main.ts" })).resolves.toBe(
      join(root, "src", "main.ts"),
    );
  });

  it("accepts the root itself", async () => {
    await expect(resolveInProject({ root, relativePath: "." })).resolves.toBe(root);
  });

  it("accepts a file that does not exist yet, for write_file", async () => {
    await expect(resolveInProject({ root, relativePath: "src/new.ts" })).resolves.toBe(
      join(root, "src", "new.ts"),
    );
  });

  it("accepts .. that stays within the root", async () => {
    await expect(resolveInProject({ root, relativePath: "src/../src/main.ts" })).resolves.toBe(
      join(root, "src", "main.ts"),
    );
  });

  it("accepts a symlink pointing inside the project", async () => {
    await expect(
      resolveInProject({ root, relativePath: "inside-link/main.ts" }),
    ).resolves.toBeTruthy();
  });
});

describe("lexical escapes", () => {
  it("rejects traversal out of the root", () => escapes("../outside/secrets.txt"));
  it("rejects deep traversal", () => escapes("../../../../etc/passwd"));
  it("rejects traversal hidden mid-path", () => escapes("src/../../outside/secrets.txt"));
  it("rejects an absolute path", () => escapes("/etc/passwd"));
  it("rejects an absolute path inside the root, which is still not relative", () =>
    escapes(join(root, "src", "main.ts")));
});

describe("symlink escapes", () => {
  it("rejects reading through a symlinked directory", () => escapes("escape-dir/secrets.txt"));

  it("rejects a symlink to a file outside", () => escapes("escape-file"));

  it("rejects creating a new file under a symlinked directory", () =>
    // The file does not exist, so only the nearest existing ancestor can be
    // resolved — and that ancestor is the symlink pointing out.
    escapes("escape-dir/planted.txt"));
});

describe("prefix confusion", () => {
  it("does not treat a sibling sharing the root's name prefix as inside", () =>
    escapes(`../${"project"}-other/leak.txt`));
});

describe("malformed input", () => {
  it("rejects a NUL byte, which truncates the path inside libc", () =>
    escapes("src/main.ts\0.png"));
});

describe("relativeToRoot", () => {
  it("strips the root so host layout is never echoed back", () => {
    expect(relativeToRoot(root, join(root, "src", "main.ts"))).toBe(`src${sep}main.ts`);
  });

  it("leaves an unrelated path alone rather than mangling it", () => {
    expect(relativeToRoot(root, resolve("/elsewhere/x"))).toBe(resolve("/elsewhere/x"));
  });
});
