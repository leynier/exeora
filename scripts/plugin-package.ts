import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { zipSync } from "fflate";

/** Distribution allowlists are intentionally narrower than either format's specification. */
export function readPluginPackage(root: string, folder: string, allowed: RegExp, dirs: RegExp) {
  const entries: Record<string, Uint8Array> = {};
  const directory = join(root, "plugins", folder);
  function walk(path: string): void {
    const stat = lstatSync(join(directory, path));
    if (stat.isSymbolicLink()) throw new Error(`Symlink in plugin: ${path}`);
    if (stat.isDirectory()) {
      if (path && !dirs.test(path)) throw new Error(`Unexpected plugin directory: ${path}`);
      for (const name of readdirSync(join(directory, path)).sort()) {
        walk(path ? `${path}/${name}` : name);
      }
    } else {
      if (!stat.isFile() || !allowed.test(path)) {
        throw new Error(`Unexpected plugin resource: ${path}`);
      }
      entries[path] = new Uint8Array(readFileSync(join(directory, path)));
    }
  }
  walk("");
  entries.LICENSE = new Uint8Array(readFileSync(join(root, "LICENSE")));
  return entries;
}

export function packageJson(entries: Record<string, Uint8Array>, path: string) {
  if (!entries[path]) throw new Error(`Missing plugin resource: ${path}`);
  return JSON.parse(Buffer.from(entries[path]).toString("utf8"));
}

export function validatePackageSkills(entries: Record<string, Uint8Array>): void {
  const expected = ["exeora-project", "exeora-setup", "exeora-workspace"];
  for (const name of expected) {
    const bytes = entries[`skills/${name}/SKILL.md`];
    const match =
      bytes &&
      /^---\nname: ([a-z0-9-]+)\ndescription: ([^\n<>]+)\n---\n/.exec(
        Buffer.from(bytes).toString(),
      );
    if (!match || match[1] !== name || match[2].length > 1024) {
      throw new Error(`Invalid skill metadata: ${name}`);
    }
  }
  if (Object.keys(entries).filter((path) => path.endsWith("/SKILL.md")).length !== 3) {
    throw new Error("Expected three skills");
  }
  if (!entries["README.md"]) throw new Error("Missing plugin README");
}

export function archivePluginPackage(entries: Record<string, Uint8Array>, version: string) {
  const sorted = Object.fromEntries(
    Object.entries(entries).sort(([a], [b]) => a.localeCompare(b, "en")),
  );
  const archive = zipSync(sorted, { level: 9, mtime: new Date(2000, 0, 1, 12) });
  const sha256 = createHash("sha256").update(archive).digest("hex");
  return { archive, sha256, version, files: Object.keys(sorted) };
}
