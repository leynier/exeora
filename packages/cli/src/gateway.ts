import * as p from "@clack/prompts";
import { discoverClient } from "./auth/client.js";
import { clearCredentials, loadCredentials } from "./auth/store.js";
import { forgetAccessToken } from "./auth/tokens.js";
import { config, forgetLocalState, gatewayUrl, projects, setGatewayUrl } from "./config.js";

/**
 * Choosing which Exeora to talk to.
 *
 * The gateway is open source and self-hostable, so `https://exeora.dev` is a
 * default rather than an address. Until now the only way to point somewhere
 * else was `EXEORA_GATEWAY_URL`, which lives in one shell and has to be
 * exported again in the next one; this is the persistent answer.
 *
 * One gateway is active at a time, and switching forgets the machine, the
 * projects and the session belonging to the old one. That is not tidiness: a
 * device id is issued by a particular gateway's database, and offering it to a
 * different one names a record that does not exist. Better to drop it loudly
 * than to route tool calls at nothing.
 */

/** Hosts where plain http is the local dev server rather than a mistake. */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * A typed address turned into the origin the rest of the CLI can build on.
 *
 * Pure, and strict about the two ways this goes wrong quietly. A path is
 * rejected rather than dropped, because every URL the CLI makes is
 * `new URL("/api/…", gateway)` and a prefix would vanish without a word. Plain
 * http is rejected off the loopback, because the bearer token on every request
 * is the whole security of the thing.
 */
export function normalizeGateway(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Give the gateway's base URL, for example https://exeora.example.com.");
  }

  const explicitScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
  let url = parse(explicitScheme ? trimmed : `https://${trimmed}`, input);

  // A bare `localhost:8787` means the dev server, which serves no TLS. Guessing
  // https there fails in a way that reads like the gateway is down rather than
  // like the scheme was assumed.
  if (!explicitScheme && LOOPBACK.has(url.hostname)) {
    url = parse(`http://${trimmed}`, input);
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`${trimmed} is not an http or https address.`);
  }
  if (url.protocol === "http:" && !LOOPBACK.has(url.hostname)) {
    throw new Error(
      `${trimmed} is plain http, which would put your session token on the wire in the clear. ` +
        "Use https, or a loopback address for local development.",
    );
  }
  if (url.pathname !== "/") {
    throw new Error(
      `${trimmed} has a path. A gateway is a whole origin, because every URL the CLI builds is ` +
        `rooted at it. Use ${url.origin} instead.`,
    );
  }

  return url.origin;
}

function parse(candidate: string, original: string): URL {
  try {
    return new URL(candidate);
  } catch {
    throw new Error(
      `${original.trim()} is not a URL. Try something like https://exeora.example.com.`,
    );
  }
}

export interface LocalState {
  deviceName: string | undefined;
  projectCount: number;
  signedIn: boolean;
}

/**
 * What switching away would throw out, in words, or nothing at all.
 *
 * Pure and separate from asking, so the question is only put when there is
 * something to answer for. A fresh install has nothing to lose and should not
 * be made to confirm anything.
 */
export function whatIsLost(state: LocalState): string[] {
  const lost: string[] = [];

  if (state.deviceName) lost.push(`this machine's registration as ${state.deviceName}`);
  if (state.projectCount > 0) {
    lost.push(`${state.projectCount} registered project${state.projectCount === 1 ? "" : "s"}`);
  }
  if (state.signedIn) lost.push("the stored session");

  return lost;
}

export type SwitchOutcome =
  | { kind: "unchanged"; target: string }
  | { kind: "declined"; target: string; lost: string[] }
  | { kind: "switched"; target: string; lost: string[] };

/**
 * Point this install at `input`, asking first when that costs something.
 *
 * Validated against the gateway itself before anything local is touched, so a
 * typo leaves the working setup exactly as it was. `--force` skips that check
 * for an instance that is merely down at the moment.
 */
export async function switchGateway(options: {
  input: string;
  force?: boolean | undefined;
  yes?: boolean | undefined;
  json?: boolean | undefined;
}): Promise<SwitchOutcome> {
  const target = normalizeGateway(options.input);
  if (target === gatewayUrl()) return { kind: "unchanged", target };

  if (!options.force) await discoverClient(target);

  const lost = whatIsLost({
    deviceName: config.get("deviceName"),
    projectCount: projects().length,
    signedIn: (await loadCredentials()) !== null,
  });

  if (lost.length > 0 && !options.yes) {
    // Under `--json` there is nobody at the terminal to ask, and a switch that
    // discards a registration is not something to assume a yes for.
    if (options.json) {
      throw new Error(
        `Switching to ${target} would forget ${lost.join(", ")}. Pass --yes to confirm.`,
      );
    }

    p.log.warn(`Switching to ${target} forgets ${lost.join(", ")}.`);
    const answer = await p.confirm({ message: "Switch anyway?", initialValue: false });
    if (p.isCancel(answer) || !answer) return { kind: "declined", target, lost };
  }

  // Credentials first: a refresh token minted by the old gateway is useless at
  // the new one, and leaving it behind is what makes the next command fail with
  // an issuer mismatch instead of a plain "not signed in".
  await clearCredentials();
  forgetAccessToken();
  forgetLocalState();
  setGatewayUrl(target);

  return { kind: "switched", target, lost };
}
