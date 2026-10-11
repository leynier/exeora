import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { zipSync } from "fflate";

export const CLAUDE_PLUGIN_ZIP = "/downloads/exeora-claude-plugin.zip";
export const CLAUDE_PLUGIN_DOWNLOAD = "/downloads/exeora-claude.plugin";
export const CLAUDE_PLUGIN_METADATA = "/downloads/exeora-claude-plugin.json";

/** Claude web accepts one manifest and a fixed remote connector, with no local runtime. */
export function claudePluginEntries(root: string): Record<string, Uint8Array> {
  const directory = join(root, "plugins/exeora-claude");
  const entries: Record<string, Uint8Array> = {};
  let bytes = 0;
  function walk(path: string): void {
    const absolute = join(directory, path);
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error(`Symlink in Claude plugin: ${path}`);
    if (stat.isDirectory()) {
      for (const name of readdirSync(absolute).sort()) walk(path ? `${path}/${name}` : name);
      return;
    }
    if (!stat.isFile()) throw new Error(`Not a regular Claude plugin file: ${path}`);
    if (
      !/^(\.claude-plugin\/plugin\.json|\.mcp\.json|README\.md|assets\/[a-z0-9-]+\.(png|svg)|skills\/[a-z0-9-]+\/SKILL\.md)$/.test(
        path,
      )
    ) {
      throw new Error(`Unexpected Claude plugin resource: ${path}`);
    }
    // Narrow allowlist also satisfies upload path/depth rules, with no scripts or credentials.
    bytes += stat.size;
    if (bytes > 200_000_000 || Object.keys(entries).length >= 5000) {
      throw new Error("Claude plugin exceeds web upload limits");
    }
    entries[path] = new Uint8Array(readFileSync(absolute));
  }
  walk("");
  entries.LICENSE = new Uint8Array(readFileSync(join(root, "LICENSE")));
  if (bytes + entries.LICENSE.length > 200_000_000 || Object.keys(entries).length > 5000) {
    throw new Error("Claude plugin exceeds web upload limits");
  }
  const json = (path: string) => {
    if (!entries[path]) throw new Error(`Missing Claude plugin resource: ${path}`);
    return JSON.parse(Buffer.from(entries[path]).toString("utf8"));
  };
  const manifest = json(".claude-plugin/plugin.json");
  if (manifest.name !== "exeora-workspaces" || !/^\d+\.\d+\.\d+$/.test(manifest.version)) {
    throw new Error("The Claude plugin needs its stable name and a release version");
  }
  const fields = new Set([
    "name",
    "displayName",
    "version",
    "description",
    "author",
    "homepage",
    "repository",
    "license",
    "keywords",
    "icon",
    "documentationUrl",
    "supportUrl",
    "privacyPolicyUrl",
    "termsOfServiceUrl",
  ]);
  if (Object.keys(manifest).some((key) => !fields.has(key))) {
    throw new Error("Unexpected Claude manifest field");
  }
  if (
    typeof manifest.displayName !== "string" ||
    manifest.displayName.length > 64 ||
    typeof manifest.description !== "string" ||
    !manifest.description ||
    manifest.description.length > 500
  ) {
    throw new Error("Invalid Claude listing metadata");
  }
  for (const key of ["documentationUrl", "supportUrl", "privacyPolicyUrl", "termsOfServiceUrl"]) {
    if (typeof manifest[key] !== "string" || !manifest[key].startsWith("https://")) {
      throw new Error(`Invalid Claude listing URL: ${key}`);
    }
  }
  if (typeof manifest.icon !== "string" || !entries[manifest.icon.replace(/^\.\//, "")]) {
    throw new Error("Missing Claude listing icon");
  }
  if (
    !isDeepStrictEqual(json(".mcp.json"), {
      mcpServers: { exeora: { type: "http", url: "https://exeora.dev/mcp" } },
    })
  ) {
    throw new Error("Claude web needs the fixed credential-free Exeora HTTP endpoint");
  }
  // These authored skills intentionally use just the two frontmatter fields shared by web.
  const skills = Object.entries(entries).filter(([path]) => path.endsWith("/SKILL.md"));
  if (skills.length !== 3) throw new Error("Expected three Claude skills");
  for (const [path, contents] of skills) {
    const text = Buffer.from(contents).toString("utf8");
    const match = /^---\nname: ([a-z0-9-]+)\ndescription: ([^\n<>]+)\n---\n/.exec(text);
    if (!match || match[1] !== path.split("/")[1]) {
      throw new Error(`Invalid Claude skill metadata: ${path}`);
    }
  }
  if (!entries["README.md"]) throw new Error("Missing Claude README");
  return Object.fromEntries(Object.entries(entries).sort(([a], [b]) => a.localeCompare(b, "en")));
}

export function buildClaudePluginBundle(root: string) {
  const entries = claudePluginEntries(root);
  const manifest = JSON.parse(Buffer.from(entries[".claude-plugin/plugin.json"]).toString("utf8"));
  // Both .plugin and .zip downloads use these same deterministic DEFLATE ZIP bytes.
  const archive = zipSync(entries, { level: 9, mtime: new Date(2000, 0, 1, 12) });
  const sha256 = createHash("sha256").update(archive).digest("hex");
  return { archive, sha256, version: manifest.version as string, files: Object.keys(entries) };
}
