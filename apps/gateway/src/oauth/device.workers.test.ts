import { createExecutionContext, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../index.js";
import { CLI_SCOPES } from "./clients.js";
import {
  beginDeviceAuthorization,
  captureDeviceAuthorization,
  createDeviceGrant,
  DEVICE_INTERVAL_SECONDS,
  denyDeviceAuthorization,
  formatUserCode,
  lookupDeviceGrantByUserCode,
  normalizeUserCode,
  pollDeviceGrant,
  purgeExpiredDeviceGrants,
} from "./device.js";
import { abandonParkedDeviceGrant } from "./device-continue.js";
import { parkAuthorization } from "./pending.js";

const bindings = {
  ...env,
  COOKIE_SECRET: "test-secret-value",
  EXEORA_BASE_URL: "https://exeora.dev",
} as unknown as Env;

const CHALLENGE = "a".repeat(43);

async function mint() {
  await env.OAUTH_KV.put("cli_client_id", "cli");
  const created = await createDeviceGrant(bindings, {
    clientId: "cli",
    codeChallenge: CHALLENGE,
    codeChallengeMethod: "S256",
    scope: [...CLI_SCOPES],
  });
  if ("error" in created) throw new Error(created.error);
  return created;
}

describe("device-code login", () => {
  it("mints a hyphenated code the CLI can print and a browser can type", async () => {
    const created = await mint();

    expect(created.userCode).toMatch(/^[0-9A-HJ-NP-TV-Z]{4}-[0-9A-HJ-NP-TV-Z]{4}$/);
    expect(created.verificationUri).toBe("https://exeora.dev/oauth/device");
    expect(created.interval).toBe(DEVICE_INTERVAL_SECONDS);
  });

  it("refuses a client that is not the CLI", async () => {
    await env.OAUTH_KV.put("cli_client_id", "cli");
    const created = await createDeviceGrant(bindings, {
      clientId: "someone-else",
      codeChallenge: CHALLENGE,
      codeChallengeMethod: "S256",
      scope: [...CLI_SCOPES],
    });
    expect(created).toEqual({ error: "Only the Exeora CLI can start a code sign-in." });
  });

  it("finds a pending grant by the typed code, ignoring hyphens and case", async () => {
    const created = await mint();
    const found = await lookupDeviceGrantByUserCode(bindings, created.userCode.toLowerCase());
    expect(found?.authRequest.clientId).toBe("cli");
    expect(found?.authRequest.redirectUri).toBe("https://exeora.dev/oauth/device/callback");
    expect(found?.authRequest.codeChallenge).toBe(CHALLENGE);
  });

  it("answers pending until consent, then hands the authorization code over once", async () => {
    const created = await mint();
    const found = await lookupDeviceGrantByUserCode(bindings, created.userCode);
    if (!found) throw new Error("expected a grant");

    expect(await pollDeviceGrant(bindings, created.deviceCode)).toEqual({
      error: "authorization_pending",
    });

    expect(await beginDeviceAuthorization(bindings, found.deviceCodeHash)).toBe(true);
    expect(await lookupDeviceGrantByUserCode(bindings, created.userCode)).toBeNull();

    const captured = await captureDeviceAuthorization(
      bindings,
      found.deviceCodeHash,
      "https://exeora.dev/oauth/device/callback?code=auth_1&iss=https://exeora.dev",
    );
    expect(captured).toBe(true);

    const redeemed = await pollDeviceGrant(bindings, created.deviceCode);
    expect(redeemed).toEqual({
      ok: {
        authorizationCode: "auth_1",
        redirectUri: "https://exeora.dev/oauth/device/callback",
        issuer: "https://exeora.dev",
      },
    });
    expect(await pollDeviceGrant(bindings, created.deviceCode)).toEqual({ error: "invalid_grant" });
  });

  it("tells the CLI when consent was denied", async () => {
    const created = await mint();
    const found = await lookupDeviceGrantByUserCode(bindings, created.userCode);
    if (!found) throw new Error("expected a grant");

    expect(await beginDeviceAuthorization(bindings, found.deviceCodeHash)).toBe(true);
    await denyDeviceAuthorization(bindings, found.deviceCodeHash);
    expect(await pollDeviceGrant(bindings, created.deviceCode)).toEqual({ error: "access_denied" });
  });

  it("does not return an expired grant", async () => {
    const created = await mint();
    await env.DB.prepare("UPDATE oauth_device_grants SET expires_at = 0").run();
    expect(await lookupDeviceGrantByUserCode(bindings, created.userCode)).toBeNull();
    expect(await pollDeviceGrant(bindings, created.deviceCode)).toEqual({ error: "expired_token" });
  });

  it("asks a caller polling too fast to slow down", async () => {
    const created = await mint();
    expect(await pollDeviceGrant(bindings, created.deviceCode)).toEqual({
      error: "authorization_pending",
    });
    expect(await pollDeviceGrant(bindings, created.deviceCode)).toEqual({ error: "slow_down" });
  });

  it("keeps the poll interval while the browser is still signing in", async () => {
    const created = await mint();
    const found = await lookupDeviceGrantByUserCode(bindings, created.userCode);
    if (!found) throw new Error("expected a grant");

    expect(await beginDeviceAuthorization(bindings, found.deviceCodeHash)).toBe(true);
    expect(await pollDeviceGrant(bindings, created.deviceCode)).toEqual({
      error: "authorization_pending",
    });
    expect(await pollDeviceGrant(bindings, created.deviceCode)).toEqual({ error: "slow_down" });
  });

  it("denies a completing grant when capture cannot take the authorization code", async () => {
    const created = await mint();
    const found = await lookupDeviceGrantByUserCode(bindings, created.userCode);
    if (!found) throw new Error("expected a grant");

    expect(await beginDeviceAuthorization(bindings, found.deviceCodeHash)).toBe(true);
    expect(
      await captureDeviceAuthorization(
        bindings,
        found.deviceCodeHash,
        "https://exeora.dev/oauth/device/callback?error=server_error",
      ),
    ).toBe(false);
    await denyDeviceAuthorization(bindings, found.deviceCodeHash);
    expect(await pollDeviceGrant(bindings, created.deviceCode)).toEqual({ error: "access_denied" });
  });

  it("denies a completing grant when the parked browser state is abandoned", async () => {
    const created = await mint();
    const found = await lookupDeviceGrantByUserCode(bindings, created.userCode);
    if (!found) throw new Error("expected a grant");

    const state = await parkAuthorization(bindings, {
      authRequest: found.authRequest,
      deviceCodeHash: found.deviceCodeHash,
    });
    expect(await beginDeviceAuthorization(bindings, found.deviceCodeHash)).toBe(true);
    expect(await abandonParkedDeviceGrant(bindings, state)).toBe(true);
    expect(await pollDeviceGrant(bindings, created.deviceCode)).toEqual({ error: "access_denied" });
  });

  it("lets only one concurrent poll through the interval", async () => {
    const created = await mint();
    const answers = await Promise.all([
      pollDeviceGrant(bindings, created.deviceCode),
      pollDeviceGrant(bindings, created.deviceCode),
    ]);
    expect(
      answers.filter((answer) => "error" in answer && answer.error === "authorization_pending"),
    ).toHaveLength(1);
    expect(
      answers.filter((answer) => "error" in answer && answer.error === "slow_down"),
    ).toHaveLength(1);
  });

  it("drops expired rows during housekeeping", async () => {
    await mint();
    await env.DB.prepare("UPDATE oauth_device_grants SET expires_at = 0").run();
    await purgeExpiredDeviceGrants(env);
    const remaining = await env.DB.prepare("SELECT COUNT(*) AS n FROM oauth_device_grants").first<{
      n: number;
    }>();
    expect(remaining?.n).toBe(0);
  });
});

describe("user codes", () => {
  it("normalizes what a person types", () => {
    expect(normalizeUserCode("ab-cd ef")).toBe("ABCDEF");
    expect(formatUserCode("abcdefgh")).toBe("ABCD-EFGH");
  });
});

describe("the device-code screens", () => {
  it("serves the code form without a token", async () => {
    const response = await worker.fetch(
      new Request("https://exeora.dev/oauth/device"),
      env as unknown as Env,
      createExecutionContext(),
    );
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).toContain("Sign in from another device");
  });

  it("refuses a cross-origin POST, so a form on another site cannot skip the warning", async () => {
    const created = await mint();
    const response = await worker.fetch(
      new Request("https://exeora.dev/oauth/device", {
        method: "POST",
        headers: {
          Origin: "https://evil.example",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: `user_code=${created.userCode}`,
      }),
      bindings,
      createExecutionContext(),
    );

    expect(response.status).toBe(403);
    expect(await lookupDeviceGrantByUserCode(bindings, created.userCode)).not.toBeNull();
  });

  it("refuses a POST with no Origin, which a non-browser client would send", async () => {
    const created = await mint();
    const response = await worker.fetch(
      new Request("https://exeora.dev/oauth/device", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `user_code=${created.userCode}`,
      }),
      bindings,
      createExecutionContext(),
    );

    expect(response.status).toBe(403);
    expect(await lookupDeviceGrantByUserCode(bindings, created.userCode)).not.toBeNull();
  });

  it("refuses a login continuation that only has the parked state in the URL", async () => {
    const created = await mint();
    const found = await lookupDeviceGrantByUserCode(bindings, created.userCode);
    if (!found) throw new Error("expected a grant");

    const state = await parkAuthorization(bindings, {
      authRequest: found.authRequest,
      deviceCodeHash: found.deviceCodeHash,
    });
    expect(await beginDeviceAuthorization(bindings, found.deviceCodeHash)).toBe(true);

    const response = await worker.fetch(
      new Request(`https://exeora.dev/oauth/login/github?state=${state}`),
      bindings,
      createExecutionContext(),
    );
    expect(response.status).toBe(400);
    expect(await pollDeviceGrant(bindings, created.deviceCode)).toEqual({ error: "access_denied" });
  });

  it("accepts a same-origin POST of a typed code", async () => {
    const created = await mint();
    const response = await worker.fetch(
      new Request("https://exeora.dev/oauth/device", {
        method: "POST",
        headers: {
          Origin: "https://exeora.dev",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: `user_code=${created.userCode}`,
      }),
      bindings,
      createExecutionContext(),
    );

    expect(response.status).not.toBe(403);
    if (response.status === 200) {
      expect(await lookupDeviceGrantByUserCode(bindings, created.userCode)).toBeNull();
    } else {
      // No identity provider in this environment: the grant must still be pending.
      expect(await lookupDeviceGrantByUserCode(bindings, created.userCode)).not.toBeNull();
    }
  });
});
