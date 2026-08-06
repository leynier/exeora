import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import open from "open";
import { gatewayUrl } from "../config.js";
import { createPkce, createState } from "./pkce.js";
import { saveCredentials } from "./store.js";

/**
 * Browser login for a public client, per RFC 8252.
 *
 * A loopback listener on an ephemeral port receives the redirect. The gateway
 * registers `http://127.0.0.1/callback` without a port precisely so any port
 * works — RFC 8252 §7.3 leaves the port free for exactly this reason.
 *
 * 127.0.0.1 rather than `localhost`: the name can resolve to ::1 or be
 * redirected by a hosts file, and the literal cannot.
 */

interface CliClientInfo {
  clientId: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  scopes: string[];
}

export interface LoginResult {
  accessToken: string;
  expiresAt: number;
}

export async function login(): Promise<LoginResult> {
  const gateway = gatewayUrl();
  const client = await discoverClient(gateway);

  const pkce = createPkce();
  const state = createState();

  const { redirectUri, waitForCode } = await startLoopbackListener(state);

  const authorizeUrl = new URL(client.authorizationEndpoint);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", client.clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("code_challenge", pkce.challenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("scope", client.scopes.join(" "));

  await open(authorizeUrl.toString());
  const { code, issuer } = await waitForCode(authorizeUrl.toString());

  // RFC 9207: the response says which server issued it. If that disagrees with
  // the server we asked, the flow was redirected somewhere else mid-way.
  if (issuer && issuer !== new URL(gateway).origin) {
    throw new Error(`The authorization came back from ${issuer}, not ${gateway}. Aborting.`);
  }

  const tokens = await exchangeCode({
    tokenEndpoint: client.tokenEndpoint,
    clientId: client.clientId,
    code,
    redirectUri,
    verifier: pkce.verifier,
  });

  await saveCredentials({
    refreshToken: tokens.refresh_token,
    issuer: new URL(gateway).origin,
  });

  return {
    accessToken: tokens.access_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  };
}

async function discoverClient(gateway: string): Promise<CliClientInfo> {
  const response = await fetch(new URL("/oauth/cli-client", gateway));
  if (!response.ok) {
    throw new Error(`Could not reach the Exeora gateway at ${gateway} (${response.status}).`);
  }
  return (await response.json()) as CliClientInfo;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

async function exchangeCode(options: {
  tokenEndpoint: string;
  clientId: string;
  code: string;
  redirectUri: string;
  verifier: string;
}): Promise<TokenResponse> {
  const response = await fetch(options.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: options.clientId,
      code: options.code,
      redirect_uri: options.redirectUri,
      code_verifier: options.verifier,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Token exchange failed (${response.status}): ${detail.slice(0, 200)}`);
  }

  const tokens = (await response.json()) as Partial<TokenResponse>;
  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error("The gateway did not return a usable token pair.");
  }
  return tokens as TokenResponse;
}

interface CallbackResult {
  code: string;
  issuer: string | null;
}

async function startLoopbackListener(expectedState: string): Promise<{
  redirectUri: string;
  waitForCode: (authorizeUrl: string) => Promise<CallbackResult>;
}> {
  let settle: ((result: CallbackResult) => void) | undefined;
  let fail: ((error: Error) => void) | undefined;

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/callback") {
      response.writeHead(404).end();
      return;
    }

    const reply = (status: number, message: string) => {
      response.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
      response.end(page(message));
    };

    const error = url.searchParams.get("error");
    if (error) {
      reply(400, "Authorization was declined. You can close this tab.");
      fail?.(new Error(`Authorization was declined (${error}).`));
      return;
    }

    // Checked before the code is touched: a callback carrying someone else's
    // state did not come from this login attempt.
    if (url.searchParams.get("state") !== expectedState) {
      reply(400, "This response did not match the request. You can close this tab.");
      fail?.(new Error("The authorization response did not match this login attempt."));
      return;
    }

    const code = url.searchParams.get("code");
    if (!code) {
      reply(400, "No authorization code was returned. You can close this tab.");
      fail?.(new Error("No authorization code was returned."));
      return;
    }

    reply(200, "Signed in. You can close this tab and return to the terminal.");
    settle?.({ code, issuer: url.searchParams.get("iss") });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    redirectUri: `http://127.0.0.1:${port}/callback`,
    waitForCode: (authorizeUrl: string) =>
      new Promise<CallbackResult>((resolve, reject) => {
        settle = resolve;
        fail = reject;

        const timer = setTimeout(
          () => reject(new Error("Timed out waiting for the browser. Try `exeora login` again.")),
          5 * 60 * 1000,
        );

        // A machine with no browser (a server over SSH) never opens the page,
        // so print the URL as well rather than leaving the user staring.
        console.log(`\nIf your browser did not open, visit:\n${authorizeUrl}\n`);

        const finish = () => {
          clearTimeout(timer);
          server.close();
        };
        settle = (result) => {
          finish();
          resolve(result);
        };
        fail = (error) => {
          finish();
          reject(error);
        };
      }),
  };
}

function page(message: string): string {
  return `<!doctype html><meta charset="utf-8"><title>Exeora</title>
<body style="font:16px/1.5 system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0;color:#111;background:#fff">
<main style="text-align:center"><p style="font-weight:600;letter-spacing:-.02em">Exeora</p><p>${message}</p></main>`;
}
