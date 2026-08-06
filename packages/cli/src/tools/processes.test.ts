import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_PROCESSES_PER_PROJECT } from "@exeora/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  killAllProcesses,
  killProcess,
  readProcess,
  runningProcesses,
  startProcess,
  writeProcess,
} from "./processes.js";

/**
 * Processes that outlive the call that started them.
 *
 * Real subprocesses rather than stubs, because everything worth testing here is
 * about what an operating system actually does: whether output arrives, whether
 * a tree dies, whether stdin reaches a program that is waiting on it.
 */

let root: string;
let other: string;

/** Reads until the process has printed something, or gives up. */
async function outputOf(id: string, from = 0) {
  let result = readProcess(root, id, from);
  await vi.waitFor(() => {
    result = readProcess(root, id, from);
    expect(result.chunk.length).toBeGreaterThan(0);
  });
  return result;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "exeora-proc-"));
  other = await mkdtemp(join(tmpdir(), "exeora-other-"));
});

afterEach(async () => {
  killAllProcesses();
  await rm(root, { recursive: true, force: true });
  await rm(other, { recursive: true, force: true });
});

describe("start_command", () => {
  it("answers at once with a handle, without waiting for the process", async () => {
    // The whole point of the tool: `sleep 30` would have blocked run_command
    // for its full budget, and this returns immediately.
    const started = await startProcess({ root, cwd: root, command: "sleep 30" });

    expect(started.processId).toMatch(/^proc_/);
    expect(started.pid).toBeGreaterThan(0);
    expect(readProcess(root, started.processId).running).toBe(true);
  });

  it("refuses once a project has too many running", async () => {
    for (let index = 0; index < MAX_PROCESSES_PER_PROJECT; index += 1) {
      await startProcess({ root, cwd: root, command: "sleep 30" });
    }

    await expect(startProcess({ root, cwd: root, command: "sleep 30" })).rejects.toThrow(
      /already has/,
    );
  });

  it("counts the limit per project rather than per machine", async () => {
    for (let index = 0; index < MAX_PROCESSES_PER_PROJECT; index += 1) {
      await startProcess({ root, cwd: root, command: "sleep 30" });
    }

    // A second project is not out of room because the first one is.
    await expect(
      startProcess({ root: other, cwd: other, command: "sleep 30" }),
    ).resolves.toMatchObject({ command: "sleep 30" });
  });
});

describe("get_command_output", () => {
  it("reads from a cursor and continues where it stopped", async () => {
    const { processId } = await startProcess({
      root,
      cwd: root,
      command: "echo one; sleep 0.2; echo two",
    });

    const first = await outputOf(processId);
    expect(first.chunk).toContain("one");
    expect(first.skipped).toBe(false);

    const second = await outputOf(processId, first.nextCursor);
    expect(second.chunk).toContain("two");
    // The point of the cursor: the second read is not the first one again.
    expect(second.chunk).not.toContain("one");
  });

  it("interleaves stderr with stdout, as the process wrote them", async () => {
    const { processId } = await startProcess({
      root,
      cwd: root,
      command: "echo out; echo err 1>&2",
    });

    await vi.waitFor(() => {
      const { chunk } = readProcess(root, processId);
      expect(chunk).toContain("out");
      expect(chunk).toContain("err");
    });
  });

  it("reports the exit code once the process is done", async () => {
    const { processId } = await startProcess({ root, cwd: root, command: "exit 3" });

    await vi.waitFor(() => {
      const result = readProcess(root, processId);
      expect(result.running).toBe(false);
      expect(result.exitCode).toBe(3);
    });
  });

  it("keeps a finished process readable rather than forgetting it", async () => {
    // The most useful moment to read a process is just after it died.
    const { processId } = await startProcess({ root, cwd: root, command: "echo done" });

    await vi.waitFor(() => expect(readProcess(root, processId).running).toBe(false));
    expect(readProcess(root, processId).chunk).toContain("done");
  });
});

describe("send_command_input", () => {
  it("reaches a process waiting on an answer", async () => {
    const { processId } = await startProcess({
      root,
      cwd: root,
      command: "read answer; echo got:$answer",
    });

    // Given a moment to reach the `read`, which is where the shell blocks.
    await new Promise((resolve) => setTimeout(resolve, 100));
    writeProcess(root, processId, "yes", true);

    await vi.waitFor(() => expect(readProcess(root, processId).chunk).toContain("got:yes"));
  });

  it("refuses a process that has already exited", async () => {
    const { processId } = await startProcess({ root, cwd: root, command: "true" });

    await vi.waitFor(() => expect(readProcess(root, processId).running).toBe(false));
    expect(() => writeProcess(root, processId, "hello", true)).toThrow(/not accepting input/);
  });
});

describe("kill_command", () => {
  it("stops a running process", async () => {
    const { processId } = await startProcess({ root, cwd: root, command: "sleep 30" });

    expect(killProcess(root, processId).killed).toBe(true);
    await vi.waitFor(() => expect(readProcess(root, processId).running).toBe(false));
  });

  it("is not an error to stop one that already finished", async () => {
    // An agent that asked for the outcome it already has should not be told it
    // failed, or it will retry.
    const { processId } = await startProcess({ root, cwd: root, command: "true" });

    await vi.waitFor(() => expect(readProcess(root, processId).running).toBe(false));
    expect(killProcess(root, processId).killed).toBe(false);
  });
});

describe("isolation between projects", () => {
  it("refuses a handle belonging to another project", async () => {
    // Handles are per machine while a token is per project. Without this check,
    // an agent authorized for one repository could read a build running in
    // another one on the same machine.
    const { processId } = await startProcess({ root, cwd: root, command: "sleep 30" });

    expect(() => readProcess(other, processId)).toThrow(/No such process/);
    expect(() => killProcess(other, processId)).toThrow(/No such process/);
    expect(() => writeProcess(other, processId, "x", true)).toThrow(/No such process/);
  });

  it("says the same thing about a handle that never existed", async () => {
    // Same message either way, so a handle cannot be probed for existence.
    expect(() => readProcess(root, "proc_nope")).toThrow(/No such process/);
  });
});

describe("dying with the connection", () => {
  it("kills everything and forgets it", async () => {
    await startProcess({ root, cwd: root, command: "sleep 30" });
    await startProcess({ root: other, cwd: other, command: "sleep 30" });
    expect(runningProcesses()).toHaveLength(2);

    killAllProcesses();

    // Nothing left running, and nothing left to read: this is the rule the
    // whole design rests on, that nothing keeps working with nobody watching.
    expect(runningProcesses()).toEqual([]);
  });
});
