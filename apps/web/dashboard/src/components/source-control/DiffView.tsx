import { IconButton } from "@exeora/design/react";
import type { FileDiffOptions } from "@pierre/diffs";
import { PatchDiff } from "@pierre/diffs/react";
import { Columns2, MessageSquarePlus, Rows2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { DiffArea } from "../../api-types-workspace.js";
import { useWide } from "../../hooks/useBreakpoint.js";
import { useCommentCompose } from "../comments/annotations.js";
import { diffSelection, type LineRange, patchNames } from "../comments/diffSelection.js";
import { EmptyState, Skeleton } from "../ui.js";
import { type DiffStyle, workspacePrefs } from "../workspace/workspacePrefs.js";
import { type FilePatch, splitPatch } from "./patchSplit.js";

/**
 * A patch on screen.
 *
 * Unified everywhere, and side by side as well where there is the width for
 * it, which a phone and the side panel never have. What the machine could
 * not send in full, or sent as bytes, is said above the patch rather than
 * left as a patch that looks whole.
 */
export function DiffView({
  patch,
  loading = false,
  binary = false,
  truncated = false,
  note,
  emptyTitle = "No textual diff",
  emptyBody = "The file may be untracked, binary, or unchanged in this area.",
  toolbar,
  comment,
}: {
  patch: string | undefined;
  loading?: boolean;
  binary?: boolean;
  truncated?: boolean;
  /** One more line for the banner, such as untracked files left out. */
  note?: string | undefined;
  emptyTitle?: string;
  emptyBody?: string;
  /** Controls drawn beside the style toggle. */
  toolbar?: React.ReactNode;
  /**
   * Which changes these are, for a comment on selected lines: the working
   * tree, the index, or a commit. Comments are offered only where the
   * Workspace is embedded to take them.
   */
  comment?: { area: DiffArea | null; commit: string | null };
}) {
  const wide = useWide();
  const [style, setStyle] = useState<DiffStyle>(workspacePrefs.diffStyle.read);
  const diffStyle: DiffStyle = wide ? style : "unified";
  // The renderer takes one file at a time; an aggregate patch is many.
  const files = useMemo(() => (patch ? splitPatch(patch) : []), [patch]);
  // Lines picked in one file of the patch, for a comment.
  const compose = useCommentCompose();
  const commenting = compose && comment ? comment : null;
  const [picked, setPicked] = useState<{ file: FilePatch; range: LineRange } | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new patch or layout is the trigger
  useEffect(() => setPicked(null), [patch, diffStyle]);
  const optionsFor = (file: FilePatch) =>
    commenting
      ? {
          ...options,
          enableLineSelection: true,
          onLineSelectionEnd: (range: LineRange | null) =>
            setPicked(range ? { file, range } : null),
        }
      : options;
  const commentOnLines = () => {
    if (!picked || !commenting) return;
    // The Workspace adds the project and working copy; the patch names the file.
    const names = patchNames(picked.file.patch, picked.file.path);
    const selected = diffSelection(
      picked.file.patch,
      picked.range,
      { ...names, area: commenting.area, commit: commenting.commit },
      diffStyle,
    );
    if (selected) compose?.(selected);
  };
  const options: FileDiffOptions<undefined> = {
    // Pierre still follows the OS unless themeType is dark.
    // Naming both slots pierre-dark is not enough on a light laptop.
    theme: { dark: "pierre-dark", light: "pierre-dark" },
    themeType: "dark" as const,
    disableFileHeader: true,
    diffStyle,
    overflow: "scroll" as const,
    stickyHeader: true,
    unsafeCSS: `:host { color-scheme: dark; background: var(--color-bg, #0d0f11); }`,
  };

  const banner = binary
    ? "Binary file: the diff is not shown."
    : truncated
      ? "The diff was cut short at the machine's output limit."
      : note;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {wide || toolbar || commenting ? (
        <div className="border-border-subtle flex shrink-0 items-center justify-end gap-1 border-b px-2 py-1">
          {toolbar}
          {commenting ? (
            <IconButton
              label="Comment on the selected lines"
              icon={MessageSquarePlus}
              size="sm"
              disabled={!picked}
              onClick={commentOnLines}
            />
          ) : null}
          {wide ? (
            <IconButton
              label={diffStyle === "split" ? "Show as one column" : "Show side by side"}
              icon={diffStyle === "split" ? Rows2 : Columns2}
              size="sm"
              onClick={() =>
                setStyle(workspacePrefs.diffStyle.write(style === "split" ? "unified" : "split"))
              }
            />
          ) : null}
        </div>
      ) : null}
      {banner ? (
        <p className="text-body-md text-warning border-border-subtle shrink-0 border-b px-4 py-2">
          {banner}
        </p>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto">
        {files.length === 1 && files[0] ? (
          <div className="git-diff h-full">
            <PatchDiff
              // Pierre keeps its layout once mounted; a style change is a new diff.
              key={diffStyle}
              patch={files[0].patch}
              disableWorkerPool
              options={optionsFor(files[0])}
            />
          </div>
        ) : files.length > 1 ? (
          <div className="git-diff">
            {files.map((file) => (
              <section key={file.path} aria-label={file.path}>
                <h3 className="border-border-subtle bg-surface text-title-md sticky top-0 z-10 border-y px-4 py-1.5 font-mono text-xs">
                  {file.path}
                </h3>
                <PatchDiff
                  key={diffStyle}
                  patch={file.patch}
                  disableWorkerPool
                  options={optionsFor(file)}
                />
              </section>
            ))}
          </div>
        ) : loading ? (
          <Skeleton className="m-5 h-64 w-[calc(100%-2.5rem)]" />
        ) : (
          <EmptyState title={emptyTitle}>{emptyBody}</EmptyState>
        )}
      </div>
    </div>
  );
}
