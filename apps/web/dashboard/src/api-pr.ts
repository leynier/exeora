import { request } from "./api.js";

/** Pull requests, restated from the gateway's `src/github/pull-requests/` routes. */

export type PullRequestState = "open" | "draft" | "merged" | "closed";
export type MergeMethod = "merge" | "squash" | "rebase";

export interface PullRequestAuthor {
  login: string;
  avatarUrl: string | null;
}

export interface PullRequest {
  number: number;
  nodeId: string;
  title: string;
  body: string;
  state: PullRequestState;
  author: PullRequestAuthor;
  head: { ref: string; sha: string };
  base: { ref: string };
  url: string;
  mergeable: boolean | null;
  mergeableState: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
}

export interface PullRequestRepository {
  owner: string;
  repo: string;
  fullName: string;
  defaultBranch: string;
  mergeMethods: MergeMethod[];
  deleteBranchOnMerge: boolean;
  url: string;
}

export interface PullRequestLookup {
  repository: PullRequestRepository | null;
  pullRequest: PullRequest | null;
  /** Permissions the app asks for that this installation has not granted yet. */
  pending: string[];
  reason?: "not_github";
}

export type CheckState = "failing" | "in_progress" | "successful" | "neutral";

export interface Check {
  id: string;
  name: string;
  state: CheckState;
  url: string | null;
  app: string | null;
  startedAt: string | null;
  completedAt: string | null;
  description: string | null;
}

export interface PullRequestChecks {
  sha: string;
  failing: Check[];
  inProgress: Check[];
  successful: Check[];
}

export type ConversationKind = "comment" | "review_comment" | "review";
export type ReviewState = "approved" | "changes_requested" | "commented" | "dismissed";

export interface ConversationItem {
  id: string;
  kind: ConversationKind;
  githubId: number;
  author: PullRequestAuthor;
  body: string;
  createdAt: string;
  updatedAt: string;
  url: string;
  path?: string;
  line?: number | null;
  diffHunk?: string | null;
  reviewState?: ReviewState;
  editable: boolean;
}

export interface PullRequestConversation {
  items: ConversationItem[];
  viewer: string;
}

export interface CreatePullRequestInput {
  title: string;
  body?: string;
  base: string;
  head: string;
  draft?: boolean;
  push?: boolean;
}

const json = (body: unknown, method: string): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

function target(workspace: string | undefined, extra: Record<string, string> = {}): string {
  const query = new URLSearchParams(extra);
  if (workspace) query.set("workspace", workspace);
  const text = query.toString();
  return text ? `?${text}` : "";
}

export const prApi = {
  lookup: (projectId: string, workspace: string | undefined, branch: string | null) =>
    request<PullRequestLookup>(
      `/api/projects/${projectId}/pull-request${target(workspace, branch ? { branch } : {})}`,
    ),
  checks: (projectId: string, number: number) =>
    request<PullRequestChecks>(`/api/projects/${projectId}/pull-request/${number}/checks`),
  conversation: (projectId: string, number: number) =>
    request<PullRequestConversation>(
      `/api/projects/${projectId}/pull-request/${number}/conversation`,
    ),
  create: (projectId: string, workspace: string | undefined, input: CreatePullRequestInput) =>
    request<{ pullRequest: PullRequest }>(
      `/api/projects/${projectId}/pull-request${target(workspace)}`,
      json(input, "POST"),
    ),
  update: (
    projectId: string,
    number: number,
    patch: { title?: string; base?: string; draft?: boolean },
  ) =>
    request<{ pullRequest: PullRequest }>(
      `/api/projects/${projectId}/pull-request/${number}`,
      json(patch, "PATCH"),
    ),
  merge: (projectId: string, number: number, method: MergeMethod) =>
    request<{ merged: boolean; sha: string | null; message: string }>(
      `/api/projects/${projectId}/pull-request/${number}/merge`,
      json({ method }, "POST"),
    ),
  close: (projectId: string, number: number) =>
    request<{ pullRequest: PullRequest }>(
      `/api/projects/${projectId}/pull-request/${number}/close`,
      json({}, "POST"),
    ),
  comment: (projectId: string, number: number, body: string) =>
    request<{ item: ConversationItem }>(
      `/api/projects/${projectId}/pull-request/${number}/comments`,
      json({ body }, "POST"),
    ),
  editComment: (
    projectId: string,
    number: number,
    commentId: number,
    body: string,
    kind: "comment" | "review_comment",
  ) =>
    request<{ item: ConversationItem }>(
      `/api/projects/${projectId}/pull-request/${number}/comments/${commentId}`,
      json({ body, kind }, "PATCH"),
    ),
};

export const prKeys = {
  lookup: (projectId: string, target: string, branch: string | null) =>
    ["pull-request", projectId, target, branch] as const,
  checks: (projectId: string, number: number) =>
    ["pull-request", projectId, "checks", number] as const,
  conversation: (projectId: string, number: number) =>
    ["pull-request", projectId, "conversation", number] as const,
};
