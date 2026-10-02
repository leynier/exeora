import { type MenuEntry, SplitButton } from "@exeora/design/react";
import type { ReactNode } from "react";
import type { GitStatus } from "../../api.js";
import { type PrimaryActionId, primaryAction } from "./primaryAction.js";

/**
 * The message and the one button.
 *
 * Enter commits, since a commit message is one line more often than not;
 * Shift+Enter starts the body. The button names what the situation calls
 * for, and the rest of what git can do here waits under its chevron.
 */
export function CommitBox({
  message,
  onMessageChange,
  status,
  pending,
  entries,
  onPrimary,
  assist,
}: {
  message: string;
  onMessageChange: (message: string) => void;
  status: GitStatus;
  pending: boolean;
  entries: MenuEntry[];
  onPrimary: (id: PrimaryActionId) => void;
  /** The assistant's button, when an account has one linked. */
  assist?: ReactNode;
}) {
  const subject = message.trim().split("\n")[0] ?? "";
  const primary = primaryAction(status, subject.length > 0);
  return (
    <section className="border-border-subtle shrink-0 border-b p-3">
      <div className="relative">
        <label className="block">
          <span className="text-label-md text-foreground-faint font-mono tracking-wide uppercase">
            Commit
          </span>
          <textarea
            value={message}
            onChange={(event) => onMessageChange(event.target.value)}
            rows={3}
            placeholder="Commit message"
            aria-label="Commit message"
            className="border-border bg-bg mt-2 w-full resize-y rounded-lg border px-3 py-2 font-mono text-xs"
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
              event.preventDefault();
              if (primary.id === "commit" && !primary.disabled && !pending) onPrimary("commit");
            }}
          />
        </label>
        {assist ? <div className="mt-1 flex justify-end">{assist}</div> : null}
      </div>
      <SplitButton
        className="mt-2 w-full"
        label={primary.label}
        disabled={pending || primary.disabled}
        entries={entries}
        menuLabel="More actions"
        onClick={() => onPrimary(primary.id)}
      />
      {primary.disabled && primary.reason ? (
        <p className="text-label-md text-foreground-faint mt-1 text-center">{primary.reason}</p>
      ) : null}
    </section>
  );
}
