import { type AiProviderId, aiApi } from "../../api-ai.js";
import type { Target } from "../../queries-workspace.js";
import { GenerateButton } from "./GenerateButton.js";

/**
 * The assistant's button in the commit box: writes a message from what is
 * staged, into the field, unless the field moved on meanwhile.
 */
export function CommitAssist({
  target,
  staged,
  conflicts,
  pending,
  value,
  onChange,
}: {
  target: Target;
  staged: number;
  conflicts: boolean;
  pending: boolean;
  /** The field, read when the answer arrives. */
  value: () => string;
  onChange: (message: string) => void;
}) {
  const reason = conflicts
    ? "Resolve conflicts first"
    : staged === 0
      ? "Stage changes first"
      : undefined;
  return (
    <GenerateButton
      label="Write a commit message"
      reason={reason}
      disabled={pending}
      fieldValue={value}
      generate={async (provider: AiProviderId | undefined, signal) => {
        const started = value();
        const result = await aiApi.commitMessage(
          target.projectId,
          provider,
          target.workspace,
          signal,
        );
        if (value() === started) onChange(result.message);
      }}
    />
  );
}
