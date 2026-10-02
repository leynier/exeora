import { zValidator } from "@hono/zod-validator";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import type { ApiEnv } from "../api/router.js";
import "../env.js";
import { curatedModels } from "./catalog.js";
import { current, forgetCredential, linkedProviders, storeCredential } from "./credentials.js";
import { deleteLogin, readLogin, storeLogin } from "./logins.js";
import { outbound } from "./outbound.js";
import {
  type AiConfig,
  aiConfig,
  type OfferedProvider,
  oauthAvailable,
  offeredProvider,
} from "./providers/index.js";
import { AiError } from "./providers/types.js";
import { readSettings, SettingsPatch, writeSettings } from "./settings.js";

/**
 * AI Assist for an account: which providers it may link and has linked, how
 * each is linked, and what each operation is generated with. The
 * generations themselves are under a project, in `routes-generate.ts`.
 */

export const ai = new Hono<ApiEnv>();

const disabled = (c: { json: (body: unknown, status: 404) => Response }) =>
  c.json({ error: "ai_disabled" }, 404);

/** Where the provider is the problem, in words for the person. */
export function aiFailure(
  c: { json: (body: unknown, status: 409 | 422 | 502) => Response },
  error: AiError,
) {
  const body = { message: error.message };
  switch (error.kind) {
    case "not_linked":
      return c.json({ error: "ai_not_linked", ...body }, 409);
    case "reconnect":
      return c.json({ error: "ai_reconnect", ...body }, 409);
    case "invalid_key":
      return c.json({ error: "ai_invalid_key", ...body }, 422);
    default:
      return c.json({ error: "ai_unavailable", ...body }, 502);
  }
}

/** The provider the path names, as this gateway offers it. */
function named(c: Context<ApiEnv>, config: AiConfig): OfferedProvider | null {
  return offeredProvider(config, c.req.param("provider") ?? "");
}

ai.get("/api/ai", async (c) => {
  const config = aiConfig(c.env);
  if (!config) {
    return c.json({ enabled: false, providers: [], settings: null, oauthAvailable: false });
  }
  const userId = c.get("userId");
  const linked = await linkedProviders(c.env, userId);
  return c.json({
    enabled: true,
    providers: config.offered.map(({ provider, authKinds }) => {
      const link = linked.find((entry) => entry.provider === provider.id);
      return {
        id: provider.id,
        label: provider.label,
        authKinds,
        linked: link ? { kind: link.kind, accountLabel: link.accountLabel } : null,
        // Curated only: the live listing is `GET …/models`, which asks the provider.
        models: curatedModels(provider.id),
      };
    }),
    settings: await readSettings(c.env, userId),
    oauthAvailable: oauthAvailable(config),
  });
});

ai.post("/api/ai/providers/:provider/device", async (c) => {
  const config = aiConfig(c.env);
  if (!config) return disabled(c);
  const offered = named(c, config);
  if (!offered) return c.json({ error: "not_found" }, 404);
  if (!offered.authKinds.includes("oauth")) {
    return c.json(
      {
        error: "ai_oauth_unavailable",
        message: "This gateway offers that provider by API key only.",
      },
      400,
    );
  }
  const userId = c.get("userId");
  try {
    const start = await offered.provider.startDeviceLogin(outbound(), c.env);
    await storeLogin(c.env, config, userId, offered.provider.id, start);
    return c.json({
      userCode: start.userCode,
      verificationUrl: start.verificationUrl,
      interval: start.interval,
      expiresAt: start.expiresAt,
    });
  } catch (error) {
    if (error instanceof AiError) return aiFailure(c, error);
    throw error;
  }
});

ai.post("/api/ai/providers/:provider/device/poll", async (c) => {
  const config = aiConfig(c.env);
  if (!config) return disabled(c);
  const offered = named(c, config);
  if (!offered) return c.json({ error: "not_found" }, 404);
  if (!offered.authKinds.includes("oauth")) {
    return c.json(
      {
        error: "ai_oauth_unavailable",
        message: "This gateway offers that provider by API key only.",
      },
      400,
    );
  }
  const userId = c.get("userId");
  const id = offered.provider.id;
  const login = await readLogin(c.env, config, userId, id);
  if (!login) {
    return c.json({ error: "ai_login_missing", message: "No device login is in progress." }, 404);
  }
  if (login.expiresAt <= Date.now()) {
    await deleteLogin(c.env, userId, id);
    return c.json({ status: "expired" });
  }
  try {
    const poll = await offered.provider.pollDeviceLogin(outbound(), c.env, login);
    if (poll.status === "pending") return c.json({ status: "pending" });
    await deleteLogin(c.env, userId, id);
    if (poll.status !== "granted") return c.json({ status: poll.status });
    await storeCredential(c.env, config, userId, id, "oauth", poll.tokens);
    return c.json({
      status: "granted",
      linked: { kind: "oauth", accountLabel: poll.tokens.accountLabel ?? null },
    });
  } catch (error) {
    if (error instanceof AiError) return aiFailure(c, error);
    throw error;
  }
});

const keyInput = z.object({ key: z.string().trim().min(1).max(1_024) });

ai.put("/api/ai/providers/:provider/key", zValidator("json", keyInput), async (c) => {
  const config = aiConfig(c.env);
  if (!config) return disabled(c);
  const offered = named(c, config);
  if (!offered) return c.json({ error: "not_found" }, 404);
  if (!offered.authKinds.includes("api_key")) return c.json({ error: "not_found" }, 404);
  const userId = c.get("userId");
  const { key } = c.req.valid("json");
  try {
    const { accountLabel } = await offered.provider.validateKey(outbound(), key);
    await storeCredential(c.env, config, userId, offered.provider.id, "api_key", {
      access: key,
      accountLabel,
    });
    // A key replaces whatever login was underway for the same provider.
    await deleteLogin(c.env, userId, offered.provider.id);
    return c.json({ linked: { kind: "api_key", accountLabel: accountLabel ?? null } });
  } catch (error) {
    if (error instanceof AiError) return aiFailure(c, error);
    throw error;
  }
});

ai.delete("/api/ai/providers/:provider", async (c) => {
  const config = aiConfig(c.env);
  if (!config) return disabled(c);
  const offered = named(c, config);
  if (!offered) return c.json({ error: "not_found" }, 404);
  const userId = c.get("userId");
  const removed = await forgetCredential(c.env, userId, offered.provider.id);
  await deleteLogin(c.env, userId, offered.provider.id);
  return c.json({ ok: true, removed });
});

ai.get("/api/ai/providers/:provider/models", async (c) => {
  const config = aiConfig(c.env);
  if (!config) return disabled(c);
  const offered = named(c, config);
  if (!offered) return c.json({ error: "not_found" }, 404);
  try {
    const fetcher = outbound();
    const credential = await current(c.env, config, c.get("userId"), offered.provider, fetcher);
    return c.json({ models: await offered.provider.listModels(fetcher, credential) });
  } catch (error) {
    if (error instanceof AiError) return aiFailure(c, error);
    throw error;
  }
});

ai.put("/api/ai/settings", zValidator("json", SettingsPatch), async (c) => {
  const config = aiConfig(c.env);
  if (!config) return disabled(c);
  const patch = c.req.valid("json");
  const chosen = [
    patch.defaultProvider,
    patch.operations?.commit?.provider,
    patch.operations?.pull_request?.provider,
  ];
  if (chosen.some((id) => typeof id === "string" && !offeredProvider(config, id))) {
    return c.json(
      { error: "ai_provider_unavailable", message: "This gateway does not offer that provider." },
      400,
    );
  }
  return c.json(await writeSettings(c.env, c.get("userId"), patch));
});
