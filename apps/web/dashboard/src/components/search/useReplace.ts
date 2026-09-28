import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ReplaceResult } from "../../api-types-workspace.js";
import { type SearchInput, workspaceKeys } from "../../queries-workspace.js";
import { useToast } from "../toast.js";
import type { WorkspaceContext } from "../workspace/context.js";

/**
 * Replacing in place: the same query the results came from, the targets
 * with the tokens they were searched at, and a word on what happened to
 * each. Files that moved on since are left alone and named.
 */
export function useReplace(
  ctx: WorkspaceContext,
  input: SearchInput,
  options: { replacement: string; preserveCase: boolean },
) {
  const client = useQueryClient();
  const toast = useToast();
  const [pending, setPending] = useState(false);

  const run = async (targets: { path: string; token: string; lines?: number[] }[]) => {
    if (targets.length === 0) return;
    setPending(true);
    try {
      const result = (await ctx.actions.run(
        {
          action: "replace",
          query: input.query,
          regex: input.regex ?? false,
          caseSensitive: input.caseSensitive ?? false,
          wholeWord: input.wholeWord ?? false,
          replacement: options.replacement,
          preserveCase: options.preserveCase,
          targets,
        },
        { quiet: true },
      )) as ReplaceResult | null;
      if (!result) return;
      const conflicts = result.files.filter((file) => file.status === "conflict");
      const wrote = result.files.filter((file) => file.status === "ok" && file.replaced > 0);
      const note =
        conflicts.length > 0
          ? ` ${conflicts.length} ${conflicts.length === 1 ? "file" : "files"} changed since the search and ${conflicts.length === 1 ? "was" : "were"} skipped.`
          : "";
      toast(
        `Replaced ${result.replaced} ${result.replaced === 1 ? "match" : "matches"} in ${wrote.length} ${wrote.length === 1 ? "file" : "files"}.${note}`,
        conflicts.length > 0 ? "error" : "ok",
      );
      for (const file of wrote) {
        void client.invalidateQueries({
          queryKey: workspaceKeys.file(ctx.target.projectId, ctx.target.targetKey, file.path),
        });
      }
    } finally {
      setPending(false);
    }
  };

  return { run, pending };
}
