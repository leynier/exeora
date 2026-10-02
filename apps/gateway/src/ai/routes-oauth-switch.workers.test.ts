import { env } from "cloudflare:test";
import { afterEach, beforeEach, expect, it } from "vitest";
import { db, schema } from "../db/client.js";
import { aiOn, call, fakeProvider, seedUser } from "./fixtures.js";
import { replaceOutbound } from "./outbound.js";

const USER = "usr_ai_oauth_switch";
let restore: (() => void) | undefined;
beforeEach(() => seedUser(USER));
afterEach(() => {
  restore?.();
  restore = undefined;
});

it("refuses a pending device grant before decrypting it when OAuth is disabled", async () => {
  await db(env)
    .insert(schema.aiDeviceLogins)
    .values({
      userId: USER,
      provider: "openai",
      deviceCiphertext: "not-a-ciphertext",
      userCode: "PENDING",
      verificationUrl: "https://auth.openai.com/codex/device",
      intervalS: 5,
      expiresAt: new Date(Date.now() + 600_000),
      secretCiphertext: null,
    })
    .run();
  const fake = fakeProvider(() => {
    throw new Error("Disabled OAuth must not reach the provider");
  });
  restore = replaceOutbound(fake.fetcher);
  const response = await call("/api/ai/providers/openai/device/poll", {
    method: "POST",
    userId: USER,
    env: aiOn({ AI_ASSIST_OAUTH: "off" }),
  });
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: "ai_oauth_unavailable" });
  expect(fake.asked).toHaveLength(0);
  expect(
    await env.DB.prepare("SELECT id FROM ai_providers WHERE user_id = ?").bind(USER).first(),
  ).toBeNull();
});
