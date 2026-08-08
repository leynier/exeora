/**
 * Prefixed, URL-safe identifiers. The prefix makes ids self-describing in logs
 * and in the MCP URL, so a misrouted id is obvious rather than silently wrong.
 */

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz"; // Crockford base32: no i, l, o, u
// The alphabet is a power of two, so taking the low bits of a byte maps every
// value onto exactly eight characters. Masking rather than `% ALPHABET.length`
// makes that uniformity local to the expression instead of a fact you have to
// know about the alphabet's length.
const MASK = ALPHABET.length - 1;
const LENGTH = 22;

export type IdPrefix = "usr" | "dev" | "prj" | "req" | "call" | "pcl" | "apr" | "adl";

export function newId(prefix: IdPrefix): string {
  const bytes = crypto.getRandomValues(new Uint8Array(LENGTH));
  let out = "";
  for (const byte of bytes) {
    // biome-ignore lint/style/noNonNullAssertion: index is masked into range
    out += ALPHABET[byte & MASK]!;
  }
  return `${prefix}_${out}`;
}

export function hasPrefix(id: string, prefix: IdPrefix): boolean {
  return id.startsWith(`${prefix}_`);
}
