import { isDeepStrictEqual } from "node:util";
import { validateAgentPluginDocuments } from "./agent-plugin-schemas.js";
import {
  archivePluginPackage,
  packageJson,
  readPluginPackage,
  validatePackageSkills,
} from "./plugin-package.js";

export const AGENT_PLUGIN_LABEL = "Agent Plugin";
export const AGENT_PLUGIN_DOWNLOAD = "/downloads/exeora-agent-plugin.zip";
export const AGENT_PLUGIN_METADATA = "/downloads/exeora-agent-plugin.json";

/** Schema conformance and pure-distribution constraints are checked separately. */
export function buildAgentPluginBundle(root: string) {
  const entries = readPluginPackage(
    root,
    "exeora-agent",
    /^(plugin\.json|mcp\.json|README\.md|skills\/exeora-(setup|project|workspace)\/SKILL\.md)$/,
    /^(skills|skills\/exeora-(setup|project|workspace))$/,
  );
  const manifest = packageJson(entries, "plugin.json");
  const mcp = packageJson(entries, "mcp.json");
  validateAgentPluginDocuments(manifest, mcp);
  if (Object.hasOwn(manifest, "extensions"))
    throw new Error("Pure Agent Plugin cannot contain extensions");
  if (manifest.name !== "exeora-agent-plugin" || !/^\d+\.\d+\.\d+$/.test(manifest.version))
    throw new Error("Invalid Agent Plugin identity");
  // The schema permits literal headers; this public package deliberately permits none.
  if (
    !isDeepStrictEqual(mcp, {
      $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
      mcpServers: { exeora: { type: "streamable-http", url: "https://exeora.dev/mcp" } },
    })
  )
    throw new Error("Agent Plugin needs the fixed credential-free Exeora endpoint");
  validatePackageSkills(entries);
  return archivePluginPackage(entries, manifest.version);
}
