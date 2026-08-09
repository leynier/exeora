import { describe, expect, it, vi } from "vitest";
import { UPGRADE_INVOCATIONS } from "../package-manager.js";
import { upgradePackage } from "./upgrade.js";

describe("upgrade", () => {
  it("uses the owning package manager", async () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const run = vi.fn(async () => ({ exitCode: 0 }));

    await upgradePackage(true, {
      detect: async () => "bun",
      run,
    });

    expect(run).toHaveBeenCalledWith(UPGRADE_INVOCATIONS.bun, true);
    write.mockRestore();
  });

  it("emits the detected manager after a successful upgrade", async () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await upgradePackage(true, {
      detect: async () => "pnpm",
      run: async () => ({ exitCode: 0 }),
    });

    expect(write).toHaveBeenCalledWith(
      `${JSON.stringify(
        {
          updated: true,
          distribution: "registry",
          packageManager: "pnpm",
          package: "@exeora/cli@latest",
        },
        null,
        2,
      )}\n`,
    );
    write.mockRestore();
  });

  it("surfaces the package manager failure", async () => {
    await expect(
      upgradePackage(true, {
        detect: async () => "yarn",
        run: async () => ({ exitCode: 1, stderr: "permission denied" }),
      }),
    ).rejects.toThrow("permission denied");
  });
});
