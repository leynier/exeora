import { MessageSquareText } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ContextCapability } from "./annotations.js";
import { type Draft, formatBatch, type Selected, snippetProblem, sourceLabel } from "./model.js";
import type { CommentStore } from "./store.js";

/**
 * The comment controls of a Workspace: writing one on a selection, the list
 * of those waiting, copying them all, and (where the Workspace is in ChatGPT)
 * adding them to the conversation.
 */

/** A modal that stays usable on a phone-width panel. */
function Modal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);
  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="border-border bg-surface text-foreground m-auto max-h-[calc(100dvh-2rem)] w-[min(36rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border p-5 backdrop:bg-black/60"
    >
      <h2 id={titleId} className="text-title-lg">
        {title}
      </h2>
      {open ? children : null}
    </dialog>
  );
}

function Snippet({ text }: { text: string }) {
  return (
    <pre className="border-border-subtle bg-bg text-foreground-muted mt-2 max-h-40 overflow-auto rounded-lg border p-2 font-mono text-xs whitespace-pre-wrap">
      {text}
    </pre>
  );
}

/** Writing a comment on what was selected. */
export function CommentComposer({
  selected,
  store,
  onClose,
}: {
  selected: Selected | null;
  store: CommentStore;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const fieldId = useId();
  useEffect(() => {
    if (selected) {
      setText("");
      setProblem(null);
    }
  }, [selected]);
  const tooLong = selected ? snippetProblem(selected.snippet) : null;
  return (
    <Modal open={selected !== null} title="Comment on the selection" onClose={onClose}>
      {selected ? (
        // Not a <form>: a sandboxed frame may not allow form submission.
        <div className="mt-3 space-y-3">
          <p className="text-body-md text-foreground-muted">{sourceLabel(selected.source)}</p>
          <Snippet text={selected.snippet} />
          {tooLong ? (
            <p role="alert" className="text-body-md text-error">
              {tooLong}
            </p>
          ) : null}
          <label htmlFor={fieldId} className="text-label-md block">
            Comment
          </label>
          <textarea
            id={fieldId}
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={4}
            className="border-border bg-bg w-full rounded-lg border p-2 text-sm"
          />
          {problem ? (
            <p role="alert" className="text-body-md text-error">
              {problem}
            </p>
          ) : null}
          <p className="text-body-md text-foreground-faint">
            It waits in this Workspace until you copy it or add it.
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={tooLong !== null}
              onClick={() => {
                // Refused, the text stays as typed: nothing is cut to fit.
                const refused = store.add(selected, text);
                if (refused) setProblem(refused);
                else onClose();
              }}
            >
              Add comment
            </button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

/** The header button: how many comments wait. */
export function CommentsButton({ store, onOpen }: { store: CommentStore; onOpen: () => void }) {
  const { drafts } = useSyncExternalStore(store.subscribe, store.get);
  return (
    <button
      type="button"
      className="btn shrink-0"
      onClick={onOpen}
      aria-label={`Comments, ${drafts.length} waiting`}
    >
      <MessageSquareText aria-hidden className="size-4" />
      <span aria-hidden>{drafts.length}</span>
    </button>
  );
}

const NO_BATCHES: { id: string; title: string; text: string }[] = [];
const noSubscribe = () => () => {};

type Copied = { kind: "done"; what: string } | { kind: "fallback"; text: string } | null;

/** The comments waiting, those already added, copying them, and adding the rest. */
export function CommentsReview({
  open,
  store,
  context,
  onPublish,
  onClose,
}: {
  open: boolean;
  store: CommentStore;
  /** Only where the Workspace can hand comments to a model. */
  context: ContextCapability | null;
  onPublish: () => void;
  onClose: () => void;
}) {
  const state = useSyncExternalStore(store.subscribe, store.get);
  const attached = useSyncExternalStore(
    context?.subscribe ?? noSubscribe,
    context?.batches ?? (() => NO_BATCHES),
  );
  const [editing, setEditing] = useState<ReadonlySet<string>>(new Set());
  const [copied, setCopied] = useState<Copied>(null);
  const publishing = state.publishing.size > 0;
  const unsaved = editing.size > 0;
  const none = state.drafts.length === 0;

  useEffect(() => {
    if (!open) setCopied(null);
  }, [open]);
  const onEditing = useCallback((id: string, now: boolean) => {
    setEditing((current) => {
      const next = new Set(current);
      if (now) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  // The exact text a model is (or would be) given: what is attached, then
  // what waits. Copied as is, or shown to copy by hand.
  const copy = async () => {
    const text = [
      ...attached.map((batch) => batch.text),
      ...(none ? [] : [formatBatch(state.drafts)]),
    ].join("\n\n");
    const parts = [
      ...(none ? [] : [count(state.drafts.length, "comment", "comments")]),
      ...(attached.length ? [count(attached.length, "attached batch", "attached batches")] : []),
    ];
    try {
      if (!navigator.clipboard?.writeText) throw new Error("No clipboard here.");
      await navigator.clipboard.writeText(text);
      setCopied({ kind: "done", what: parts.join(" and ") });
    } catch {
      setCopied({ kind: "fallback", text });
    }
  };

  return (
    <Modal open={open} title="Comments" onClose={onClose}>
      <div className="mt-3 space-y-4">
        {state.error ? (
          <div role="alert" className="border-error/30 bg-error/8 rounded-lg border p-3">
            <p className="text-body-md text-error">{state.error}</p>
            <button type="button" className="btn mt-2" onClick={() => store.dismissError()}>
              Dismiss
            </button>
          </div>
        ) : null}

        <section aria-label="Waiting comments">
          <h3 className="text-title-md">Waiting {none ? "" : `(${state.drafts.length})`}</h3>
          {none ? (
            <p className="text-body-md text-foreground-muted mt-1">
              Select text in a file or lines in a diff, then comment on it.
            </p>
          ) : (
            <ul className="mt-2 space-y-3">
              {state.drafts.map((draft) => (
                <DraftItem
                  key={draft.id}
                  draft={draft}
                  store={store}
                  locked={state.publishing.has(draft.id)}
                  onEditing={onEditing}
                />
              ))}
            </ul>
          )}
          <p className="text-body-md text-foreground-faint mt-2">
            {state.persistent
              ? "Waiting comments are kept with this panel until you add them."
              : "Waiting comments last while this Workspace stays open."}
            {context ? " ChatGPT does not see them until you add them." : ""}
          </p>
        </section>

        {copied?.kind === "done" ? (
          <p role="status" className="text-body-md text-foreground-muted">
            Copied {copied.what}.
          </p>
        ) : copied?.kind === "fallback" ? (
          <div role="alert" className="space-y-2">
            <p className="text-body-md text-warning">
              This page cannot use the clipboard. Select the text below and copy it.
            </p>
            <textarea
              aria-label="Comments to copy"
              readOnly
              value={copied.text}
              rows={6}
              onFocus={(event) => event.currentTarget.select()}
              ref={(element) => element?.select()}
              className="border-border bg-bg w-full rounded-lg border p-2 font-mono text-xs"
            />
          </div>
        ) : null}

        {context && attached.length > 0 ? (
          <section aria-label="Attached to context">
            <h3 className="text-title-md">Attached to context</h3>
            <ul className="mt-1 space-y-1">
              {attached.map((batch) => (
                <li key={batch.id} className="text-body-md text-foreground-muted">
                  {batch.title}
                </li>
              ))}
            </ul>
            <p className="text-body-md text-foreground-faint mt-1">
              ChatGPT reads them with your next message. Remove one from the composer to take it
              back.
            </p>
          </section>
        ) : null}

        {unsaved ? (
          <p className="text-body-md text-foreground-faint">
            Save or cancel the comment you are editing first.
          </p>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="btn"
            disabled={(none && attached.length === 0) || unsaved}
            onClick={() => void copy()}
          >
            Copy all comments
          </button>
          {context ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={none || unsaved || publishing}
              onClick={onPublish}
            >
              {publishing ? "Adding…" : "Add to context"}
            </button>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}

function count(n: number, one: string, many: string): string {
  return n === 1 ? `1 ${one}` : `${n} ${many}`;
}

function DraftItem({
  draft,
  store,
  locked,
  onEditing,
}: {
  draft: Draft;
  store: CommentStore;
  locked: boolean;
  onEditing: (id: string, editing: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(draft.comment);
  const [problem, setProblem] = useState<string | null>(null);
  const label = sourceLabel(draft.source);
  const edit = (now: boolean) => {
    setEditing(now);
    onEditing(draft.id, now);
  };
  // A comment taken out of the list mid-edit leaves nothing waiting on it.
  useEffect(() => () => onEditing(draft.id, false), [draft.id, onEditing]);
  return (
    <li className="border-border-subtle rounded-lg border p-3" aria-label={`Comment on ${label}`}>
      <p className="text-label-md text-foreground-muted font-mono">{label}</p>
      <Snippet text={draft.snippet} />
      {editing ? (
        <div className="mt-2 space-y-2">
          <textarea
            aria-label="Edit comment"
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={3}
            className="border-border bg-bg w-full rounded-lg border p-2 text-sm"
          />
          {problem ? (
            <p role="alert" className="text-body-md text-error">
              {problem}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="btn"
              onClick={() => {
                setText(draft.comment);
                setProblem(null);
                edit(false);
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={locked}
              onClick={() => {
                const refused = store.edit(draft.id, text);
                setProblem(refused);
                if (!refused) edit(false);
              }}
            >
              Save
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-body-md mt-2 whitespace-pre-wrap">{draft.comment}</p>
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              className="btn"
              disabled={locked}
              onClick={() => {
                setText(draft.comment);
                edit(true);
              }}
            >
              Edit
            </button>
            <button
              type="button"
              className="btn"
              disabled={locked}
              onClick={() => store.remove(draft.id)}
            >
              Delete
            </button>
          </div>
        </>
      )}
    </li>
  );
}
