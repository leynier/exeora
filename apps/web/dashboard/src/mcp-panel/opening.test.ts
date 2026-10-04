import { describe, expect, it, vi } from "vitest";
import type { Invocation } from "./opening.js";
import {
  FILES_DESKTOP_ONLY,
  OPEN_PANEL_TOOL,
  RESOLVE_FILE_TOOL,
  resolveOpening,
} from "./opening.js";
import type { CallTool, ToolAnswer } from "./transport.js";

const FILE = { name: "app.ts", resourceUri: "host-resource://app" };
const SELECTED = { projectId: "p1", workspace: null, path: "src/app.ts" };

/** On a host that hands files over, unless a test says otherwise. */
function open(invocation: Omit<Invocation, "fileAccess">, call: CallTool, fileAccess = true) {
  return resolveOpening({ ...invocation, fileAccess }, call);
}

function caller(answer: ToolAnswer) {
  return vi.fn<CallTool>(async () => answer);
}

describe("resolveOpening", () => {
  it("uses the entrypoint's result without calling again", async () => {
    const call = caller({});
    const opening = await open({ input: {}, result: { structuredContent: SELECTED } }, call);
    expect(opening).toMatchObject({ kind: "ready", selection: { projectId: "p1" }, file: null });
    expect(call).not.toHaveBeenCalled();
  });

  it("resolves a file through a call the host amends with its path", async () => {
    const call = caller({ structuredContent: SELECTED });
    const opening = await open(
      { input: { file: FILE }, result: { structuredContent: { needsResolve: true } } },
      call,
    );
    expect(call).toHaveBeenCalledWith(RESOLVE_FILE_TOOL, { file: FILE });
    expect(opening).toMatchObject({ kind: "ready", file: FILE, selection: { path: "src/app.ts" } });
  });

  it("opens the panel itself when no result came, keeping the model's arguments", async () => {
    const call = caller({ structuredContent: SELECTED });
    await open(
      { input: { project: "p1", workspace: "w", path: "README.md", extra: 1 }, result: null },
      call,
    );
    expect(call).toHaveBeenCalledWith(OPEN_PANEL_TOOL, {
      project: "p1",
      workspace: "w",
      path: "README.md",
    });
  });

  it("reports a file outside every project with the file's name", async () => {
    const call = caller({ structuredContent: { error: "outside", message: "Not in a project." } });
    const opening = await open({ input: { file: FILE }, result: null }, call);
    expect(opening).toEqual({ kind: "failed", message: "Not in a project.", file: FILE });
  });

  it("reports a failed entrypoint call with its text", async () => {
    const opening = await open(
      { input: {}, result: { isError: true, content: [{ type: "text", text: "Offline." }] } },
      caller({}),
    );
    expect(opening).toEqual({ kind: "failed", message: "Offline.", file: null });
  });

  it("fails rather than loop when the resolve call asks for a resolve", async () => {
    const call = caller({ structuredContent: { needsResolve: true } });
    const opening = await open({ input: { file: FILE }, result: null }, call);
    expect(opening.kind).toBe("failed");
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("ignores a malformed file input", async () => {
    const call = caller({ structuredContent: SELECTED });
    await open({ input: { file: { name: "", resourceUri: "x" } }, result: null }, call);
    expect(call).toHaveBeenCalledWith(OPEN_PANEL_TOOL, {});
  });

  it("says files open on desktop when the host never hands one over", async () => {
    const call = caller({ isError: true, content: [{ type: "text", text: "No resource path." }] });
    const opening = await open({ input: { file: FILE }, result: null }, call, false);
    expect(opening).toEqual({ kind: "failed", message: FILES_DESKTOP_ONLY, file: FILE });
  });

  it("still tries, and opens, when the host did amend the call", async () => {
    const call = caller({ structuredContent: SELECTED });
    const opening = await open({ input: { file: FILE }, result: null }, call, false);
    expect(opening.kind).toBe("ready");
  });
});
