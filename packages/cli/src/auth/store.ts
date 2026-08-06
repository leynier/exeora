import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Entry } from "@napi-rs/keyring";

/**
 * Where the refresh token lives.
 *
 * The OS keychain first: this token can reconnect a machine that serves file
 * reads and shell commands, so it deserves better than a file. Linux servers
 * and CI containers often have no D-Bus secret service at all, so there is a
 * file fallback at mode 0600 — worse, but the alternative is being unusable
 * on exactly the headless machines this product exists to reach.
 */

const SERVICE = "exeora";
const ACCOUNT = "refresh-token";

function fallbackPath(): string {
  const base =
    process.env.XDG_CONFIG_HOME ?? join(homedir(), process.platform === "win32" ? "" : ".config");
  return join(base, "exeora", "credentials.json");
}

function keyring(): Entry | null {
  try {
    return new Entry(SERVICE, ACCOUNT);
  } catch {
    return null;
  }
}

export interface StoredCredentials {
  refreshToken: string;
  /** Which server minted it, so switching gateways does not reuse a token. */
  issuer: string;
}

export async function saveCredentials(credentials: StoredCredentials): Promise<void> {
  const serialised = JSON.stringify(credentials);

  const entry = keyring();
  if (entry) {
    try {
      entry.setPassword(serialised);
      // Drop any earlier file fallback so the secret does not linger on disk.
      await rm(fallbackPath(), { force: true });
      return;
    } catch {
      // No usable secret service; fall through to the file.
    }
  }

  const path = fallbackPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, serialised, "utf8");
  // Set after writing: on a fresh file the write would otherwise land with
  // the process umask, which is commonly world-readable.
  await chmod(path, 0o600);
}

export async function loadCredentials(): Promise<StoredCredentials | null> {
  const entry = keyring();
  if (entry) {
    try {
      const stored = entry.getPassword();
      if (stored) return JSON.parse(stored) as StoredCredentials;
    } catch {
      // Fall through to the file.
    }
  }

  try {
    return JSON.parse(await readFile(fallbackPath(), "utf8")) as StoredCredentials;
  } catch {
    return null;
  }
}

export async function clearCredentials(): Promise<void> {
  const entry = keyring();
  if (entry) {
    try {
      entry.deletePassword();
    } catch {
      // Nothing stored, or no secret service.
    }
  }
  await rm(fallbackPath(), { force: true });
}

/** True when the secret is going to a file rather than the OS keychain. */
export function usingFileFallback(): boolean {
  const entry = keyring();
  if (!entry) return true;
  try {
    entry.getPassword();
    return false;
  } catch {
    return true;
  }
}
