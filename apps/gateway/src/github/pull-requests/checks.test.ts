import { describe, expect, it } from "vitest";
import {
  type CheckRun,
  type CommitStatus,
  checkRunState,
  groupChecks,
  statusState,
} from "./checks.js";

const run = (over: Partial<CheckRun>): CheckRun => ({
  id: 1,
  name: "build",
  status: "completed",
  conclusion: "success",
  url: "https://github.com/octocat/api/runs/1",
  app: "GitHub Actions",
  startedAt: "2026-09-01T10:00:00Z",
  completedAt: "2026-09-01T10:05:00Z",
  description: null,
  ...over,
});

const status = (over: Partial<CommitStatus>): CommitStatus => ({
  id: 9,
  context: "ci/circle",
  state: "success",
  url: "https://circleci.com/1",
  description: "Your tests passed",
  createdAt: "2026-09-01T10:00:00Z",
  updatedAt: "2026-09-01T10:01:00Z",
  ...over,
});

describe("the state of one check", () => {
  it("reads a check run's conclusion, and its status while it has none", () => {
    expect(checkRunState({ status: "queued", conclusion: null })).toBe("in_progress");
    expect(checkRunState({ status: "in_progress", conclusion: null })).toBe("in_progress");
    expect(checkRunState({ status: "completed", conclusion: "success" })).toBe("successful");
    for (const conclusion of ["neutral", "skipped"]) {
      expect(checkRunState({ status: "completed", conclusion })).toBe("neutral");
    }
    for (const conclusion of ["failure", "cancelled", "timed_out", "action_required"]) {
      expect(checkRunState({ status: "completed", conclusion })).toBe("failing");
    }
    // Something newer than this file is shown, not hidden among the passes.
    expect(checkRunState({ status: "completed", conclusion: "unheard_of" })).toBe("failing");
  });

  it("reads a commit status", () => {
    expect(statusState({ state: "success" })).toBe("successful");
    expect(statusState({ state: "pending" })).toBe("in_progress");
    expect(statusState({ state: "failure" })).toBe("failing");
    expect(statusState({ state: "error" })).toBe("failing");
  });
});

describe("grouping", () => {
  it("puts runs and statuses in three groups, each sorted by name", () => {
    const grouped = groupChecks(
      [
        run({ id: 1, name: "test", conclusion: "failure" }),
        run({ id: 2, name: "build" }),
        run({ id: 3, name: "lint", status: "in_progress", conclusion: null, completedAt: null }),
        run({ id: 4, name: "docs", conclusion: "skipped" }),
        run({ id: 5, name: "audit", conclusion: "cancelled" }),
      ],
      [
        status({ id: 9, context: "ci/circle" }),
        status({ id: 10, context: "deploy/preview", state: "pending", url: null }),
      ],
    );
    expect(grouped.failing.map((check) => [check.id, check.name, check.state])).toEqual([
      ["run:5", "audit", "failing"],
      ["run:1", "test", "failing"],
    ]);
    expect(grouped.inProgress.map((check) => [check.id, check.name])).toEqual([
      ["status:10", "deploy/preview"],
      ["run:3", "lint"],
    ]);
    expect(grouped.successful.map((check) => [check.id, check.state])).toEqual([
      ["run:2", "successful"],
      ["status:9", "successful"],
      ["run:4", "neutral"],
    ]);
  });

  it("keeps what the screen links to and shows", () => {
    const { successful, inProgress } = groupChecks(
      [run({ id: 2, name: "build", description: "All 12 jobs passed" })],
      [status({ id: 10, context: "deploy", state: "pending" })],
    );
    expect(successful[0]).toEqual({
      id: "run:2",
      name: "build",
      state: "successful",
      url: "https://github.com/octocat/api/runs/1",
      app: "GitHub Actions",
      startedAt: "2026-09-01T10:00:00Z",
      completedAt: "2026-09-01T10:05:00Z",
      description: "All 12 jobs passed",
    });
    // A status still pending has not completed, whatever its last update was.
    expect(inProgress[0]).toMatchObject({
      app: null,
      completedAt: null,
      description: "Your tests passed",
    });
  });

  it("is empty for a commit nothing ran against", () => {
    expect(groupChecks([], [])).toEqual({ failing: [], inProgress: [], successful: [] });
  });
});
