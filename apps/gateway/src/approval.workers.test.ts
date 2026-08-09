import { describe, expect, it } from "vitest";
import { describeCall, hashArguments } from "./approval.js";

/**
 * The parts of the approval flow that decide whether a confirmation still
 * applies.
 *
 * The signature is the SDK's job, and its codec is well covered upstream. The
 * hash is ours, and it is what stops an approval for one call being spent on
 * another: a state naming only the tool would let a client have `ls` confirmed
 * and retry with `rm -rf ~` under the same permission.
 */

describe("hashing the arguments an approval was given for", () => {
  it("gives the same call the same hash", async () => {
    const args = { command: "npm test", cwd: "apps/gateway" };
    expect(await hashArguments(args)).toBe(await hashArguments({ ...args }));
  });

  it("does not care about key order", async () => {
    // The same call, serialised by two clients. Asking twice for it would be a
    // prompt people learn to dismiss.
    const a = await hashArguments({ command: "npm test", cwd: "src" });
    const b = await hashArguments({ cwd: "src", command: "npm test" });
    expect(a).toBe(b);
  });

  it("changes when the command changes at all", async () => {
    const approved = await hashArguments({ command: "ls" });

    expect(await hashArguments({ command: "rm -rf ~" })).not.toBe(approved);
    expect(await hashArguments({ command: "ls " })).not.toBe(approved);
    expect(await hashArguments({ command: "ls;" })).not.toBe(approved);
  });

  it("changes when an argument is added", async () => {
    const approved = await hashArguments({ command: "npm test" });
    expect(await hashArguments({ command: "npm test", cwd: "/etc" })).not.toBe(approved);
  });

  it("treats an absent key and an undefined one as the same call", async () => {
    // They serialise to the same wire message, so they must not need two
    // separate confirmations.
    expect(await hashArguments({ command: "ls", cwd: undefined })).toBe(
      await hashArguments({ command: "ls" }),
    );
  });

  it("does not confuse nesting for content", async () => {
    // `{a: {b: 1}}` and `{"a.b": 1}` would collide under a naive flattening.
    const nested = await hashArguments({ a: { b: 1 } });
    expect(await hashArguments({ "a.b": 1 })).not.toBe(nested);
  });

  it("handles a call with no arguments at all", async () => {
    expect(await hashArguments({})).toBe(await hashArguments({}));
    expect(await hashArguments(undefined)).not.toBe(await hashArguments({}));
  });
});

describe("what the prompt says", () => {
  it("quotes the command in full, so nobody approves a shape", () => {
    expect(describeCall("run_command", { command: "rm -rf build" })).toContain("rm -rf build");
  });

  it("says where a command will run when it is not the project root", () => {
    expect(describeCall("run_command", { command: "npm test", cwd: "apps/gateway" })).toContain(
      "apps/gateway",
    );
    expect(describeCall("run_command", { command: "npm test", cwd: "." })).not.toContain("in .");
  });

  it("names the file for the tools that change one", () => {
    expect(describeCall("write_file", { path: "src/main.ts" })).toBe("Write src/main.ts?");
    expect(describeCall("edit_file", { path: "src/main.ts" })).toBe("Edit src/main.ts?");
  });

  it("still says something when the arguments are not what it expected", () => {
    expect(describeCall("run_command", {})).toBe("Allow run_command?");
    expect(describeCall("write_file", null)).toBe("Allow write_file?");
  });
});
