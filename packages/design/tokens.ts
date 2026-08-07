/**
 * The tokens, readable from code.
 *
 * `tokens.css` stays the source: this parses it rather than restating it, so a
 * colour can never mean one thing in the stylesheet and another on the brand
 * page or in a generated PNG.
 *
 * Node only, and build time only. The landing is static, so the page that calls
 * this runs in Astro's build and ships the values as plain text.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DECLARATION = /^\s*(--[a-z0-9-]+):\s*([^;]+);/gm;

let cache: ReadonlyMap<string, string> | undefined;

/** Every custom property in `tokens.css`, keyed with its leading dashes. */
export function readTokens(): ReadonlyMap<string, string> {
  if (cache) return cache;

  const source = readFileSync(fileURLToPath(new URL("./tokens.css", import.meta.url)), "utf8");
  const tokens = new Map<string, string>();
  for (const [, name, value] of source.matchAll(DECLARATION)) {
    if (name && value) tokens.set(name, value.trim());
  }

  cache = tokens;
  return tokens;
}

/** One token, or a throw. A missing token is a rename that broke something. */
export function token(name: string): string {
  const value = readTokens().get(name);
  if (value === undefined) {
    throw new Error(`Unknown design token: ${name}. Check packages/design/tokens.css.`);
  }
  return value;
}
