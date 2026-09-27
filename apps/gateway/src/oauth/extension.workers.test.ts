import { createExecutionContext, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { api } from "../api/index.js";
import worker from "../index.js";
import { extensionIds, firstPartyOrigin } from "./clients.js";
import {
  extensionConsent,
  extensionConsentSince,
  rememberExtensionConsent,
  skipsConsent,
} from "./extension.js";
import { grantedScopes } from "./scopes.js";

const EXTENSION_ID = "helnfgncjgikiojakjdfppmmflbdjamo";
const USER = "usr_extension_test";
/** The worker's own bindings, typed as the whole of what it is handed. */
const bindings = env as unknown as Env;
const OTHER = "usr_extension_other";

beforeEach(async () => {
  await Promise.all([
    env.OAUTH_KV.put("dashboard_client_id", "dashboard"),
    env.OAUTH_KV.put("extension_client_id", "extension"),
    env.OAUTH_KV.delete(`extension_consent:${USER}`),
    env.OAUTH_KV.delete(`extension_consent:${OTHER}`),
  ]);
});

describe("the Chrome extension as an OAuth client", () => {
  it("reads only well-formed ids from the configured list", () => {
    const configured = {
      EXEORA_EXTENSION_IDS: ` ${EXTENSION_ID}, not-an-id,,`,
    } as unknown as Pick<Env, "EXEORA_EXTENSION_IDS">;
    expect(extensionIds(configured)).toEqual([EXTENSION_ID]);
  });

  it("gets the dashboard's scopes and nothing a tool client would", async () => {
    expect(
      await grantedScopes(env, {
        clientId: "extension",
        scope: ["dashboard:manage", "tools:execute", "executor:connect"],
      }),
    ).toEqual(["dashboard:manage"]);
  });

  it("publishes its client, and hides it when the gateway names no extension", async () => {
    await env.OAUTH_KV.delete("extension_client_id");
    const enabled = await worker.fetch(
      new Request("https://exeora.dev/oauth/extension-client"),
      bindings,
      createExecutionContext(),
    );
    expect(enabled.status).toBe(200);
    const body = (await enabled.json()) as { clientId: string; scopes: string[] };
    expect(body.scopes).toEqual(["dashboard:manage"]);
    expect(await env.OAUTH_KV.get("extension_client_id")).toBe(body.clientId);

    const disabled = await worker.fetch(
      new Request("https://exeora.dev/oauth/extension-client"),
      { ...env, EXEORA_EXTENSION_IDS: "" } as unknown as Env,
      createExecutionContext(),
    );
    expect(disabled.status).toBe(404);
  });
});

describe("extension consent", () => {
  it("is asked once per account, and never of the dashboard", async () => {
    expect(await skipsConsent(env, "dashboard", USER)).toBe(true);
    expect(await skipsConsent(env, "extension", USER)).toBe(false);
    expect(await skipsConsent(env, "third_party", USER)).toBe(false);

    expect(await rememberExtensionConsent(env, "extension", USER)).toBe(true);
    expect(await skipsConsent(env, "extension", USER)).toBe(true);
    // Remembered for that account only.
    expect(await skipsConsent(env, "extension", OTHER)).toBe(false);
  });

  it("is not remembered for any other client", async () => {
    expect(await rememberExtensionConsent(env, "third_party", USER)).toBe(false);
    expect(await rememberExtensionConsent(env, "dashboard", USER)).toBe(false);
    expect(await extensionConsentSince(env, USER)).toBeNull();
  });

  it("keeps the time of the first approval", async () => {
    await env.OAUTH_KV.put(`extension_consent:${USER}`, "1000");
    await rememberExtensionConsent(env, "extension", USER);
    expect(await extensionConsentSince(env, USER)).toBe(1000);
  });

  it("has a screen of its own, for the extension only", async () => {
    const options = { client: null, userEmail: "someone@example.com", state: "s" };
    const page = await extensionConsent(env, "extension", options);
    expect(String(page)).toContain("every project on this account");
    expect(await extensionConsent(env, "third_party", options)).toBeNull();
  });
});

describe("revoking the extension from the dashboard", () => {
  function call(method: string, bindings: Record<string, unknown>) {
    const context = createExecutionContext();
    (context as { props?: { userId: string; scopes: string[] } }).props = {
      userId: USER,
      scopes: ["dashboard:manage"],
    };
    return api.fetch(
      new Request("https://exeora.dev/api/extension", { method }),
      { ...env, ...bindings } as typeof env,
      context,
    );
  }

  function provider() {
    const revoked: string[] = [];
    const grants = [
      { id: "g1", clientId: "extension" },
      { id: "g2", clientId: "extension" },
      { id: "g3", clientId: "dashboard" },
    ];
    const OAUTH_PROVIDER = {
      listUserGrants: async (userId: string) => ({
        items: grants.map((grant) => ({ ...grant, userId, scope: [], metadata: {}, createdAt: 0 })),
      }),
      revokeGrant: async (grantId: string) => {
        revoked.push(grantId);
      },
      lookupClient: async (clientId: string) => ({
        clientId,
        redirectUris: [`https://${EXTENSION_ID}.chromiumapp.org/`],
      }),
    };
    return { revoked, OAUTH_PROVIDER };
  }

  it("counts the signed-in panels and when it was approved", async () => {
    await env.OAUTH_KV.put(`extension_consent:${USER}`, "1234");
    const { OAUTH_PROVIDER } = provider();
    const response = await call("GET", { OAUTH_PROVIDER });
    expect(await response.json()).toEqual({ enabled: true, since: 1234, sessions: 2 });
  });

  it("ends every extension session and asks again next time", async () => {
    await env.OAUTH_KV.put(`extension_consent:${USER}`, "1234");
    const { revoked, OAUTH_PROVIDER } = provider();
    const response = await call("DELETE", { OAUTH_PROVIDER });
    expect(response.status).toBe(200);
    expect(revoked).toEqual(["g1", "g2"]);
    expect(await skipsConsent(env, "extension", USER)).toBe(false);
  });
});

describe("terminal origins", () => {
  it("accepts the dashboard's and an allowed extension's origin only", () => {
    const gateway = new URL(env.EXEORA_BASE_URL).origin;
    expect(firstPartyOrigin(env, gateway)).toBe(gateway);
    expect(firstPartyOrigin(env, `chrome-extension://${EXTENSION_ID}`)).toBe(
      `chrome-extension://${EXTENSION_ID}`,
    );
    expect(firstPartyOrigin(env, `chrome-extension://${"a".repeat(32)}`)).toBeNull();
    expect(firstPartyOrigin(env, "https://evil.example")).toBeNull();
    expect(firstPartyOrigin(env, undefined)).toBeNull();
  });

  it("lets the extension's socket past the origin check and no one else's", async () => {
    async function connect(origin: string) {
      return worker.fetch(
        new Request("https://exeora.dev/terminal/connect", {
          headers: { Upgrade: "websocket", Origin: origin },
        }),
        bindings,
        createExecutionContext(),
      );
    }

    // Past the origin check, it fails on the missing ticket instead.
    expect((await connect(`chrome-extension://${EXTENSION_ID}`)).status).toBe(400);
    expect((await connect(`chrome-extension://${"a".repeat(32)}`)).status).toBe(403);
  });
});
