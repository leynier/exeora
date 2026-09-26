import { describe, expect, it } from "vitest";
import {
  bootstrapFatalReason,
  bootstrapSucceeded,
  cliConfigFor,
  renderBootstrap,
  serviceSpecFor,
} from "./bootstrap.js";

/**
 * A workers test only because the template is a Text module import, which
 * needs wrangler's rules; nothing here touches a binding.
 */

const cliConfig = cliConfigFor({
  gatewayUrl: "https://exeora.dev",
  deviceId: "dev_0123456789abcdefghjkmn",
  project: { id: "prj_1", slug: "demo", name: "Demo" },
  workspace: { id: "wsp_1", slug: "feature", branch: "feature" },
});

describe("the bootstrap script", () => {
  it("carries the payload in a quoted heredoc and ends with the sentinel", () => {
    const script = renderBootstrap({
      gatewayUrl: "https://exeora.dev",
      installUrl: "https://exeora.dev/linux/install.sh",
      cliVersion: "0.16.0",
      machineToken: "exm_0123456789abcdefghjkmn_secretsecretsecretsecretsecretsecret",
      repoUrl: "https://github.com/leynier/exeora.git",
      branch: "feature",
      credential: { username: "x-access-token", secret: "ghp_token" },
      cliConfig,
    });

    const lines = script.split("\n");
    const open = lines.indexOf("cat > \"$HOME/.exeora/payload.json\" <<'__EXEORA_PAYLOAD__'");
    expect(open).toBeGreaterThan(0);
    expect(lines[open + 2]).toBe("__EXEORA_PAYLOAD__");
    // The token appears exactly once: inside the heredoc, never in a command.
    expect(script.split("ghp_token")).toHaveLength(2);
    expect(JSON.parse(lines[open + 1] as string)).toMatchObject({ branch: "feature" });
    expect(script.trimEnd().endsWith("echo EXEORA_BOOTSTRAP_OK")).toBe(true);
    expect(script).toContain("set +x");
  });

  it("judges a run by its exit status and its last line", () => {
    expect(
      bootstrapSucceeded({ output: "bootstrap: done\nEXEORA_BOOTSTRAP_OK\n", exitCode: 0 }),
    ).toBe(true);
    expect(bootstrapSucceeded({ output: "EXEORA_BOOTSTRAP_OK\n", exitCode: 1 })).toBe(false);
    expect(bootstrapSucceeded({ output: "bootstrap: error: node missing", exitCode: 0 })).toBe(
      false,
    );
  });

  it("writes a config the CLI can read, with project and workspace on one checkout", () => {
    expect(cliConfig.projects[0]?.root).toBe("/home/sprite/workspace");
    expect(cliConfig.workspaces[0]).toMatchObject({
      projectId: "prj_1",
      root: "/home/sprite/workspace",
      gitRoot: "/home/sprite/workspace",
      managed: true,
      syncState: "active",
    });
    expect(() =>
      cliConfigFor({
        gatewayUrl: "not a url",
        deviceId: "dev_x",
        project: { id: "p", slug: "s", name: "n" },
        workspace: { id: "w", slug: "s", branch: "b" },
      }),
    ).toThrow();
  });

  it("registers a service that the Sprite proxy routes to the wake port", () => {
    const spec = serviceSpecFor("https://exeora.dev");
    expect(spec.http_port).toBe(8080);
    expect(spec.env.EXEORA_CLOUD).toBe("1");
    expect(spec.env.EXEORA_GATEWAY_URL).toBe("https://exeora.dev");
    expect(spec.args).toEqual(["/home/sprite/.exeora/run.sh"]);
  });
});

describe("bootstrapFatalReason", () => {
  it("reads the reason the script gave up for good, and nothing else", () => {
    expect(
      bootstrapFatalReason("bootstrap: installing\nEXEORA_BOOTSTRAP_FATAL The base x is gone.\n"),
    ).toBe("The base x is gone.");
    expect(bootstrapFatalReason("bootstrap: error: node is not installed")).toBeUndefined();
  });
});
