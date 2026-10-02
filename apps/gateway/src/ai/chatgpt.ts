import {
  ExeoraError,
  type ChatgptAction as ProtocolChatgptAction,
  ChatgptGeneration as ProtocolChatgptGeneration,
  ChatgptLogin as ProtocolChatgptLogin,
  ChatgptLogout as ProtocolChatgptLogout,
  ChatgptModels as ProtocolChatgptModels,
  ChatgptStatus as ProtocolChatgptStatus,
  ChatgptWelcomeAck as ProtocolChatgptWelcomeAck,
  type WorkspaceAction,
} from "@exeora/protocol";
import { zValidator } from "@hono/zod-validator";
import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import { relayName } from "../api/ops.js";
import type { ApiEnv } from "../api/router.js";
import { ownedTarget, type ResolvedTarget, targetQuery } from "../api/workspace-target.js";
import { db, schema } from "../db/client.js";
import { newId } from "../ids.js";
import { callRelayWorkspace } from "../relay-client.js";
import { aiConfig, offeredProvider } from "./providers/index.js";

/**
 * The gateway only carries these values between the authenticated dashboard
 * and the relay. The CLI owns OAuth state, tokens, model discovery and the
 * Responses API call; none of those values are accepted as gateway input.
 */

export const chatgpt = new Hono<ApiEnv>();

const CHATGPT_DEVICE_PROJECT = "chatgpt";
/** The CLI enforces its 60s inference budget; leave transport headroom here. */
export const CHATGPT_RELAY_GENERATE_TIMEOUT_MS = 90_000;
const loginInput = z.object({ mode: z.enum(["new", "reauth", "enable_plan"]) });

export type ChatgptAction = ProtocolChatgptAction;

/** The protocol package adds these actions in `chatgpt-v1`; keep this bridge buildable during rollout. */
export function asChatgptAction(action: ChatgptAction): WorkspaceAction {
  return action;
}

export type ChatgptTarget = Pick<ResolvedTarget, "deviceId" | "workspaceId" | "workspaceSlug">;

/** Dispatches a device-level ChatGPT action without exposing a credential to the Worker. */
export function dispatchChatgpt(
  env: Env,
  userId: string,
  target: ChatgptTarget,
  action: ChatgptAction,
  signal: AbortSignal,
  projectId = CHATGPT_DEVICE_PROJECT,
): Promise<unknown> {
  return callRelayWorkspace(env.DEVICE_RELAY.getByName(relayName(userId, target.deviceId)), {
    requestId: newId("req"),
    projectId,
    workspaceId: target.workspaceId,
    workspaceSlug: target.workspaceSlug,
    action: asChatgptAction(action),
    signal,
  });
}

function disabled(c: Context<ApiEnv>) {
  return c.json({ error: "ai_disabled" }, 404);
}

function requireChatgpt(c: Context<ApiEnv>) {
  const config = aiConfig(c.env);
  if (!config) return null;
  const offered = offeredProvider(config, "chatgpt");
  return offered?.provider.machineBound ? config : null;
}

async function ownedDevice(env: Env, userId: string, deviceId: string) {
  return db(env)
    .select()
    .from(schema.devices)
    .where(and(eq(schema.devices.id, deviceId), eq(schema.devices.userId, userId)))
    .get();
}

function invalidDevice(c: Context<ApiEnv>) {
  return c.json(
    {
      error: "ai_chatgpt_unavailable_on_cloud",
      message: "ChatGPT plan usage is available on local machines only.",
    },
    409,
  );
}

export function chatgptRelayFailure(c: Context<ApiEnv>, error: unknown) {
  if (error instanceof ExeoraError) {
    if (error.code === "LOCAL_EXECUTOR_OFFLINE" || error.code === "EXECUTOR_WAKING") {
      return c.json(
        { error: "ai_machine_offline", message: "Connect this Exeora machine to continue." },
        409,
      );
    }
    if (error.code === "FORBIDDEN") {
      return c.json(
        {
          error: "ai_update_cli",
          message: "Update the Exeora CLI on this machine to use ChatGPT.",
        },
        409,
      );
    }
    if (error.code === "WORKSPACE_UNAVAILABLE") {
      return c.json(
        {
          error: "ai_update_cli",
          message: "Update the Exeora CLI on this machine to use ChatGPT.",
        },
        409,
      );
    }
    if (error.code === "TOOL_TIMEOUT") {
      return c.json(
        { error: "ai_unavailable", message: "The machine did not answer in time. Try again." },
        503,
      );
    }
  }
  console.error("chatgpt relay request failed", error);
  return c.json({ error: "ai_unavailable", message: "ChatGPT could not answer. Try again." }, 502);
}

function authorizeUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.origin !== "https://auth.openai.com" ||
      url.pathname !== "/api/accounts/authorize" ||
      url.username ||
      url.password ||
      url.hash ||
      url.searchParams.has("id_token_hint")
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function expiryMs(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function statusResponse(c: Context<ApiEnv>, value: unknown) {
  const parsed = ProtocolChatgptStatus.safeParse(value);
  if (!parsed.success)
    return c.json({ error: "ai_unavailable", message: "ChatGPT returned an invalid status." }, 502);
  const { kind: _kind, pending, ...status } = parsed.data;
  if (!pending) return c.json(status);
  const expiresAt = expiryMs(pending.expiresAt);
  if (expiresAt === null)
    return c.json({ error: "ai_unavailable", message: "ChatGPT returned an invalid status." }, 502);
  return c.json({ ...status, pending: { expiresAt } });
}

function loginResponse(c: Context<ApiEnv>, value: unknown) {
  const parsed = ProtocolChatgptLogin.safeParse(value);
  if (!parsed.success)
    return c.json(
      { error: "ai_unavailable", message: "ChatGPT returned an invalid sign-in URL." },
      502,
    );
  const url = authorizeUrl(parsed.data.authorizeUrl);
  const expiresAt = expiryMs(parsed.data.expiresAt);
  if (!url || expiresAt === null)
    return c.json(
      { error: "ai_unavailable", message: "ChatGPT returned an invalid sign-in URL." },
      502,
    );
  return c.json({ authorizeUrl: url, expiresAt });
}

function logoutResponse(c: Context<ApiEnv>, value: unknown) {
  const parsed = ProtocolChatgptLogout.safeParse(value);
  if (!parsed.success)
    return c.json(
      { error: "ai_unavailable", message: "ChatGPT returned an invalid sign-out result." },
      502,
    );
  return c.json({ revocationConfirmed: parsed.data.revocationConfirmed });
}

function modelsResponse(c: Context<ApiEnv>, value: unknown) {
  const parsed = ProtocolChatgptModels.safeParse(value);
  if (!parsed.success)
    return c.json(
      { error: "ai_unavailable", message: "ChatGPT returned an invalid model list." },
      502,
    );
  return c.json({ models: parsed.data.models });
}

async function deviceTarget(c: Context<ApiEnv>) {
  const device = await ownedDevice(c.env, c.get("userId"), c.req.param("deviceId") ?? "");
  if (!device || device.revokedAt !== null) return { missing: true as const };
  if (device.kind !== "local") return { cloud: true as const };
  return { target: { deviceId: device.id } as ChatgptTarget };
}

async function projectTarget(c: Context<ApiEnv>) {
  const query = targetQuery.parse({ workspace: c.req.query("workspace") });
  const projectId = c.req.param("id") ?? "";
  const target = await ownedTarget(c.env, c.get("userId"), projectId, query.workspace);
  if (!target) return { missing: true as const };
  const device = await ownedDevice(c.env, c.get("userId"), target.deviceId);
  if (!device || device.revokedAt !== null) return { missing: true as const };
  if (device.kind !== "local") return { cloud: true as const };
  return { target: target as ChatgptTarget, projectId };
}

async function invoke(
  c: Context<ApiEnv>,
  targetResult: { target: ChatgptTarget; projectId?: string },
  action: ChatgptAction,
) {
  try {
    return {
      value: await dispatchChatgpt(
        c.env,
        c.get("userId"),
        targetResult.target,
        action,
        c.req.raw.signal,
        targetResult.projectId,
      ),
    };
  } catch (error) {
    return { response: chatgptRelayFailure(c, error) };
  }
}

function ensureEnabled(c: Context<ApiEnv>) {
  if (aiConfig(c.env) === null) return disabled(c);
  if (!requireChatgpt(c)) return c.json({ error: "not_found" }, 404);
  return null;
}

chatgpt.get("/api/devices/:deviceId/ai/chatgpt", async (c) => {
  const disabledResponse = ensureEnabled(c);
  if (disabledResponse) return disabledResponse;
  const resolved = await deviceTarget(c);
  if (resolved.missing) return c.json({ error: "not_found" }, 404);
  if (resolved.cloud) return invalidDevice(c);
  const result = await invoke(c, resolved, { action: "chatgpt_status" });
  return result.response ?? statusResponse(c, result.value);
});

chatgpt.post(
  "/api/devices/:deviceId/ai/chatgpt/login",
  zValidator("json", loginInput),
  async (c) => {
    const disabledResponse = ensureEnabled(c);
    if (disabledResponse) return disabledResponse;
    const resolved = await deviceTarget(c);
    if (resolved.missing) return c.json({ error: "not_found" }, 404);
    if (resolved.cloud) return invalidDevice(c);
    const result = await invoke(c, resolved, {
      action: "chatgpt_login_start",
      mode: c.req.valid("json").mode,
    });
    return result.response ?? loginResponse(c, result.value);
  },
);

chatgpt.post("/api/devices/:deviceId/ai/chatgpt/login/cancel", async (c) => {
  const disabledResponse = ensureEnabled(c);
  if (disabledResponse) return disabledResponse;
  const resolved = await deviceTarget(c);
  if (resolved.missing) return c.json({ error: "not_found" }, 404);
  if (resolved.cloud) return invalidDevice(c);
  const result = await invoke(c, resolved, { action: "chatgpt_login_cancel" });
  return result.response ?? statusResponse(c, result.value);
});

chatgpt.post(
  "/api/devices/:deviceId/ai/chatgpt/welcome",
  zValidator("json", z.object({ noticeId: z.uuid() })),
  async (c) => {
    const disabledResponse = ensureEnabled(c);
    if (disabledResponse) return disabledResponse;
    const resolved = await deviceTarget(c);
    if (resolved.missing) return c.json({ error: "not_found" }, 404);
    if (resolved.cloud) return invalidDevice(c);
    const result = await invoke(c, resolved, {
      action: "chatgpt_welcome_ack",
      noticeId: c.req.valid("json").noticeId,
    });
    if (result.response) return result.response;
    const parsed = ProtocolChatgptWelcomeAck.safeParse(result.value);
    if (!parsed.success) return c.json({ error: "ai_unavailable" }, 502);
    return c.json({ acknowledged: parsed.data.acknowledged });
  },
);

chatgpt.post("/api/devices/:deviceId/ai/chatgpt/logout", async (c) => {
  const disabledResponse = ensureEnabled(c);
  if (disabledResponse) return disabledResponse;
  const resolved = await deviceTarget(c);
  if (resolved.missing) return c.json({ error: "not_found" }, 404);
  if (resolved.cloud) return invalidDevice(c);
  const result = await invoke(c, resolved, { action: "chatgpt_logout" });
  return result.response ?? logoutResponse(c, result.value);
});

chatgpt.get("/api/devices/:deviceId/ai/chatgpt/models", async (c) => {
  const disabledResponse = ensureEnabled(c);
  if (disabledResponse) return disabledResponse;
  const resolved = await deviceTarget(c);
  if (resolved.missing) return c.json({ error: "not_found" }, 404);
  if (resolved.cloud) return invalidDevice(c);
  const result = await invoke(c, resolved, { action: "chatgpt_models" });
  return result.response ?? modelsResponse(c, result.value);
});

chatgpt.get("/api/projects/:id/ai/chatgpt", zValidator("query", targetQuery), async (c) => {
  const disabledResponse = ensureEnabled(c);
  if (disabledResponse) return disabledResponse;
  const resolved = await projectTarget(c);
  if (resolved.missing) return c.json({ error: "not_found" }, 404);
  if (resolved.cloud) return invalidDevice(c);
  const result = await invoke(c, resolved, { action: "chatgpt_status" });
  return result.response ?? statusResponse(c, result.value);
});

chatgpt.get("/api/projects/:id/ai/chatgpt/models", zValidator("query", targetQuery), async (c) => {
  const disabledResponse = ensureEnabled(c);
  if (disabledResponse) return disabledResponse;
  const resolved = await projectTarget(c);
  if (resolved.missing) return c.json({ error: "not_found" }, 404);
  if (resolved.cloud) return invalidDevice(c);
  const result = await invoke(c, resolved, { action: "chatgpt_models" });
  return result.response ?? modelsResponse(c, result.value);
});

chatgpt.post(
  "/api/projects/:id/ai/chatgpt/login",
  zValidator("query", targetQuery),
  zValidator("json", loginInput),
  async (c) => {
    const disabledResponse = ensureEnabled(c);
    if (disabledResponse) return disabledResponse;
    const resolved = await projectTarget(c);
    if (resolved.missing) return c.json({ error: "not_found" }, 404);
    if (resolved.cloud) return invalidDevice(c);
    const result = await invoke(c, resolved, {
      action: "chatgpt_login_start",
      mode: c.req.valid("json").mode,
    });
    return result.response ?? loginResponse(c, result.value);
  },
);

chatgpt.post(
  "/api/projects/:id/ai/chatgpt/login/cancel",
  zValidator("query", targetQuery),
  async (c) => {
    const disabledResponse = ensureEnabled(c);
    if (disabledResponse) return disabledResponse;
    const resolved = await projectTarget(c);
    if (resolved.missing) return c.json({ error: "not_found" }, 404);
    if (resolved.cloud) return invalidDevice(c);
    const result = await invoke(c, resolved, { action: "chatgpt_login_cancel" });
    return result.response ?? statusResponse(c, result.value);
  },
);

chatgpt.post("/api/projects/:id/ai/chatgpt/logout", zValidator("query", targetQuery), async (c) => {
  const disabledResponse = ensureEnabled(c);
  if (disabledResponse) return disabledResponse;
  const resolved = await projectTarget(c);
  if (resolved.missing) return c.json({ error: "not_found" }, 404);
  if (resolved.cloud) return invalidDevice(c);
  const result = await invoke(c, resolved, { action: "chatgpt_logout" });
  return result.response ?? logoutResponse(c, result.value);
});

export function parseChatgptGeneration(value: unknown) {
  return ProtocolChatgptGeneration.safeParse(value);
}
