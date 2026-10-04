import { ExeoraError } from "@exeora/protocol";
import { and, eq, inArray } from "drizzle-orm";
import { ownedTarget } from "./api/workspace-target.js";
import { accountProjects, resolveTarget } from "./client-targets.js";
import { db, schema } from "./db/client.js";
import { locationsOf } from "./locations.js";
import { relativeWorkspacePath, safeRelativePath } from "./plugin-paths.js";
import { readPluginSettings } from "./plugin-settings.js";
import type { Props } from "./props.js";

export class PluginAccess {
  constructor(
    readonly env: Env,
    readonly props: Props,
    readonly projectId?: string,
  ) {}

  async projects() {
    const { userId, clientId } = this.props;
    if (!userId || !clientId || this.props.deviceId)
      throw new ExeoraError("FORBIDDEN", "This connection cannot be identified.");
    if (!this.projectId) return accountProjects(this.env, { userId, clientId });
    const target = await resolveTarget(this.env, { userId, clientId, projectId: this.projectId });
    if (!target || target.clientRevokedAt)
      throw new ExeoraError("FORBIDDEN", "This project is not available on this connection.");
    const row = await db(this.env)
      .select()
      .from(schema.projects)
      .where(and(eq(schema.projects.id, this.projectId), eq(schema.projects.userId, userId)))
      .get();
    return row ? [row] : [];
  }

  async project(named?: string) {
    const projects = await this.projects();
    const selected = named
      ? projects.find((row) => row.id === named || row.slug === named)
      : projects.length === 1
        ? projects[0]
        : undefined;
    if (!selected)
      throw new ExeoraError("UNKNOWN_PROJECT", "Choose a project available on this connection.");
    return selected;
  }

  async selection(args: {
    project?: string | undefined;
    workspace?: string | undefined;
    path?: string | undefined;
  }) {
    const settings = await readPluginSettings(this.env, this.props, this.projectId);
    const named = args.project ?? (settings.defaultProject || undefined);
    const projects = await this.projects();
    const gatewayOrigin = new URL(this.env.EXEORA_BASE_URL).origin;
    if (!named && projects.length !== 1)
      return { projectId: null, workspace: null, settings, gatewayOrigin };
    const project = named
      ? projects.find((row) => row.id === named || row.slug === named)
      : projects[0];
    // A revoked or renamed default must not trap a new panel in a retry loop.
    if (!project) {
      if (args.project)
        throw new ExeoraError("UNKNOWN_PROJECT", "Choose a project available on this connection.");
      return { projectId: null, workspace: null, settings, gatewayOrigin };
    }
    let workspace =
      args.workspace ??
      ([project.id, project.slug].includes(settings.defaultProject)
        ? settings.defaultWorkspace || undefined
        : undefined) ??
      "main";
    if (
      workspace !== "main" &&
      !(await ownedTarget(this.env, this.props.userId, project.id, workspace))
    ) {
      if (args.workspace)
        throw new ExeoraError("UNKNOWN_WORKSPACE", "That workspace is not available.");
      workspace = "main";
    }
    if (args.path !== undefined && !safeRelativePath(args.path))
      throw new ExeoraError("INVALID_ARGUMENTS", "Use a path relative to the selected workspace.");
    return {
      projectId: project.id,
      workspace,
      ...(args.path ? { path: args.path } : {}),
      settings,
      gatewayOrigin,
    };
  }

  async resolveFile(
    absolute: string,
    filter: { project?: string | undefined; workspace?: string | undefined },
  ) {
    const reachable = filter.project ? [await this.project(filter.project)] : await this.projects();
    if (reachable.length === 0)
      throw new ExeoraError("FORBIDDEN", "No project is available on this connection.");
    const matches: { projectId: string; workspace: string; path: string; root: string }[] = [];
    // Bounded batches avoid D1's parameter limit for accounts with many projects.
    for (let offset = 0; offset < reachable.length; offset += 80) {
      const ids = reachable.slice(offset, offset + 80).map((row) => row.id);
      const projects = await db(this.env)
        .select()
        .from(schema.projects)
        .where(inArray(schema.projects.id, ids))
        .all();
      const locations = await locationsOf(this.env, this.props.userId, projects);
      const workspaces = await db(this.env)
        .select()
        .from(schema.workspaces)
        .where(inArray(schema.workspaces.projectId, ids))
        .all();
      const add = (projectId: string, workspace: string, root: string, alias?: string) => {
        if (filter.workspace && filter.workspace !== workspace && filter.workspace !== alias)
          return;
        const path = relativeWorkspacePath(root, absolute);
        if (path) matches.push({ projectId, workspace, path, root });
      };
      for (const project of projects) {
        const places = locations.get(project.id) ?? [];
        for (const location of places) {
          if (location.localPath && location.state !== "removed")
            add(
              project.id,
              location.default ? "main" : `main@${location.slug}`,
              location.localPath,
              `main@${location.slug}`,
            );
        }
        for (const ws of workspaces.filter((row) => row.projectId === project.id))
          add(project.id, ws.slug, ws.localPath, ws.id);
      }
    }
    // Prefer nested checkouts; equal paths on different machines require an explicit selection.
    const valid = [];
    for (const match of matches)
      if (await ownedTarget(this.env, this.props.userId, match.projectId, match.workspace))
        valid.push(match);
    valid.sort((a, b) => b.root.length - a.root.length);
    const first = valid[0];
    if (!first)
      throw new ExeoraError(
        "FORBIDDEN",
        "This file is outside the workspaces available on this connection. Open its workspace in Exeora first.",
      );
    if (valid[1]?.root.length === first.root.length)
      throw new ExeoraError(
        "INVALID_ARGUMENTS",
        "This path exists in several workspaces. Select its project and workspace first.",
      );
    return this.selection({
      project: first.projectId,
      workspace: first.workspace,
      path: first.path,
    });
  }
}
