/**
 * Shared truncation and timing limits.
 *
 * Both sides must agree on these: the executor enforces them when producing a
 * result, and the gateway relies on them to know a payload can never blow past
 * the Durable Object WebSocket message ceiling (32 MiB).
 */

/** Largest text payload a single tool result may carry, in bytes. */
export const MAX_RESULT_BYTES = 1_000_000;

/** Largest file `read_file` will return without an explicit range. */
export const MAX_READ_BYTES = 500_000;

/** Largest number of entries `list_files` returns in one call. */
export const MAX_LIST_ENTRIES = 1_000;

/** Largest number of matches `grep` returns in one call. */
export const MAX_GREP_MATCHES = 200;

/** Largest combined stdout/stderr `run_command` returns, in bytes. */
export const MAX_COMMAND_OUTPUT_BYTES = 200_000;

/** Default wall-clock budget for `run_command`, in milliseconds. */
export const DEFAULT_COMMAND_TIMEOUT_MS = 60_000;

/** Upper bound a caller may request for `run_command`, in milliseconds. */
export const MAX_COMMAND_TIMEOUT_MS = 300_000;

/**
 * How long the relay waits for the executor before giving up with
 * `TOOL_TIMEOUT`. Deliberately larger than MAX_COMMAND_TIMEOUT_MS so the
 * executor's own timeout wins and reports a useful partial result.
 */
export const RELAY_TIMEOUT_MS = 310_000;

/**
 * How much output one long-running process keeps, in bytes.
 *
 * A ring: once it is full the oldest bytes go, and the reader is told they did.
 * A dev server left running for a day would otherwise be a memory leak with a
 * scrollback, and the useful end of a log is the recent one.
 */
export const MAX_PROCESS_BUFFER_BYTES = 256_000;

/** Largest slice `get_command_output` returns in one call, in bytes. */
export const MAX_PROCESS_CHUNK_BYTES = 100_000;

/**
 * How many long-running processes one project may have at once.
 *
 * Low on purpose. These are dev servers and watch tasks, and an agent that has
 * started twenty of something has lost track rather than found a use for them.
 */
export const MAX_PROCESSES_PER_PROJECT = 8;

/**
 * How long a call may wait for someone to confirm it, in milliseconds.
 *
 * Well inside RELAY_TIMEOUT_MS, so the relay is not the thing that gives up.
 * The real ceiling is the calling AI client's own HTTP timeout, which for
 * claude.ai and ChatGPT is around a minute: past that the answer arrives to
 * nobody. Ninety seconds is long enough to read a command and short enough
 * that an unattended machine fails rather than hangs.
 */
export const APPROVAL_WAIT_MS = 90_000;

/** How often the CLI sends a heartbeat frame, in milliseconds. */
export const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * How often live presence is checkpointed to D1.
 *
 * Connectivity heartbeats are answered by the Durable Object runtime without
 * waking JavaScript. This slower frame exists only to keep `lastSeenAt`
 * useful for aggregate/admin views that cannot fan out to every relay.
 */
export const PRESENCE_CHECKPOINT_INTERVAL_MS = 15 * 60_000;

/**
 * Retry cadence for presence signals.
 *
 * Shorter than the checkpoint interval so a lost frame is not a lost write. The
 * gateway debounces to `PRESENCE_CHECKPOINT_INTERVAL_MS` minus one signal, which
 * is what makes the checkpoint interval the real staleness of `lastSeenAt`
 * rather than a floor a whole signal below it.
 */
export const PRESENCE_SIGNAL_INTERVAL_MS = 5 * 60_000;

/**
 * How long a checkpoint stays good for.
 *
 * Wider than `PRESENCE_CHECKPOINT_INTERVAL_MS` by enough to survive a missed
 * write, which is why it cannot be tight. Being loose costs little because it
 * is only half the answer: the gateway records a disconnection as it happens,
 * so this window is what covers the machines that left without saying so.
 */
export const PRESENCE_TIMEOUT_MS = 25 * 60_000;

/** How long the CLI tolerates an unanswered fixed heartbeat before reconnecting. */
export const HEARTBEAT_TIMEOUT_MS = 90_000;

/**
 * Bound data copied into Durable Object WebSocket attachments.
 *
 * Not the attachment budget, which is far larger: workerd enforces 16,384 bytes
 * ("A WebSocket 'attachment' cannot be larger than 16384 bytes"), and the rest
 * of the `ApprovalView` around the prompt is a few hundred more. This is a bound
 * on what a person can be asked to read and judge in one prompt, and there is
 * room to raise it if a real command needs it.
 */
export const MAX_APPROVAL_PROMPT_LENGTH = 2_048;
