/**
 * The caller, as the OAuth provider hands them over.
 *
 * Its own module because everything that needs it would otherwise have to
 * import `index.ts`, which is the Worker entry point and imports them back.
 */

export type Props = { userId: string; clientId?: string; clientName?: string };

/**
 * OAuthProvider attaches the grant's props to the ExecutionContext before
 * invoking the API handler. Typed as unknown because Hono's ExecutionContext
 * and the runtime's are structurally different.
 */
export function propsOf(ctx: unknown): Props {
  return ((ctx as { props?: Props }).props ?? { userId: "" }) as Props;
}
