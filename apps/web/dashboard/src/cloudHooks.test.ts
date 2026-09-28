import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./api.js";
import type { CloudInstance, HookRun, InstanceTool, ToolsReport } from "./api-projects.js";
import {
  hookFact,
  hookSentence,
  hookSource,
  hookWarning,
  isTroubled,
  noticedHooks,
  runningSentence,
  runRefusal,
  spent,
  toolsLines,
  toolsNote,
  troubledHooks,
} from "./cloudHooks.js";

const NOW = 1_800_000_000_000;

const run = (patch: Partial<HookRun> = {}): HookRun => ({
  runId: "run_1",
  status: "failed",
  source: "dashboard",
  trigger: "setup",
  scriptSha256: null,
  exitCode: 3,
  startedAt: NOW - 312_000,
  finishedAt: NOW - 300_000,
  output: "npm ERR! missing script: build",
  truncated: false,
  ...patch,
});

const tool = (name: string, patch: Partial<InstanceTool> = {}): InstanceTool => ({
  name,
  state: "installed",
  version: null,
  required: false,
  reason: null,
  ...patch,
});

const report = (tools: InstanceTool[]): ToolsReport => ({
  tools,
  environment: { os: "linux", arch: "x86_64", sudo: true, apt: true, memoryDisk: false },
});

const instance = (patch: Partial<CloudInstance> = {}) =>
  ({
    state: "online",
    hooks: { supported: true, install: null, resume: null },
    ...patch,
  }) as CloudInstance;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("how a script ended", () => {
  it("says a failure with the code the script left", () => {
    expect(hookSentence("install", run())).toBe("The install script failed (exit 3).");
    expect(hookSentence("resume", run({ exitCode: 127 }))).toBe(
      "The resume script failed (exit 127).",
    );
  });

  it("says a failure with no code without inventing one", () => {
    expect(hookSentence("install", run({ exitCode: null }))).toBe("The install script failed.");
  });

  it("says how long a script had when it ran out of time", () => {
    const timedOut = run({
      status: "timed_out",
      exitCode: null,
      startedAt: NOW - 120_000,
      finishedAt: NOW,
    });
    expect(hookSentence("resume", timedOut)).toBe(
      "The resume script ran out of time after 2 minutes.",
    );
    expect(hookSentence("install", { ...timedOut, startedAt: NOW - 1_200_000 })).toBe(
      "The install script ran out of time after 20 minutes.",
    );
    expect(hookSentence("resume", { ...timedOut, finishedAt: null })).toBe(
      "The resume script ran out of time.",
    );
  });

  it("says where the script came from", () => {
    expect(hookSource(run({ source: "dashboard" }))).toBe("from the project's page");
    expect(hookSource(run({ source: "repository" }))).toBe("from the repository");
    expect(hookSource(run({ source: "none" }))).toBeNull();
  });

  it("puts the cause, the place and what to do in one paragraph", () => {
    expect(hookWarning("install", run())).toBe(
      "The install script failed (exit 3). It came from the project's page. Fix the script, then run it again.",
    );
    expect(
      hookWarning(
        "resume",
        run({
          status: "timed_out",
          source: "repository",
          startedAt: NOW - 120_000,
          finishedAt: NOW,
        }),
      ),
    ).toBe(
      "The resume script ran out of time after 2 minutes. It came from the repository. Fix the script, then run it again.",
    );
    expect(hookWarning("install", run({ source: "none" }))).toBe(
      "The install script failed (exit 3). Fix the script, then run it again.",
    );
  });

  it("says a script is running", () => {
    expect(runningSentence("install")).toBe("Running the install script…");
    expect(runningSentence("resume")).toBe("Running the resume script…");
  });

  it("takes only a failure and a timeout as trouble", () => {
    expect(isTroubled(run({ status: "failed" }))).toBe(true);
    expect(isTroubled(run({ status: "timed_out" }))).toBe(true);
    expect(isTroubled(run({ status: "ok" }))).toBe(false);
    expect(isTroubled(run({ status: "skipped" }))).toBe(false);
    expect(isTroubled(run({ status: "running" }))).toBe(false);
    expect(isTroubled(null)).toBe(false);
    expect(isTroubled(undefined)).toBe(false);
  });

  it("writes a length of time in words", () => {
    expect(spent(200)).toBe("less than a second");
    expect(spent(1_000)).toBe("1 second");
    expect(spent(45_000)).toBe("45 seconds");
    expect(spent(60_000)).toBe("1 minute");
    expect(spent(120_000)).toBe("2 minutes");
    expect(spent(-5)).toBe("less than a second");
  });
});

describe("a run as a fact", () => {
  it("says each status with its source, when, and how long", () => {
    expect(hookFact(run({ status: "ok", exitCode: 0 }))).toBe(
      "ok · from the project's page · 5m ago · took 12 seconds",
    );
    expect(hookFact(run({ source: "repository" }))).toBe(
      "failed (exit 3) · from the repository · 5m ago · took 12 seconds",
    );
    expect(
      hookFact(
        run({
          status: "timed_out",
          exitCode: null,
          startedAt: NOW - 420_000,
          finishedAt: NOW - 300_000,
        }),
      ),
    ).toBe("ran out of time · from the project's page · 5m ago · took 2 minutes");
  });

  it("says a run that has not ended is running, and since when", () => {
    expect(
      hookFact(
        run({ status: "running", exitCode: null, startedAt: NOW - 90_000, finishedAt: null }),
      ),
    ).toBe("running · from the project's page · started 1m ago");
  });

  it("says a hook with no script has none, and one that never ran has not", () => {
    expect(hookFact(run({ status: "skipped", source: "none" }))).toBe("no script");
    expect(hookFact(null)).toBe("not run yet");
  });
});

describe("what the row speaks of", () => {
  const failed = run();
  const timedOut = run({ runId: "run_2", status: "timed_out" });
  const running = run({ runId: "run_3", status: "running", finishedAt: null });

  it("names the scripts that ended badly and the ones running, in order", () => {
    expect(
      noticedHooks(instance({ hooks: { supported: true, install: failed, resume: timedOut } })),
    ).toEqual([
      { hook: "install", run: failed },
      { hook: "resume", run: timedOut },
    ]);
    expect(
      noticedHooks(instance({ hooks: { supported: true, install: running, resume: null } })),
    ).toEqual([{ hook: "install", run: running }]);
  });

  it("says nothing of a script that went well, or that does not exist", () => {
    const hooks = {
      supported: true,
      install: run({ status: "ok" }),
      resume: run({ status: "skipped" }),
    };
    expect(noticedHooks(instance({ hooks }))).toEqual([]);
    expect(
      noticedHooks(instance({ hooks: { supported: true, install: null, resume: null } })),
    ).toEqual([]);
  });

  it("says nothing of an instance that reports no scripts, or that cannot run them", () => {
    expect(noticedHooks(instance({ hooks: undefined }))).toEqual([]);
    expect(
      noticedHooks(instance({ hooks: { supported: false, install: failed, resume: null } })),
    ).toEqual([]);
  });

  it("leaves an instance that is not ready to say what it has to say itself", () => {
    const hooks = { supported: true, install: running, resume: failed };
    for (const state of ["setting up", "failed", "removing", "removed"] as const) {
      expect(noticedHooks(instance({ state, hooks }))).toEqual([]);
    }
    for (const state of ["online", "asleep", "offline"] as const) {
      expect(noticedHooks(instance({ state, hooks }))).toHaveLength(2);
    }
  });

  it("keeps a script that is running out of what needs somebody", () => {
    expect(
      troubledHooks(instance({ hooks: { supported: true, install: running, resume: failed } })),
    ).toEqual([{ hook: "resume", run: failed }]);
  });
});

describe("the tools of an instance", () => {
  it("names the tools that could not be installed, in one line", () => {
    expect(
      toolsNote(
        report([
          tool("gh", { required: true }),
          tool("jq", { state: "failed", reason: "apt is not available" }),
          tool("yq", { state: "failed", reason: "no release for this system" }),
          tool("zip", { state: "skipped", reason: "no sudo" }),
        ]),
      ),
    ).toBe("2 tools could not be installed: jq, yq. About this instance says why.");
  });

  it("counts one tool as one", () => {
    expect(toolsNote(report([tool("jq", { state: "failed" })]))).toBe(
      "1 tool could not be installed: jq. About this instance says why.",
    );
  });

  it("says nothing when every tool is there, was skipped, or was never reported", () => {
    expect(
      toolsNote(report([tool("gh", { required: true }), tool("git", { state: "present" })])),
    ).toBe(null);
    expect(toolsNote(report([tool("zip", { state: "skipped", reason: "no sudo" })]))).toBeNull();
    expect(toolsNote(null)).toBeNull();
    expect(toolsNote(undefined)).toBeNull();
  });

  it("leaves a required tool to the failure of the instance", () => {
    expect(toolsNote(report([tool("gh", { state: "failed", required: true })]))).toBeNull();
  });

  it("groups them by what became of them, with a reason for what is missing", () => {
    expect(
      toolsLines(
        report([
          tool("git-lfs", { state: "present" }),
          tool("make", { state: "present" }),
          tool("gh", { required: true, version: "2.63.0" }),
          tool("jq"),
          tool("yq", { state: "failed", reason: "no release for this system" }),
          tool("uv", { state: "failed" }),
          tool("zip", { state: "skipped", reason: "apt is not available" }),
        ]),
      ),
    ).toEqual([
      { label: "Already there", text: "git-lfs, make" },
      { label: "Installed", text: "gh, jq" },
      { label: "Failed", text: "yq (no release for this system), uv" },
      { label: "Skipped", text: "zip (apt is not available)" },
    ]);
  });

  it("leaves out a group that is empty", () => {
    expect(toolsLines(report([tool("gh", { required: true })]))).toEqual([
      { label: "Installed", text: "gh" },
    ]);
    expect(toolsLines(report([]))).toEqual([]);
  });
});

describe("a refusal to run a script again", () => {
  it("says an instance made before scripts existed has to be made again", () => {
    expect(runRefusal(new ApiError(409, { error: "hooks_unsupported", message: "Too old." }))).toBe(
      "This instance was made before scripts existed. Destroy it and start it again to run them.",
    );
  });

  it("says an instance that is waking up needs a moment", () => {
    expect(runRefusal(new ApiError(503, { error: "machine_waking", message: "Waking." }))).toBe(
      "The instance is waking up. Try again in a moment.",
    );
  });

  it("says an instance that is gone is gone", () => {
    expect(runRefusal(new ApiError(404, { error: "not_found" }))).toBe(
      "This instance no longer exists. Reload the page to see what is running.",
    );
  });

  it("says what the gateway said of anything else, and what to do when it said nothing", () => {
    expect(runRefusal(new ApiError(500, { error: "boom", message: "The relay is down" }))).toBe(
      "The relay is down.",
    );
    expect(runRefusal("nothing")).toBe("The script could not be run. Try again in a moment.");
  });
});
