import { GITHUB_API, GitHubError } from "../app.js";
import { type UserTokenEnv, userFetch } from "../user-token.js";
import type { CheckRun, CommitStatus } from "./checks.js";
import type { Author, IssueComment, Review, ReviewComment, ReviewState } from "./conversation.js";
import type { RepositoryName } from "./repo.js";

/**
 * GitHub's pull request API, as the person, reduced to what the screen
 * needs. Every answer is read into a shape of this file's own: nothing
 * GitHub sends is passed through, so the dashboard never sees a field this
 * file did not decide to show, and a change on GitHub's side breaks here
 * rather than there.
 */

export type PullRequestState = "open" | "draft" | "merged" | "closed";

export const MERGE_METHODS = ["merge", "squash", "rebase"] as const;
export type MergeMethod = (typeof MERGE_METHODS)[number];

export interface PullRequest {
  number: number;
  /** GitHub's global id, which the GraphQL mutations are addressed to. */
  nodeId: string;
  title: string;
  body: string;
  state: PullRequestState;
  author: Author;
  head: { ref: string; sha: string };
  base: { ref: string };
  url: string;
  /** Null while GitHub is still working it out. */
  mergeable: boolean | null;
  /** `clean`, `dirty`, `blocked`, `behind`, `unstable`, `draft` or `unknown`. */
  mergeableState: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
}

export interface RepositoryInfo extends RepositoryName {
  defaultBranch: string;
  mergeMethods: MergeMethod[];
  deleteBranchOnMerge: boolean;
  url: string;
}

export interface MergeOutcome {
  merged: boolean;
  sha: string | null;
  message: string;
}

export interface PullRequestApi {
  /** The number of the branch's pull request: the open one, else the newest of any state. */
  findPullRequestByHead(branch: string): Promise<number | null>;
  getPullRequest(number: number): Promise<PullRequest>;
  repositoryInfo(): Promise<RepositoryInfo>;
  createPullRequest(input: {
    title: string;
    body: string;
    head: string;
    base: string;
    draft: boolean;
  }): Promise<PullRequest>;
  updatePullRequest(
    number: number,
    changes: { title?: string; base?: string },
  ): Promise<PullRequest>;
  mergePullRequest(number: number, method: MergeMethod): Promise<MergeOutcome>;
  closePullRequest(number: number): Promise<PullRequest>;
  /** Through GraphQL: the REST API has no way to change the draft state. */
  setDraft(nodeId: string, draft: boolean): Promise<void>;
  listChecks(sha: string): Promise<{ runs: CheckRun[]; statuses: CommitStatus[] }>;
  listIssueComments(number: number): Promise<IssueComment[]>;
  listReviewComments(number: number): Promise<ReviewComment[]>;
  listReviews(number: number): Promise<Review[]>;
  createIssueComment(number: number, body: string): Promise<IssueComment>;
  updateIssueComment(commentId: number, body: string): Promise<IssueComment>;
  updateReviewComment(commentId: number, body: string): Promise<ReviewComment>;
}

type Raw = Record<string, unknown>;

const object = (value: unknown): Raw =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Raw) : {};
const list = (value: unknown): Raw[] => (Array.isArray(value) ? value.map(object) : []);
const text = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;
const maybeText = (value: unknown): string | null => (typeof value === "string" ? value : null);
const count = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

function author(raw: unknown): Author {
  const user = object(raw);
  return { login: text(user.login), avatarUrl: maybeText(user.avatar_url) };
}

function pullRequest(raw: Raw): PullRequest {
  const merged = raw.merged === true || typeof raw.merged_at === "string";
  const state: PullRequestState = merged
    ? "merged"
    : raw.state === "closed"
      ? "closed"
      : raw.draft === true
        ? "draft"
        : "open";
  const head = object(raw.head);
  return {
    number: count(raw.number),
    nodeId: text(raw.node_id),
    title: text(raw.title),
    body: text(raw.body),
    state,
    author: author(raw.user),
    head: { ref: text(head.ref), sha: text(head.sha) },
    base: { ref: text(object(raw.base).ref) },
    url: text(raw.html_url),
    mergeable: typeof raw.mergeable === "boolean" ? raw.mergeable : null,
    mergeableState: text(raw.mergeable_state, "unknown"),
    additions: count(raw.additions),
    deletions: count(raw.deletions),
    changedFiles: count(raw.changed_files),
    createdAt: text(raw.created_at),
    updatedAt: text(raw.updated_at),
    mergedAt: maybeText(raw.merged_at),
  };
}

function comment(raw: Raw): IssueComment {
  return {
    id: count(raw.id),
    author: author(raw.user),
    body: text(raw.body),
    createdAt: text(raw.created_at),
    updatedAt: text(raw.updated_at),
    url: text(raw.html_url),
  };
}

function reviewComment(raw: Raw): ReviewComment {
  const line = raw.line ?? raw.original_line;
  return {
    ...comment(raw),
    path: text(raw.path),
    line: typeof line === "number" ? line : null,
    diffHunk: maybeText(raw.diff_hunk),
  };
}

const REVIEW_STATES: Record<string, ReviewState> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes_requested",
  COMMENTED: "commented",
  DISMISSED: "dismissed",
};

function review(raw: Raw): Review {
  return {
    id: count(raw.id),
    author: author(raw.user),
    body: text(raw.body),
    state: REVIEW_STATES[text(raw.state)] ?? "commented",
    submittedAt: maybeText(raw.submitted_at),
    url: text(raw.html_url),
  };
}

function checkRun(raw: Raw): CheckRun {
  return {
    id: count(raw.id),
    name: text(raw.name),
    status: text(raw.status, "queued"),
    conclusion: maybeText(raw.conclusion),
    url: maybeText(raw.html_url) ?? maybeText(raw.details_url),
    app: maybeText(object(raw.app).name),
    startedAt: maybeText(raw.started_at),
    completedAt: maybeText(raw.completed_at),
    description: maybeText(object(raw.output).title),
  };
}

function commitStatus(raw: Raw): CommitStatus {
  return {
    id: count(raw.id),
    context: text(raw.context),
    state: text(raw.state, "pending"),
    url: maybeText(raw.target_url),
    description: maybeText(raw.description),
    createdAt: maybeText(raw.created_at),
    updatedAt: maybeText(raw.updated_at),
  };
}

/** In words about the cause, never the body: GitHub's message may echo what was sent. */
function refusal(status: number): string {
  switch (status) {
    case 403:
      return "GitHub refused that. The account may not have access to the repository, or the request limit was reached.";
    case 404:
      return "GitHub has no such pull request or repository for this account.";
    case 405:
      return "GitHub refused to merge: the pull request cannot be merged as it is.";
    case 409:
      return "GitHub refused: the branch changed since it was last looked at. Reload and try again.";
    case 422:
      return "GitHub could not do that: the branches may not differ, a pull request may already exist for the branch, or the base branch is unknown.";
    default:
      return "GitHub could not answer. Try again in a few minutes.";
  }
}

const DRAFT_MUTATIONS = {
  draft:
    "mutation($id: ID!) { convertPullRequestToDraft(input: {pullRequestId: $id}) { pullRequest { isDraft } } }",
  ready:
    "mutation($id: ID!) { markPullRequestReadyForReview(input: {pullRequestId: $id}) { pullRequest { isDraft } } }",
};

/** The API for one repository, as the person behind `userId`. */
export function pullRequestApi(
  env: UserTokenEnv,
  userId: string,
  name: RepositoryName,
  fetcher: typeof fetch,
): PullRequestApi {
  const repo = `/repos/${encodeURIComponent(name.owner)}/${encodeURIComponent(name.repo)}`;

  async function request(method: string, path: string, body?: unknown): Promise<unknown> {
    const response = await userFetch(env, userId, `${GITHUB_API}${path}`, fetcher, {
      method,
      ...(body === undefined
        ? {}
        : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
    });
    if (!response.ok) {
      await response.text().catch(() => "");
      throw new GitHubError(response.status, refusal(response.status));
    }
    if (response.status === 204) return null;
    return response.json();
  }

  const listPulls = async (query: string) =>
    list(await request("GET", `${repo}/pulls?${query}`)).map((raw) => count(raw.number));

  return {
    async findPullRequestByHead(branch) {
      const head = `head=${encodeURIComponent(`${name.owner}:${branch}`)}&per_page=1`;
      const open = await listPulls(`${head}&state=open`);
      if (open[0] !== undefined) return open[0];
      const any = await listPulls(`${head}&state=all&sort=updated&direction=desc`);
      return any[0] ?? null;
    },
    async getPullRequest(number) {
      return pullRequest(object(await request("GET", `${repo}/pulls/${number}`)));
    },
    async repositoryInfo() {
      const raw = object(await request("GET", repo));
      const allowed = (method: MergeMethod, flag: unknown) =>
        flag === false ? [] : ([method] as MergeMethod[]);
      return {
        ...name,
        defaultBranch: text(raw.default_branch, "main"),
        mergeMethods: [
          ...allowed("merge", raw.allow_merge_commit),
          ...allowed("squash", raw.allow_squash_merge),
          ...allowed("rebase", raw.allow_rebase_merge),
        ],
        deleteBranchOnMerge: raw.delete_branch_on_merge === true,
        url: text(raw.html_url, `https://github.com/${name.fullName}`),
      };
    },
    async createPullRequest(input) {
      return pullRequest(object(await request("POST", `${repo}/pulls`, input)));
    },
    async updatePullRequest(number, changes) {
      return pullRequest(object(await request("PATCH", `${repo}/pulls/${number}`, changes)));
    },
    async mergePullRequest(number, method) {
      const raw = object(
        await request("PUT", `${repo}/pulls/${number}/merge`, { merge_method: method }),
      );
      return { merged: raw.merged === true, sha: maybeText(raw.sha), message: text(raw.message) };
    },
    async closePullRequest(number) {
      return pullRequest(
        object(await request("PATCH", `${repo}/pulls/${number}`, { state: "closed" })),
      );
    },
    async setDraft(nodeId, draft) {
      const answer = object(
        await request("POST", "/graphql", {
          query: draft ? DRAFT_MUTATIONS.draft : DRAFT_MUTATIONS.ready,
          variables: { id: nodeId },
        }),
      );
      if (list(answer.errors).length > 0) {
        throw new GitHubError(
          502,
          "GitHub refused to change whether the pull request is a draft. The account may not be allowed to, or the pull request is closed.",
        );
      }
    },
    async listChecks(sha) {
      const ref = encodeURIComponent(sha);
      const [runs, combined] = await Promise.all([
        request("GET", `${repo}/commits/${ref}/check-runs?per_page=100`),
        request("GET", `${repo}/commits/${ref}/status?per_page=100`),
      ]);
      return {
        runs: list(object(runs).check_runs).map(checkRun),
        statuses: list(object(combined).statuses).map(commitStatus),
      };
    },
    async listIssueComments(number) {
      return list(await request("GET", `${repo}/issues/${number}/comments?per_page=100`)).map(
        comment,
      );
    },
    async listReviewComments(number) {
      return list(await request("GET", `${repo}/pulls/${number}/comments?per_page=100`)).map(
        reviewComment,
      );
    },
    async listReviews(number) {
      return list(await request("GET", `${repo}/pulls/${number}/reviews?per_page=100`)).map(review);
    },
    async createIssueComment(number, body) {
      return comment(object(await request("POST", `${repo}/issues/${number}/comments`, { body })));
    },
    async updateIssueComment(commentId, body) {
      return comment(
        object(await request("PATCH", `${repo}/issues/comments/${commentId}`, { body })),
      );
    },
    async updateReviewComment(commentId, body) {
      return reviewComment(
        object(await request("PATCH", `${repo}/pulls/comments/${commentId}`, { body })),
      );
    },
  };
}
