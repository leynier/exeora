import {
  batchProblem,
  type CommentSource,
  commentProblem,
  type Draft,
  newId,
  type Selected,
  snippetProblem,
} from "./model.js";

/**
 * The comments waiting in one Workspace, before anyone else sees them.
 *
 * They live in memory: one set per signed-in dashboard, Chrome side panel or
 * ChatGPT panel. Where ChatGPT keeps a widget's state
 * (`window.openai.widgetState`), they are also kept there, inside
 * `privateContent` only: the part the model is never shown. Whatever else
 * that state holds is left as it was.
 *
 * The waiting set is kept within what one batch may carry, so it can always
 * be copied or added whole. While a set is being added to the conversation,
 * those comments cannot be changed or deleted; new ones can still be written.
 */

export interface WidgetStateApi {
  read: () => unknown;
  write: (state: Record<string, unknown>) => void;
}

export interface CommentsState {
  drafts: readonly Draft[];
  /** The drafts being added right now, by id. */
  publishing: ReadonlySet<string>;
  error: string | null;
  /** Whether waiting comments outlive this panel being closed. */
  persistent: boolean;
}

const KEY = "exeoraComments";

export class CommentStore {
  private state: CommentsState;
  private listeners = new Set<() => void>();

  constructor(private readonly widget: WidgetStateApi | null = null) {
    this.state = {
      drafts: restore(widget),
      publishing: new Set(),
      error: null,
      persistent: widget !== null,
    };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  get = (): CommentsState => this.state;

  /** Adds a comment on a selection; says why not when it cannot. */
  add(selected: Selected, comment: string): string | null {
    const problem = snippetProblem(selected.snippet) ?? commentProblem(comment);
    if (problem) return problem;
    const draft: Draft = {
      id: newId(),
      source: structuredClone(selected.source),
      snippet: selected.snippet,
      comment: comment.trim(),
      createdAt: Date.now(),
    };
    const drafts = [...this.state.drafts, draft];
    if (batchProblem(drafts)) {
      return "There is no room for another waiting comment. Copy or add the waiting comments first, or delete some.";
    }
    this.set({ drafts, error: null }, true);
    return null;
  }

  edit(id: string, comment: string): string | null {
    if (this.state.publishing.has(id)) return "This comment is being added; wait for it.";
    const problem = commentProblem(comment);
    if (problem) return problem;
    const drafts = this.state.drafts.map((draft) =>
      draft.id === id ? { ...draft, comment: comment.trim() } : draft,
    );
    if (batchProblem(drafts)) {
      return "That makes the waiting comments too long to send at once. Shorten it.";
    }
    this.set({ drafts }, true);
    return null;
  }

  remove(id: string): string | null {
    if (this.state.publishing.has(id)) return "This comment is being added; wait for it.";
    this.set({ drafts: this.state.drafts.filter((draft) => draft.id !== id) }, true);
    return null;
  }

  /**
   * Takes what is waiting now, to add as one batch: an exact copy, which no
   * edit can change underneath. Null, with the reason shown, when it cannot go.
   */
  begin(): readonly Draft[] | null {
    if (this.state.publishing.size > 0) return null;
    const batch = this.state.drafts;
    const problem = batchProblem(batch);
    if (problem) {
      this.set({ error: problem });
      return null;
    }
    this.set({ publishing: new Set(batch.map((draft) => draft.id)), error: null });
    return batch;
  }

  /** Settles a batch: gone from waiting on success, kept as it was otherwise. */
  end(batch: readonly Draft[], error: string | null): void {
    const sent = new Set(batch.map((draft) => draft.id));
    this.set(
      {
        publishing: new Set(),
        error,
        drafts: error
          ? this.state.drafts
          : this.state.drafts.filter((draft) => !sent.has(draft.id)),
      },
      !error,
    );
  }

  /** Forgets every waiting comment: signing out leaves none for the next account. */
  clear(): void {
    this.set({ drafts: [], publishing: new Set(), error: null }, true);
  }

  /** Shows a sentence about the waiting comments, or clears it. */
  report(error: string | null): void {
    this.set({ error });
  }

  dismissError(): void {
    this.set({ error: null });
  }

  private set(patch: Partial<CommentsState>, persist = false): void {
    this.state = { ...this.state, ...patch };
    if (persist) this.persist();
    for (const listener of this.listeners) listener();
  }

  private persist(): void {
    if (!this.widget || !this.state.persistent) return;
    // Only `privateContent` changes; a model-visible field never sees a draft.
    try {
      const current = this.widget.read();
      const base = isRecord(current) ? current : {};
      const privateContent = isRecord(base.privateContent) ? base.privateContent : {};
      this.widget.write({
        ...base,
        privateContent: { ...privateContent, [KEY]: { v: 1, drafts: this.state.drafts } },
      });
    } catch {
      // A host that refuses keeps the drafts in memory only, and says so.
      this.state = { ...this.state, persistent: false };
    }
  }
}

function restore(widget: WidgetStateApi | null): Draft[] {
  if (!widget) return [];
  let state: unknown;
  try {
    state = widget.read();
  } catch {
    return [];
  }
  const saved =
    isRecord(state) && isRecord(state.privateContent) ? state.privateContent[KEY] : null;
  if (!isRecord(saved) || saved.v !== 1 || !Array.isArray(saved.drafts)) return [];
  const seen = new Set<string>();
  // Only what could have been written here comes back.
  return saved.drafts.filter((value): value is Draft => {
    if (!isDraft(value) || seen.has(value.id)) return false;
    seen.add(value.id);
    return true;
  });
}

function isDraft(value: unknown): value is Draft {
  if (!isRecord(value) || !isSource(value.source)) return false;
  return (
    typeof value.id === "string" &&
    value.id !== "" &&
    typeof value.snippet === "string" &&
    typeof value.comment === "string" &&
    typeof value.createdAt === "number" &&
    snippetProblem(value.snippet) === null &&
    commentProblem(value.comment) === null
  );
}

function isSource(value: unknown): value is CommentSource {
  if (!isRecord(value)) return false;
  const text = (key: string) => typeof value[key] === "string" && value[key] !== "";
  if (!text("projectId") || !text("path")) return false;
  if (value.workspace !== null && typeof value.workspace !== "string") return false;
  if (value.kind === "file") {
    return (
      typeof value.version === "string" &&
      typeof value.unsaved === "boolean" &&
      isPosition(value.start) &&
      isPosition(value.end)
    );
  }
  if (value.kind === "diff") {
    return (
      (value.area === null || value.area === "working" || value.area === "staged") &&
      (value.commit === null || typeof value.commit === "string") &&
      (value.oldPath === null || typeof value.oldPath === "string") &&
      (value.side === "old" || value.side === "new" || value.side === "both") &&
      isLines(value.oldLines) &&
      isLines(value.newLines)
    );
  }
  return false;
}

function isPosition(value: unknown): boolean {
  return (
    isRecord(value) &&
    Number.isInteger(value.line) &&
    Number.isInteger(value.column) &&
    (value.line as number) > 0 &&
    (value.column as number) > 0
  );
}

function isLines(value: unknown): boolean {
  return (
    value === null ||
    (Array.isArray(value) &&
      value.length === 2 &&
      value.every((line) => Number.isInteger(line) && line > 0) &&
      value[0] <= value[1])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** ChatGPT's widget state, when the page has it. */
export function openaiWidgetState(win: Window): WidgetStateApi | null {
  const openai = (win as unknown as { openai?: Record<string, unknown> }).openai;
  if (!openai || typeof openai.setWidgetState !== "function") return null;
  return {
    read: () => openai.widgetState,
    write: (state) => {
      void Promise.resolve((openai.setWidgetState as (state: unknown) => unknown)(state)).catch(
        () => undefined,
      );
    },
  };
}
