import { createExecutionContext, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { api } from "../api/index.js";
import worker from "../index.js";
import { extensionIds, firstPartyOrigin } from "./clients.js";
import {
  extensionConsent,
  extensionConsentSince,
  extensionIdOf,
  refusedExtension,
  rememberExtensionConsent,
  skipsConsent,
} from "./extension.js";
import { grantedScopes } from "./scopes.js";

const EXTENSION_ID = "helnfgncjgikiojakjdfppmmflbdjamo";
const STORE_ID = "abcdefghijklmnopabcdefghijklmnop";
const USER = "usr_extension_test";
const OTHER = "usr_extension_other";

/** The gateway as production runs it, allowing no extension. */
const off = { ...env, EXEORA_EXTENSION_IDS: "" } as unknown as Env;
/** The gateway allowing the unpacked id and a store id, as a development one might. */
const on = { ...env, EXEORA_EXTENSION_IDS: `${EXTENSION_ID},${STORE_ID}` } as unknown as Env;

const request = (id: string) => ({
  clientId: "extension",
  redirectUri: `https://${id}.chromiumapp.org/`,
});
const thirdParty = { clientId: "third_party", redirectUri: "https://client.example/cb" };

beforeEach(async () => {
  const stale = await env.OAUTH_KV.list({ prefix: "extension_consent:" });
  await Promise.all([
    env.OAUTH_KV.put("dashboard_client_id", "dashboard"),
    env.OAUTH_KV.put("extension_client_id", "extension"),
    ...stale.keys.map((key) => env.OAUTH_KV.delete(key.name)),
  ]);
});

describe("the Chrome extension as an OAuth client", () => {
  it("reads only well-formed ids from the configured list and from a redirect", () => {
    const configured = {
      EXEORA_EXTENSION_IDS: ` ${EXTENSION_ID}, not-an-id,,`,
    } as unknown as Pick<Env, "EXEORA_EXTENSION_IDS">;
    expect(extensionIds(configured)).toEqual([EXTENSION_ID]);
    expect(extensionIdOf(`https://${EXTENSION_ID}.chromiumapp.org/`)).toBe(EXTENSION_ID);
    expect(extensionIdOf(`https://${EXTENSION_ID}.chromiumapp.org.evil.example/`)).toBeNull();
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
      on,
      createExecutionContext(),
    );
    expect(enabled.status).toBe(200);
    const body = (await enabled.json()) as { clientId: string; scopes: string[] };
    expect(body.scopes).toEqual(["dashboard:manage"]);
    expect(await env.OAUTH_KV.get("extension_client_id")).toBe(body.clientId);

    const disabled = await worker.fetch(
      new Request("https://exeora.dev/oauth/extension-client"),
      off,
      createExecutionContext(),
    );
    expect(disabled.status).toBe(404);
  });

  it("refuses an id taken off the list, even while its redirect is still registered", async () => {
    await env.OAUTH_KV.delete("extension_client_id");
    const registered = await worker.fetch(
      new Request("https://exeora.dev/oauth/extension-client"),
      on,
      createExecutionContext(),
    );
    const { clientId } = (await registered.json()) as { clientId: string };

    const authorize = new URL("https://exeora.dev/oauth/authorize");
    authorize.searchParams.set("response_type", "code");
    authorize.searchParams.set("client_id", clientId);
    authorize.searchParams.set("redirect_uri", `https://${EXTENSION_ID}.chromiumapp.org/`);
    authorize.searchParams.set("state", "s");
    authorize.searchParams.set("code_challenge", "a".repeat(43));
    authorize.searchParams.set("code_challenge_method", "S256");
    authorize.searchParams.set("scope", "dashboard:manage");

    const refused = await worker.fetch(new Request(authorize), off, createExecutionContext());
    expect(refused.status).toBe(400);
    expect(await refused.text()).toContain("not allowed to sign in");

    await env.OAUTH_KV.put("extension_client_id", "extension");
    expect(await refusedExtension(on, request(EXTENSION_ID))).toBeNull();
    expect(await refusedExtension(on, request("p".repeat(32)))).not.toBeNull();
    expect(await refusedExtension(off, request(EXTENSION_ID))).not.toBeNull();
    expect(await refusedExtension(off, thirdParty)).toBeNull();
  });
});

describe("extension consent", () => {
  it("is asked once per account and extension id, and never of the dashboard", async () => {
    const dashboard = { clientId: "dashboard", redirectUri: "https://exeora.dev/dashboard/" };
    expect(await skipsConsent(env, dashboard, USER)).toBe(true);
    expect(await skipsConsent(env, request(EXTENSION_ID), USER)).toBe(false);
    expect(await skipsConsent(env, thirdParty, USER)).toBe(false);

    expect(await rememberExtensionConsent(env, request(EXTENSION_ID), USER)).toBe(EXTENSION_ID);
    expect(await skipsConsent(env, request(EXTENSION_ID), USER)).toBe(true);
    // Not for another allowed build, and not for another account.
    expect(await skipsConsent(env, request(STORE_ID), USER)).toBe(false);
    expect(await skipsConsent(env, request(EXTENSION_ID), OTHER)).toBe(false);
  });

  it("is not remembered for any other client", async () => {
    expect(await rememberExtensionConsent(env, thirdParty, USER)).toBeNull();
    const dashboard = { ...request(EXTENSION_ID), clientId: "dashboard" };
    expect(await rememberExtensionConsent(env, dashboard, USER)).toBeNull();
    expect(await extensionConsentSince(env, USER)).toBeNull();
  });

  it("keeps the time of the first approval, the earliest across ids", async () => {
    await env.OAUTH_KV.put(`extension_consent:${USER}:${EXTENSION_ID}`, "2000");
    await env.OAUTH_KV.put(`extension_consent:${USER}:${STORE_ID}`, "1000");
    await rememberExtensionConsent(env, request(EXTENSION_ID), USER);
    expect(await env.OAUTH_KV.get(`extension_consent:${USER}:${EXTENSION_ID}`)).toBe("2000");
    expect(await extensionConsentSince(env, USER)).toBe(1000);
  });

  it("has a screen of its own that says it can do what the dashboard can", async () => {
    const options = { client: null, userEmail: "someone@example.com", state: "s" };
    const page = String(await extensionConsent(env, "extension", options));
    expect(page).toContain("anything the Exeora dashboard can");
    expect(page).toContain("deleting it included");
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
      { ...off, ...bindings } as typeof env,
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
    };
    return { revoked, OAUTH_PROVIDER };
  }

  it("still counts the sessions after the gateway stopped allowing the extension", async () => {
    await env.OAUTH_KV.put(`extension_consent:${USER}:${EXTENSION_ID}`, "1234");
    const { OAUTH_PROVIDER } = provider();
    const response = await call("GET", { OAUTH_PROVIDER });
    expect(await response.json()).toEqual({ enabled: false, since: 1234, sessions: 2 });
  });

  it("ends every extension session and asks every id again next time", async () => {
    await env.OAUTH_KV.put(`extension_consent:${USER}:${EXTENSION_ID}`, "1234");
    await env.OAUTH_KV.put(`extension_consent:${USER}:${STORE_ID}`, "1234");
    const { revoked, OAUTH_PROVIDER } = provider();
    const response = await call("DELETE", { OAUTH_PROVIDER });
    expect(response.status).toBe(200);
    expect(revoked).toEqual(["g1", "g2"]);
    expect(await skipsConsent(env, request(EXTENSION_ID), USER)).toBe(false);
    expect(await skipsConsent(env, request(STORE_ID), USER)).toBe(false);
  });
});

describe("terminal origins", () => {
  it("accepts the dashboard's and an allowed extension's origin only", () => {
    const gateway = new URL(env.EXEORA_BASE_URL).origin;
    expect(firstPartyOrigin(on, gateway)).toBe(gateway);
    expect(firstPartyOrigin(on, `chrome-extension://${EXTENSION_ID}`)).toBe(
      `chrome-extension://${EXTENSION_ID}`,
    );
    expect(firstPartyOrigin(off, `chrome-extension://${EXTENSION_ID}`)).toBeNull();
    expect(firstPartyOrigin(on, `chrome-extension://${"p".repeat(32)}`)).toBeNull();
    expect(firstPartyOrigin(on, "https://evil.example")).toBeNull();
    expect(firstPartyOrigin(on, undefined)).toBeNull();
  });

  it("lets the extension's socket past the origin check and no one else's", async () => {
    async function connect(origin: string) {
      return worker.fetch(
        new Request("https://exeora.dev/terminal/connect", {
          headers: { Upgrade: "websocket", Origin: origin },
        }),
        on,
        createExecutionContext(),
      );
    }

    // Past the origin check, it fails on the missing ticket instead.
    expect((await connect(`chrome-extension://${EXTENSION_ID}`)).status).toBe(400);
    expect((await connect(`chrome-extension://${"p".repeat(32)}`)).status).toBe(403);
  });
});
