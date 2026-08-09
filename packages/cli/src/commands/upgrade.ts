import * as p from "@clack/prompts";
import type { Command } from "commander";
import { execa } from "execa";
import { asJson, emit, guard } from "../output.js";
import {
  detectPackageManager,
  type PackageManager,
  packageManagerLabel,
  type UpgradeInvocation,
  upgradeInvocation,
} from "../package-manager.js";

interface RunResult {
  exitCode: number;
  stderr?: string;
}

type UpgradeRunner = (invocation: UpgradeInvocation, jsonOutput: boolean) => Promise<RunResult>;

async function runPackageManager(
  invocation: UpgradeInvocation,
  jsonOutput: boolean,
): Promise<RunResult> {
  const result = await execa(invocation.command, [...invocation.args], {
    reject: false,
    stdio: jsonOutput ? "pipe" : "inherit",
  });
  return {
    exitCode: result.exitCode ?? -1,
    ...(typeof result.stderr === "string" ? { stderr: result.stderr } : {}),
  };
}

interface UpgradeDependencies {
  detect?: () => Promise<PackageManager>;
  run?: UpgradeRunner;
}

/** Updates the registry distribution through the package manager that owns it. */
export async function upgradePackage(
  jsonOutput = asJson(),
  dependencies: UpgradeDependencies = {},
): Promise<void> {
  const manager = await (dependencies.detect ?? detectPackageManager)();
  const invocation = upgradeInvocation(manager);
  const result = await (dependencies.run ?? runPackageManager)(invocation, jsonOutput);
  if (result.exitCode !== 0) {
    const detail = result.stderr?.trim();
    throw new Error(
      detail || `${packageManagerLabel(manager)} exited with code ${result.exitCode}.`,
    );
  }

  if (jsonOutput) {
    emit({
      updated: true,
      distribution: "registry",
      packageManager: manager,
      package: "@exeora/cli@latest",
    });
  } else {
    p.log.success(
      `Exeora was upgraded through ${packageManagerLabel(manager)}. Run \`exeora --version\` to verify it.`,
    );
  }
}

export function register(program: Command): void {
  program
    .command("upgrade")
    .description("Upgrade this installation with its original package manager")
    .action(guard(() => upgradePackage()));
}
