import { describe, expect, it, vi } from "vitest";
import type { Selected } from "./model.js";
import { CommentStore, type WidgetStateApi } from "./store.js";

const SELECTED: Selected = {
  source: {
    kind: "file",
    projectId: "p1",
    workspace: null,
    path: "src/a.ts",
    version: "tok1",
    unsaved: false,
    start: { line: 1, column: 1 },
    end: { line: 1, column: 6 },
  },
  snippet: "const",
};

function widget(initial: unknown = undefined) {
  let state = initial;
  const writes: unknown[] = [];
  const api: WidgetStateApi = {
    read: () => state,
    write: (next) => {
      state = next;
      writes.push(next);
    },
  };
  return { api, writes, current: () => state };
}

describe("CommentStore", () => {
  it("keeps a copy of the source, so later changes to it cannot move the comment", () => {
    const store = new CommentStore();
    const selected = structuredClone(SELECTED);
    expect(store.add(selected, "  Why?  ")).toBeNull();
    if (selected.source.kind === "file") selected.source.path = "elsewhere.ts";
    expect(store.get().drafts[0]).toMatchObject({ comment: "Why?", source: { path: "src/a.ts" } });
  });

  it("refuses an empty selection or comment, and adds nothing", () => {
    const store = new CommentStore();
    expect(store.add({ ...SELECTED, snippet: "" }, "x")).toBe("Select some text first.");
    expect(store.add(SELECTED, "  ")).toBe("Write a comment first.");
    expect(store.get().drafts).toHaveLength(0);
  });

  it("edits and deletes", () => {
    const store = new CommentStore();
    store.add(SELECTED, "one");
    const id = store.get().drafts[0]?.id ?? "";
    expect(store.edit(id, "two")).toBeNull();
    expect(store.get().drafts[0]?.comment).toBe("two");
    expect(store.edit(id, "")).toBe("Write a comment first.");
    store.remove(id);
    expect(store.get().drafts).toEqual([]);
  });

  it("moves only the exact batch it took once added, and keeps what came after", () => {
    const store = new CommentStore();
    store.add(SELECTED, "first");
    const batch = store.begin();
    expect(batch?.map((draft) => draft.comment)).toEqual(["first"]);
    // Locked while it goes; a new one can still be written.
    const id = batch?.[0]?.id ?? "";
    expect(store.edit(id, "changed")).toContain("being added");
    expect(store.remove(id)).toContain("being added");
    expect(store.begin()).toBeNull();
    store.add(SELECTED, "second");

    store.end(batch ?? [], null);
    expect(store.get().drafts.map((draft) => draft.comment)).toEqual(["second"]);
    expect(store.get().publishing.size).toBe(0);
  });

  it("keeps every draft, and says why, when adding fails", () => {
    const store = new CommentStore();
    store.add(SELECTED, "first");
    const batch = store.begin() ?? [];
    store.end(batch, "ChatGPT is not connected to this panel.");
    expect(store.get()).toMatchObject({
      error: "ChatGPT is not connected to this panel.",
      drafts: [{ comment: "first" }],
    });
    expect(store.begin()).toHaveLength(1);
  });

  it("refuses a comment the waiting set has no room for, keeping the rest whole", () => {
    const store = new CommentStore();
    for (let i = 0; i < 25; i += 1) expect(store.add(SELECTED, `c${i}`)).toBeNull();
    expect(store.add(SELECTED, "one too many")).toContain("Copy or add the waiting comments first");
    expect(store.get().drafts).toHaveLength(25);
    expect(store.begin()).toHaveLength(25);
  });

  it("refuses an edit that makes the waiting set too long to send", () => {
    const store = new CommentStore();
    const big = "x".repeat(3_900);
    for (let i = 0; i < 9; i += 1) store.add({ ...SELECTED, snippet: big }, "short");
    const id = store.get().drafts[0]?.id ?? "";
    expect(store.edit(id, "y".repeat(3_999))).toContain("too long to send at once");
    expect(store.get().drafts[0]?.comment).toBe("short");
  });

  it("lets restored comments over the limit be trimmed by hand, not dropped", () => {
    const saved = new CommentStore();
    const drafts = Array.from({ length: 26 }, (_, i) => ({
      id: `r${i}`,
      source: SELECTED.source,
      snippet: "const",
      comment: `restored ${i}`,
      createdAt: i,
    }));
    const store = new CommentStore(
      widget({ privateContent: { exeoraComments: { v: 1, drafts } } }).api,
    );
    expect(store.get().drafts).toHaveLength(26);
    expect(store.begin()).toBeNull();
    expect(store.get().error).toContain("At most 25");
    store.remove("r0");
    expect(store.begin()).toHaveLength(25);
    expect(saved.get().drafts).toEqual([]);
  });

  it("keeps working, in memory, when the widget state refuses to be read", () => {
    const listener = vi.fn();
    const store = new CommentStore({
      read: () => {
        throw new Error("blocked");
      },
      write: () => {
        throw new Error("blocked");
      },
    });
    store.subscribe(listener);
    expect(store.add(SELECTED, "still here")).toBeNull();
    expect(store.get().drafts).toHaveLength(1);
    expect(store.get().persistent).toBe(false);
    expect(listener).toHaveBeenCalled();
  });

  it("restores only well-formed comments, once each", () => {
    const good = {
      id: "g1",
      source: SELECTED.source,
      snippet: "const",
      comment: "ok",
      createdAt: 1,
    };
    const store = new CommentStore(
      widget({
        privateContent: {
          exeoraComments: {
            v: 1,
            drafts: [
              good,
              good,
              { ...good, id: "bad1", source: { ...SELECTED.source, start: undefined } },
              { ...good, id: "bad2", source: { kind: "diff", projectId: "p1", path: "x" } },
              { ...good, id: "bad3", comment: "" },
              { ...good, id: "bad4", snippet: "x".repeat(5_000) },
            ],
          },
        },
      }).api,
    );
    expect(store.get().drafts.map((draft) => draft.id)).toEqual(["g1"]);
  });

  it("keeps drafts in the widget's private state only, beside whatever else is there", () => {
    const saved = widget({
      modelContent: { visible: "to the model" },
      privateContent: { other: 1 },
      unrelated: true,
    });
    const store = new CommentStore(saved.api);
    store.add(SELECTED, "secret draft");
    const state = saved.current() as Record<string, Record<string, unknown>>;
    expect(state.modelContent).toEqual({ visible: "to the model" });
    expect(state.unrelated).toBe(true);
    expect(state.privateContent?.other).toBe(1);
    expect(JSON.stringify(state.modelContent)).not.toContain("secret draft");
    expect(JSON.stringify(state.privateContent)).toContain("secret draft");

    // This widget's next render finds them again.
    const again = new CommentStore(saved.api);
    expect(again.get().drafts.map((draft) => draft.comment)).toEqual(["secret draft"]);
    expect(again.get().persistent).toBe(true);
  });

  it("ignores saved state it does not recognize", () => {
    const store = new CommentStore(
      widget({ privateContent: { exeoraComments: { v: 9, drafts: [1] } } }).api,
    );
    expect(store.get().drafts).toEqual([]);
    const plain = new CommentStore(null);
    expect(plain.get().persistent).toBe(false);
  });

  it("forgets every waiting comment on clear, private state included", () => {
    const saved = widget({ keep: true });
    const store = new CommentStore(saved.api);
    store.add(SELECTED, "account one");
    store.clear();
    expect(store.get().drafts).toEqual([]);
    expect(JSON.stringify(saved.current())).not.toContain("account one");
    expect((saved.current() as Record<string, unknown>).keep).toBe(true);
  });
});
