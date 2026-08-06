/** Values that appear in more than one component, so they cannot drift. */

/**
 * The CLI is published and MIT licensed; the repository behind it is not
 * public. Nothing here should link to a source tree or imply one exists.
 */
export const NPM_URL = "https://www.npmjs.com/package/@exeora/cli";

/**
 * The one command a first-time visitor runs.
 *
 * `connect` signs in, registers the machine and registers the directory when
 * any of those is missing, so there is nothing to run before it. The package
 * is scoped because npm would not give up the bare name.
 */
export const QUICKSTART = "npx @exeora/cli connect";

/** For anyone who would rather have the binary on their PATH. */
export const GLOBAL_INSTALL = "npm install -g @exeora/cli";
