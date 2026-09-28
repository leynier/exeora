import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { api, type WorkspaceAction, type WorkspaceMutationResult } from "../../api.js";
import type { FileWritten } from "../../api-types-workspace.js";
import { keys } from "../../queries.js";
import { workspaceKeys } from "../../queries-workspace.js";
import { useToast } from "../toast.js";
import { workspaceActionLabel } from "../WorkspaceFileGroup.js";

export type Confirmation = {
  action: WorkspaceAction | WorkspaceAction[];
  title: string;
  body: string;
  label: string;
};

/**
 * Running things against the checkout, from wherever the button is.
 *
 * One pending flag covers the git client, the diff on screen and the
 * Explorer, since the machine serialises mutations anyway. The status that
 * comes back is written straight into the cache, and everything read from
 * the checkout (history, tree, files) is refetched, because any of it may
 * have moved.
 */
export function useWorkspaceActions({
  projectId,
  workspace,
  targetKey,
}: {
  projectId: string;
  workspace: string | undefined;
  targetKey: string;
}) {
  const client = useQueryClient();
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const [confirm, setConfirm] = useState<Confirmation | null>(null);

  const run = useCallback(
    async (
      actions: WorkspaceAction | WorkspaceAction[],
      options: { quiet?: boolean } = {},
    ): Promise<WorkspaceMutationResult | FileWritten | null> => {
      const batch = Array.isArray(actions) ? actions : [actions];
      const first = batch[0];
      if (!first) return null;
      setPending(true);
      try {
        let result: WorkspaceMutationResult | FileWritten | null = null;
        for (const action of batch) {
          // A file write answers with the file's new version, not a status.
          result = (await api.workspaceAction(projectId, action, workspace)) as
            | WorkspaceMutationResult
            | FileWritten;
        }
        if (result?.kind === "mutation") {
          client.setQueryData(keys.gitStatus(projectId, targetKey), result.status);
        }
        await Promise.all([
          client.invalidateQueries({ queryKey: ["workspace", projectId, targetKey, "diff"] }),
          client.invalidateQueries({ queryKey: workspaceKeys.reads(projectId, targetKey) }),
        ]);
        if (!options.quiet) toast(batchLabel(batch));
        return result;
      } catch (error) {
        toast(error instanceof Error ? error.message : "The action failed.", "error");
        return null;
      } finally {
        setPending(false);
        setConfirm(null);
      }
    },
    [client, projectId, targetKey, toast, workspace],
  );

  return { run, pending, confirm, setConfirm };
}

function batchLabel(batch: WorkspaceAction[]): string {
  if (batch.length === 1 && batch[0]) return workspaceActionLabel(batch[0]);
  const names = [...new Set(batch.map((action) => action.action.replaceAll("_", " ")))];
  return `${names.join(", then ")} completed.`;
}
