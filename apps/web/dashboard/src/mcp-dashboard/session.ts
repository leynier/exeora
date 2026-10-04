/**
 * The ChatGPT dashboard's own sign-in: its access token, its expiry, and
 * what signing out stops.
 *
 * The token is the dashboard's, never the MCP connection's, and never shown
 * to the model. It lives in `sessionStorage` (in memory when the sandbox has
 * none). Signing out, or the token running out, starts a new generation:
 * every request and poll of the old one is aborted, whoever shows the account
 * is told, and a sign-in that finishes late cannot restore itself.
 */

const TOKEN_KEY = "exeora.sideapp.access_token";
const EXPIRY_KEY = "exeora.sideapp.expires_at";
/** So a request never races the clock. */
const SLACK_MS = 60_000;

export interface SideappSession {
  token: () => string | null;
  /** Bumped by every sign-out and expiry. */
  generation: () => number;
  /** Aborted when the current generation ends. */
  signal: () => AbortSignal;
  subscribe: (listener: () => void) => () => void;
  /** Keeps a token, unless the generation it was asked for has ended. */
  save: (token: string, expiresInSeconds: number, generation: number) => boolean;
  signOut: () => void;
}

export function createSession(storage: Storage, now: () => number = Date.now): SideappSession {
  let generation = 0;
  let controller = new AbortController();
  let expiry: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const read = (key: string) => {
    try {
      return storage.getItem(key);
    } catch {
      return null;
    }
  };
  const forget = () => {
    try {
      storage.removeItem(TOKEN_KEY);
      storage.removeItem(EXPIRY_KEY);
    } catch {
      // Storage that refuses held nothing to forget.
    }
  };
  const end = () => {
    clearTimeout(expiry);
    forget();
    controller.abort();
    controller = new AbortController();
    generation += 1;
    notify();
  };
  const schedule = () => {
    clearTimeout(expiry);
    const expiresAt = Number(read(EXPIRY_KEY) ?? 0);
    if (!read(TOKEN_KEY) || !expiresAt) return;
    expiry = setTimeout(end, Math.max(0, expiresAt - SLACK_MS - now()));
  };
  // A token kept from earlier in this tab ends on time too.
  schedule();

  return {
    token: () => {
      const token = read(TOKEN_KEY);
      const expiresAt = Number(read(EXPIRY_KEY) ?? 0);
      if (!token || expiresAt - SLACK_MS < now()) return null;
      return token;
    },
    generation: () => generation,
    signal: () => controller.signal,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    save: (token, expiresInSeconds, asked) => {
      if (asked !== generation || controller.signal.aborted) return false;
      try {
        storage.setItem(TOKEN_KEY, token);
        storage.setItem(EXPIRY_KEY, String(now() + expiresInSeconds * 1000));
      } catch {
        return false;
      }
      schedule();
      notify();
      return true;
    },
    signOut: end,
  };
}
