import { IconButton } from "@exeora/design/react";
import { useQueryClient } from "@tanstack/react-query";
import { BookOpenText, Code, FileDiff, RotateCcw, Save } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { errorText } from "../../api.js";
import { registerSave } from "../../hooks/saveRegistry.js";
import { type Target, useFileContent, workspaceKeys } from "../../queries-workspace.js";
import { useToast } from "../toast.js";
import { EmptyState, ErrorBanner, Skeleton } from "../ui.js";
import type { WorkspaceContext } from "../workspace/context.js";
import { Editor } from "./Editor.js";
import { fileKind } from "./explorerModel.js";
import { MarkdownPreview } from "./MarkdownPreview.js";

/** Above this, the editor shows the file and refuses to change it. */
const EDIT_LIMIT = 1_000_000;

/**
 * A file, open: the editor for text, a picture for an image, a page for
 * markdown that can flip back to its source.
 *
 * Saving sends the version the editor started from along with the new text;
 * a file that changed on the machine meanwhile is not overwritten, and the
 * banner offers to reload it or to overwrite anyway.
 */
export function FileView({ ctx, path }: { ctx: WorkspaceContext; path: string }) {
  const target = ctx.target;
  const file = useFileContent(target, path);
  const kind = file.data ? fileKind(path, file.data.mime, file.data.binary) : null;
  if (file.isError) return <ErrorBanner error={file.error} onRetry={() => void file.refetch()} />;
  if (!file.data || !kind) return <Skeleton className="m-4 h-40 w-[calc(100%-2rem)]" />;
  if (kind === "image") return <ImageView target={target} path={path} mime={file.data.mime} />;
  if (kind === "binary" || kind === "pdf") {
    return (
      <EmptyState title="Not shown">
        {kind === "pdf" ? "A PDF" : "A binary file"} of {formatSize(file.data.size)}. Open it on the
        machine that holds the workspace.
      </EmptyState>
    );
  }
  return (
    <TextFile
      ctx={ctx}
      path={path}
      content={file.data.content}
      token={file.data.token}
      truncated={file.data.truncated || file.data.size > EDIT_LIMIT}
      markdown={kind === "markdown"}
    />
  );
}

function TextFile({
  ctx,
  path,
  content,
  token,
  truncated,
  markdown,
}: {
  ctx: WorkspaceContext;
  path: string;
  content: string;
  token: string;
  truncated: boolean;
  markdown: boolean;
}) {
  const client = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState(content);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [preview, setPreview] = useState(markdown);
  const dirty = text !== content;
  const changed = ctx.status.data?.files.some((item) => item.path === path) ?? false;
  const { setDirty, actions, target } = ctx;

  useEffect(() => {
    setDirty({ kind: "file", path }, dirty);
  }, [setDirty, path, dirty]);

  const save = useCallback(
    async (overwrite = false) => {
      if (saving || (!dirty && !overwrite)) return;
      setSaving(true);
      try {
        const result = await actions.run(
          overwrite
            ? { action: "file_write", path, content: text }
            : { action: "file_write", path, content: text, expectedToken: token },
          { quiet: true },
        );
        if (result?.kind !== "file_write") return;
        if (result.status === "conflict") {
          setConflict(true);
          toast("The file changed on the machine since it was opened.", "error");
          return;
        }
        setConflict(false);
        client.setQueryData(workspaceKeys.file(target.projectId, target.targetKey, path), {
          kind: "file",
          path,
          content: text,
          encoding: "text",
          token: result.token,
          size: new TextEncoder().encode(text).length,
          truncated: false,
          binary: false,
          mime: null,
        });
        toast("Saved.");
      } catch (error) {
        toast(errorText(error, "The file could not be saved."), "error");
      } finally {
        setSaving(false);
      }
    },
    [actions, client, dirty, path, saving, target, text, toast, token],
  );

  useEffect(() => registerSave(() => void save()), [save]);

  const reload = async () => {
    await client.invalidateQueries({
      queryKey: workspaceKeys.file(target.projectId, target.targetKey, path),
    });
    setConflict(false);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-border-subtle flex shrink-0 items-center justify-end gap-1 border-b px-2 py-1">
        {truncated ? (
          <span className="text-label-md text-warning mr-auto">
            Too large to edit here; shown read only.
          </span>
        ) : dirty ? (
          <span className="text-label-md text-foreground-faint mr-auto">Unsaved changes</span>
        ) : null}
        {markdown ? (
          <IconButton
            label={preview ? "Edit the source" : "Preview"}
            icon={preview ? Code : BookOpenText}
            size="sm"
            pressed={preview}
            onClick={() => setPreview((current) => !current)}
          />
        ) : null}
        {changed ? (
          <IconButton
            label="View diff"
            icon={FileDiff}
            size="sm"
            onClick={() => ctx.open({ kind: "diff", area: "working", path }, true)}
          />
        ) : null}
        <IconButton
          label="Discard edits"
          icon={RotateCcw}
          size="sm"
          disabled={!dirty || saving}
          onClick={() => setText(content)}
        />
        <IconButton
          label="Save"
          icon={Save}
          size="sm"
          variant={dirty ? "primary" : "ghost"}
          disabled={!dirty || saving || truncated}
          busy={saving}
          onClick={() => void save()}
        />
      </div>
      {conflict ? (
        <div className="border-warning/40 bg-warning/10 text-body-md flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2">
          <span className="text-warning flex-1">
            The file changed on the machine. Reload it, or overwrite it with what is here.
          </span>
          <button type="button" className="btn" onClick={() => void reload()}>
            Reload
          </button>
          <button type="button" className="btn btn-danger" onClick={() => void save(true)}>
            Overwrite
          </button>
        </div>
      ) : null}
      {preview ? (
        <MarkdownPreview source={text} />
      ) : (
        <Editor
          path={path}
          content={dirty ? text : content}
          token={dirty ? `${token}:edited` : token}
          readOnly={truncated}
          onChange={setText}
          onSave={() => void save()}
        />
      )}
    </div>
  );
}

function ImageView({ target, path, mime }: { target: Target; path: string; mime: string | null }) {
  const file = useFileContent(target, path, "base64");
  if (!file.data) return <Skeleton className="m-4 h-40 w-[calc(100%-2rem)]" />;
  if (file.data.truncated) {
    return (
      <EmptyState title="Too large to show">
        The image is over the size the machine sends.
      </EmptyState>
    );
  }
  const type = mime ?? "image/png";
  return (
    <div className="grid min-h-0 flex-1 place-items-center overflow-auto p-4">
      <img
        src={`data:${type};base64,${file.data.content}`}
        alt={path}
        className="max-h-full max-w-full rounded-lg"
      />
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
