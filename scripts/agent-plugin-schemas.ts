import Ajv2020 from "ajv/dist/2020.js";
import mcpSchema from "./schemas/agent-plugins-1.0.0/mcp.schema.json";
import pluginSchema from "./schemas/agent-plugins-1.0.0/plugin.schema.json";

const ajv = new Ajv2020({ allErrors: true });
const validateManifest = ajv.compile(pluginSchema);
const validateMcp = ajv.compile(mcpSchema);

/** Validate against the official offline Agent Plugins 1.0.0 Draft 2020-12 schemas. */
export function validateAgentPluginDocuments(manifest: unknown, mcp: unknown): void {
  if (!validateManifest(manifest))
    throw new Error(`Agent plugin schema: ${ajv.errorsText(validateManifest.errors)}`);
  if (!validateMcp(mcp)) throw new Error(`Agent MCP schema: ${ajv.errorsText(validateMcp.errors)}`);
}
