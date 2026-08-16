import { createExecutionContext, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "./db/client.js";
import { authenticated } from "./index.js";

const USER_ID = "usr_relay_route";
const DEVICE_ID = "dev_relay_route";

beforeEach(async () => {
  await db(env)
    .insert(schema.users)
    .values({ id: USER_ID, email: "relay-route@example.com" })
    .onConflictDoNothing()
    .run();
  await db(env)
    .insert(schema.devices)
    .values({
      id: DEVICE_ID,
      userId: USER_ID,
      name: "relay route machine",
      platform: "linux",
    })
    .onConflictDoNothing()
    .run();
});

function dial(scopes: string[]) {
  const context = createExecutionContext();
  (context as { props?: { userId: string; scopes: string[] } }).props = {
    userId: USER_ID,
    scopes,
  };
  return authenticated.fetch(
    new Request(`https://exeora.dev/api/relay/${DEVICE_ID}`, {
      headers: { Upgrade: "websocket" },
    }),
    env,
    context,
  );
}

describe("executor relay authorization", () => {
  it("lets a CLI token pass the shared API middleware and upgrade the relay", async () => {
    const response = await dial(["executor:connect", "executor:execute"]);

    expect(response.status).toBe(101);
    expect(response.webSocket).not.toBeNull();
    response.webSocket?.accept();
    response.webSocket?.close(1000, "test complete");
  });

  it("still rejects a token with no executor scope", async () => {
    const response = await dial([]);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "insufficient_scope",
      requiredScopes: ["executor:connect"],
    });
  });
});
