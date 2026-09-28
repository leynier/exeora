import { FileIcon, IconButton } from "@exeora/design/react";
import { Copy, FileDiff } from "lucide-react";
import type { GitCommitFile } from "../../api-types-workspace.js";
import { type Target, useCommitDetail } from "../../queries-workspace.js";
import { useToast } from "../toast.js";
import { EmptyState, ErrorBanner, Skeleton } from "../ui.js";
import { fileStatusClass } from "../WorkspaceFileGroup.js";

/**
 * One commit: its message, and the files it touched with what each gained
 * and lost. A file opens its diff; the whole commit opens as one patch.
 */
export function CommitDetail({
  target,
  oid,
  onOpenFile,
  onOpenAll,
}: {
  target: Target;
  oid: string;
  onOpenFile: (file: GitCommitFile) => void;
  onOpenAll: () => void;
}) {
  const detail = useCommitDetail(target, oid);
  const toast = useToast();

  if (detail.isError)
    return <ErrorBanner error={detail.error} onRetry={() => void detail.refetch()} />;
  if (!detail.data) return <Skeleton className="m-4 h-40 w-[calc(100%-2rem)]" />;

  const { message, files } = detail.data;
  const [subject, ...rest] = message.split("\n");
  const body = rest.join("\n").trim();
  const additions = files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0);

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${what} copied.`);
    } catch {
      toast(`Could not copy the ${what.toLowerCase()}.`, "error");
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="border-border-subtle border-b px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <p className="text-title-md min-w-0 break-words">{subject}</p>
          <div className="flex shrink-0 gap-1">
            <IconButton
              label="Copy commit hash"
              icon={Copy}
              size="sm"
              onClick={() => void copy(oid, "Commit hash")}
            />
            <IconButton label="Open all changes" icon={FileDiff} size="sm" onClick={onOpenAll} />
          </div>
        </div>
        {body ? (
          <pre className="text-body-md text-foreground-muted mt-2 font-sans whitespace-pre-wrap">
            {body}
          </pre>
        ) : null}
        <p className="text-label-md text-foreground-faint mt-2 font-mono">
          {oid.slice(0, 12)} · {files.length} {files.length === 1 ? "file" : "files"} ·{" "}
          <span className="text-success">+{additions}</span>{" "}
          <span className="text-error">-{deletions}</span>
        </p>
      </div>
      {files.length === 0 ? (
        <EmptyState title="No files changed">An empty commit, or one that only merged.</EmptyState>
      ) : (
        <ul className="py-1">
          {files.map((file) => (
            <li key={file.path}>
              <button
                type="button"
                className="hover:bg-surface-variant flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left font-mono text-xs"
                title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
                onClick={() => onOpenFile(file)}
              >
                <span
                  className={`w-3 shrink-0 text-center font-medium ${fileStatusClass(file.status, "tracked")}`}
                >
                  {file.status}
                </span>
                <FileIcon name={file.path} />
                <span className="min-w-0 flex-1 truncate">{file.path}</span>
                {file.binary ? (
                  <span className="text-foreground-faint shrink-0">binary</span>
                ) : (
                  <span className="shrink-0 tabular-nums">
                    <span className="text-success">+{file.additions}</span>{" "}
                    <span className="text-error">-{file.deletions}</span>
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
