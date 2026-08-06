declare const __CLI_VERSION__: string;

/**
 * Replaced at build time by tsdown with the version in package.json.
 *
 * `typeof` on an undeclared identifier does not throw, so running the sources
 * directly (vitest, `tsx`) reports a development version rather than crashing.
 */
export const CLI_VERSION = typeof __CLI_VERSION__ === "undefined" ? "0.0.0-dev" : __CLI_VERSION__;
