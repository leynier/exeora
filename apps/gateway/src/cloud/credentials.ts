/**
 * Repository access tokens at rest.
 *
 * A private repository's token has to outlive the moment it was typed in: a
 * workspace created weeks later clones the same repository on a new machine.
 * So it is kept in D1, but only under AES-256-GCM with `CLOUD_CREDENTIALS_KEY`,
 * a key that lives nowhere near the database. The plaintext exists in memory
 * for the length of one bootstrap and is never logged or sent anywhere but
 * into the machine that needs it.
 *
 * `v1.<iv>.<ciphertext>` in base64url, so a later scheme can sit beside it.
 */

const VERSION = "v1";

export async function encryptSecret(keyHex: string, plaintext: string): Promise<string> {
  const key = await importKey(keyHex);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return `${VERSION}.${encode(iv)}.${encode(new Uint8Array(ciphertext))}`;
}

export async function decryptSecret(keyHex: string, sealed: string): Promise<string> {
  const [version, iv, ciphertext] = sealed.split(".");
  if (version !== VERSION || !iv || !ciphertext) {
    throw new Error("The stored credential is not in a form this gateway can read.");
  }
  const key = await importKey(keyHex);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: decode(iv) },
    key,
    decode(ciphertext),
  );
  return new TextDecoder().decode(plaintext);
}

async function importKey(keyHex: string): Promise<CryptoKey> {
  if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) {
    throw new Error("CLOUD_CREDENTIALS_KEY must be 32 bytes as 64 hex characters.");
  }
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = Number.parseInt(keyHex.slice(i * 2, i * 2 + 2), 16);
  return crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function encode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function decode(text: string): Uint8Array {
  const padded = text
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(text.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
