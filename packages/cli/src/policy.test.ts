import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CommandPolicy, DEFAULT_POLICY } from "@exeora/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { effectivePolicy, forgetPolicyCache, POLICY_FILENAME } from "./policy.js";

/**
 * Reading a project's `exeora.toml`.
 *
 * The rules it has to hold up are that the file can only narrow what the
 * account allows, that a broken file is reported rather than obeyed in either
 * direction, and that editing it takes effect on the next call rather than on
 * the next reconnect.
 */

let root: string;

const remote = (over: Partial<CommandPolicy> = {}): CommandPolicy => ({
  ...DEFAULT_POLICY,
  ...over,
});

const write = (contents: string) => writeFile(join(root, POLICY_FILENAME), contents);

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "exeora-policy-")));
  forgetPolicyCache();
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("with no file", () => {
  it("uses the account's policy unchanged", async () => {
    const account = remote({ mode: "allow_list", allow: ["npm"] });
    expect(await effectivePolicy(root, account)).toEqual({ policy: account });
  });

  it("falls back to allow_all when the gateway sent no policy either", async () => {
    // A gateway that predates the field. The CLI must not invent a restriction
    // nobody configured.
    expect(await effectivePolicy(root, undefined)).toEqual({ policy: DEFAULT_POLICY });
  });
});

describe("with a file", () => {
  it("narrows the account's list", async () => {
    await write('mode = "allow_list"\nallow = ["npm", "rm"]\n');

    const { policy } = await effectivePolicy(
      root,
      remote({ mode: "allow_list", allow: ["npm", "git"] }),
    );

    expect(policy).toEqual({
      mode: "allow_list",
      allow: ["npm"],
      deny: [],
      shell: false,
      approve: false,
      tools: null,
    });
  });

  it("cannot widen what the account allows", async () => {
    await write('mode = "allow_all"\nallow = ["anything"]\nshell = true\n');

    const account = remote({ mode: "allow_list", allow: ["npm"] });
    const { policy } = await effectivePolicy(root, account);

    // Whoever controls the machine may tie their own hands further. They may
    // not untie them.
    expect(policy).toEqual(account);
  });

  it("takes effect for a machine that only wants to read", async () => {
    await write('mode = "read_only"\n');

    const { policy } = await effectivePolicy(root, remote());

    expect(policy.mode).toBe("read_only");
  });

  it("applies even when the account has no policy of its own", async () => {
    await write('mode = "allow_list"\nallow = ["npm"]\n');

    const { policy } = await effectivePolicy(root, DEFAULT_POLICY);

    expect(policy).toEqual({
      mode: "allow_list",
      allow: ["npm"],
      deny: [],
      shell: false,
      approve: false,
      tools: null,
    });
  });

  it("says nothing about a key it does not set", async () => {
    await write('mode = "allow_list"\n');

    const { policy } = await effectivePolicy(
      root,
      remote({ mode: "allow_list", allow: ["npm"], shell: true }),
    );

    // The file asked to be in allow_list mode, which it already was. It did not
    // ask for the shell to be switched off as well.
    expect(policy.shell).toBe(true);
    expect(policy.allow).toEqual(["npm"]);
  });
});

describe("with a file that cannot be used", () => {
  const account = remote({ mode: "allow_list", allow: ["npm"] });

  it("reports invalid TOML and falls back to the account's policy", async () => {
    await write("mode = allow_list\n");

    const result = await effectivePolicy(root, account);

    expect(result.policy).toEqual(account);
    expect(result.problem).toContain("not valid TOML");
  });

  it("reports a setting it does not understand", async () => {
    await write('mode = "whatever"\n');

    const result = await effectivePolicy(root, account);

    expect(result.policy).toEqual(account);
    expect(result.problem).toContain("does not understand");
  });

  /**
   * The two wrong answers, for the record. Treating a typo as the strictest
   * possible policy stops a project dead; treating it as absent without saying
   * so removes a restriction someone believed they had.
   */
  it("neither locks the project down nor stays quiet about it", async () => {
    await write("this is not toml at all {{{\n");

    const result = await effectivePolicy(root, account);

    expect(result.policy.mode).not.toBe("read_only");
    expect(result.problem).toBeDefined();
  });
});

describe("caching", () => {
  it("picks up an edit without a reconnect", async () => {
    await write('mode = "allow_list"\nallow = ["npm", "git"]\n');
    const account = remote({ mode: "allow_list", allow: ["npm", "git"] });

    expect((await effectivePolicy(root, account)).policy.allow).toEqual(["npm", "git"]);

    // A different length as well as a different mtime, since a filesystem's
    // timestamp resolution is coarse enough to lose an edit made this fast.
    await write('mode = "allow_list"\nallow = ["npm"]\n');

    expect((await effectivePolicy(root, account)).policy.allow).toEqual(["npm"]);
  });

  it("notices the file being deleted", async () => {
    await write('mode = "read_only"\n');
    const account = remote({ mode: "allow_list", allow: ["npm"] });

    expect((await effectivePolicy(root, account)).policy.mode).toBe("read_only");

    await rm(join(root, POLICY_FILENAME));

    expect((await effectivePolicy(root, account)).policy).toEqual(account);
  });
});
