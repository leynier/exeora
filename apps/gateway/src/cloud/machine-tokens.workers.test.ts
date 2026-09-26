import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "../db/client.js";
import {
  MACHINE_TOKEN_PATTERN,
  machineTokenHash,
  mintMachineToken,
  resolveMachineToken,
} from "./machine-tokens.js";

const USER_ID = "usr_machine_token";
const DEVICE_ID = "dev_0123456789abcdefghjkmn";
const PROJECT_ID = "prj_machine_token";

beforeEach(async () => {
  const database = db(env);
  await database
    .insert(schema.users)
    .values({ id: USER_ID, email: "machine-token@example.com" })
    .onConflictDoNothing()
    .run();
  await database
    .insert(schema.devices)
    .values({ id: DEVICE_ID, userId: USER_ID, name: "cloud box", platform: "linux", kind: "cloud" })
    .onConflictDoNothing()
    .run();
  await database
    .insert(schema.projects)
    .values({
      id: PROJECT_ID,
      userId: USER_ID,
      deviceId: DEVICE_ID,
      name: "Cloud",
      slug: "cloud",
      localPath: "/home/sprite/workspace",
    })
    .onConflictDoNothing()
    .run();
  // Storage carries over between the tests in this file, so undo the
  // revocation one of them performs.
  await database
    .update(schema.devices)
    .set({ revokedAt: null })
    .where(eq(schema.devices.id, DEVICE_ID))
    .run();
});

async function seedMachine(token: string) {
  const tokenHash = await machineTokenHash(token);
  await db(env)
    .insert(schema.cloudMachines)
    .values({
      deviceId: DEVICE_ID,
      userId: USER_ID,
      projectId: PROJECT_ID,
      spriteName: "exeora-0123456789abcdefghjkmn",
      tokenHash,
    })
    .onConflictDoUpdate({ target: schema.cloudMachines.deviceId, set: { tokenHash } })
    .run();
}

describe("machine tokens", () => {
  it("mints a token that names its device and hashes deterministically", async () => {
    const token = mintMachineToken(DEVICE_ID);
    const match = MACHINE_TOKEN_PATTERN.exec(token);
    expect(match?.[1]).toBe(DEVICE_ID.slice(4));
    expect(mintMachineToken(DEVICE_ID)).not.toBe(token);
    expect(await machineTokenHash(token)).toBe(await machineTokenHash(token));
    expect(await machineTokenHash(token)).toHaveLength(64);
  });

  it("resolves a live token to props bound to that device", async () => {
    const token = mintMachineToken(DEVICE_ID);
    await seedMachine(token);

    await expect(resolveMachineToken(env, token)).resolves.toEqual({
      props: {
        userId: USER_ID,
        deviceId: DEVICE_ID,
        clientName: "Exeora Cloud",
        scopes: ["executor:connect", "executor:execute"],
      },
    });
  });

  it("refuses a wrong secret, a malformed bearer and an unknown device alike", async () => {
    await seedMachine(mintMachineToken(DEVICE_ID));

    await expect(resolveMachineToken(env, mintMachineToken(DEVICE_ID))).resolves.toBeNull();
    await expect(resolveMachineToken(env, "usr:grant:secret")).resolves.toBeNull();
    await expect(resolveMachineToken(env, "exm_short_x")).resolves.toBeNull();
    await expect(
      resolveMachineToken(env, mintMachineToken("dev_zzzzzzzzzzzzzzzzzzzzzz")),
    ).resolves.toBeNull();
  });

  it("refuses the token of a revoked device", async () => {
    const token = mintMachineToken(DEVICE_ID);
    await seedMachine(token);
    await db(env)
      .update(schema.devices)
      .set({ revokedAt: new Date() })
      .where(eq(schema.devices.id, DEVICE_ID))
      .run();

    await expect(resolveMachineToken(env, token)).resolves.toBeNull();
  });
});
