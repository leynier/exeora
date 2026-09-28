import { CLOUD_HOOKS, type CloudHook } from "@exeora/protocol";
import { zValidator } from "@hono/zod-validator";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { ownedInstance, saveScripts, scriptsOf } from "../cloud/hooks.js";
import { db, schema } from "../db/client.js";
import { relayName } from "./ops.js";
import "../env.js";
import type { ApiEnv } from "./router.js";

/**
 * The scripts a project runs in its instances, as its page reads and writes
 * them, and the one thing a person can ask of an instance about them: to run
 * one again.
 *
 * Saving changes no instance at that moment. Each is told the scripts the
 * next time it says hello, which is the next time it resumes.
 */

export const cloudScripts = new Hono<ApiEnv>();

async function owned(env: Pick<Env, "DB">, userId: string, projectId: string) {
  return db(env)
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)))
    .get();
}

cloudScripts.get("/api/projects/:id/cloud-scripts", async (c) => {
  const project = await owned(c.env, c.get("userId"), c.req.param("id"));
  if (!project) return c.json({ error: "not_found" }, 404);
  return c.json(await scriptsOf(c.env, project.id));
});

// Far above the limit on purpose: a script that is too large is refused by
// name, with the limit, rather than as a body that did not validate.
const script = z.string().max(1_000_000).nullable();
const scriptsInput = z.object({
  install: script,
  resume: script,
  runRepositoryScripts: z.boolean().optional(),
});

cloudScripts.put("/api/projects/:id/cloud-scripts", zValidator("json", scriptsInput), async (c) => {
  const saved = await saveScripts(c.env, c.get("userId"), c.req.param("id"), c.req.valid("json"));
  if (saved === null) return c.json({ error: "not_found" }, 404);
  if ("error" in saved) return c.json(saved, 422);
  return c.json(saved);
});

cloudScripts.post("/api/cloud/machines/:deviceId/hooks/:hook/run", async (c) => {
  const userId = c.get("userId");
  const hook = c.req.param("hook");
  if (!(CLOUD_HOOKS as readonly string[]).includes(hook)) {
    return c.json({ error: "not_found" }, 404);
  }
  const machine = await ownedInstance(c.env, userId, c.req.param("deviceId"));
  if (!machine) return c.json({ error: "not_found" }, 404);

  const asked = await c.env.DEVICE_RELAY.getByName(
    relayName(userId, machine.deviceId),
  ).runCloudHook(hook as CloudHook);
  switch (asked) {
    case "sent":
      return c.json({ ok: true }, 202);
    case "unsupported":
      return c.json(
        {
          error: "hooks_unsupported",
          message:
            "This instance was made before scripts existed. Destroy it and start it again to run them.",
        },
        409,
      );
    default:
      return c.json(
        { error: "machine_waking", message: "The instance is waking up. Try again in a moment." },
        503,
      );
  }
});
