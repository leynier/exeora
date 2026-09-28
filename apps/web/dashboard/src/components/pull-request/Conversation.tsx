import { IconButton } from "@exeora/design/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import DOMPurify from "dompurify";
import { Pencil, Send } from "lucide-react";
import { marked } from "marked";
import { useMemo, useState } from "react";
import { errorText, relativeTime } from "../../api.js";
import { type ConversationItem, prApi, prKeys } from "../../api-pr.js";
import { fieldClass } from "../Dialog.js";
import { useToast } from "../toast.js";
import { Badge, ErrorBanner, Skeleton } from "../ui.js";
import type { WorkspaceContext } from "../workspace/context.js";

/** What has been said on the pull request, in order, and a place to add to it. */
export function Conversation({ ctx, number }: { ctx: WorkspaceContext; number: number }) {
  const { projectId } = ctx.target;
  const client = useQueryClient();
  const toast = useToast();
  const conversation = useQuery({
    queryKey: prKeys.conversation(projectId, number),
    queryFn: () => prApi.conversation(projectId, number),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<ConversationItem | null>(null);
  const [edited, setEdited] = useState("");

  const post = useMutation({
    mutationFn: () => prApi.comment(projectId, number, draft.trim()),
    onSuccess: () => {
      setDraft("");
      toast("Comment posted.");
      void client.invalidateQueries({ queryKey: prKeys.conversation(projectId, number) });
    },
    onError: (error) => toast(errorText(error, "The comment could not be posted."), "error"),
  });
  const save = useMutation({
    mutationFn: (item: ConversationItem) =>
      prApi.editComment(
        projectId,
        number,
        item.githubId,
        edited.trim(),
        item.kind === "review_comment" ? "review_comment" : "comment",
      ),
    onSuccess: () => {
      setEditing(null);
      toast("Comment updated.");
      void client.invalidateQueries({ queryKey: prKeys.conversation(projectId, number) });
    },
    onError: (error) => toast(errorText(error, "The comment could not be updated."), "error"),
  });

  return (
    <section aria-label="Conversation" className="flex flex-col">
      <h2 className="text-label-md text-foreground-faint px-3 pt-2 pb-1 font-mono tracking-wide uppercase">
        Conversation
      </h2>
      {conversation.isError ? (
        <ErrorBanner error={conversation.error} onRetry={() => void conversation.refetch()} />
      ) : !conversation.data ? (
        <Skeleton className="m-4 h-16 w-[calc(100%-2rem)]" />
      ) : conversation.data.items.length === 0 ? (
        <p className="text-body-md text-foreground-faint px-4 py-2">No comments yet.</p>
      ) : (
        <ul className="divide-border-subtle divide-y">
          {conversation.data.items.map((item) => (
            <li key={item.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                {item.author.avatarUrl ? (
                  <img
                    src={item.author.avatarUrl}
                    alt=""
                    width={20}
                    height={20}
                    className="size-5 rounded-full"
                  />
                ) : null}
                <span className="text-title-md">{item.author.login}</span>
                {item.reviewState ? (
                  <Badge
                    tone={
                      item.reviewState === "approved"
                        ? "success"
                        : item.reviewState === "changes_requested"
                          ? "error"
                          : undefined
                    }
                  >
                    {item.reviewState.replaceAll("_", " ")}
                  </Badge>
                ) : null}
                {item.path ? (
                  <span className="text-label-md text-foreground-faint font-mono">
                    {item.path}
                    {item.line ? `:${item.line}` : ""}
                  </span>
                ) : null}
                <span className="text-label-md text-foreground-faint ml-auto">
                  {relativeTime(Date.parse(item.createdAt))}
                </span>
                {item.editable && item.kind !== "review" ? (
                  <IconButton
                    label="Edit comment"
                    icon={Pencil}
                    size="sm"
                    onClick={() => {
                      setEditing(item);
                      setEdited(item.body);
                    }}
                  />
                ) : null}
              </div>
              {editing?.id === item.id ? (
                <form
                  className="mt-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (edited.trim()) save.mutate(item);
                  }}
                >
                  <textarea
                    value={edited}
                    onChange={(event) => setEdited(event.target.value)}
                    rows={4}
                    className={`${fieldClass} mt-0 resize-y`}
                    disabled={save.isPending}
                  />
                  <div className="mt-2 flex justify-end gap-2">
                    <button
                      type="button"
                      className="btn"
                      disabled={save.isPending}
                      onClick={() => setEditing(null)}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="btn btn-primary"
                      disabled={save.isPending || !edited.trim()}
                    >
                      Save
                    </button>
                  </div>
                </form>
              ) : (
                <Markdown source={item.body} />
              )}
            </li>
          ))}
        </ul>
      )}
      <form
        className="border-border-subtle border-t p-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (draft.trim()) post.mutate();
        }}
      >
        <div className="relative">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={3}
            placeholder="Leave a comment. Markdown is fine."
            aria-label="New comment"
            disabled={post.isPending}
            className={`${fieldClass} mt-0 resize-y pr-9`}
          />
          <div className="absolute right-1.5 bottom-1.5">
            <IconButton
              label="Post comment"
              icon={Send}
              size="sm"
              variant="primary"
              type="submit"
              disabled={post.isPending || !draft.trim()}
              busy={post.isPending}
            />
          </div>
        </div>
      </form>
    </section>
  );
}

/** A comment's markdown, sanitised before it reaches the page. */
function Markdown({ source }: { source: string }) {
  const html = useMemo(() => {
    if (!source.trim()) return "";
    const rendered = marked.parse(source, { async: false, gfm: true });
    return DOMPurify.sanitize(typeof rendered === "string" ? rendered : "", {
      USE_PROFILES: { html: true },
    });
  }, [source]);
  if (!html)
    return <p className="text-body-md text-foreground-faint mt-1 italic">No description.</p>;
  // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized by DOMPurify
  return <div className="markdown-preview mt-1" dangerouslySetInnerHTML={{ __html: html }} />;
}
