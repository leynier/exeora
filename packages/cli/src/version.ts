declare const __CLI_VERSION__: string;

/**
 * Replaced at build time by tsdown with the version in package.json.
 *
 * `typeof` on an undeclared identifier does not throw, so running the sources
 * directly (vitest, `tsx`) reports a development version rather than crashing.
 */
export const CLI_VERSION = typeof __CLI_VERSION__ === "undefined" ? "0.0.0-dev" : __CLI_VERSION__;

/**
 * Whether `current` is behind `latest`, for the line `connect` prints.
 *
 * Deliberately small: three numbers compared in order, and anything that is not
 * that shape answers false. A prerelease suffix is ignored, which makes
 * `0.0.0-dev` (the sources run directly) compare as 0.0.0 and see every
 * published version as newer. That is the right answer for a real install and a
 * harmless one while developing, where the line is a notice and nothing more.
 *
 * A full semver comparator would be a dependency and a set of edge cases to
 * defend, for a message.
 */
export function isOutdated(current: string, latest: string): boolean {
  const here = parseVersion(current);
  const there = parseVersion(latest);
  if (!here || !there) return false;

  for (let index = 0; index < 3; index += 1) {
    const mine = here[index] as number;
    const theirs = there[index] as number;
    if (mine !== theirs) return mine < theirs;
  }

  return false;
}

function parseVersion(value: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(value.trim());
  if (!match) return null;

  return [Number(match[1]), Number(match[2]), Number(match[3])];
}
