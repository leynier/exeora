import { type ComponentType, createContext, useContext, useSyncExternalStore } from "react";
import { signOut as dashboardSignOut, storedToken } from "./auth.js";
import { Callback } from "./pages/Callback.js";
import { SignIn } from "./pages/SignIn.js";

/**
 * How the dashboard's screens sign in and out, wherever they run.
 *
 * In its own tab the dashboard signs in by redirecting through the gateway's
 * authorization page and keeps the token in the tab. In ChatGPT the same
 * screens run in a sandboxed frame that cannot be redirected, and sign in
 * with a code shown on screen instead; they get an adapter of their own and
 * the routes, guards and shell stay the same.
 */
export interface AuthAdapter {
  /** A usable access token, or null when signed out. */
  token: () => string | null;
  /** Tells React when `token` may answer differently. */
  subscribe: (listener: () => void) => () => void;
  signOut: () => void;
  /** What `/signin` shows. */
  SignIn: ComponentType;
  /**
   * What `/callback` shows: where the browser comes back from the
   * authorization page. Where there is no such redirect, it must not run.
   */
  Callback: ComponentType;
  /** Prefixes the path a guard sends back to after signing in. */
  returnPrefix: string;
}

export const dashboardAuth: AuthAdapter = {
  token: storedToken,
  // Signing in and out reloads the page, so there is nothing to follow.
  subscribe: () => () => {},
  signOut: dashboardSignOut,
  SignIn,
  Callback,
  returnPrefix: "/dashboard",
};

const AuthContext = createContext<AuthAdapter>(dashboardAuth);

export const AuthProvider = AuthContext.Provider;

export function useAuth(): AuthAdapter & { signedIn: boolean } {
  const adapter = useContext(AuthContext);
  const token = useSyncExternalStore(adapter.subscribe, adapter.token);
  return { ...adapter, signedIn: token !== null };
}
