import { createExecutionContext, env } from "cloudflare:test";
import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  PROTOCOL_VERSION_META_KEY,
} from "@modelcontextprotocol/server";
import { createProjectMcpHandler } from "./mcp.js";
import { createAccountMcpHandler } from "./mcp-account.js";
import { payload } from "./mcp-fixtures.js";
import { pluginEnv, props } from "./plugin-extensions-fixtures.js";

export async function post(
  method: string,
  params: Record<string, unknown> = {},
  project?: string,
  modern = false,
) {
  const ctx = createExecutionContext();
  (ctx as unknown as { props: typeof props }).props = props;
  const url = project ? `/p/${project}/mcp` : "/mcp";
  const handler = project
    ? createProjectMcpHandler(
        project,
        async () => ({ kind: "value", value: {} }),
        pluginEnv,
        undefined,
        undefined,
        undefined,
        pluginEnv,
      )
    : createAccountMcpHandler(
        async () => ({ kind: "value", value: {} }),
        async () => ({}),
        pluginEnv,
        undefined,
        undefined,
        pluginEnv,
      );
  const body = await payload(
    await handler(
      new Request(`https://exeora.dev${url}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "MCP-Protocol-Version": modern ? "2026-07-28" : "2025-11-25",
          ...(modern
            ? {
                "Mcp-Method": method,
                ...(typeof params.name === "string" ? { "Mcp-Name": params.name } : {}),
              }
            : {}),
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method,
          params: modern
            ? {
                ...params,
                _meta: {
                  [PROTOCOL_VERSION_META_KEY]: "2026-07-28",
                  [CLIENT_INFO_META_KEY]: { name: "ChatGPT", version: "1" },
                  [CLIENT_CAPABILITIES_META_KEY]: {},
                  ...(params._meta as Record<string, unknown> | undefined),
                },
              }
            : params,
        }),
      }),
      env,
      ctx,
    ),
  );
  if (body.error) throw new Error(JSON.stringify(body.error));
  return body;
}

export async function call(
  name: string,
  args: Record<string, unknown> = {},
  meta?: Record<string, unknown>,
) {
  const body = await post("tools/call", {
    name,
    arguments: args,
    ...(meta ? { _meta: meta } : {}),
  });
  return body.result as {
    isError?: boolean;
    structuredContent?: Record<string, unknown>;
    content: { text: string }[];
  };
}
