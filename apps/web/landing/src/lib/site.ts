/** Values that appear in more than one component, so they cannot drift. */

/** Public source tree. */
export const GITHUB_URL = "https://github.com/leynier/exeora";

/** Published CLI package. */
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
