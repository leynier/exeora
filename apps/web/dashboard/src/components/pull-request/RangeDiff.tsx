import { type Target, useRangeDiff } from "../../queries-workspace.js";
import { DiffView } from "../source-control/DiffView.js";

/** What the branch adds over its base: the pull request's diff, as the machine sees it. */
export function RangeDiff({ target, base }: { target: Target; base: string }) {
  const diff = useRangeDiff(target, base);
  return (
    <DiffView
      patch={diff.data?.patch}
      loading={diff.isLoading}
      truncated={diff.data?.truncated}
      note={
        diff.data
          ? `${diff.data.files.length} files against ${diff.data.mergeBase.slice(0, 7)}`
          : undefined
      }
      emptyTitle="Nothing to compare"
      emptyBody={`The branch adds nothing over ${base}, or ${base} is not known on the machine. Fetch first.`}
    />
  );
}
