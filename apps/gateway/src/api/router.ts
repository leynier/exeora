/**
 * What every router under `/api/*` shares.
 *
 * The routers below are separate files rather than one, but they are one API:
 * they are all mounted on the same path prefix by `index.ts`, and they all run
 * behind the middleware there that turns the OAuth grant's props into `userId`.
 * Naming that contract once means a route file cannot quietly disagree with the
 * middleware about what it is handed.
 */
export type ApiEnv = { Bindings: Env; Variables: { userId: string } };
