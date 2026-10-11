import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  archivePluginPackage,
  packageJson,
  readPluginPackage,
  validatePackageSkills,
} from "./plugin-package.js";

export const CURSOR_PLUGIN_LABEL = "GrokBot Cursor";
export const CURSOR_PLUGIN_DOWNLOAD = "/downloads/grokbot-cursor-plugin.zip";
export const CURSOR_PLUGIN_METADATA = "/downloads/grokbot-cursor-plugin.json";

export function buildCursorPluginBundle(root: string) {
  const entries = readPluginPackage(
    root,
    "exeora-cursor",
    /^(\.cursor-plugin\/plugin\.json|mcp\.json|README\.md|assets\/logo\.png|skills\/exeora-(setup|project|workspace)\/SKILL\.md)$/,
    /^(\.cursor-plugin|assets|skills|skills\/exeora-(setup|project|workspace))$/,
  );
  const manifest = packageJson(entries, ".cursor-plugin/plugin.json");
  // displayName is used by Cursor's official plugin-template; the reference table omits it.
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
    "logo",
  ]);
  if (Object.keys(manifest).some((key) => !fields.has(key)))
    throw new Error("Unexpected Cursor manifest field");
  if (
    manifest.name !== "grokbot-cursor" ||
    manifest.displayName !== CURSOR_PLUGIN_LABEL ||
    !/^\d+\.\d+\.\d+$/.test(manifest.version)
  ) {
    throw new Error("Invalid GrokBot Cursor identity");
  }
  if (
    !manifest.description ||
    typeof manifest.description !== "string" ||
    !manifest.author?.name ||
    manifest.logo !== "assets/logo.png" ||
    !entries[manifest.logo]
  ) {
    throw new Error("Invalid Cursor listing metadata or missing logo");
  }
  if (
    !isDeepStrictEqual(packageJson(entries, "mcp.json"), {
      mcpServers: { exeora: { url: "https://exeora.dev/mcp" } },
    })
  ) {
    throw new Error("Cursor needs the fixed credential-free Exeora endpoint");
  }
  const marketplace = JSON.parse(
    readFileSync(join(root, ".cursor-plugin/marketplace.json"), "utf8"),
  );
  if (
    marketplace.name !== "exeora" ||
    marketplace.plugins?.length !== 1 ||
    marketplace.plugins[0].name !== manifest.name ||
    marketplace.plugins[0].source !== "plugins/exeora-cursor"
  ) {
    throw new Error("Invalid Cursor marketplace mapping");
  }
  validatePackageSkills(entries);
  return archivePluginPackage(entries, manifest.version);
}
