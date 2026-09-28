import { FileView } from "../explorer/FileView.js";
import { RangeDiff } from "../pull-request/RangeDiff.js";
import { CommitDetail } from "../source-control/CommitDetail.js";
import { AllChangesDiff, CommitFileDiff, WorkingFileDiff } from "../source-control/FileDiff.js";
import type { WorkspaceContext } from "./context.js";
import type { Detail } from "./workspaceLayout.js";

/** What a detail shows, whichever way it was opened. */
export function DetailContent({ ctx, detail }: { ctx: WorkspaceContext; detail: Detail }) {
  switch (detail.kind) {
    case "diff":
      return (
        <WorkingFileDiff
          target={ctx.target}
          path={detail.path}
          area={detail.area}
          status={ctx.status.data}
          pending={ctx.actions.pending}
          onRun={(action) => void ctx.actions.run(action)}
          onConfirm={ctx.actions.setConfirm}
        />
      );
    case "diffall":
      return <AllChangesDiff target={ctx.target} area={detail.area} />;
    case "commit":
      return (
        <CommitDetail
          target={ctx.target}
          oid={detail.oid}
          onOpenFile={(file) =>
            ctx.open({ kind: "commitfile", oid: detail.oid, path: file.path }, true)
          }
          onOpenAll={() => ctx.open({ kind: "commitdiff", oid: detail.oid }, true)}
        />
      );
    case "commitdiff":
      return <CommitFileDiff target={ctx.target} oid={detail.oid} path={null} />;
    case "commitfile":
      return <CommitFileDiff target={ctx.target} oid={detail.oid} path={detail.path} />;
    case "file":
      return <FileView ctx={ctx} path={detail.path} />;
    case "range":
      return <RangeDiff target={ctx.target} base={detail.base} />;
  }
}

/** What a detail is called in a tab or above a pushed screen, with its area. */
export function detailHeading(detail: Detail): { title: string; subtitle?: string } {
  switch (detail.kind) {
    case "diff":
      return { title: detail.path, subtitle: detail.area === "staged" ? "Staged" : "Working tree" };
    case "diffall":
      return { title: detail.area === "staged" ? "Staged changes" : "All changes" };
    case "commit":
      return { title: detail.oid.slice(0, 12), subtitle: "Commit" };
    case "commitdiff":
      return { title: detail.oid.slice(0, 12), subtitle: "All changes in the commit" };
    case "commitfile":
      return { title: detail.path, subtitle: `In ${detail.oid.slice(0, 7)}` };
    case "file":
      return { title: detail.path };
    case "range":
      return { title: `Changes against ${detail.base}` };
  }
}
