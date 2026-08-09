import { realpath } from "node:fs/promises";
import { execa } from "execa";

export const PACKAGE_MANAGERS = ["npm", "pnpm", "yarn", "bun", "volta"] as const;

export type PackageManager = (typeof PACKAGE_MANAGERS)[number];

export interface UpgradeInvocation {
  manager: PackageManager;
  command: string;
  args: readonly string[];
}

export const UPGRADE_INVOCATIONS: Readonly<Record<PackageManager, UpgradeInvocation>> = {
  npm: {
    manager: "npm",
    command: "npm",
    args: ["install", "--global", "@exeora/cli@latest"],
  },
  pnpm: {
    manager: "pnpm",
    command: "pnpm",
    args: ["add", "--global", "@exeora/cli@latest"],
  },
  yarn: {
    manager: "yarn",
    command: "yarn",
    args: ["global", "add", "@exeora/cli@latest"],
  },
  bun: {
    manager: "bun",
    command: "bun",
    args: ["add", "--global", "@exeora/cli@latest"],
  },
  volta: {
    manager: "volta",
    command: "volta",
    args: ["install", "@exeora/cli@latest"],
  },
};

type Probe = (command: string, args: readonly string[]) => Promise<string | undefined>;
type ResolvePath = (target: string) => Promise<string | undefined>;

export interface DetectionOptions {
  entryPath?: string;
  realEntryPath?: string;
  override?: string;
  probe?: Probe;
  resolvePath?: ResolvePath;
}

const MANAGER_LABELS: Readonly<Record<PackageManager, string>> = {
  npm: "npm",
  pnpm: "pnpm",
  yarn: "Yarn Classic",
  bun: "Bun",
  volta: "Volta",
};

export function packageManagerLabel(manager: PackageManager): string {
  return MANAGER_LABELS[manager];
}

export function upgradeInvocation(manager: PackageManager): UpgradeInvocation {
  return UPGRADE_INVOCATIONS[manager];
}

function parseManager(value: string | undefined): PackageManager | undefined {
  const normalized = value?.trim().toLowerCase();
  return PACKAGE_MANAGERS.find((manager) => manager === normalized);
}

function normalizePath(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/\/+$/, "");
  return /^[a-z]:\//i.test(normalized) ? normalized.toLowerCase() : normalized;
}

function appendPath(root: string, suffix: string): string {
  return `${root.replace(/[\\/]+$/, "")}/${suffix.replace(/^[\\/]+/, "")}`;
}

function isWithin(target: string, root: string): boolean {
  const normalizedTarget = normalizePath(target);
  const normalizedRoot = normalizePath(root);
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}/`);
}

function managerFromKnownPath(path: string): PackageManager | undefined {
  const normalized = normalizePath(path);
  if (normalized.includes("/.bun/install/global/")) return "bun";
  if (normalized.includes("/.volta/tools/image/packages/")) return "volta";
  if (normalized.includes("/.config/yarn/global/")) return "yarn";
  if (normalized.includes("/pnpm/global/") || normalized.includes("/pnpm-global/")) {
    return "pnpm";
  }
  return undefined;
}

function temporaryLauncher(path: string): string | undefined {
  const normalized = normalizePath(path);
  if (normalized.includes("/.npm/_npx/")) return "npx";
  if (normalized.includes("/pnpm/dlx/") || normalized.includes("/.cache/pnpm/dlx/")) {
    return "pnpm dlx";
  }
  if (normalized.includes("/.bun/install/cache/") || normalized.includes("/.bun/install/tmp/")) {
    return "bunx";
  }
  return undefined;
}

async function resolveExistingPath(target: string): Promise<string | undefined> {
  try {
    return await realpath(target);
  } catch {
    return undefined;
  }
}

async function runProbe(command: string, args: readonly string[]): Promise<string | undefined> {
  try {
    const result = await execa(command, [...args], {
      reject: false,
      stdout: "pipe",
      stderr: "ignore",
      timeout: 3_000,
    });
    if (result.exitCode !== 0 || typeof result.stdout !== "string") return undefined;
    return result.stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

async function sameResolvedPath(
  left: string,
  right: string,
  resolvePath: ResolvePath,
): Promise<boolean> {
  if (normalizePath(left) === normalizePath(right)) return true;
  const [resolvedLeft, resolvedRight] = await Promise.all([resolvePath(left), resolvePath(right)]);
  return (
    resolvedLeft !== undefined &&
    resolvedRight !== undefined &&
    normalizePath(resolvedLeft) === normalizePath(resolvedRight)
  );
}

async function managerFromGlobalInstall(
  entryPath: string,
  realEntryPath: string,
  probe: Probe,
  resolvePath: ResolvePath,
): Promise<PackageManager | undefined> {
  const results = await Promise.all([
    probe("npm", ["root", "--global"]),
    probe("pnpm", ["root", "--global"]),
    probe("yarn", ["global", "dir"]),
    probe("bun", ["pm", "bin", "-g"]),
    probe("volta", ["which", "exeora"]),
  ]);

  const [npmRoot, pnpmRoot, yarnGlobalDir, bunGlobalBin, voltaExecutable] = results;
  if (pnpmRoot !== undefined && isWithin(realEntryPath, appendPath(pnpmRoot, "@exeora/cli"))) {
    return "pnpm";
  }
  if (
    yarnGlobalDir !== undefined &&
    isWithin(realEntryPath, appendPath(yarnGlobalDir, "node_modules/@exeora/cli"))
  ) {
    return "yarn";
  }
  if (bunGlobalBin !== undefined) {
    const candidates = [appendPath(bunGlobalBin, "exeora"), appendPath(bunGlobalBin, "exeora.cmd")];
    const matches = await Promise.all(
      candidates.map(async (candidate) => {
        if (normalizePath(entryPath) === normalizePath(candidate)) return true;
        return sameResolvedPath(candidate, realEntryPath, resolvePath);
      }),
    );
    if (matches.some(Boolean)) {
      return "bun";
    }
  }
  if (
    voltaExecutable !== undefined &&
    (await sameResolvedPath(voltaExecutable, realEntryPath, resolvePath))
  ) {
    return "volta";
  }
  if (npmRoot !== undefined && isWithin(realEntryPath, appendPath(npmRoot, "@exeora/cli"))) {
    return "npm";
  }
  return undefined;
}

/**
 * Finds the package manager that owns the running global Node.js distribution.
 *
 * Known layouts avoid subprocesses. Custom prefixes are resolved against the
 * global directories reported by each installed manager, queried concurrently.
 */
export async function detectPackageManager(
  options: DetectionOptions = {},
): Promise<PackageManager> {
  const overrideValue = options.override ?? process.env.EXEORA_PACKAGE_MANAGER;
  if (overrideValue !== undefined) {
    const overridden = parseManager(overrideValue);
    if (overridden !== undefined) return overridden;
    throw new Error(`EXEORA_PACKAGE_MANAGER must be one of: ${PACKAGE_MANAGERS.join(", ")}.`);
  }

  const entryPath = options.entryPath ?? process.argv[1] ?? "";
  const resolvePath = options.resolvePath ?? resolveExistingPath;
  const realEntryPath = options.realEntryPath ?? (await resolvePath(entryPath)) ?? entryPath;
  const launcher = temporaryLauncher(entryPath) ?? temporaryLauncher(realEntryPath);
  if (launcher !== undefined) {
    throw new Error(
      `This Exeora process was launched through ${launcher}, so there is no persistent global installation to upgrade. Install @exeora/cli globally first.`,
    );
  }

  const known = managerFromKnownPath(realEntryPath) ?? managerFromKnownPath(entryPath);
  if (known !== undefined) return known;

  const detected = await managerFromGlobalInstall(
    entryPath,
    realEntryPath,
    options.probe ?? runProbe,
    resolvePath,
  );
  if (detected !== undefined) return detected;

  // npm has a conventional layout even when npm itself is no longer on PATH.
  // This comes after exact manager probes so a custom Bun/Yarn prefix cannot be
  // mistaken for npm merely because it also contains node_modules.
  const normalized = normalizePath(realEntryPath);
  if (
    normalized.includes("/lib/node_modules/@exeora/cli/") ||
    normalized.includes("/appdata/roaming/npm/node_modules/@exeora/cli/")
  ) {
    return "npm";
  }

  throw new Error(
    `Could not determine which package manager owns this Exeora installation. Set EXEORA_PACKAGE_MANAGER to one of: ${PACKAGE_MANAGERS.join(", ")}, then run exeora upgrade again.`,
  );
}
