import { request } from "./api.js";
import type { ProjectLocation, State } from "./api-types.js";

/**
 * Projects where they live, and everything that runs them.
 *
 * A project is a repository. It lives in one or more locations, each of them
 * one of the person's machines or Exeora Cloud, and a workspace is a branch
 * with a working copy of its own in one of those. These are the calls that
 * place and remove them, the one list of machines both lenses read, and the
 * GitHub connection that saves pasting an address and a token.
 */

interface MachineBase {
  deviceId: string;
  name: string;
  platform: string;
  cliVersion: string | null;
  online: boolean;
  state: Exclude<State, "not cloned">;
  lastSeenAt: number | null;
  createdAt: number;
  revokedAt: number | null;
}

/** A copy of a project on one of the person's machines, as that machine lists it. */
export interface MachineProject {
  projectId: string;
  slug: string;
  name: string;
  localPath: string | null;
  status: ProjectLocation["status"];
  error: string | null;
  default: boolean;
  /** How many workspaces of the project are on this machine. */
  workspaces: number;
}

export interface LocalMachine extends MachineBase {
  kind: "local";
  projects: MachineProject[];
}

/** A machine Exeora Cloud runs: one workspace of one project, and nothing else. */
export interface CloudInstance extends MachineBase {
  kind: "cloud";
  project: { id: string; slug: string; name: string };
  /** A null `id` is the project root. */
  workspace: { id: string | null; slug: string; branch: string | null };
  status: "creating" | "ready" | "error" | "destroying";
  /** What it is doing right now, while it is being set up. */
  step: string | null;
  error: string | null;
  errorCode: string | null;
  errorDetail: string | null;
  readyAt: number | null;
  /** What the provider says, when it was asked. Null without `live`. */
  runtime: "cold" | "warm" | "running" | null;
}

export type Machine = LocalMachine | CloudInstance;

export interface GitHubInstallation {
  /** Exeora's own id for the connection, which is what disconnecting names. */
  id: string;
  /** GitHub's id for the installation. */
  installationId: number;
  accountLogin: string;
  accountType: string;
  repositorySelection: "all" | "selected";
  suspended: boolean;
  /** Where, on github.com, the repositories it reaches are chosen. */
  manageUrl: string;
}

export interface GitHubStatus {
  /** Whether this gateway has a GitHub app at all. */
  enabled: boolean;
  connected: boolean;
  installations: GitHubInstallation[];
  /** A complete address on github.com, good for a few minutes. */
  connectUrl: string | null;
  /** The connection was there and GitHub no longer honours it: it has to be made again. */
  reconnect?: boolean;
}

export interface GitHubRepository {
  id: number;
  fullName: string;
  owner: string;
  name: string;
  private: boolean;
  defaultBranch: string;
  url: string;
  description: string | null;
  pushedAt: number | null;
  installationId: number;
  /** The project that is already this repository, when the account has one. */
  projectId: string | null;
}

export interface CreateProjectInput {
  name: string;
  slug: string;
  repoUrl: string;
  /** Left out unless somebody insists: the gateway reads it from the repository. */
  defaultBranch?: string;
  token?: string;
  username?: string;
  /** Clients on the account URL that reach the project from the start. */
  clientIds?: string[];
  /** Set when the repository was picked from GitHub, which then needs no token. */
  github?: { repositoryId: number; installationId: number };
}

export interface CreateProjectResult {
  projectId: string;
  deviceId: string | null;
  status: "creating" | "ready";
  /** `joined` is a repository the account already had, put on Cloud as one more location. */
  location: "created" | "joined";
}

export interface CreateWorkspaceInput {
  branch: string;
  from?: string;
  reuseExistingBranch?: boolean;
  name?: string;
  slug?: string;
  /** A location by slug or id, or `cloud`. The default location when absent. */
  where?: string;
}

/**
 * The slug is always read from here and never from what was sent: the gateway
 * adds the location to it when the same branch already has a workspace in
 * another location of the project.
 */
export type CreateWorkspaceResult =
  | {
      status: "ready";
      where: string;
      workspace: {
        id: string;
        slug: string;
        name: string;
        branch: string | null;
        localPath: string;
      };
    }
  | { status: "creating"; where: string; workspaceId: string; deviceId: string; slug: string };

/** The slug a workspace ended up with, whichever of the two answers came back. */
export function createdSlug(result: CreateWorkspaceResult): string {
  return result.status === "ready" ? result.workspace.slug : result.slug;
}

export type AddLocationInput =
  | { deviceId: string }
  | { kind: "cloud"; token?: string; username?: string };

const json = (body: unknown): RequestInit => ({
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const projectsApi = {
  /**
   * `live` also asks the provider what each instance is doing, which costs a
   * request to somebody else's API: for the Machines page and nowhere else.
   */
  machines: (live = false) =>
    request<{ machines: Machine[] }>(`/api/machines${live ? "?live=1" : ""}`),

  /**
   * Puts a repository on Exeora Cloud as a project. Not the way onto one of
   * the person's machines: that is a command run there, because only the
   * machine knows its own paths.
   */
  createProject: (input: CreateProjectInput) =>
    request<CreateProjectResult>("/api/cloud/projects", { method: "POST", ...json(input) }),

  addLocation: (projectId: string, input: AddLocationInput) =>
    request<{ locations: ProjectLocation[] }>(`/api/projects/${projectId}/locations`, {
      method: "POST",
      ...json(input),
    }),

  setDefaultLocation: (projectId: string, locationId: string) =>
    request<{ locations: ProjectLocation[] }>(`/api/projects/${projectId}/default-location`, {
      method: "PUT",
      ...json({ locationId }),
    }),

  /** A machine is forgotten and its files left alone; on Cloud the instances are destroyed. */
  removeLocation: (projectId: string, locationId: string) =>
    request<{ ok: true }>(`/api/projects/${projectId}/locations/${locationId}`, {
      method: "DELETE",
    }),

  /**
   * Can take minutes: the first workspace on a machine that has no copy clones
   * the repository first, and the request stays open until that is done.
   */
  createWorkspace: (projectId: string, input: CreateWorkspaceInput) =>
    request<CreateWorkspaceResult>(`/api/projects/${projectId}/workspaces`, {
      method: "POST",
      ...json(input),
    }),

  /** Refused with `unforced` when there is work that would be lost; `force` goes ahead. */
  removeWorkspace: (projectId: string, workspaceId: string, force = false) =>
    request<{ ok: true; status: "removed" | "removing" }>(
      `/api/projects/${projectId}/workspaces/${workspaceId}/remove`,
      { method: "POST", ...json({ force }) },
    ),

  github: () => request<GitHubStatus>("/api/github"),

  githubRepositories: (query: string, limit = 50) => {
    const search = new URLSearchParams({ limit: String(limit) });
    if (query) search.set("q", query);
    return request<{ enabled: boolean; connected: boolean; repositories: GitHubRepository[] }>(
      `/api/github/repositories?${search}`,
    );
  },

  disconnectGitHub: (id: string) =>
    request<{ ok: true; manageUrl: string }>(
      `/api/github/installations/${encodeURIComponent(id)}`,
      {
        method: "DELETE",
      },
    ),
};
