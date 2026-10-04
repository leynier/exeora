/**
 * The caller, as the OAuth provider hands them over.
 *
 * Its own module because everything that needs it would otherwise have to
 * import `index.ts`, which is the Worker entry point and imports them back.
 */

export type Props = {
  userId: string;
  clientId?: string;
  clientName?: string;
  /** Effective scopes on this access token, not merely the grant ceiling. */
  scopes?: string[];
  /**
   * Set only by a cloud machine's token: the one device this bearer may
   * connect as. A user's own token carries no device and reaches all of them.
   */
  deviceId?: string;
};

/**
 * OAuthProvider attaches the grant's props to the ExecutionContext before
 * invoking the API handler. Typed as unknown because Hono's ExecutionContext
 * and the runtime's are structurally different.
 */
export function propsOf(ctx: unknown): Props {
  return ((ctx as { props?: Props }).props ?? { userId: "" }) as Props;
}

/**
 * Which of Exeora's own screens made a request, for the audit log: the name
 * the token's client was registered with, "Exeora for Chrome" for the side
 * panel, and the dashboard's when the token carries none.
 */
export function uiClientName(ctx: unknown): string {
  return propsOf(ctx).clientName ?? "Exeora Dashboard";
}

/** Set only by the internal, grant-checked MCP panel router. Never read from token props. */
export function panelSocketOrigin(ctx: unknown): string | undefined {
  return (ctx as { _exeoraPanelOrigin?: string })._exeoraPanelOrigin;
}
