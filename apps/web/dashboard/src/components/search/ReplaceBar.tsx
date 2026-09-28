import { IconButton } from "@exeora/design/react";
import { CaseSensitive, ReplaceAll } from "lucide-react";
import type { SearchResult } from "../../api-types-workspace.js";
import type { SearchInput } from "../../queries-workspace.js";
import type { WorkspaceContext } from "../workspace/context.js";
import { blockedByEdits } from "./searchModel.js";
import { useReplace } from "./useReplace.js";

/** The replacement, and the button that applies it everywhere at once. */
export function ReplaceBar({
  ctx,
  input,
  result,
  replacement,
  preserveCase,
  onReplacementChange,
  onPreserveCaseChange,
}: {
  ctx: WorkspaceContext;
  input: SearchInput;
  result: SearchResult | undefined;
  replacement: string;
  preserveCase: boolean;
  onReplacementChange: (value: string) => void;
  onPreserveCaseChange: (value: boolean) => void;
}) {
  const replace = useReplace(ctx, input, { replacement, preserveCase });
  const paths = result?.files.map((file) => file.path) ?? [];
  const blocked = blockedByEdits(paths, ctx.dirtyPaths);
  const reason =
    !result || result.totalMatches === 0
      ? "Nothing to replace"
      : result.truncated
        ? "Not every match is listed; narrow the search first"
        : blocked.length > 0
          ? `Save ${blocked.length === 1 ? blocked[0] : `${blocked.length} open files`} first`
          : undefined;
  return (
    <div className="flex items-center gap-1">
      <input
        value={replacement}
        onChange={(event) => onReplacementChange(event.target.value)}
        placeholder="Replace"
        aria-label="Replace with"
        autoComplete="off"
        spellCheck={false}
        className="border-border bg-bg min-w-0 flex-1 rounded-lg border px-3 py-1.5 font-mono text-xs"
      />
      <div className="border-border bg-bg flex items-center gap-0.5 rounded-lg border px-1">
        <IconButton
          label="Preserve case"
          icon={CaseSensitive}
          size="sm"
          pressed={preserveCase}
          onClick={() => onPreserveCaseChange(!preserveCase)}
        />
        <IconButton
          label={
            reason ? `Replace all: ${reason}` : `Replace all ${result?.totalMatches ?? 0} matches`
          }
          icon={ReplaceAll}
          size="sm"
          disabled={reason !== undefined || replace.pending || ctx.actions.pending}
          busy={replace.pending}
          onClick={() =>
            result
              ? void replace.run(
                  result.files.map((file) => ({ path: file.path, token: file.token })),
                )
              : undefined
          }
        />
      </div>
    </div>
  );
}
