import { z } from "zod";
import type { Props } from "./props.js";

/** Preferences are scoped to the authenticated connection, never shared across users. */
export const PluginSettings = z.object({
  defaultProject: z.string().max(128).default(""),
  defaultWorkspace: z.string().max(128).default(""),
  defaultTab: z.enum(["files", "source-control", "search"]).default("files"),
  showIgnored: z.boolean().default(false),
  diffStyle: z.enum(["unified", "split"]).default("unified"),
});
export type PluginSettings = z.infer<typeof PluginSettings>;
// Zod defaults also run inside optional fields. Remove them from patches so omitted fields stay omitted.
export const PluginSettingsPatch = z
  .object({
    defaultProject: PluginSettings.shape.defaultProject.removeDefault().optional(),
    defaultWorkspace: PluginSettings.shape.defaultWorkspace.removeDefault().optional(),
    defaultTab: PluginSettings.shape.defaultTab.removeDefault().optional(),
    showIgnored: PluginSettings.shape.showIgnored.removeDefault().optional(),
    diffStyle: PluginSettings.shape.diffStyle.removeDefault().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Supply at least one setting.");

function key(props: Props, projectId?: string): [string, string, string] {
  if (!props.userId || !props.clientId) throw new Error("This connection cannot be identified.");
  return [props.userId, props.clientId, projectId ?? "account"];
}

export async function readPluginSettings(
  env: Pick<Env, "DB">,
  props: Props,
  projectId?: string,
): Promise<PluginSettings> {
  const row = await env.DB.prepare(
    "SELECT values_json FROM plugin_settings WHERE user_id = ? AND client_id = ? AND endpoint = ?",
  )
    .bind(...key(props, projectId))
    .first<{ values_json: string }>();
  return PluginSettings.parse(row ? JSON.parse(row.values_json) : {});
}

export async function updatePluginSettings(
  env: Pick<Env, "DB">,
  props: Props,
  patch: z.infer<typeof PluginSettingsPatch>,
  projectId?: string,
): Promise<PluginSettings> {
  // Merge in SQL: concurrent edits to different fields do not erase each other.
  await env.DB.prepare(
    `INSERT INTO plugin_settings (user_id, client_id, endpoint, values_json)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, client_id, endpoint)
     DO UPDATE SET values_json = json_patch(plugin_settings.values_json, excluded.values_json)`,
  )
    .bind(...key(props, projectId), JSON.stringify(patch))
    .run();
  return readPluginSettings(env, props, projectId);
}

export function settingsView(values: PluginSettings) {
  return {
    schema: {
      type: "object",
      properties: {
        defaultProject: {
          type: "string",
          title: "Default project",
          description: "Project slug or id. Leave empty to choose in the panel.",
          maxLength: 128,
        },
        defaultWorkspace: {
          type: "string",
          title: "Default workspace",
          description: "Workspace slug or id, or main for the project root.",
          maxLength: 128,
        },
        defaultTab: {
          type: "string",
          title: "Initial workspace view",
          enum: ["files", "source-control", "search"],
        },
        showIgnored: { type: "boolean", title: "Show ignored files" },
        diffStyle: { type: "string", title: "Diff layout", enum: ["unified", "split"] },
      },
    },
    values,
    layout: [
      {
        kind: "group",
        title: "Workspace",
        items: ["defaultProject", "defaultWorkspace", "defaultTab"].map((property) => ({
          kind: "property",
          property,
        })),
      },
      {
        kind: "group",
        title: "Editor",
        items: ["showIgnored", "diffStyle"].map((property) => ({ kind: "property", property })),
      },
      {
        kind: "group",
        title: "Exeora",
        items: [{ kind: "tool", tool: "exeora_open_panel", title: "Open workspace panel" }],
      },
    ],
  };
}
