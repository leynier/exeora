/**
 * What a gateway says about its own OAuth client, before anyone is signed in.
 *
 * `/oauth/cli-client` is unauthenticated by design: the CLI has to know which
 * client id to present and which endpoints to talk to before it holds any
 * token. That also makes it the one request that can answer "is there an
 * Exeora gateway at this address", which is why validating a URL and starting
 * a login both come through here.
 */

export interface CliClientInfo {
  clientId: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  scopes: string[];
}

export async function discoverClient(gateway: string): Promise<CliClientInfo> {
  let response: Response;
  try {
    response = await fetch(new URL("/oauth/cli-client", gateway));
  } catch (error) {
    // A mistyped hostname surfaces here rather than as a status code, and
    // fetch's own message is the bare "fetch failed": the part worth reading,
    // `ENOTFOUND` or `ECONNREFUSED`, is one level down in `cause`.
    throw new Error(`Could not reach the Exeora gateway at ${gateway}: ${reasonFor(error)}`);
  }

  if (!response.ok) {
    throw new Error(`Could not reach the Exeora gateway at ${gateway} (${response.status}).`);
  }

  return (await response.json()) as CliClientInfo;
}

function reasonFor(error: unknown): string {
  if (!(error instanceof Error)) return String(error);

  // A refused connection arrives as an AggregateError holding one error per
  // address the host resolved to, and carrying no message of its own, so the
  // cause is preferred but not trusted to say anything.
  const cause = error.cause;
  if (cause instanceof AggregateError) {
    const first = cause.errors.find((entry) => entry instanceof Error && entry.message);
    if (first) return first.message;
  }
  if (cause instanceof Error && cause.message) return cause.message;
  return error.message || "the connection failed";
}
