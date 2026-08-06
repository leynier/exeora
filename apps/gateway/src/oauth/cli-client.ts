/**
 * The Exeora CLI's OAuth client.
 *
 * It is a *public* client — a program on the user's machine cannot keep a
 * secret — so it authenticates with PKCE alone.
 *
 * `createClient()` always mints its own random client id and ignores any id
 * passed in, so a fixed well-known constant is not available. Instead the
 * generated id is recorded in KV under a stable key and the CLI discovers it
 * from `/api/cli-client` during `exeora login`.
 *
 * The standards-forward alternative is a Client ID Metadata Document: the CLI
 * would use a URL as its client id and the server would publish the document.
 * It is deliberately not used yet because CIMD resolution requires the
 * `global_fetch_strictly_public` fetch to reach the document over the public
 * internet, which does not hold for a `localhost` development server.
 */
const KV_KEY = "cli_client_id";

/** RFC 8252 §7.3: scheme, host, path and query must match; the port is free. */
const CLI_REDIRECT_URI = "http://127.0.0.1/callback";

/**
 * Executor tokens are scoped apart from MCP tokens on purpose: a token that
 * lets a machine serve tool calls must not also be usable to *make* them.
 */
export const CLI_SCOPES = ["executor:connect", "executor:execute"];

/**
 * Returns the CLI's client id, registering it on first use. Idempotent, so a
 * fresh deployment heals itself the first time anyone runs `exeora login`.
 */
export async function getCliClientId(env: Env): Promise<string> {
  const stored = await env.OAUTH_KV.get(KV_KEY);
  // Re-check against the provider: a client can be deleted from the dashboard
  // while the KV pointer survives.
  if (stored && (await env.OAUTH_PROVIDER.lookupClient(stored))) {
    return stored;
  }

  const client = await env.OAUTH_PROVIDER.createClient({
    clientName: "Exeora CLI",
    redirectUris: [CLI_REDIRECT_URI],
    tokenEndpointAuthMethod: "none",
    grantTypes: ["authorization_code", "refresh_token"],
    responseTypes: ["code"],
  });

  await env.OAUTH_KV.put(KV_KEY, client.clientId);
  return client.clientId;
}
