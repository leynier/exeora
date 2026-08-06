/**
 * Prefixed, URL-safe identifiers. The prefix makes ids self-describing in logs
 * and in the MCP URL, so a misrouted id is obvious rather than silently wrong.
 */

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz"; // Crockford base32: no i, l, o, u
const LENGTH = 22;

export type IdPrefix = "usr" | "dev" | "prj" | "req" | "call" | "pcl" | "apr";

export function newId(prefix: IdPrefix): string {
  const bytes = crypto.getRandomValues(new Uint8Array(LENGTH));
  let out = "";
  for (const byte of bytes) {
    // biome-ignore lint/style/noNonNullAssertion: index is masked into range
    out += ALPHABET[byte % ALPHABET.length]!;
  }
  return `${prefix}_${out}`;
}

export function hasPrefix(id: string, prefix: IdPrefix): boolean {
  return id.startsWith(`${prefix}_`);
}
