import { describe, expect, it, vi } from "vitest";
import type { Draft } from "../../components/comments/model.js";
import {
  CHANGED_MEANWHILE,
  type ContentBlock,
  type ContextHost,
  ContextWriter,
} from "./contextWriter.js";

const DRAFT: Draft = {
  id: "d1",
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
  comment: "Why?",
  createdAt: 1,
};

type Write = { content: ContentBlock[]; structuredContent: Record<string, unknown> };

function host(options: { connected?: boolean; text?: boolean; ids?: boolean } = {}) {
  const writes: Write[] = [];
  let next = 0;
  let gate: Promise<void> | null = null;
  const fake: ContextHost & {
    fail?: string;
    /** Runs while a write is on its way, before its acknowledgement. */
    during?: (params: Write, updateId: string | null) => void;
  } = {
    connected: () => options.connected ?? true,
    supportsText: () => options.text ?? true,
    update: async (params) => {
      writes.push(structuredClone(params));
      if (gate) await gate;
      if (fake.fail) throw new Error(fake.fail);
      next += 1;
      const updateId = options.ids === false ? null : `u${next}`;
      const during = fake.during;
      fake.during = undefined;
      during?.(structuredClone(params), updateId);
      return updateId;
    },
  };
  return {
    fake,
    writes,
    hold: () => {
      let release: () => void = () => {};
      gate = new Promise((resolve) => {
        release = resolve;
      });
      return () => {
        gate = null;
        release();
      };
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("ContextWriter", () => {
  it("writes workspace metadata alone, contents-free and without drafts", async () => {
    const h = host();
    const writer = new ContextWriter(h.fake, 0);
    writer.setWorkspace({ projectId: "p1", path: "src/a.ts" });
    await settle();
    expect(h.writes).toEqual([
      {
        content: [],
        structuredContent: { "exeora/workspace": { projectId: "p1", path: "src/a.ts" } },
      },
    ]);
  });

  it("adds a titled batch, and keeps it through later navigation", async () => {
    const h = host();
    const writer = new ContextWriter(h.fake, 0);
    const batch = await writer.publish([DRAFT]);
    expect(h.writes[0]?.content).toEqual([
      {
        type: "text",
        text: expect.stringContaining("Comment: Why?"),
        _meta: {
          "openai/title": "Exeora Workspace: 1 comment on 1 file",
          "exeora/batch": batch.id,
        },
      },
    ]);
    writer.setWorkspace({ path: "elsewhere.ts" });
    await settle();
    expect(h.writes.at(-1)?.content).toHaveLength(1);
    expect(writer.batches()).toEqual([batch]);
  });

  it("appends a later batch beside the earlier one", async () => {
    const h = host();
    const writer = new ContextWriter(h.fake, 0);
    const first = await writer.publish([DRAFT]);
    const second = await writer.publish([{ ...DRAFT, id: "d2", comment: "Again" }]);
    expect(h.writes.at(-1)?.content.map((block) => block._meta?.["exeora/batch"])).toEqual([
      first.id,
      second.id,
    ]);
  });

  it.each([
    [{ connected: false }, "not connected"],
    [{ text: false }, "cannot attach context"],
  ])("refuses to publish on a host that cannot take it (%j)", async (options, message) => {
    const h = host(options);
    const writer = new ContextWriter(h.fake, 0);
    await expect(writer.publish([DRAFT])).rejects.toThrow(message);
    expect(h.writes).toEqual([]);
    expect(writer.batches()).toEqual([]);
  });

  it("does not count a batch the host refused, and can try again", async () => {
    const h = host();
    h.fake.fail = "Host said no";
    const writer = new ContextWriter(h.fake, 0);
    await expect(writer.publish([DRAFT])).rejects.toThrow("Host said no");
    expect(writer.batches()).toEqual([]);
    h.fake.fail = undefined;
    await writer.publish([DRAFT]);
    expect(writer.batches()).toHaveLength(1);
  });

  it("takes the host's word for what is attached: removed stays removed", async () => {
    const h = host();
    const writer = new ContextWriter(h.fake, 0);
    const first = await writer.publish([DRAFT]);
    const second = await writer.publish([{ ...DRAFT, id: "d2" }]);
    const kept = h.writes
      .at(-1)
      ?.content.filter((block) => block._meta?.["exeora/batch"] === second.id);
    writer.fromHost({ updateId: "host-1", content: kept });
    expect(writer.batches().map((batch) => batch.id)).toEqual([second.id]);
    writer.setWorkspace({ path: "x" });
    await settle();
    expect(h.writes.at(-1)?.content.map((block) => block._meta?.["exeora/batch"])).toEqual([
      second.id,
    ]);
    expect(JSON.stringify(h.writes.at(-1))).not.toContain(first.id);

    // Cleared altogether: navigation brings back the metadata, not the batches.
    writer.fromHost(null);
    writer.setWorkspace({ path: "y" });
    await settle();
    expect(h.writes.at(-1)).toEqual({
      content: [],
      structuredContent: { "exeora/workspace": { path: "y" } },
    });
  });

  it("starts from what the host says on initialize, batches of an earlier mount included", async () => {
    const h = host();
    const writer = new ContextWriter(h.fake, 0);
    const earlier = {
      type: "text",
      text: "earlier",
      _meta: { "openai/title": "Before", "exeora/batch": "b0" },
    };
    writer.fromHost({ updateId: "u0", content: [earlier] });
    expect(writer.batches()).toEqual([{ id: "b0", title: "Before", text: "earlier" }]);
    await writer.publish([DRAFT]);
    expect(h.writes.at(-1)?.content[0]).toEqual(earlier);
    expect(h.writes.at(-1)?.content).toHaveLength(2);
  });

  it("does not count a batch twice when the host echoes it before the acknowledgement", async () => {
    const h = host();
    const writer = new ContextWriter(h.fake, 0);
    h.fake.during = (params, updateId) => writer.fromHost({ updateId, content: params.content });
    const batch = await writer.publish([DRAFT]);
    await settle();
    expect(writer.batches()).toEqual([batch]);
    expect(h.writes).toHaveLength(1);
  });

  it("does not count a first batch the host cleared, unechoed, before a slow acknowledgement", async () => {
    const h = host({ ids: false });
    const writer = new ContextWriter(h.fake, 0);
    const release = h.hold();
    const going = writer.publish([DRAFT]);
    await settle();
    // The host takes the batch; the person clears the context; the late
    // acknowledgement comes with no echo before it.
    writer.fromHost(null);
    release();
    await expect(going).rejects.toThrow(CHANGED_MEANWHILE);
    await settle();
    expect(writer.batches()).toEqual([]);
    expect(h.writes.at(-1)?.content).toEqual([]);
  });

  it("does not count a new batch a snapshot left out, even with the older one kept", async () => {
    const h = host();
    const writer = new ContextWriter(h.fake, 0);
    const first = await writer.publish([DRAFT]);
    const kept = h.writes.at(-1)?.content ?? [];
    h.fake.during = () => writer.fromHost({ updateId: "host-1", content: kept });
    await expect(writer.publish([{ ...DRAFT, id: "d2", comment: "New" }])).rejects.toThrow(
      CHANGED_MEANWHILE,
    );
    await settle();
    expect(writer.batches().map((batch) => batch.id)).toEqual([first.id]);
    expect(h.writes.at(-1)?.content).toEqual(kept);
  });

  it("takes the host's latest snapshot over this write when an older batch went meanwhile", async () => {
    const h = host();
    const writer = new ContextWriter(h.fake, 0);
    const first = await writer.publish([DRAFT]);
    h.fake.during = () => writer.fromHost({ updateId: "host-removed", content: [] });
    await expect(writer.publish([{ ...DRAFT, id: "d2" }])).rejects.toThrow(CHANGED_MEANWHILE);
    await settle();
    expect(writer.batches()).toEqual([]);
    const last = h.writes.at(-1)?.content.map((block) => block._meta?.["exeora/batch"]);
    expect(last).toEqual([]);
    expect(last).not.toContain(first.id);
  });

  it("tells links to different resources apart, so a changed one is no echo", async () => {
    const h = host({ ids: false });
    const writer = new ContextWriter(h.fake, 0);
    const link = (uri: string) => ({ type: "resource_link", uri, name: "file" });
    writer.fromHost({ content: [link("file:///a")] });
    h.fake.during = () => writer.fromHost({ content: [link("file:///b")] });
    writer.setWorkspace({ path: "x" });
    await settle();
    await settle();
    // Not taken for an echo: the host's own latest snapshot is written back.
    expect(h.writes).toHaveLength(2);
    expect(h.writes.at(-1)?.content).toEqual([link("file:///b")]);
  });

  it("lets a removal after the echo stand, rather than an older acknowledgement", async () => {
    const h = host();
    const writer = new ContextWriter(h.fake, 0);
    h.fake.during = (params, updateId) => {
      writer.fromHost({ updateId, content: params.content });
      writer.fromHost(null);
    };
    await writer.publish([DRAFT]);
    await settle();
    expect(writer.batches()).toEqual([]);
    expect(h.writes).toHaveLength(1);
  });

  it("tells an echo from a change on a host that gives no update ids", async () => {
    const h = host({ ids: false });
    const writer = new ContextWriter(h.fake, 0);
    h.fake.during = (params) => writer.fromHost({ content: params.content });
    await writer.publish([DRAFT]);
    writer.setWorkspace({ path: "x" });
    await settle();
    expect(writer.batches()).toHaveLength(1);
    expect(h.writes).toHaveLength(2);
  });

  it("recognizes its batch when the host rewrites only _meta", async () => {
    const h = host();
    const writer = new ContextWriter(h.fake, 0);
    h.fake.during = (params) =>
      writer.fromHost({
        updateId: "rewritten",
        content: params.content.map((block) => ({ ...block, _meta: { other: true } })),
      });
    await writer.publish([DRAFT]);
    expect(h.writes).toHaveLength(1);
    expect(writer.batches()).toEqual([]);
  });

  it("writes back at most once for a host that rewrites what it is sent", async () => {
    const h = host();
    const writer = new ContextWriter(h.fake, 0);
    const rewrite = (params: Write) =>
      writer.fromHost({
        updateId: "other",
        content: params.content.map(({ text }) => ({ type: "text", text: `${text}!` })),
      });
    h.fake.during = rewrite;
    await expect(writer.publish([DRAFT])).rejects.toThrow(CHANGED_MEANWHILE);
    h.fake.during = rewrite;
    await settle();
    await settle();
    expect(h.writes.length).toBeLessThanOrEqual(2);
  });

  it("fails an add, keeping it unclaimed, when the host also refuses the write back", async () => {
    const h = host();
    const writer = new ContextWriter(h.fake, 0);
    h.fake.during = () => {
      writer.fromHost({ updateId: "host-1", content: [] });
      h.fake.fail = "Host refused";
    };
    await expect(writer.publish([DRAFT])).rejects.toThrow(CHANGED_MEANWHILE);
    expect(writer.batches()).toEqual([]);
  });

  it("writes one update at a time, in order", async () => {
    const h = host();
    const writer = new ContextWriter(h.fake, 0);
    const update = vi.spyOn(h.fake, "update");
    const release = h.hold();
    const one = writer.publish([DRAFT]);
    const two = writer.publish([{ ...DRAFT, id: "d2" }]);
    await settle();
    expect(update).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([one, two]);
    expect(h.writes.at(-1)?.content).toHaveLength(2);
  });
});
