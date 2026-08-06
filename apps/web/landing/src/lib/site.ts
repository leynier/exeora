/** Values that appear in more than one component, so they cannot drift. */

export const GITHUB_URL = "https://github.com/leynier/exeora";

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
