import { createExecutionContext, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../index.js";
import { NEGOTIABLE_CLIENT, REDIRECT_URI, UNUSABLE_CLIENT } from "./cimd-fixtures.js";

/**
 * Client ID Metadata Documents, and the one field that kept ChatGPT out.
 *
 * A CIMD client is a public client: the gateway never issued it a secret, so
 * `none` is the only token endpoint authentication method that can work here.
 * What matters is how a document that *prefers* something else is read.
 * ChatGPT's says `token_endpoint_auth_method: "private_key_jwt"` and then
 * `token_endpoint_auth_methods_supported: ["none", "private_key_jwt"]`, which
 * is a preference followed by the list to negotiate against, and `none` is in
 * it.
 *
 * @cloudflare/workers-oauth-provider 0.10.1 read only the first field and
 * refused the whole document, which turned every ChatGPT connection into an
 * error page. `patches/@cloudflare%2Fworkers-oauth-provider@0.10.1.patch` makes
 * it negotiate instead. These tests exist because that patch is invisible:
 * nothing else here would notice if an upgrade dropped it.
 */

/**
 * PKCE is not incidental. A public client that omits it is turned away by the
 * provider before the auth method is reached, so a request without it would
 * pass or fail for the wrong reason.
 */
function ask(clientId: string): Promise<Response> {
  const url = new URL("https://exeora.dev/oauth/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("scope", "tools:read tools:execute");
  url.searchParams.set("code_challenge", "DKGRmOBZrxS0PsPAX9xuS98Ec8wwqE8xxwSpnc00R_8");
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("resource", "https://exeora.dev/mcp");
  url.searchParams.set("state", "state-1");

  return worker.fetch(new Request(url), env as unknown as Env, createExecutionContext());
}

const REFUSAL = "accepted token endpoint authentication method";

describe("a client identified by a metadata document", () => {
  it("negotiates down to none when the document lists it behind a method the gateway has no use for", async () => {
    const response = await ask(NEGOTIABLE_CLIENT);
    const body = await response.text();

    expect(body).not.toContain(REFUSAL);
    expect(response.status).toBe(200);
    expect(body).toContain("Sign in to continue");
  });

  it("still refuses a document with nothing the gateway can authenticate", async () => {
    const response = await ask(UNUSABLE_CLIENT);

    expect(response.status).toBe(400);
    expect(await response.text()).toContain(REFUSAL);
  });
});
