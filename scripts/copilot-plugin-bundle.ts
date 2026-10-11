import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { validateAgentPluginDocuments } from "./agent-plugin-schemas.js";
import {
  archivePluginPackage,
  packageJson,
  readPluginPackage,
  validatePackageSkills,
} from "./plugin-package.js";

export const COPILOT_PLUGIN_LABEL = "GitHub Copilot";
export const COPILOT_PLUGIN_DOWNLOAD = "/downloads/exeora-copilot-plugin.zip";
export const COPILOT_PLUGIN_METADATA = "/downloads/exeora-copilot-plugin.json";

export function buildCopilotPluginBundle(root: string) {
  const entries = readPluginPackage(
    root,
    "exeora-copilot",
    /^(plugin\.json|mcp\.json|README\.md|assets\/logo\.png|skills\/exeora-(setup|project|workspace)\/SKILL\.md)$/,
    /^(assets|skills|skills\/exeora-(setup|project|workspace))$/,
  );
  const manifest = packageJson(entries, "plugin.json");
  const mcp = packageJson(entries, "mcp.json");
  validateAgentPluginDocuments(manifest, mcp);
  // No reviewed Copilot contract defines image/interface extension fields.
  if (Object.hasOwn(manifest, "extensions"))
    throw new Error("Unsupported Copilot extension metadata");
  if (manifest.name !== "exeora-copilot" || !/^\d+\.\d+\.\d+$/.test(manifest.version))
    throw new Error("Invalid GitHub Copilot identity");
  if (!entries["assets/logo.png"]) throw new Error("Missing Copilot README logo");
  if (
    !isDeepStrictEqual(mcp, {
      $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
      mcpServers: { exeora: { type: "streamable-http", url: "https://exeora.dev/mcp" } },
    })
  )
    throw new Error("Copilot needs the fixed credential-free Exeora endpoint");
  const marketplace = JSON.parse(
    readFileSync(join(root, ".github/plugin/marketplace.json"), "utf8"),
  );
  if (
    marketplace.name !== "exeora-copilot" ||
    marketplace.plugins?.length !== 1 ||
    marketplace.plugins[0].name !== manifest.name ||
    marketplace.plugins[0].source !== "./plugins/exeora-copilot" ||
    marketplace.plugins[0].version !== manifest.version
  ) {
    throw new Error("Invalid GitHub Copilot marketplace mapping");
  }
  validatePackageSkills(entries);
  return archivePluginPackage(entries, manifest.version);
}
