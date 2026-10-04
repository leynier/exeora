import { createExecutionContext, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { api } from "../api/index.js";
import worker from "../index.js";
import { panelSocketOrigin } from "../props.js";
import { isSideappClient, sideappDeviceRedirectUri } from "./clients.js";
import {
  beginDeviceAuthorization,
  captureDeviceAuthorization,
  createDeviceGrant,
  lookupDeviceGrantByUserCode,
  pollDeviceGrant,
} from "./device.js";
import { grantedScopes } from "./scopes.js";

const origin = "https://exeora.web-sandbox.oaiusercontent.com";
const bindings = {
  ...env,
  EXEORA_BASE_URL: "https://exeora.dev",
  COOKIE_SECRET: "test-sideapp-secret",
} as unknown as Env;
const challenge = "a".repeat(43);

beforeEach(async () => {
  await env.OAUTH_KV.put("sideapp_client_id", "sideapp");
  await env.OAUTH_KV.put("cli_client_id", "cli");
});

describe("Sideapp authentication", () => {
  it("allows bearer preflights without bypassing authentication on the actual API request", async () => {
    const response = await worker.fetch(
      new Request("https://exeora.dev/api/projects", {
        method: "OPTIONS",
        headers: {
          Origin: origin,
          "Access-Control-Request-Method": "GET",
          "Access-Control-Request-Headers": "Authorization",
        },
      }),
      bindings,
      createExecutionContext(),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    const unauthorized = await worker.fetch(
      new Request("https://exeora.dev/api/projects", { headers: { Origin: origin } }),
      bindings,
      createExecutionContext(),
    );
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("Access-Control-Allow-Origin")).toBe(origin);
  });
  it("registers a separate public PKCE client discoverable from the sandbox", async () => {
    await env.OAUTH_KV.delete("sideapp_client_id");
    const response = await worker.fetch(
      new Request("https://exeora.dev/oauth/sideapp-client", { headers: { Origin: origin } }),
      bindings,
      createExecutionContext(),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    const { client_id } = (await response.json()) as { client_id: string };
    expect(await isSideappClient(bindings, client_id)).toBe(true);
    const lookup = await worker.fetch(
      new Request("https://exeora.dev/oauth/sideapp-client"),
      bindings,
      createExecutionContext(),
    );
    expect(await lookup.json()).toEqual({ client_id });
    expect(sideappDeviceRedirectUri(bindings)).toBe(
      "https://exeora.dev/oauth/device/sideapp-callback",
    );
  });

  it("restricts UI and MCP clients to their distinct ceilings", async () => {
    const scope = ["dashboard:manage", "executor:connect", "tools:read", "tools:execute"];
    expect(await grantedScopes(bindings, { clientId: "sideapp", scope })).toEqual([
      "dashboard:manage",
    ]);
    expect(await grantedScopes(bindings, { clientId: "third_party", scope })).toEqual([
      "tools:read",
      "tools:execute",
    ]);
    for (const clientId of ["third_party", "dashboard", "extension"])
      expect(
        await createDeviceGrant(bindings, {
          clientId,
          scope,
          codeChallenge: challenge,
          codeChallengeMethod: "S256",
        }),
      ).toHaveProperty("error");
    expect(
      await createDeviceGrant(bindings, {
        clientId: "sideapp",
        scope: ["tools:execute"],
        codeChallenge: challenge,
        codeChallengeMethod: "S256",
      }),
    ).toHaveProperty("error");
    expect(
      await createDeviceGrant(bindings, {
        clientId: "sideapp",
        scope,
        codeChallenge: "weak",
        codeChallengeMethod: "plain",
      }),
    ).toHaveProperty("error");
  });

  it("starts via HTTP, binds scopes and PKCE server-side, and redeems the code once", async () => {
    const response = await worker.fetch(
      new Request("https://exeora.dev/oauth/device/code", {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: "sideapp",
          scope: "dashboard:manage tools:execute executor:connect",
          code_challenge: challenge,
          code_challenge_method: "S256",
        }),
      }),
      bindings,
      createExecutionContext(),
    );
    expect(response.status).toBe(200);
    const grant = (await response.json()) as {
      device_code: string;
      user_code: string;
      expires_in: number;
      interval: number;
    };
    expect(grant).toMatchObject({ expires_in: 600, interval: 5 });
    const found = await lookupDeviceGrantByUserCode(bindings, grant.user_code);
    expect(found?.authRequest).toMatchObject({
      scope: ["dashboard:manage"],
      codeChallenge: challenge,
      redirectUri: sideappDeviceRedirectUri(bindings),
    });
    if (!found) throw new Error("missing grant");
    expect(await beginDeviceAuthorization(bindings, found.deviceCodeHash)).toBe(true);
    expect(
      await captureDeviceAuthorization(
        bindings,
        found.deviceCodeHash,
        `${sideappDeviceRedirectUri(bindings)}?code=sideapp_auth&iss=https://exeora.dev`,
      ),
    ).toBe(true);
    expect(await pollDeviceGrant(bindings, grant.device_code)).toEqual({
      ok: {
        authorizationCode: "sideapp_auth",
        redirectUri: sideappDeviceRedirectUri(bindings),
        issuer: "https://exeora.dev",
      },
    });
    expect(await pollDeviceGrant(bindings, grant.device_code)).toEqual({ error: "invalid_grant" });
  });

  it("binds socket origin only after UI scope and Sideapp client validation", async () => {
    async function run(clientId: string, scopes: string[], requestOrigin: string) {
      const ctx = createExecutionContext();
      (ctx as unknown as { props: unknown }).props = {
        userId: "usr_sideapp_test",
        clientId,
        scopes,
      };
      const response = await api.fetch(
        new Request("https://exeora.dev/api/projects/unknown/logs-ticket", {
          method: "POST",
          headers: { Origin: requestOrigin },
        }),
        bindings,
        ctx,
      );
      return { status: response.status, origin: panelSocketOrigin(ctx) };
    }
    expect(await run("sideapp", ["dashboard:manage"], origin)).toEqual({ status: 404, origin });
    expect(await run("sideapp", ["tools:execute"], origin)).toEqual({
      status: 403,
      origin: undefined,
    });
    expect((await run("third_party", ["dashboard:manage"], origin)).origin).toBeUndefined();
    expect(
      (await run("sideapp", ["dashboard:manage"], "https://evil.example")).origin,
    ).toBeUndefined();
  });
});
