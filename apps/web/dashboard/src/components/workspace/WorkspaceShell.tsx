import { BottomBar, IconButton, ResizeHandle } from "@exeora/design/react";
import type { LucideIcon } from "lucide-react";
import { type CSSProperties, type ReactNode, useState } from "react";
import { useWide } from "../../hooks/useBreakpoint.js";
import { DetailScreen } from "./DetailScreen.js";
import type { WorkspaceView } from "./workspaceLayout.js";
import { MAX_PANEL_WIDTH, MIN_PANEL_WIDTH, workspacePrefs } from "./workspacePrefs.js";

export type ShellView = {
  id: WorkspaceView;
  label: string;
  short?: string;
  icon: LucideIcon;
  badge?: ReactNode;
};

export type ShellDetail = {
  title: string;
  subtitle?: string | undefined;
  actions?: ReactNode;
  content: ReactNode;
};

/**
 * The frame the Workspace views sit in.
 *
 * Wide, it is an editor's: a column of icons on the left picks the view, a
 * panel next to it holds the view's list, and the rest of the width shows
 * what was picked from the list, as tabs. Narrow, as in Chrome's side panel,
 * the same views are a bar along the bottom, the list fills the screen, and
 * what is picked from it is pushed over the list with Back.
 *
 * A view that has no list and detail, such as the terminal or the logs, asks
 * for `layout: "full"` and gets the whole width beside the column of views.
 */
export function WorkspaceShell({
  views,
  view,
  onViewChange,
  layout,
  panel,
  main,
  detail,
  onBack,
}: {
  views: readonly ShellView[];
  view: WorkspaceView;
  onViewChange: (view: WorkspaceView) => void;
  layout: "split" | "full";
  /** The view's own content: its list, or everything when the layout is full. */
  panel: ReactNode;
  /** What the wide layout shows beside the panel. */
  main?: ReactNode;
  /** What the narrow layout has pushed over the panel. */
  detail?: ShellDetail | null | undefined;
  onBack: () => void;
}) {
  const wide = useWide();
  const [width, setWidth] = useState(workspacePrefs.panelWidth.read);
  const [resizing, setResizing] = useState(false);

  if (!wide) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="border-border bg-surface flex min-h-0 flex-1 flex-col overflow-hidden rounded-t-xl border border-b-0">
          {detail ? (
            <DetailScreen
              title={detail.title}
              subtitle={detail.subtitle}
              actions={detail.actions}
              onBack={onBack}
            >
              {detail.content}
            </DetailScreen>
          ) : (
            panel
          )}
        </div>
        <BottomBar
          label="Workspace views"
          items={views}
          value={view}
          onChange={onViewChange}
          className="border-border rounded-b-xl border"
        />
      </div>
    );
  }

  return (
    <div className="border-border bg-surface flex min-h-0 flex-1 overflow-hidden rounded-xl border">
      <nav
        aria-label="Workspace views"
        className="border-border-subtle flex w-12 shrink-0 flex-col items-center gap-1 border-r py-2"
      >
        {views.map((item) => (
          <IconButton
            key={item.id}
            label={item.label}
            icon={item.icon}
            size="lg"
            tooltipSide="right"
            pressed={item.id === view}
            aria-current={item.id === view ? "page" : undefined}
            badge={item.badge}
            onClick={() => onViewChange(item.id)}
          />
        ))}
      </nav>
      {layout === "full" ? (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{panel}</div>
      ) : (
        <>
          <aside
            aria-label={views.find((item) => item.id === view)?.label}
            style={{ "--panel-width": `${width}px` } as CSSProperties}
            className={`border-border-subtle relative flex w-[var(--panel-width)] min-w-[var(--panel-width)] flex-col overflow-hidden border-r ${
              resizing ? "" : "transition-[width] duration-fast"
            }`}
          >
            {panel}
            <ResizeHandle
              value={width}
              min={MIN_PANEL_WIDTH}
              max={MAX_PANEL_WIDTH}
              label="Resize panel"
              onChange={(next) => setWidth(workspacePrefs.panelWidth.write(next))}
              onResizingChange={setResizing}
            />
          </aside>
          <div className="bg-bg flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{main}</div>
        </>
      )}
    </div>
  );
}
