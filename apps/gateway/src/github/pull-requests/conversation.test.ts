import { describe, expect, it } from "vitest";
import {
  conversation,
  type IssueComment,
  type Review,
  type ReviewComment,
} from "./conversation.js";

const octocat = { login: "octocat", avatarUrl: "https://avatars.githubusercontent.com/u/1" };
const hubot = { login: "hubot", avatarUrl: null };

const comment = (over: Partial<IssueComment>): IssueComment => ({
  id: 1,
  author: octocat,
  body: "Looks good",
  createdAt: "2026-09-01T10:00:00Z",
  updatedAt: "2026-09-01T10:00:00Z",
  url: "https://github.com/octocat/api/pull/7#issuecomment-1",
  ...over,
});

const reviewComment = (over: Partial<ReviewComment>): ReviewComment => ({
  ...comment({ id: 2, url: "https://github.com/octocat/api/pull/7#discussion_r2" }),
  path: "src/index.ts",
  line: 12,
  diffHunk: "@@ -1,3 +1,4 @@",
  ...over,
});

const review = (over: Partial<Review>): Review => ({
  id: 3,
  author: hubot,
  body: "",
  state: "approved",
  submittedAt: "2026-09-01T11:00:00Z",
  url: "https://github.com/octocat/api/pull/7#pullrequestreview-3",
  ...over,
});

describe("one thread out of three lists", () => {
  it("orders everything by when it was said, and says what each thing is", () => {
    const items = conversation(
      {
        comments: [comment({ id: 1, createdAt: "2026-09-01T12:00:00Z" })],
        reviewComments: [
          reviewComment({ id: 2, createdAt: "2026-09-01T10:30:00Z", author: hubot }),
        ],
        reviews: [review({ id: 3, submittedAt: "2026-09-01T11:00:00Z", body: "Ship it" })],
      },
      "octocat",
    );
    expect(items.map((item) => [item.id, item.kind, item.editable])).toEqual([
      ["review_comment:2", "review_comment", false],
      ["review:3", "review", false],
      ["comment:1", "comment", true],
    ]);
    expect(items[0]).toMatchObject({
      githubId: 2,
      path: "src/index.ts",
      line: 12,
      diffHunk: "@@ -1,3 +1,4 @@",
      author: hubot,
    });
    expect(items[1]).toMatchObject({
      githubId: 3,
      reviewState: "approved",
      body: "Ship it",
      createdAt: "2026-09-01T11:00:00Z",
      updatedAt: "2026-09-01T11:00:00Z",
    });
    expect(items[1]).not.toHaveProperty("path");
  });

  it("drops the empty review GitHub wraps every batch of line comments in", () => {
    const items = conversation(
      {
        comments: [],
        reviewComments: [reviewComment({ id: 2 })],
        reviews: [
          review({ id: 3, state: "commented", body: "" }),
          review({ id: 4, state: "commented", body: "One thought", author: octocat }),
          review({ id: 5, state: "changes_requested", body: "" }),
          review({ id: 6, state: "approved", submittedAt: null }),
        ],
      },
      null,
    );
    expect(items.map((item) => item.id)).toEqual(["review_comment:2", "review:4", "review:5"]);
    expect(items[2]).toMatchObject({ reviewState: "changes_requested", body: "" });
  });

  it("offers to edit only what the viewer wrote, whatever the case of the login", () => {
    const items = conversation(
      {
        comments: [comment({ id: 1, author: { login: "OctoCat", avatarUrl: null } })],
        reviewComments: [reviewComment({ id: 2, author: hubot })],
        reviews: [review({ id: 3, author: octocat, body: "Mine" })],
      },
      "octocat",
    );
    expect(items.map((item) => [item.id, item.editable])).toEqual([
      ["comment:1", true],
      ["review_comment:2", false],
      ["review:3", false],
    ]);
    expect(
      conversation({ comments: [comment({})], reviewComments: [], reviews: [] }, null)[0],
    ).toMatchObject({ editable: false });
  });

  it("keeps the listed order for things said in the same instant", () => {
    const at = "2026-09-01T10:00:00Z";
    const items = conversation(
      {
        comments: [comment({ id: 1, createdAt: at }), comment({ id: 2, createdAt: at })],
        reviewComments: [reviewComment({ id: 3, createdAt: at })],
        reviews: [review({ id: 4, submittedAt: at })],
      },
      null,
    );
    expect(items.map((item) => item.id)).toEqual([
      "comment:1",
      "comment:2",
      "review_comment:3",
      "review:4",
    ]);
  });
});
