import type { ReactNode } from "react";
import { Explorer } from "../explorer/Explorer.js";
import { PullRequestPanel } from "../pull-request/PullRequestPanel.js";
import { SearchPanel } from "../search/SearchPanel.js";
import { SourceControl } from "../source-control/SourceControl.js";
import { ErrorBanner } from "../ui.js";
import { WorkspaceTerminals } from "../WorkspaceTerminals.js";
import type { WorkspaceContext } from "./context.js";
import { TabUnavailable } from "./TabUnavailable.js";
import type { WorkspaceView } from "./workspaceLayout.js";

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
          <WorkspaceTerminals
            projectId={ctx.project.id}
            workspaceId={ctx.target.workspace}
            workspaceSlug={ctx.root.selector}
            targetLabel={ctx.targetLabel}
            available={ctx.capabilities?.terminal === true}
            visible
          />
        ),
      };
    case "source":
      return {
        layout: "split",
        panel: unavailable("Source Control", ctx.capabilities?.sourceControl) ?? (
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
        ),
      };
    case "explorer":
      return {
        layout: "split",
        panel: unavailable("the Explorer", ctx.capabilities?.files) ?? (
          <Explorer key={ctx.target.targetKey} ctx={ctx} />
        ),
      };
    case "search":
      return {
        layout: "split",
        panel: unavailable("Search", ctx.capabilities?.search) ?? (
          <SearchPanel key={ctx.target.targetKey} ctx={ctx} />
        ),
      };
    case "pr":
      return {
        layout: "split",
        panel: unavailable("Pull Request", ctx.capabilities?.sourceControl) ?? (
          <PullRequestPanel key={ctx.target.targetKey} ctx={ctx} />
        ),
      };
  }
}
