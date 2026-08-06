/** Values that appear in more than one component, so they cannot drift. */

/**
 * The CLI is published and MIT licensed; the repository behind it is not
 * public. Nothing here should link to a source tree or imply one exists.
 */
export const NPM_URL = "https://www.npmjs.com/package/@exeora/cli";

/**
 * What a first-time visitor pastes into a terminal, in order.
 *
 * The package is scoped because npm would not give up the bare name; the
 * binary it installs is still `exeora`.
 */
export const QUICKSTART = [
  "npm install -g @exeora/cli",
  "exeora login",
  "exeora project add .",
  "exeora connect",
] as const;
