import { createHash, randomBytes } from "node:crypto";

/**
 * PKCE (RFC 7636) with S256 only.
 *
 * The CLI is a public client: it ships to users' machines and cannot hold a
 * secret, so PKCE is the entire proof that the code being redeemed belongs to
 * the process that started the flow. The gateway rejects `plain`.
 */
export interface Pkce {
  verifier: string;
  challenge: string;
}

export function createPkce(): Pkce {
  // 32 bytes -> 43 base64url chars, the minimum RFC 7636 allows.
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

/** Unguessable value tying the callback back to this flow (CSRF defence). */
export function createState(): string {
  return base64Url(randomBytes(24));
}

function base64Url(buffer: Buffer): string {
  return buffer.toString("base64url");
}
