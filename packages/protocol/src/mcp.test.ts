import { describe, expect, it } from "vitest";
import { MAX_MCP_TOOL_NAME_LENGTH } from "./limits.js";
import {
  decodeExecutorMessage,
  decodeRelayMessage,
  encodeMessage,
  McpToolDescriptor,
} from "./messages.js";
import { DEFAULT_POLICY, mcpPolicyAllows, needsMcpApproval } from "./policy.js";

/**
 * Tools proxied from upstream MCP servers.
 *
 * Their read-only-ness is a claim their server makes, so every question here
 * has to come out safe when the claim is missing.
 */
describe("the MCP policy", () => {
  const readOnly = { ...DEFAULT_POLICY, mode: "read_only" as const };

  it("refuses a tool that may change something in a read-only project", () => {
    expect(mcpPolicyAllows(readOnly, undefined).allowed).toBe(false);
    expect(mcpPolicyAllows(readOnly, false).allowed).toBe(false);
    expect(mcpPolicyAllows(readOnly, true).allowed).toBe(true);
  });

  it("allows every tool where the mode allows changes", () => {
    expect(mcpPolicyAllows(DEFAULT_POLICY, undefined).allowed).toBe(true);
    expect(mcpPolicyAllows({ ...DEFAULT_POLICY, mode: "allow_list" }, false).allowed).toBe(true);
  });

  it("asks before a tool with no read-only claim when the project asks before changes", () => {
    const approve = { ...DEFAULT_POLICY, approve: true };
    expect(needsMcpApproval(approve, undefined)).toBe(true);
    expect(needsMcpApproval(approve, false)).toBe(true);
    expect(needsMcpApproval(approve, true)).toBe(false);
    expect(needsMcpApproval(DEFAULT_POLICY, undefined)).toBe(false);
  });
});

describe("the MCP wire", () => {
  const tool = {
    exposedName: "mcp__demo__echo",
    server: "demo",
    name: "echo",
    inputSchema: { type: "object" },
    annotations: { readOnlyHint: true },
  };

  it("caps exposed names at the length MCP clients accept", () => {
    const at = `mcp__demo__${"x".repeat(MAX_MCP_TOOL_NAME_LENGTH - 11)}`;
    expect(McpToolDescriptor.safeParse({ ...tool, exposedName: at }).success).toBe(true);
    expect(McpToolDescriptor.safeParse({ ...tool, exposedName: `${at}x` }).success).toBe(false);
    expect(McpToolDescriptor.safeParse({ ...tool, exposedName: "read_file" }).success).toBe(false);
  });

  it("round-trips a catalog and a call that carries the policy", () => {
    const catalog = decodeExecutorMessage(
      encodeMessage({ type: "mcp.catalog", projectId: "prj_a", tools: [tool] }),
    );
    expect(catalog).toMatchObject({ type: "mcp.catalog", tools: [tool] });

    const call = {
      type: "mcp.call" as const,
      requestId: "req_a",
      projectId: "prj_a",
      server: "demo",
      tool: "echo",
      arguments: { message: "hi" },
      policy: DEFAULT_POLICY,
      issuedAt: 1,
      expiresAt: 2,
    };
    expect(decodeRelayMessage(encodeMessage(call))).toEqual(call);
    const { policy: _policy, ...withoutPolicy } = call;
    expect(decodeRelayMessage(encodeMessage(withoutPolicy as never))).toBeNull();
  });

  it("lets an approval question name a proxied tool", () => {
    const question = {
      type: "approval.request" as const,
      id: "apr_a",
      projectId: "prj_a",
      tool: "mcp__demo__echo",
      prompt: "Use `echo` from the `demo` MCP server?",
      expiresAt: 1,
    };
    expect(decodeRelayMessage(encodeMessage(question))).toEqual(question);
  });
});
