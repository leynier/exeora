import {
  ExeoraError,
  MAX_PROCESS_BUFFER_BYTES,
  MAX_PROCESS_CHUNK_BYTES,
  MAX_PROCESSES_PER_PROJECT,
} from "@exeora/protocol";
import { execa } from "execa";

/**
 * Processes that outlive the call that started them.
 *
 * `run_command` is bounded and answers with everything the command printed.
 * A dev server has neither property: it does not finish, and its output arrives
 * over minutes. So it gets a handle, a buffer, and three more tools.
 *
 * **They die with the connection.** That is the same rule everything else here
 * follows: nothing keeps running once there is nobody left to read the answer.
 * A watch task surviving a dropped socket sounds convenient right up to the
 * afternoon a laptop wakes up with four of them still going, holding ports and
 * writing files nobody asked for.
 *
 * State lives in this module rather than being threaded through, because there
 * is exactly one executor per CLI process and its lifetime is the CLI's.
 */

/**
 * Output kept for one process, oldest dropped first.
 *
 * Measured in string length rather than bytes, and the cursor counts the same
 * way, which is what matters: the two have to agree or a reader would seek to a
 * position that is not where it thinks it is. The limits are named in bytes
 * because that is what they approximate, and for command output, which is
 * overwhelmingly ASCII, the two are the same number.
 */
interface Ring {
  /** Chunks in arrival order, stdout and stderr interleaved as they came. */
  chunks: string[];
  /** Bytes currently held, so trimming does not measure the whole ring. */
  bytes: number;
  /**
   * How many bytes have been dropped off the front, ever.
   *
   * The cursor a reader holds counts from the start of the process, not from
   * the start of the buffer. This is what turns one into the other, and what
   * lets a reader be told it fell behind instead of quietly handed a gap.
   */
  dropped: number;
}

/**
 * Only what is needed to read from, write to and stop one process.
 *
 * The subprocess object itself is deliberately not kept. execa types it by the
 * exact options it was called with, so a field holding one has to name every
 * one of them, and nothing here wants anything else from it.
 */
interface Running {
  id: string;
  root: string;
  command: string;
  pid: number | undefined;
  stdin: NodeJS.WritableStream | null;
  ring: Ring;
  exitCode: number | null;
  running: boolean;
}

const processes = new Map<string, Running>();

let counter = 0;

/** Starts a process and returns its handle at once. */
export async function startProcess(options: {
  root: string;
  cwd: string;
  command: string;
}): Promise<{ processId: string; command: string; pid: number | null }> {
  const mine = [...processes.values()].filter((entry) => entry.root === options.root);
  if (mine.length >= MAX_PROCESSES_PER_PROJECT) {
    throw new ExeoraError(
      "TOOL_FAILED",
      `This project already has ${MAX_PROCESSES_PER_PROJECT} processes running. ` +
        "Stop one with kill_command before starting another.",
    );
  }

  counter += 1;
  const id = `proc_${counter}_${Math.random().toString(36).slice(2, 8)}`;

  const subprocess = execa(options.command, {
    shell: true,
    cwd: options.cwd,
    // Same reason as run_command: a process group so the whole tree can be
    // signalled at once, rather than a shell whose orphans outlive it.
    detached: process.platform !== "win32",
    reject: false,
    all: false,
    // A pipe rather than "ignore", because unlike run_command this one can be
    // written to: send_command_input exists for the process waiting on an
    // answer, and a closed stdin would make that impossible.
    stdin: "pipe",
    buffer: false,
  });

  const entry: Running = {
    id,
    root: options.root,
    command: options.command,
    pid: subprocess.pid,
    stdin: subprocess.stdin,
    ring: { chunks: [], bytes: 0, dropped: 0 },
    exitCode: null,
    running: true,
  };

  subprocess.stdout?.on("data", (data: Buffer) => append(entry.ring, data.toString()));
  subprocess.stderr?.on("data", (data: Buffer) => append(entry.ring, data.toString()));

  // Marks it finished rather than deleting it: the exit code and the last of
  // the output are the most useful thing about a process that has just died,
  // and an agent that reads a moment too late should still find them.
  void subprocess.then(
    (result) => {
      entry.running = false;
      entry.exitCode = typeof result.exitCode === "number" ? result.exitCode : null;
    },
    () => {
      entry.running = false;
    },
  );

  processes.set(id, entry);

  return { processId: id, command: options.command, pid: subprocess.pid ?? null };
}

/**
 * Reads from a cursor, and says so when the cursor fell off the back.
 *
 * `skipped` is the honest half. A reader that is slower than the process loses
 * output, and pretending the chunk is continuous would produce a log with a
 * silent hole in it, which is worse than one with a gap marked in it.
 */
export function readProcess(
  root: string,
  processId: string,
  cursor?: number,
): {
  processId: string;
  chunk: string;
  nextCursor: number;
  skipped: boolean;
  running: boolean;
  exitCode: number | null;
} {
  const entry = find(root, processId);
  const { ring } = entry;

  const total = ring.dropped + ring.bytes;
  const from = cursor ?? 0;

  // Behind the start of what is still held, or past the end because the caller
  // sent back a cursor from a different process.
  const start = Math.min(Math.max(from, ring.dropped), total);
  const available = ring.chunks.join("");
  const slice = available.slice(
    start - ring.dropped,
    start - ring.dropped + MAX_PROCESS_CHUNK_BYTES,
  );

  return {
    processId,
    chunk: slice,
    nextCursor: start + slice.length,
    skipped: from < ring.dropped,
    running: entry.running,
    exitCode: entry.exitCode,
  };
}

export function writeProcess(
  root: string,
  processId: string,
  data: string,
  newline: boolean,
): { processId: string; bytesWritten: number } {
  const entry = find(root, processId);

  if (!entry.running || !entry.stdin?.writable) {
    throw new ExeoraError("TOOL_FAILED", "That process is not accepting input.");
  }

  const payload = newline ? `${data}\n` : data;
  entry.stdin.write(payload);

  return { processId, bytesWritten: Buffer.byteLength(payload) };
}

export function killProcess(
  root: string,
  processId: string,
): { processId: string; killed: boolean; exitCode: number | null } {
  const entry = find(root, processId);

  // Not an error: an agent that kills something already finished has the
  // outcome it wanted, and reporting a failure would invite it to retry.
  if (!entry.running) {
    return { processId, killed: false, exitCode: entry.exitCode };
  }

  killTree(entry.pid);
  entry.running = false;

  return { processId, killed: true, exitCode: entry.exitCode };
}

/**
 * Stops everything, for a connection that has gone.
 *
 * Called from the socket's teardown, which is what makes "they die with the
 * connection" true rather than aspirational.
 */
export function killAllProcesses(): void {
  for (const entry of processes.values()) {
    if (entry.running) killTree(entry.pid);
  }
  processes.clear();
}

/** For tests, and for anything that needs to know what is running. */
export function runningProcesses(): { id: string; command: string; running: boolean }[] {
  return [...processes.values()].map((entry) => ({
    id: entry.id,
    command: entry.command,
    running: entry.running,
  }));
}

// ---------------------------------------------------------------------------

/**
 * Looks up a process, and refuses one belonging to another project.
 *
 * The root check is not decoration. Handles are per machine while a token is
 * per project, so without it an agent authorized for one repository could read
 * the output of a build running in another.
 */
function find(root: string, processId: string): Running {
  const entry = processes.get(processId);
  if (!entry || entry.root !== root) {
    throw new ExeoraError(
      "TOOL_FAILED",
      "No such process. It may have been stopped, or it belongs to another project.",
    );
  }
  return entry;
}

function append(ring: Ring, text: string): void {
  ring.chunks.push(text);
  ring.bytes += text.length;

  while (ring.bytes > MAX_PROCESS_BUFFER_BYTES && ring.chunks.length > 1) {
    const oldest = ring.chunks.shift() as string;
    ring.bytes -= oldest.length;
    ring.dropped += oldest.length;
  }
}

/** Kills the process and everything it started. Mirrors run_command's. */
function killTree(pid: number | undefined): void {
  if (pid === undefined) return;

  if (process.platform === "win32") {
    // Windows has no process groups to signal; taskkill /T walks the tree.
    execa("taskkill", ["/pid", String(pid), "/T", "/F"], { reject: false });
    return;
  }

  try {
    // Negative pid targets the process group created by `detached`.
    process.kill(-pid, "SIGKILL");
  } catch {
    // Already gone, or never became a group leader: fall back to the process.
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Nothing left to kill.
    }
  }
}
