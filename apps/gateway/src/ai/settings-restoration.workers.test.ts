import { env } from "cloudflare:test";
import { beforeEach, expect, it } from "vitest";
import { storeCredential } from "./credentials.js";
import { aiOn, CREDENTIALS_KEY, call, seedUser } from "./fixtures.js";

const USER = "usr_ai_restoration";
beforeEach(() => seedUser(USER));

it("restores local ChatGPT preferences without replacing explicit Grok settings or instructions", async () => {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO ai_settings (user_id, default_provider) VALUES (?, 'chatgpt')",
    ).bind(USER),
    env.DB.prepare(
      "INSERT INTO ai_operation_settings (user_id, operation, provider, model, instructions) VALUES (?, 'commit', NULL, 'local-model', 'Write Spanish')",
    ).bind(USER),
    env.DB.prepare(
      "INSERT INTO ai_operation_settings (user_id, operation, provider, model, instructions) VALUES (?, 'pull_request', 'xai', 'grok-4-fast', 'Keep details')",
    ).bind(USER),
  ]);
  const response = await call("/api/ai", { userId: USER, env: aiOn() });
  const body = (await response.json()) as { settings: unknown };
  expect(body.settings).toEqual({
    defaultProvider: "openai",
    operations: {
      commit: { provider: null, model: null, instructions: "Write Spanish" },
      pull_request: { provider: "xai", model: "grok-4-fast", instructions: "Keep details" },
    },
  });
  const saved = await call("/api/ai/settings", {
    method: "PUT",
    body: body.settings,
    userId: USER,
    env: aiOn(),
  });
  expect(saved.status).toBe(200);
  expect(await saved.json()).toEqual(body.settings);
  expect(
    await env.DB.prepare("SELECT default_provider FROM ai_settings WHERE user_id = ?")
      .bind(USER)
      .first(),
  ).toEqual({ default_provider: "openai" });
});

it("maps an explicit local ChatGPT override and rejects the removed provider for new requests", async () => {
  await env.DB.prepare(
    "INSERT INTO ai_operation_settings (user_id, operation, provider, model, instructions) VALUES (?, 'commit', 'chatgpt', 'local-model', 'Be concise')",
  )
    .bind(USER)
    .run();
  const status = await call("/api/ai", { userId: USER, env: aiOn() });
  expect(await status.json()).toMatchObject({
    settings: {
      operations: { commit: { provider: "openai", model: null, instructions: "Be concise" } },
    },
  });
  const refused = await call("/api/ai/settings", {
    method: "PUT",
    body: { defaultProvider: "chatgpt" },
    userId: USER,
    env: aiOn(),
  });
  expect(refused.status).toBe(400);
  const retired = await call("/api/ai/devices/dev_1/chatgpt", { userId: USER, env: aiOn() });
  expect(retired.status).toBe(404);
});

it.each(["default", "override"])(
  "preserves a newly saved model after recovering the %s provider",
  async (choice) => {
    if (choice === "default") {
      await env.DB.prepare(
        "INSERT INTO ai_settings (user_id, default_provider) VALUES (?, 'chatgpt')",
      )
        .bind(USER)
        .run();
    }
    await env.DB.prepare(
      "INSERT INTO ai_operation_settings (user_id, operation, provider, model, instructions) VALUES (?, 'commit', ?, 'retired-model', 'Keep instructions')",
    )
      .bind(USER, choice === "override" ? "chatgpt" : null)
      .run();
    const saved = await call("/api/ai/settings", {
      method: "PUT",
      body: { operations: { commit: { model: "gpt-5.5-mini" } } },
      userId: USER,
      env: aiOn(),
    });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({
      operations: {
        commit: {
          provider: choice === "override" ? "openai" : null,
          model: "gpt-5.5-mini",
          instructions: "Keep instructions",
        },
      },
    });
    const status = await call("/api/ai", { userId: USER, env: aiOn() });
    expect(await status.json()).toMatchObject({
      settings: { operations: { commit: { model: "gpt-5.5-mini" } } },
    });
  },
);

it.each(["default", "commit", "pull_request"] as const)(
  "requires a named linked replacement for the retired %s preference before any settings writes",
  async (choice) => {
    await storeCredential(env, { credentialsKey: CREDENTIALS_KEY }, USER, "openai", "api_key", {
      access: "sk-simulated",
    });
    await env.DB.prepare("INSERT INTO ai_settings (user_id, default_provider) VALUES (?, ?)")
      .bind(USER, choice === "default" ? "chatgpt" : "openai")
      .run();
    await env.DB.prepare(
      "INSERT INTO ai_operation_settings (user_id, operation, provider, instructions) VALUES (?, ?, ?, 'Original instructions')",
    )
      .bind(USER, choice === "default" ? "commit" : choice, choice === "default" ? null : "chatgpt")
      .run();
    const before = await (await call("/api/ai", { userId: USER, env: aiOn() })).json();
    for (const replacement of [null, "xai"] as const) {
      const patch =
        choice === "default"
          ? {
              defaultProvider: replacement,
              operations: { commit: { instructions: "Must not save" } },
            }
          : {
              defaultProvider: null,
              operations: { [choice]: { provider: replacement, instructions: "Must not save" } },
            };
      const refused = await call("/api/ai/settings", {
        method: "PUT",
        body: patch,
        userId: USER,
        env: aiOn(),
      });
      expect(refused.status).toBe(400);
      expect(await refused.json()).toMatchObject({ error: "ai_provider_choice_required" });
      expect(await (await call("/api/ai", { userId: USER, env: aiOn() })).json()).toEqual(before);
    }
    const accepted = await call("/api/ai/settings", {
      method: "PUT",
      body:
        choice === "default"
          ? { defaultProvider: "openai" }
          : { operations: { [choice]: { provider: "openai" } } },
      userId: USER,
      env: aiOn(),
    });
    expect(accepted.status).toBe(200);
  },
);
