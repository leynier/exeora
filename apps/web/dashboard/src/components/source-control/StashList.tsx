import { IconButton } from "@exeora/design/react";
import { ArchiveRestore, Trash } from "lucide-react";
import { relativeTime } from "../../api.js";
import { type Target, useStashes } from "../../queries-workspace.js";
import type { Confirmation } from "../workspace/useWorkspaceActions.js";

/** What was put aside with stash, with the way back. */
export function StashList({
  target,
  count,
  pending,
  onPop,
  onConfirm,
}: {
  target: Target;
  count: number;
  pending: boolean;
  onPop: (index: number) => void;
  onConfirm: (confirm: Confirmation) => void;
}) {
  const stashes = useStashes(target, count > 0);
  if (count === 0) return null;
  const entries = stashes.data?.entries ?? [];
  return (
    <section className="border-border-subtle border-b py-1.5">
      <h2 className="text-label-md text-foreground-faint px-3 pb-1 font-mono tracking-wide uppercase">
        Stashes <span className="tabular-nums">{count}</span>
      </h2>
      <ul>
        {entries.map((entry) => (
          <li key={entry.index} className="group flex items-center gap-1 px-1.5">
            <span className="min-w-0 flex-1 px-1.5 py-1 font-mono text-xs">
              <span className="text-foreground-faint">stash@{`{${entry.index}}`} </span>
              <span className="text-foreground">{entry.message}</span>
              <span className="text-foreground-faint">
                {" "}
                · {relativeTime(Date.parse(entry.createdAt))}
              </span>
            </span>
            <IconButton
              label="Apply and drop this stash"
              icon={ArchiveRestore}
              size="sm"
              disabled={pending}
              onClick={() => onPop(entry.index)}
            />
            <IconButton
              label="Drop this stash"
              icon={Trash}
              size="sm"
              variant="danger"
              disabled={pending}
              onClick={() =>
                onConfirm({
                  action: { action: "stash_drop", index: entry.index },
                  title: "Drop this stash?",
                  body: `"${entry.message}" will be gone; git keeps no other copy of it.`,
                  label: "Drop stash",
                })
              }
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
