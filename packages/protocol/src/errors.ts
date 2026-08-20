/**
 * Error codes exchanged between the gateway and the local executor.
 *
 * These cross a trust boundary, so the message attached to an error is always
 * safe to show to the calling agent: never put absolute host paths, tokens or
 * environment values in it.
 */
export const ERROR_CODES = [
  /** No CLI is currently connected for the device that owns the project. */
  "LOCAL_EXECUTOR_OFFLINE",
  /** The executor did not answer within the relay deadline. */
  "TOOL_TIMEOUT",
  /**
   * The call was cancelled before it finished: the caller went away, or the
   * relay gave up waiting. The executor kills the process tree and answers with
   * this rather than letting the work run on unobserved.
   */
  "CANCELLED",
  /** The resolved path escaped the project root. */
  "PATH_ESCAPE",
  /** The path exists but is not the expected kind (file vs directory). */
  "PATH_NOT_FOUND",
  /** The tool ran but the underlying operation failed (ENOENT, EACCES, ...). */
  "TOOL_FAILED",
  /** The arguments did not match the tool's input schema. */
  "INVALID_ARGUMENTS",
  /** The tool name is not one this executor serves. */
  "UNKNOWN_TOOL",
  /** The project id is not registered on this executor. */
  "UNKNOWN_PROJECT",
  /** The requested worktree is not registered under the resolved project. */
  "UNKNOWN_WORKTREE",
  /** The worktree exists but this connected executor cannot currently serve it. */
  "WORKTREE_UNAVAILABLE",
  /** Reserved for protocol-v1 compatibility; the gateway no longer emits it. */
  "NO_ACTIVE_PROJECT",
  /** The caller is authenticated but not allowed to reach this project. */
  "FORBIDDEN",
  /** Someone was asked to confirm the call and said no. */
  "APPROVAL_DECLINED",
  /**
   * The call needed confirming and nobody answered in time.
   *
   * Distinct from `APPROVAL_DECLINED` because they mean different things to
   * whoever reads the audit log: one is a decision, the other is an empty
   * chair. Both refuse the call, which is the only safe direction.
   */
  "APPROVAL_TIMEOUT",
  /** Something went wrong that we could not classify. */
  "INTERNAL_ERROR",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export class ExeoraError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "ExeoraError";
    this.code = code;
  }
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && (ERROR_CODES as readonly string[]).includes(value);
}
