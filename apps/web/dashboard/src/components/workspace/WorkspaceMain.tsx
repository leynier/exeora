import { FileIcon, type TabItem, Tabs } from "@exeora/design/react";
import { FileCode, FileDiff, GitCommitHorizontal } from "lucide-react";
import { EmptyState } from "../ui.js";
import type { WorkspaceContext } from "./context.js";
import { DetailContent, detailHeading } from "./DetailContent.js";
import type { useOpener } from "./useOpener.js";
import { type Detail, detailTitle } from "./workspaceLayout.js";

/**
 * The wide layout's main area: the open details as tabs, and the one that
 * is active below them. A tab opened with one click is a preview and gives
 * way to the next; a double click, or an edit, keeps it.
 */
export function WorkspaceMain({
  ctx,
  opener,
}: {
  ctx: WorkspaceContext;
  opener: ReturnType<typeof useOpener>;
}) {
  const { tabs } = opener;
  const active = tabs.tabs.find((tab) => tab.id === tabs.active);
  const items: TabItem[] = tabs.tabs.map((tab) => ({
    id: tab.id,
    label: detailTitle(tab.detail),
    icon: iconFor(tab.detail),
    leading: tab.detail.kind === "file" ? <FileIcon name={tab.detail.path} size="sm" /> : undefined,
    closable: true,
    preview: !tab.pinned,
    badge: tab.dirty ? "●" : undefined,
    title: detailHeading(tab.detail).title,
  }));

  if (!active) {
    return (
      <EmptyState title="Nothing open">
        Pick a file or a change on the left to open it here.
      </EmptyState>
    );
  }
  const heading = detailHeading(active.detail);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Tabs
        label="Open files and diffs"
        tabs={items}
        value={tabs.active}
        size="sm"
        className="border-border-subtle shrink-0 border-b"
        onChange={opener.activate}
        onClose={opener.close}
        onPin={opener.pin}
      />
      <p className="border-border-subtle text-label-md text-foreground-faint shrink-0 truncate border-b px-3 py-1 font-mono">
        {heading.title}
        {heading.subtitle ? <span> · {heading.subtitle}</span> : null}
      </p>
      <div key={active.id} className="flex min-h-0 flex-1 flex-col">
        <DetailContent ctx={ctx} detail={active.detail} />
      </div>
    </div>
  );
}

function iconFor(detail: Detail) {
  if (detail.kind === "file") return FileCode;
  if (detail.kind === "commit") return GitCommitHorizontal;
  return FileDiff;
}
