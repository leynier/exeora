/**
 * Exeora's own OAuth clients: the CLI and the dashboard.
 *
 * Both are *public* clients: one ships to users' machines, the other runs
 * in a browser, so neither can hold a secret and both authenticate with PKCE
 * alone.
 *
 * `createClient()` always mints its own random client id and ignores any id
 * passed in, so a fixed well-known constant is not available. Each generated
 * id is recorded in KV under a stable key and discovered at runtime.
 *
 * The standards-forward alternative is a Client ID Metadata Document, where
 * the client id is a URL the server publishes. It is deliberately not used
 * yet: CIMD resolution requires the `global_fetch_strictly_public` fetch to
 * reach that document over the public internet, which does not hold for a
 * `localhost` development server.
 */

/**
 * Executor tokens are scoped apart from MCP tokens on purpose: a token that
 * lets a machine serve tool calls must not also be usable to *make* them.
 */
export const CLI_SCOPES = ["executor:connect", "executor:execute"];

/** The dashboard only ever reads and manages; it never runs a tool. */
export const DASHBOARD_SCOPES = ["dashboard:manage"];

interface ClientSpec {
  kvKey: string;
  clientName: string;
  redirectUris: string[];
}

const CLI: ClientSpec = {
  kvKey: "cli_client_id",
  clientName: "Exeora CLI",
  // RFC 8252 §7.3: scheme, host, path and query must match; the port is free,
  // so the CLI can bind whatever ephemeral port is available.
  redirectUris: ["http://127.0.0.1/callback"],
};

function dashboard(env: Env): ClientSpec {
  return {
    kvKey: "dashboard_client_id",
    clientName: "Exeora Dashboard",
    redirectUris: [new URL("/dashboard/callback", env.EXEORA_BASE_URL).toString()],
  };
}

export const getCliClientId = (env: Env) => clientIdFor(env, CLI);
export const getDashboardClientId = (env: Env) => clientIdFor(env, dashboard(env));

/**
 * Returns the client's id, registering it on first use. Idempotent, so a fresh
 * deployment heals itself the first time anyone signs in.
 */
async function clientIdFor(env: Env, spec: ClientSpec): Promise<string> {
  const stored = await env.OAUTH_KV.get(spec.kvKey);
  // Re-checked against the provider: a client can be deleted while the KV
  // pointer survives.
  if (stored && (await env.OAUTH_PROVIDER.lookupClient(stored))) {
    return stored;
  }

  const client = await env.OAUTH_PROVIDER.createClient({
    clientName: spec.clientName,
    redirectUris: spec.redirectUris,
    tokenEndpointAuthMethod: "none",
    grantTypes: ["authorization_code", "refresh_token"],
    responseTypes: ["code"],
  });

  await env.OAUTH_KV.put(spec.kvKey, client.clientId);
  return client.clientId;
}
