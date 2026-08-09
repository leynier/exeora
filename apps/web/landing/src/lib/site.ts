/** Values that appear in more than one component, so they cannot drift. */

/** Public source tree. */
export const GITHUB_URL = "https://github.com/leynier/exeora";

/** Native executables and their signed release checksums. */
export const RELEASES_URL = `${GITHUB_URL}/releases/latest`;

/**
 * The one command a first-time visitor runs.
 *
 * `connect` signs in, registers the machine and registers the directory when
 * any of those is missing, so there is nothing to run before it.
 */
export const QUICKSTART = "exeora connect";

export const INSTALL_COMMANDS = {
  macos: "curl -fsSL https://exeora.dev/macos/install.sh | sh",
  linux: "curl -fsSL https://exeora.dev/linux/install.sh | sh",
  windows: "irm https://exeora.dev/windows/install.ps1 | iex",
} as const;
