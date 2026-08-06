import {
  type CommandPolicy,
  DEFAULT_POLICY,
  LocalCommandPolicy,
  narrowPolicy,
} from "@exeora/protocol";
import { parse as parseToml } from "smol-toml";
import { describe, expect, it } from "vitest";
import { describePolicy, fromFlags, renderPolicyToml, splitList } from "./init.js";

/**
 * `exeora init`, minus the asking.
 *
 * The property that matters most is the round trip: whatever this writes, the
 * executor has to read back as the same policy. A generator whose output its
 * own parser rejects would fail at the next tool call rather than here.
 */

describe("splitList", () => {
  it("tolerates spaces and empty entries", () => {
    expect(splitList("npm, git * ,, cargo")).toEqual(["npm", "git *", "cargo"]);
    expect(splitList("  ")).toEqual([]);
  });
});

describe("fromFlags", () => {
  it("leaves out what the flags did not mention", () => {
    // Absent is not the same as strict. A file saying only `mode` must not also
    // silently switch the shell off, and that starts here.
    expect(fromFlags({ mode: "read_only" })).toEqual({ mode: "read_only" });
  });

  it("reads the list flags", () => {
    expect(fromFlags({ allow: "npm,git *", deny: "sudo" })).toEqual({
      allow: ["npm", "git *"],
      deny: ["sudo"],
    });
  });

  it("refuses a mode that is not one", () => {
    expect(() => fromFlags({ mode: "sometimes" })).toThrow();
  });

  it("refuses a tool that does not exist", () => {
    // Caught when the file is written rather than at the next tool call, which
    // is a much later and much more confusing place to learn about a typo.
    expect(() => fromFlags({ tools: "read_file,teleport" })).toThrow();
  });

  it("accepts every real tool name", () => {
    expect(fromFlags({ tools: "read_file,run_command" }).tools).toEqual([
      "read_file",
      "run_command",
    ]);
  });
});

describe("describePolicy", () => {
  it("shows what the account and the file come to together", () => {
    // The reason `init` prints this at all: the file is half the answer, and
    // someone who writes `allow_all` into it needs to see it did not widen
    // anything.
    const account: CommandPolicy = {
      ...DEFAULT_POLICY,
      mode: "allow_list",
      allow: ["npm", "git"],
    };
    const effective = narrowPolicy(account, fromFlags({ mode: "allow_all" }));

    expect(describePolicy(effective).join("\n")).toContain("allow_list");
  });

  it("names the allow list only when the mode consults one", () => {
    const listed = describePolicy({ ...DEFAULT_POLICY, mode: "allow_list", allow: ["npm"] });
    expect(listed.join("\n")).toContain("npm");

    // Under read_only the list decides nothing, so printing it would suggest
    // it does.
    expect(describePolicy({ ...DEFAULT_POLICY, mode: "read_only" }).join("\n")).not.toContain(
      "Allow",
    );
  });

  it("says every tool rather than leaving the line blank", () => {
    expect(describePolicy(DEFAULT_POLICY).join("\n")).toContain("all of them");
  });
});

describe("renderPolicyToml", () => {
  it("writes back what the executor reads", () => {
    const local = fromFlags({
      mode: "allow_list",
      allow: "npm,git *",
      deny: "sudo,rm *",
      tools: "read_file,run_command",
    });

    const parsed = LocalCommandPolicy.safeParse(parseToml(renderPolicyToml(local)));

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toEqual(local);
  });

  it("writes no key for a setting with no opinion", () => {
    const text = renderPolicyToml(fromFlags({ mode: "allow_all" }));

    expect(text).toContain('mode = "allow_all"');
    expect(text).not.toContain("shell");
    expect(text).not.toContain("allow =");
  });

  it("quotes entries, so a rule with a space survives the round trip", () => {
    const local = fromFlags({ mode: "allow_list", allow: "cargo build *" });
    const parsed = parseToml(renderPolicyToml(local)) as { allow: string[] };

    expect(parsed.allow).toEqual(["cargo build *"]);
  });

  it("explains itself, since the file is meant to be edited by hand", () => {
    expect(renderPolicyToml(fromFlags({ mode: "read_only" }))).toContain("only narrow");
  });
});
