import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { db, schema } from "./db/client.js";

export const USER = "usr_plugin_extensions";
export const PROJECT = "prj_plugin_extensions";
export const OTHER = "prj_plugin_ungranted";
export const CLIENT = "client_plugin_extensions";
export const props = { userId: USER, clientId: CLIENT, scopes: ["tools:read", "tools:execute"] };
export const pluginEnv = {
  ...env,
  REQUEST_STATE_SECRET: "test-plugin-secret-that-is-at-least-32-bytes-long",
  ASSETS: {
    fetch: async () =>
      new Response(
        '<html><head><!--exeora:base--><script type="module" src="/dashboard/assets/panel.js"></script></head></html>',
        { headers: { "content-type": "text/html" } },
      ),
  },
} as unknown as Env;

export async function setupPluginFixture() {
  const database = db(env);
  await database.delete(schema.users).where(eq(schema.users.id, USER));
  await database.insert(schema.users).values({ id: USER, email: "plugin@example.com" });
  await database
    .insert(schema.devices)
    .values({ id: "dev_plugin_extensions", userId: USER, name: "desktop", platform: "linux" });
  await database.insert(schema.projects).values([
    {
      id: PROJECT,
      userId: USER,
      deviceId: "dev_plugin_extensions",
      name: "Allowed",
      slug: "allowed",
      localPath: "/work/allowed",
    },
    {
      id: OTHER,
      userId: USER,
      deviceId: "dev_plugin_extensions",
      name: "Hidden",
      slug: "hidden",
      localPath: "/work/hidden",
    },
  ]);
  await database.insert(schema.workspaces).values({
    id: "wsp_plugin_extensions",
    projectId: PROJECT,
    slug: "feature",
    name: "Feature",
    localPath: "/work/allowed/worktrees/feature",
  });
  await database.insert(schema.projectClients).values({
    id: "pcl_plugin_extensions",
    userId: USER,
    projectId: PROJECT,
    clientId: CLIENT,
    endpoint: "account",
    authorizedAt: new Date(),
  });
}
