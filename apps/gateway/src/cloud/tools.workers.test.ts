import { describe, expect, it } from "vitest";
import { serviceSpecFor } from "./bootstrap.js";
import {
  parseToolsReport,
  TOOLS_SCRIPT,
  TOOLS_SENTINEL,
  toolsFailure,
  toolsSucceeded,
} from "./tools.js";

/**
 * A workers test only because the script is a Text module import, which
 * needs wrangler's rules; nothing here touches a binding. What the script
 * does on a machine is covered by scripts/test-cloud-tools.sh.
 */

const RUN = [
  "tools: installing gh 2.101.0",
  "EXEORA_TOOL gh installed 2.101.0 yes -",
  "EXEORA_TOOL uv present 0.12.19 no -",
  "tools: jq: failed: the checksum of the download did not match: expected aa, got bb",
  "EXEORA_TOOL jq failed - no the checksum of the download did not match: expected aa, got bb",
  "EXEORA_TOOL unzip skipped - no sudo does not answer without a password on this machine",
  "EXEORA_ENV os=ubuntu-25.10 arch=x86_64 sudo=no apt=yes shm=yes",
  "tools: done in 12s",
  "EXEORA_TOOLS_OK",
  "",
].join("\n");

const rows = (kind: string): string[][] =>
  TOOLS_SCRIPT.split("\n")
    .filter((line) => line.startsWith(`${kind} `))
    .map((line) => line.trim().split(/\s+/));

describe("the tools script", () => {
  it("ends with the sentinel and never prompts", () => {
    expect(TOOLS_SCRIPT.trimEnd().endsWith(`echo ${TOOLS_SENTINEL}`)).toBe(true);
    expect(TOOLS_SCRIPT).toContain("export DEBIAN_FRONTEND=noninteractive");
    expect(TOOLS_SCRIPT).toContain("set +x");
    // sudo is only ever asked not to ask.
    expect(TOOLS_SCRIPT).toContain("ROOT=(sudo -n)");
    expect(TOOLS_SCRIPT).not.toMatch(/\bsudo (env|true|apt-get|install)\b/);
  });

  it("has every tool in its table, and only gh blocking", () => {
    const tools = rows("tool");
    expect(tools.map((row) => row[1])).toEqual([
      "gh",
      "uv",
      "jq",
      "ripgrep",
      "yq",
      "git-lfs",
      "pnpm",
      "yarn",
      "unzip",
      "zip",
      "make",
      "cc",
      "tmux",
    ]);
    expect(tools.filter((row) => row[3] === "yes").map((row) => row[1])).toEqual(["gh"]);
    // The real gh is kept off the PATH, where the shim is.
    expect(tools[0]?.[8]).toBe("{home}/.local/share/exeora/bin/gh");
    expect(tools.slice(1).every((row) => row[8] === "-")).toBe(true);
  });

  it("pins a checksum and an https address for both architectures of every binary", () => {
    const builds = rows("build");
    const binaries = rows("tool").filter((row) => row[4] === "binary");
    expect(builds).toHaveLength(binaries.length * 2);
    for (const tool of binaries) {
      expect(tool[5]).toMatch(/^\d+\.\d+\.\d+$/);
      for (const arch of ["x86_64", "aarch64"]) {
        const build = builds.find((row) => row[1] === tool[1] && row[2] === arch);
        expect(build, `${tool[1]} for ${arch}`).toBeDefined();
        expect(build?.[3]).toMatch(/^[0-9a-f]{64}$/);
        expect(build?.[4]).toMatch(/^(tar\.gz|raw)$/);
        expect(build?.[6]).toMatch(/^https:\/\/github\.com\/\S+$/);
      }
    }
    expect(new Set(builds.map((row) => row[3])).size).toBe(builds.length);
  });

  it("looks for tools where the service will", () => {
    const path = rows("path")[0]?.[1];
    expect(path?.replaceAll("{home}", "/home/sprite")).toBe(
      serviceSpecFor("https://exeora.dev").env.PATH,
    );
  });
});

describe("parseToolsReport", () => {
  it("reads every tool and the machine it ran on", () => {
    const report = parseToolsReport(RUN);
    expect(report.tools).toEqual([
      { name: "gh", state: "installed", version: "2.101.0", required: true, reason: null },
      { name: "uv", state: "present", version: "0.12.19", required: false, reason: null },
      {
        name: "jq",
        state: "failed",
        version: null,
        required: false,
        reason: "the checksum of the download did not match: expected aa, got bb",
      },
      {
        name: "unzip",
        state: "skipped",
        version: null,
        required: false,
        reason: "sudo does not answer without a password on this machine",
      },
    ]);
    expect(report.environment).toEqual({
      os: "ubuntu-25.10",
      arch: "x86_64",
      sudo: false,
      apt: true,
      memoryDisk: true,
    });
  });

  it("passes over what is not of the report", () => {
    const report = parseToolsReport(
      [
        "bash: warning: setlocale: LC_ALL: cannot change locale",
        "tools: the line EXEORA_TOOL gh present 1.0.0 yes - was quoted in a log",
        "EXEORA_TOOL gh present 2.101.0 yes -\r",
        "EXEORA_TOOL jq broken 1.8.2 no -",
        "EXEORA_TOOL yq installed 4.53.6 maybe -",
        "EXEORA_TOOLS_OK",
        "EXEORA_ENVIRONMENT os=other",
        "  EXEORA_ENV os=- arch=aarch64 sudo=yes apt=no shm=no extra=1 noise  ",
      ].join("\n"),
    );
    expect(report.tools).toEqual([
      { name: "gh", state: "present", version: "2.101.0", required: true, reason: null },
    ]);
    expect(report.environment).toEqual({
      os: null,
      arch: "aarch64",
      sudo: true,
      apt: false,
      memoryDisk: false,
    });
  });

  it("reads what there is of an output that was cut short", () => {
    const whole = parseToolsReport(RUN).tools;
    for (let length = 0; length <= RUN.length; length++) {
      const report = parseToolsReport(RUN.slice(0, length));
      expect(report.tools.length).toBeLessThanOrEqual(whole.length);
      for (const [index, tool] of report.tools.entries()) {
        expect(tool.name).toBe(whole[index]?.name);
        expect(tool.state).toBe(whole[index]?.state);
        expect(tool.required).toBe(whole[index]?.required);
      }
    }
    const cut = parseToolsReport("EXEORA_TOOL gh installed 2.101.0 yes -\nEXEORA_TOOL uv inst");
    expect(cut.tools.map((tool) => tool.name)).toEqual(["gh"]);
    expect(cut.environment).toEqual({
      os: null,
      arch: null,
      sudo: false,
      apt: false,
      memoryDisk: false,
    });
    expect(parseToolsReport("EXEORA_TOOL uv failed - no").tools[0]?.reason).toBeNull();
    expect(parseToolsReport("")).toEqual({ tools: [], environment: cut.environment });
  });

  it("takes a tool reported twice for what it was last", () => {
    const report = parseToolsReport(
      "EXEORA_TOOL gh failed - yes the download failed\nEXEORA_TOOL uv present 0.12.19 no -\nEXEORA_TOOL gh installed 2.101.0 yes -\n",
    );
    expect(report.tools.map((tool) => [tool.name, tool.state])).toEqual([
      ["gh", "installed"],
      ["uv", "present"],
    ]);
  });
});

describe("toolsSucceeded", () => {
  it("judges a run by its exit status and its last line", () => {
    expect(toolsSucceeded({ exitCode: 0, output: RUN })).toBe(true);
    expect(toolsSucceeded({ exitCode: 0, output: "EXEORA_TOOLS_OK" })).toBe(true);
    expect(toolsSucceeded({ exitCode: 1, output: RUN })).toBe(false);
    expect(toolsSucceeded({ exitCode: null, output: RUN })).toBe(false);
    expect(toolsSucceeded({ exitCode: 0, output: RUN.slice(0, RUN.indexOf("tools: done")) })).toBe(
      false,
    );
    expect(toolsSucceeded({ exitCode: 0, output: `${RUN}EXEORA_TOOLS_FAILED gh no time` })).toBe(
      false,
    );
    expect(toolsSucceeded({ exitCode: 0, output: "" })).toBe(false);
  });
});

describe("toolsFailure", () => {
  it("says why gh could not be installed, and that Retry tries again", () => {
    const output = [
      "tools: gh: failed: the download failed: curl: (22) The requested URL returned error: 404",
      "EXEORA_TOOL gh failed - yes the download failed: curl: (22) The requested URL returned error: 404",
      "EXEORA_ENV os=ubuntu-25.10 arch=x86_64 sudo=yes apt=yes shm=yes",
      "EXEORA_TOOLS_FAILED gh the download failed: curl: (22) The requested URL returned error: 404",
      "",
    ].join("\n");
    expect(toolsFailure(output)).toBe(
      "The GitHub CLI (gh) could not be installed on the machine: the download failed: curl: (22) The requested URL returned error: 404. Retry to try again.",
    );
    expect(toolsSucceeded({ exitCode: 1, output })).toBe(false);
  });

  it("is silent about a run that did not fail on a required tool", () => {
    expect(toolsFailure(RUN)).toBeNull();
    expect(toolsFailure("")).toBeNull();
    expect(toolsFailure("tools: error: EXEORA_TOOLS_FAILED_SOMETHING gh")).toBeNull();
    expect(toolsFailure("bash: line 3: mktemp: command not found")).toBeNull();
  });

  it("makes a sentence of a line that was cut short or ends in a full stop", () => {
    expect(toolsFailure("EXEORA_TOOLS_FAILED gh there is no build of gh for riscv64.\n")).toBe(
      "The GitHub CLI (gh) could not be installed on the machine: there is no build of gh for riscv64. Retry to try again.",
    );
    expect(toolsFailure("EXEORA_TOOLS_FAILED gh")).toBe(
      "The GitHub CLI (gh) could not be installed on the machine. Retry to try again.",
    );
    expect(toolsFailure("noise\r\nEXEORA_TOOLS_FAILED\r\n")).toBe(
      "The GitHub CLI (gh) could not be installed on the machine. Retry to try again.",
    );
  });
});
