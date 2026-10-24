// Ordinary file writes and patches carry at most 1 MB of text. Leave room for
// their JSON envelope while bounding parsing before tool validation begins.
export const MAX_MCP_BODY_BYTES = 2 * 1024 * 1024;

// Count nested array entries and object keys before Zod visits tool arguments,
// including arguments for proxied tools whose schemas come from another server.
export const MAX_MCP_INPUT_ELEMENTS = 10_000;
