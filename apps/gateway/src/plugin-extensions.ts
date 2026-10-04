import { ExeoraError } from "@exeora/protocol";
import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import { getMcpAuthContext } from "agents/mcp/server";
import { z } from "zod";
import { PluginAccess } from "./plugin-access.js";
import { PanelDiff, PanelNavigation, PanelSearch, WorkspaceTab } from "./plugin-navigation.js";
import { panelRequest } from "./plugin-panel-api.js";
import {
  PluginSettings,
  PluginSettingsPatch,
  readPluginSettings,
  settingsView,
  updatePluginSettings,
} from "./plugin-settings.js";
import type { Props } from "./props.js";

export const PANEL_RESOURCE = "ui://exeora/workspace";
export const DASHBOARD_RESOURCE = "ui://exeora/dashboard";
const MIME = "text/html;profile=mcp-app";
const routing = {
  project: z.string().min(1).max(128).optional(),
  workspace: z.string().min(1).max(128).optional(),
};
const file = z
  .object({ name: z.string().min(1).max(255), resourceUri: z.string().min(1).max(4096) })
  .strict();
const selectionSchema = z.object({
  projectId: z.string().nullable(),
  workspace: z.string().nullable(),
  path: z.string().optional(),
  tab: WorkspaceTab.optional(),
  diff: PanelDiff.optional(),
  search: PanelSearch.optional(),
  settings: PluginSettings,
  gatewayOrigin: z.string(),
});
const appOnly = { ui: { visibility: ["app"] } };
const uiMeta = { ui: { resourceUri: PANEL_RESOURCE } };
export const FILE_EXTENSIONS = [
  ".txt",
  ".md",
  ".mdx",
  ".json",
  ".jsonc",
  ".yaml",
  ".yml",
  ".toml",
  ".xml",
  ".csv",
  ".log",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".html",
  ".css",
  ".scss",
  ".py",
  ".rs",
  ".go",
  ".java",
  ".kt",
  ".swift",
  ".c",
  ".h",
  ".cpp",
  ".cs",
  ".sh",
  ".ps1",
  ".sql",
  ".vue",
  ".svelte",
  ".astro",
  ".dart",
  ".rb",
  ".php",
  ".svg",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".ico",
  ".bmp",
  ".ipynb",
  ".env",
  ".gitignore",
  ".ini",
  ".conf",
];

function result(value: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent: value,
  };
}
async function guarded(fn: () => Promise<Record<string, unknown>>) {
  try {
    return result(await fn());
  } catch (error) {
    const message =
      error instanceof ExeoraError
        ? error.message
        : "The Exeora panel could not complete the request. Please retry.";
    return { isError: true, content: [{ type: "text" as const, text: message }] };
  }
}

/** Host metadata is not a routing authority: PluginAccess still checks the grant and root. */
export function openedResourcePath(ctx: ServerContext): string | undefined {
  const metadata = ctx.mcpReq._meta as Record<string, unknown> | undefined;
  const resource = metadata?.["openai/resource"] as { path?: unknown } | undefined;
  return typeof resource?.path === "string" && resource.path.length <= 4096
    ? resource.path
    : undefined;
}

export function registerPluginExtensions(server: McpServer, env: Env, projectId?: string) {
  const access = () =>
    new PluginAccess(env, (getMcpAuthContext()?.props ?? {}) as Props, projectId);
  const settingsCapability = {
    readTool: "exeora_settings_read",
    updateTool: "exeora_settings_update",
  };
  server.server.registerCapabilities({
    experimental: { "openai/settings": settingsCapability },
    extensions: { "openai/settings": settingsCapability },
  });

  server.registerResource(
    "exeora_workspace",
    PANEL_RESOURCE,
    { title: "Exeora Workspace", mimeType: MIME },
    async () => {
      await access().projects();
      const origin = new URL(env.EXEORA_BASE_URL).origin;
      const asset = await env.ASSETS.fetch(new Request(`${origin}/dashboard/mcp-panel`));
      if (!asset.ok || !(asset.headers.get("content-type") ?? "").includes("text/html"))
        throw new Error("Build the Exeora MCP panel before using its resource.");
      const html = (await asset.text())
        .replace("<!--exeora:base-->", `<base href="${origin}/dashboard/" target="_blank">`)
        .replace(/(src|href)="\/(?!\/)/g, `$1="${origin}/`);
      return {
        contents: [
          {
            uri: PANEL_RESOURCE,
            mimeType: MIME,
            text: html,
            _meta: {
              ui: {
                permissions: { clipboardWrite: {} },
                csp: {
                  resourceDomains: [origin],
                  connectDomains: [origin, origin.replace(/^http/, "ws")],
                  baseUriDomains: [origin],
                },
              },
              "openai/ui": {
                preferredDisplayMode: "fullscreen",
                availableDisplayModes: ["inline", "fullscreen"],
              },
              "openai/widgetDescription":
                "Exeora workspace explorer, editor, source control and terminal.",
            },
          },
        ],
      };
    },
  );

  server.registerTool(
    "exeora_open_panel",
    {
      title: "Exeora Workspace",
      description:
        "Open Exeora Workspace beside this conversation. Select its project/workspace and tab, a relative Explorer file, a working or staged diff, or a Search query with filters. When already open, use the instance's exeora_workspace_navigate tool to change its view.",
      inputSchema: PanelNavigation,
      outputSchema: selectionSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: { ...uiMeta, "openai/ui": { entrypoints: [{ type: "thread" }] } },
    },
    (args) => guarded(() => access().selection(args)),
  );

  server.registerResource(
    "exeora_dashboard",
    DASHBOARD_RESOURCE,
    { title: "Exeora Dashboard", mimeType: MIME },
    async () => {
      await access().projects();
      const origin = new URL(env.EXEORA_BASE_URL).origin;
      const asset = await env.ASSETS.fetch(new Request(`${origin}/dashboard/mcp-dashboard`));
      if (!asset.ok || !(asset.headers.get("content-type") ?? "").includes("text/html"))
        throw new Error("Build the Exeora Dashboard Sideapp before using its resource.");
      const html = (await asset.text())
        .replace("<!--exeora:base-->", `<base href="${origin}/dashboard/" target="_blank">`)
        .replace(/(src|href)="\/(?!\/)/g, `$1="${origin}/`);
      return {
        contents: [
          {
            uri: DASHBOARD_RESOURCE,
            mimeType: MIME,
            text: html,
            _meta: {
              ui: {
                permissions: { clipboardWrite: {} },
                csp: {
                  resourceDomains: [origin],
                  connectDomains: [origin, origin.replace(/^http/, "ws")],
                  baseUriDomains: [origin],
                },
              },
              "openai/ui": {
                preferredDisplayMode: "fullscreen",
                availableDisplayModes: ["fullscreen"],
              },
              "openai/widgetDescription": "The full Exeora dashboard with its own user sign-in.",
            },
          },
        ],
      };
    },
  );
  server.registerTool(
    "exeora_open_dashboard",
    {
      title: "Exeora Dashboard",
      description:
        "Open the full Exeora Dashboard Sideapp. The user signs in independently; this does not give the agent additional account permissions.",
      icons: [
        {
          src: `${new URL(env.EXEORA_BASE_URL).origin}/brand/exeora-plugin.svg`,
          mimeType: "image/svg+xml",
        },
      ],
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ gatewayOrigin: z.string() }),
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: {
        ui: { resourceUri: DASHBOARD_RESOURCE },
        "openai/ui": { entrypoints: [{ type: "global" }] },
      },
    },
    () =>
      guarded(async () => {
        await access().projects();
        return { gatewayOrigin: new URL(env.EXEORA_BASE_URL).origin };
      }),
  );

  server.registerTool(
    "exeora_open_file",
    {
      title: "Open in Exeora",
      description: "Open a supported workspace file in the Exeora panel.",
      inputSchema: z.object({ file }).strict(),
      annotations: { readOnlyHint: true },
      _meta: {
        ui: { resourceUri: PANEL_RESOURCE, visibility: ["app"] },
        "openai/ui": { entrypoints: [{ type: "file", extensions: FILE_EXTENSIONS }] },
      },
    },
    (args, ctx) =>
      guarded(async () => {
        const path = openedResourcePath(ctx);
        if (path) return access().resolveFile(path, {});
        await access().projects();
        return { needsResolve: true, file: args.file };
      }),
  );

  server.registerTool(
    "exeora_resolve_file",
    {
      title: "Resolve workspace file",
      inputSchema: z.object({ file, ...routing }).strict(),
      outputSchema: selectionSchema,
      annotations: { readOnlyHint: true },
      _meta: appOnly,
    },
    (args, ctx) =>
      guarded(async () => {
        const path = openedResourcePath(ctx);
        if (!path)
          throw new ExeoraError(
            "INVALID_ARGUMENTS",
            "ChatGPT did not provide a workspace file path. Select the workspace and open the file from its explorer.",
          );
        return access().resolveFile(path, args);
      }),
  );

  server.registerTool(
    "exeora_panel_session",
    {
      title: "Initialize workspace panel",
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true },
      _meta: appOnly,
    },
    () =>
      guarded(async () => ({
        protocol: 1,
        dashboardUrl: `${new URL(env.EXEORA_BASE_URL).origin}/dashboard/`,
        ...(await access().selection({})),
      })),
  );

  server.registerTool(
    "exeora_panel_request",
    {
      title: "Workspace panel request",
      inputSchema: z
        .object({
          path: z.string().min(1).max(8192),
          method: z.enum(["GET", "POST", "PUT", "DELETE"]),
          body: z.record(z.string(), z.unknown()).optional(),
          origin: z.string().max(512).optional(),
        })
        .strict(),
      annotations: { readOnlyHint: false },
      _meta: appOnly,
    },
    (args, ctx) => guarded(() => panelRequest(access(), args, ctx.mcpReq.signal)),
  );

  server.registerTool(
    "exeora_settings_read",
    {
      title: "Exeora plugin settings",
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({
        schema: z.record(z.string(), z.unknown()),
        values: PluginSettings,
        layout: z.array(z.record(z.string(), z.unknown())),
      }),
      annotations: { readOnlyHint: true },
      _meta: appOnly,
    },
    () =>
      guarded(async () => {
        const a = access();
        await a.projects();
        return settingsView(await readPluginSettings(env, a.props, projectId));
      }),
  );

  server.registerTool(
    "exeora_settings_update",
    {
      title: "Update Exeora plugin settings",
      inputSchema: z.object({ set: PluginSettingsPatch }).strict(),
      outputSchema: z.object({ values: PluginSettings }),
      annotations: { readOnlyHint: false, destructiveHint: false },
      _meta: appOnly,
    },
    (args) =>
      guarded(async () => {
        const a = access();
        await a.projects();
        const current = await readPluginSettings(env, a.props, projectId);
        const patch = { ...args.set };
        if (
          patch.defaultProject !== undefined &&
          patch.defaultProject !== current.defaultProject &&
          patch.defaultWorkspace === undefined
        )
          patch.defaultWorkspace = "";
        const next = { ...current, ...patch };
        if (
          (patch.defaultProject !== undefined || patch.defaultWorkspace !== undefined) &&
          next.defaultProject
        ) {
          const project = await a.project(next.defaultProject);
          if (next.defaultWorkspace)
            await a.selection({ project: project.id, workspace: next.defaultWorkspace });
        } else if (!next.defaultProject && next.defaultWorkspace)
          throw new ExeoraError(
            "INVALID_ARGUMENTS",
            "Choose a default project before setting a default workspace.",
          );
        return { values: await updatePluginSettings(env, a.props, patch, projectId) };
      }),
  );
}
