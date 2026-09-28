/**
 * Everything said on a pull request, in the order it was said.
 *
 * GitHub keeps three lists: comments on the issue the pull request also
 * is, comments on lines of the diff, and reviews, each of which carries a
 * verdict and maybe a summary. The dashboard shows one thread, so the
 * three are merged here by date, with each item saying which it was.
 */

export interface Author {
  login: string;
  avatarUrl: string | null;
}

/** A comment on the pull request as a whole, as `api.ts` reads it. */
export interface IssueComment {
  id: number;
  author: Author;
  body: string;
  createdAt: string;
  updatedAt: string;
  url: string;
}

/** A comment on a line of the diff. */
export interface ReviewComment extends IssueComment {
  path: string;
  /** The line in the new file, or null for a comment on a deleted line or a file. */
  line: number | null;
  diffHunk: string | null;
}

export type ReviewState = "approved" | "changes_requested" | "commented" | "dismissed";

/** A review's verdict, with its summary when it had one. */
export interface Review {
  id: number;
  author: Author;
  body: string;
  state: ReviewState;
  /** When it was submitted; null for a review still being written. */
  submittedAt: string | null;
  url: string;
}

export type ConversationKind = "comment" | "review_comment" | "review";

export interface ConversationItem {
  /** Unique across kinds, whose ids GitHub numbers separately. */
  id: string;
  kind: ConversationKind;
  /** GitHub's own id, which is what an edit is addressed to. */
  githubId: number;
  author: Author;
  body: string;
  createdAt: string;
  updatedAt: string;
  url: string;
  path?: string;
  line?: number | null;
  diffHunk?: string | null;
  reviewState?: ReviewState;
  /** Whether the viewer wrote it, which is when the dashboard offers to edit it. */
  editable: boolean;
}

function editableBy(viewer: string | null, author: Author): boolean {
  return viewer !== null && viewer !== "" && author.login.toLowerCase() === viewer.toLowerCase();
}

/** A comment on the whole pull request as the thread shows it. */
export function commentItem(comment: IssueComment, viewer: string | null): ConversationItem {
  return {
    id: `comment:${comment.id}`,
    kind: "comment",
    githubId: comment.id,
    author: comment.author,
    body: comment.body,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
    url: comment.url,
    editable: editableBy(viewer, comment.author),
  };
}

/** A comment on a line as the thread shows it. */
export function reviewCommentItem(comment: ReviewComment, viewer: string | null): ConversationItem {
  return {
    ...commentItem(comment, viewer),
    id: `review_comment:${comment.id}`,
    kind: "review_comment",
    path: comment.path,
    line: comment.line,
    diffHunk: comment.diffHunk,
  };
}

function reviewItem(review: Review, submittedAt: string): ConversationItem {
  return {
    id: `review:${review.id}`,
    kind: "review",
    githubId: review.id,
    author: review.author,
    body: review.body,
    createdAt: submittedAt,
    updatedAt: submittedAt,
    url: review.url,
    reviewState: review.state,
    // A review is not edited from here: its verdict is what it is.
    editable: false,
  };
}

/**
 * Whether a review is worth a line of its own. GitHub wraps every batch of
 * line comments in a review that says nothing and decides nothing; those
 * would repeat each thread of comments as an empty entry.
 */
function shown(review: Review): review is Review & { submittedAt: string } {
  if (review.submittedAt === null) return false;
  return review.state !== "commented" || review.body.trim() !== "";
}

/**
 * The three lists as one, oldest first. Two things said in the same
 * instant keep the order they were listed in, comments before reviews.
 */
export function conversation(
  lists: { comments: IssueComment[]; reviewComments: ReviewComment[]; reviews: Review[] },
  viewer: string | null,
): ConversationItem[] {
  const items = [
    ...lists.comments.map((comment) => commentItem(comment, viewer)),
    ...lists.reviewComments.map((comment) => reviewCommentItem(comment, viewer)),
    ...lists.reviews.filter(shown).map((review) => reviewItem(review, review.submittedAt)),
  ];
  return items
    .map((item, index) => ({ item, index, at: Date.parse(item.createdAt) || 0 }))
    .sort((a, b) => a.at - b.at || a.index - b.index)
    .map(({ item }) => item);
}
