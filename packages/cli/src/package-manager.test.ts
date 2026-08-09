import { describe, expect, it, vi } from "vitest";
import { detectPackageManager, PACKAGE_MANAGERS, UPGRADE_INVOCATIONS } from "./package-manager.js";

const noProbe = async () => undefined;

describe("package manager upgrade commands", () => {
  it("uses each manager's supported global install command", () => {
    expect(UPGRADE_INVOCATIONS).toEqual({
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
    });
  });
});

describe("detectPackageManager", () => {
  it.each([
    ["bun", "/home/me/.bun/install/global/node_modules/@exeora/cli/bin/index.mjs"],
    ["pnpm", "/home/me/.local/share/pnpm/global/5/.pnpm/@exeora+cli/bin/index.mjs"],
    ["yarn", "/home/me/.config/yarn/global/node_modules/@exeora/cli/bin/index.mjs"],
    ["volta", "/home/me/.volta/tools/image/packages/@exeora/cli/bin/index.mjs"],
  ] as const)("recognizes %s's standard layout without probing", async (manager, entryPath) => {
    const probe = vi.fn(noProbe);

    await expect(
      detectPackageManager({ entryPath, realEntryPath: entryPath, probe }),
    ).resolves.toBe(manager);
    expect(probe).not.toHaveBeenCalled();
  });

  it("recognizes npm's standard Unix layout", async () => {
    const entryPath = "/usr/local/lib/node_modules/@exeora/cli/bin/index.mjs";
    await expect(
      detectPackageManager({ entryPath, realEntryPath: entryPath, probe: noProbe }),
    ).resolves.toBe("npm");
  });

  it("recognizes npm's standard Windows layout case-insensitively", async () => {
    const entryPath =
      "C:\\Users\\Leynier\\AppData\\Roaming\\npm\\node_modules\\@exeora\\cli\\bin\\index.mjs";
    await expect(
      detectPackageManager({ entryPath, realEntryPath: entryPath, probe: noProbe }),
    ).resolves.toBe("npm");
  });

  it.each([
    ["npm", "npm", "/custom/npm/node_modules"],
    ["pnpm", "pnpm", "/custom/pnpm/global/node_modules"],
    ["yarn", "yarn", "/custom/yarn/global"],
  ] as const)("matches %s installations under custom prefixes", async (manager, command, root) => {
    const packageRoot = manager === "yarn" ? `${root}/node_modules` : root;
    const entryPath = `${packageRoot}/@exeora/cli/bin/index.mjs`;

    await expect(
      detectPackageManager({
        entryPath,
        realEntryPath: entryPath,
        probe: async (candidate) => (candidate === command ? root : undefined),
      }),
    ).resolves.toBe(manager);
  });

  it("matches a Bun executable under a custom global prefix", async () => {
    const entryPath = "/custom/bun/modules/@exeora/cli/bin/index.mjs";
    await expect(
      detectPackageManager({
        entryPath: "/custom/bun/bin/exeora",
        realEntryPath: entryPath,
        probe: async (command) => (command === "bun" ? "/custom/bun/bin" : undefined),
        resolvePath: async (target) => (target === "/custom/bun/bin/exeora" ? entryPath : target),
      }),
    ).resolves.toBe("bun");
  });

  it("matches a Volta installation using its unwrapped executable", async () => {
    const entryPath = "/custom/volta/@exeora/cli/bin/index.mjs";
    await expect(
      detectPackageManager({
        entryPath,
        realEntryPath: entryPath,
        probe: async (command) => (command === "volta" ? entryPath : undefined),
      }),
    ).resolves.toBe("volta");
  });

  it.each([
    ["npx", "/home/me/.npm/_npx/123/node_modules/@exeora/cli/bin/index.mjs"],
    ["pnpm dlx", "/home/me/.cache/pnpm/dlx/123/node_modules/@exeora/cli/bin/index.mjs"],
    ["bunx", "/home/me/.bun/install/cache/@exeora/cli/bin/index.mjs"],
  ])("refuses temporary %s executions", async (launcher, entryPath) => {
    await expect(
      detectPackageManager({ entryPath, realEntryPath: entryPath, probe: noProbe }),
    ).rejects.toThrow(`launched through ${launcher}`);
  });

  it("supports an explicit, validated override for unusual layouts", async () => {
    await expect(
      detectPackageManager({ entryPath: "/unusual/path", override: "BUN", probe: noProbe }),
    ).resolves.toBe("bun");
    await expect(
      detectPackageManager({ entryPath: "/unusual/path", override: "unknown", probe: noProbe }),
    ).rejects.toThrow(PACKAGE_MANAGERS.join(", "));
  });

  it("does not guess when no manager owns the entry point", async () => {
    await expect(
      detectPackageManager({
        entryPath: "/project/node_modules/@exeora/cli/bin/index.mjs",
        realEntryPath: "/project/node_modules/@exeora/cli/bin/index.mjs",
        probe: noProbe,
      }),
    ).rejects.toThrow("Could not determine which package manager owns");
  });
});
