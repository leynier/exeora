import { lazy, type ReactNode, Suspense } from "react";
import { ErrorBanner } from "../ui.js";
import { WorkspaceTerminals } from "../WorkspaceTerminals.js";
import type { WorkspaceContext } from "./context.js";
import { TabUnavailable } from "./TabUnavailable.js";
import type { WorkspaceView } from "./workspaceLayout.js";

// The workspace shell is useful before any particular tool is selected. Keep
// each heavy view behind its own boundary so source control, search, Explorer
// and pull requests do not all arrive with the first workspace paint.
const Explorer = lazy(() =>
  import("../explorer/Explorer.js").then((module) => ({ default: module.Explorer })),
);
const LogsPanel = lazy(() =>
  import("../logs/LogsPanel.js").then((module) => ({ default: module.LogsPanel })),
);
const PullRequestPanel = lazy(() =>
  import("../pull-request/PullRequestPanel.js").then((module) => ({
    default: module.PullRequestPanel,
  })),
);
const SearchPanel = lazy(() =>
  import("../search/SearchPanel.js").then((module) => ({ default: module.SearchPanel })),
);
const SourceControl = lazy(() =>
  import("../source-control/SourceControl.js").then((module) => ({
    default: module.SourceControl,
  })),
);

function ViewLoading() {
  return (
    <div className="grid min-h-0 flex-1 place-items-center text-sm text-foreground-muted">
      Loading view…
    </div>
  );
}

/**
 * What each view puts in the panel, or what stands in for it while the
 * machine cannot serve it: offline, or a CLI from before the view existed.
 */
export function viewPanel(
  view: WorkspaceView,
  ctx: WorkspaceContext,
  capabilities: { isError: boolean; error: unknown; refetch: () => unknown },
): { panel: ReactNode; layout: "split" | "full" } {
  const online = ctx.capabilities?.online ?? true;
  const unavailable = (feature: string, has: boolean | undefined) =>
    capabilities.isError ? (
      <ErrorBanner error={capabilities.error} onRetry={() => capabilities.refetch()} />
    ) : ctx.capabilities && (!online || !has) ? (
      <TabUnavailable
        reason={online ? "update" : "offline"}
        feature={feature}
        machineName={ctx.home?.name}
        cloud={ctx.home?.kind === "cloud"}
        projectId={ctx.project.id}
        workspaceId={ctx.target.workspace}
      />
    ) : null;

  switch (view) {
    case "terminal":
      return {
        layout: "full",
        panel: (
          <div className="flex min-h-0 flex-1 flex-col p-3">
            <WorkspaceTerminals
              projectId={ctx.project.id}
              workspaceId={ctx.target.workspace}
              workspaceSlug={ctx.root.selector}
              targetLabel={ctx.targetLabel}
              available={ctx.capabilities?.terminal === true}
              visible
            />
          </div>
        ),
      };
    case "logs":
      return {
        layout: "full",
        panel: (
          <Suspense fallback={<ViewLoading />}>
            <LogsPanel ctx={ctx} />
          </Suspense>
        ),
      };
    case "source":
      return {
        layout: "split",
        panel: unavailable("Source Control", ctx.capabilities?.sourceControl) ?? (
          <Suspense fallback={<ViewLoading />}>
            <SourceControl
              key={ctx.target.targetKey}
              ctx={ctx}
              target={ctx.target}
              workspaces={ctx.siblings}
              root={ctx.root}
              project={ctx.project}
              where={ctx.home}
              status={ctx.status.data}
              loading={ctx.status.isLoading}
              error={ctx.status.error}
              v2={ctx.capabilities?.sourceControlV2 === true}
              actions={ctx.actions}
              selected={ctx.selected}
              onOpen={ctx.open}
              onSelectWorkspace={ctx.onSelectWorkspace}
            />
          </Suspense>
        ),
      };
    case "explorer":
      return {
        layout: "split",
        panel: unavailable("the Explorer", ctx.capabilities?.files) ?? (
          <Suspense fallback={<ViewLoading />}>
            <Explorer key={ctx.target.targetKey} ctx={ctx} />
          </Suspense>
        ),
      };
    case "search":
      return {
        layout: "split",
        panel: unavailable("Search", ctx.capabilities?.search) ?? (
          <Suspense fallback={<ViewLoading />}>
            <SearchPanel key={ctx.target.targetKey} ctx={ctx} />
          </Suspense>
        ),
      };
    case "pr":
      return {
        layout: "split",
        panel: unavailable("Pull Request", ctx.capabilities?.sourceControl) ?? (
          <Suspense fallback={<ViewLoading />}>
            <PullRequestPanel key={ctx.target.targetKey} ctx={ctx} />
          </Suspense>
        ),
      };
  }
}
