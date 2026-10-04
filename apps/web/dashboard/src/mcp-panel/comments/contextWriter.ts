import { batchTitle, type Draft, formatBatch } from "../../components/comments/model.js";

/**
 * Everything this panel puts in ChatGPT's model context, written one update
 * at a time.
 *
 * `ui/update-model-context` replaces this panel's whole context each time, so
 * every write is composed whole here: the comment batches the person added
 * (each a text block, a removable attachment, titled through `_meta`), and
 * the workspace's contents-free state as structured content. Waiting drafts
 * are never part of it.
 *
 * The host's account of what is attached (`hostContext["openai/modelContext"]`,
 * on initialize and whenever it changes) wins, always: the latest snapshot it
 * gave is what this panel holds, cleared and empty ones included. A snapshot
 * heard while a write was on its way says nothing about whether it came
 * before or after the write landed, so:
 *
 * - a new batch counts as added only once a snapshot has shown it. One that
 *   no snapshot showed is not assumed: the host is told its latest snapshot
 *   again (taking the batch back out if it had landed), and adding it fails
 *   with a sentence asking to try again, the drafts still waiting;
 * - any other write the host did not echo is followed by its latest snapshot,
 *   once, so nothing the person removed comes back.
 *
 * Blocks are compared by everything they say except `_meta`, which a host may
 * rewrite and the model never reads.
 */

export interface ContentBlock {
  type: string;
  text?: string;
  _meta?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ContextHost {
  connected: () => boolean;
  /** Whether the host takes text blocks in model context. */
  supportsText: () => boolean;
  /** Writes the context; resolves with the host's update id, rejects on failure. */
  update: (params: {
    content: ContentBlock[];
    structuredContent: Record<string, unknown>;
  }) => Promise<string | null>;
}

export interface AttachedBatch {
  id: string;
  title: string;
  /** What the model reads for it, for copying. */
  text: string;
}

interface Note {
  updateId: string | null;
  blocks: ContentBlock[];
}

const BATCH_KEY = "exeora/batch";
const TITLE_KEY = "openai/title";

const batchId = (block: ContentBlock): string | null => {
  const id = block._meta?.[BATCH_KEY];
  return typeof id === "string" ? id : null;
};

/** A block as the model reads it: every field but `_meta`, in a stable order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .filter((key) => key !== "_meta")
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

const sameBlocks = (a: ContentBlock[], b: ContentBlock[]): boolean =>
  a.length === b.length && canonical(a) === canonical(b);

const holds = (blocks: ContentBlock[], block: ContentBlock): boolean => {
  const wanted = canonical(block);
  return blocks.some((item) => canonical(item) === wanted);
};

/** Why an added batch is not counted: the host changed the context meanwhile. */
export const CHANGED_MEANWHILE =
  "ChatGPT changed the attached context while these comments were being added, so they were not added. Try again.";

export class ContextWriter {
  private attached: ContentBlock[] = [];
  private workspace: Record<string, unknown> | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  /** What the host said during the write on its way, if one is. */
  private notes: Note[] | null = null;
  private lastUpdateId: string | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private listeners = new Set<() => void>();
  private cached: AttachedBatch[] = [];

  constructor(
    private readonly host: ContextHost,
    private readonly debounceMs = 300,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** The batches attached now, for the panel to list. */
  batches = (): AttachedBatch[] => this.cached;

  /** What the host says is attached: on initialize, and each time it changes. */
  fromHost(context: unknown): void {
    if (context === undefined) return;
    let note: Note;
    if (context === null) {
      note = { updateId: null, blocks: [] };
    } else if (isRecord(context)) {
      note = {
        updateId: typeof context.updateId === "string" ? context.updateId : null,
        blocks: Array.isArray(context.content)
          ? (context.content.filter(isRecord) as ContentBlock[])
          : [],
      };
      // What the last acknowledged write said, said back: nothing new.
      if (!this.notes && note.updateId !== null && note.updateId === this.lastUpdateId) return;
    } else {
      return;
    }
    this.notes?.push(note);
    this.attached = note.blocks;
    this.changed();
  }

  /**
   * The workspace's state, contents-free, written a moment after it settles;
   * `null` takes it out.
   */
  setWorkspace(state: Record<string, unknown> | null): void {
    this.workspace = state;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (!this.host.connected()) return;
      void this.enqueue(() => this.writeAndSettle(this.attached, null, false)).catch(
        () => undefined,
      );
    }, this.debounceMs);
  }

  /**
   * Adds a batch of comments, as one attachment. Resolves once the host has
   * taken it; rejects, with a sentence to show, when it did not.
   */
  async publish(drafts: readonly Draft[]): Promise<AttachedBatch> {
    if (!this.host.connected()) throw new Error("ChatGPT is not connected to this panel.");
    if (!this.host.supportsText()) {
      throw new Error("This ChatGPT client cannot attach context from apps.");
    }
    const id = crypto.randomUUID();
    const title = batchTitle(drafts);
    const block: ContentBlock = {
      type: "text",
      text: formatBatch(drafts),
      _meta: { [TITLE_KEY]: title, [BATCH_KEY]: id },
    };
    await this.enqueue(() =>
      this.writeAndSettle(
        [...this.attached.filter((item) => batchId(item) !== id), block],
        block,
        false,
      ),
    );
    return { id, title, text: block.text ?? "" };
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.chain.then(job, job);
    this.chain = run.catch(() => undefined);
    return run;
  }

  /**
   * Writes `sent` and settles what is attached by what the host said. With an
   * `added` batch, resolves only if a host snapshot showed it; rejects when
   * the host refused, or never showed it.
   */
  private async writeAndSettle(
    sent: ContentBlock[],
    added: ContentBlock | null,
    resync: boolean,
  ): Promise<void> {
    this.notes = [];
    let updateId: string | null;
    let notes: Note[];
    try {
      updateId = await this.host.update({
        content: sent,
        structuredContent: this.workspace ? { "exeora/workspace": this.workspace } : {},
      });
    } catch (error) {
      throw error instanceof Error ? error : new Error("ChatGPT did not take the context.");
    } finally {
      notes = this.notes ?? [];
      this.notes = null;
    }
    this.lastUpdateId = updateId;

    if (notes.length === 0) {
      this.attached = sent;
      this.changed();
      return;
    }
    // The host spoke meanwhile: its latest snapshot is what is attached
    // (already taken in as it came). Nothing here adds to it.
    const latest = this.attached;
    const echoed = notes.some(
      (note) => (updateId !== null && note.updateId === updateId) || sameBlocks(note.blocks, sent),
    );
    if (added) {
      if (notes.some((note) => holds(note.blocks, added))) return;
      // Never shown: it may have landed or not. The host gets its own latest
      // snapshot back, and the person a retry.
      if (!resync) await this.writeAndSettle(latest, null, true).catch(() => undefined);
      throw new Error(CHANGED_MEANWHILE);
    }
    if (!echoed && !resync) {
      await this.writeAndSettle(latest, null, true).catch(() => undefined);
    }
  }

  private changed(): void {
    const seen = new Set<string>();
    this.cached = this.attached.flatMap((block) => {
      const id = batchId(block);
      if (id === null || seen.has(id)) return [];
      seen.add(id);
      const title = block._meta?.[TITLE_KEY];
      return [
        {
          id,
          title: typeof title === "string" ? title : "Exeora Workspace comments",
          text: typeof block.text === "string" ? block.text : "",
        },
      ];
    });
    for (const listener of this.listeners) listener();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
