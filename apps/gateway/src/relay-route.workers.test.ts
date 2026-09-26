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

function dial(scopes: string[], props: { deviceId?: string } = {}, target = DEVICE_ID) {
  const context = createExecutionContext();
  (context as { props?: { userId: string; scopes: string[]; deviceId?: string } }).props = {
    userId: USER_ID,
    scopes,
    ...props,
  };
  return authenticated.fetch(
    new Request(`https://exeora.dev/api/relay/${target}`, {
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

  it("lets a machine token upgrade only the device it was minted for", async () => {
    const scopes = ["executor:connect", "executor:execute"];

    const own = await dial(scopes, { deviceId: DEVICE_ID });
    expect(own.status).toBe(101);
    own.webSocket?.accept();
    own.webSocket?.close(1000, "test complete");

    const other = await dial(scopes, { deviceId: "dev_some_other_machine" });
    expect(other.status).toBe(403);
    await expect(other.text()).resolves.toContain("another device");
  });
});
