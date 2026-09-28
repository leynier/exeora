import { describe, expect, it } from "vitest";
import {
  COMMIT_FALLBACK,
  cleanupCommitMessage,
  cleanupPullRequest,
  cleanupSubject,
  cleanupText,
  PULL_REQUEST_FALLBACK,
} from "./cleanup.js";

describe("cleanupText", () => {
  it("removes fences, narration and surrounding whitespace", () => {
    expect(cleanupText("```text\nAdd login\n\n- why\n```\n")).toBe("Add login\n\n- why");
    expect(cleanupText("Generating a commit message...\nThinking\n\nAdd login")).toBe("Add login");
    expect(cleanupText("Here is the message:\n```\nAdd login\n```")).toBe("Add login");
    expect(cleanupText("  \r\nAdd login\r\n")).toBe("Add login");
  });

  it("leaves an answer that starts with a verb that only looks like narration", () => {
    expect(cleanupText("Generate reports nightly")).toBe("Generate reports nightly");
  });
});

describe("cleanupSubject", () => {
  it("cuts at a word under 72 characters and drops the trailing period", () => {
    const long =
      "Refactor the workspace resolver so that every location is looked up once per request.";
    const subject = cleanupSubject(long, COMMIT_FALLBACK);
    expect(subject.length).toBeLessThanOrEqual(72);
    expect(subject.endsWith(".")).toBe(false);
    expect(subject).toBe("Refactor the workspace resolver so that every location is looked up");
  });

  it("strips quotes and labels, and falls back when nothing is left", () => {
    expect(cleanupSubject('"Add login."', COMMIT_FALLBACK)).toBe("Add login");
    expect(cleanupSubject("Subject: Add login", COMMIT_FALLBACK)).toBe("Add login");
    expect(cleanupSubject("...", COMMIT_FALLBACK)).toBe(COMMIT_FALLBACK);
    expect(cleanupSubject("", COMMIT_FALLBACK)).toBe(COMMIT_FALLBACK);
  });

  it("cuts a single long word hard rather than emptying the subject", () => {
    expect(cleanupSubject("x".repeat(100), COMMIT_FALLBACK)).toHaveLength(72);
  });
});

describe("cleanupCommitMessage", () => {
  it("keeps the body under a blank line", () => {
    expect(cleanupCommitMessage("Add login.\nBecause users asked.\n")).toBe(
      "Add login\n\nBecause users asked.",
    );
    expect(cleanupCommitMessage("Add login\n\n\n- one\n- two")).toBe("Add login\n\n- one\n- two");
  });

  it("falls back for an empty answer", () => {
    expect(cleanupCommitMessage("```\n```")).toBe(COMMIT_FALLBACK);
  });
});

describe("cleanupPullRequest", () => {
  it("splits the title from the body and drops a markdown heading marker", () => {
    expect(cleanupPullRequest("# Add login.\n\nWhat changed and why.")).toEqual({
      title: "Add login",
      body: "What changed and why.",
    });
  });

  it("falls back for an empty answer", () => {
    expect(cleanupPullRequest("Thinking...")).toEqual({ title: PULL_REQUEST_FALLBACK, body: "" });
  });
});
