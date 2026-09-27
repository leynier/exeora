import { describe, expect, it } from "vitest";
import { explainFailure } from "./machine-errors.js";

describe("explaining why a machine could not be made", () => {
  it("names the token when the repository refused the credentials", () => {
    const failure = explainFailure(
      "The CLI never connected. Cloning into '/home/sprite/workspace'...\n" +
        "remote: Invalid username or token.\n" +
        "fatal: Authentication failed for 'https://github.com/acme/private.git/'",
    );

    expect(failure.code).toBe("clone_auth_failed");
    expect(failure.message).toContain("token");
    expect(failure.detail).toContain("Authentication failed");
  });

  it("reads a prompt git could not show as missing credentials", () => {
    expect(
      explainFailure(
        "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
      ).code,
    ).toBe("clone_auth_failed");
  });

  it("says a repository was not found, and that a private one looks the same", () => {
    const failure = explainFailure(
      "The machine could not be set up: remote: Repository not found.\n" +
        "fatal: repository 'https://github.com/acme/nope.git/' not found",
    );

    expect(failure.code).toBe("repo_not_found");
    expect(failure.message).toContain("private");
  });

  it("keeps the script's own verdict about a branch as the message", () => {
    const failure = explainFailure("The branch main does not exist in the repository.");

    expect(failure).toEqual({
      code: "branch_not_found",
      message: "The branch main does not exist in the repository.",
      detail: null,
    });
  });

  it("does not mention the provider when the machine itself could not start", () => {
    const failure = explainFailure("Could not create the sprite: the Sprites API answered 503.");

    expect(failure.code).toBe("machine_unavailable");
    expect(failure.message).not.toMatch(/sprite/i);
    expect(failure.detail).toMatch(/Sprites API/);
  });

  it("does not take a file permission for a refused credential", () => {
    expect(explainFailure("install: cannot create /usr/local/sbin: Permission denied").code).toBe(
      "setup_failed",
    );
  });

  it("falls back to a failure with the raw text as its detail", () => {
    expect(explainFailure("something nobody expected")).toEqual({
      code: "setup_failed",
      message: expect.stringContaining("could not be set up"),
      detail: "something nobody expected",
    });
  });
});
