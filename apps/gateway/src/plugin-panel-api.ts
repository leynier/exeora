import {
  policyAllows,
  TOOL_DEFINITIONS,
  TOOL_NAMES,
  type ToolName,
  WorkspaceAction,
  WorkspaceReadAction,
} from "@exeora/protocol";
import { Hono } from "hono";
import { devices } from "./api/devices.js";
import { me } from "./api/me.js";
import { projects } from "./api/projects.js";
import type { ApiEnv } from "./api/router.js";
import { workspace } from "./api/workspace.js";
import { workspaceReads } from "./api/workspace-reads.js";
import { ownedTarget } from "./api/workspace-target.js";
import { workspaces } from "./api/workspaces.js";
import { resolveAccountTarget, resolveTarget } from "./client-targets.js";
import type { CloudMachineView, MachineView } from "./machines-view.js";
import type { PluginAccess } from "./plugin-access.js";
import { allowedPanelRoute, trustedPanelOrigin } from "./plugin-panel-routes.js";

/** Only Workspace routers; no account management, credentials, billing or AI inference. */
const panelApi = new Hono<ApiEnv>();
panelApi.use("*", async (c, next) => {
  c.set("userId", (c.executionCtx as unknown as { props: { userId: string } }).props.userId);
  await next();
});
for (const router of [me, projects, devices, workspaces, workspace, workspaceReads])
  panelApi.route("/", router);

export async function panelRequest(
  access: PluginAccess,
  args: {
    path: string;
    method: string;
    body?: Record<string, unknown> | undefined;
    origin?: string | undefined;
  },
  signal?: AbortSignal,
) {
  const fail = (message: string) => ({ status: 403, body: { error: "forbidden", message } });
  if (!args.path.startsWith("/api/") || args.path.includes("\\") || args.path.includes("#"))
    return fail("This route is not available in the Exeora panel.");
  const url = new URL(args.path, access.env.EXEORA_BASE_URL);
  if (
    url.pathname.includes("%") ||
    `${url.pathname}${url.search}` !== args.path ||
    !allowedPanelRoute(url.pathname, args.method)
  )
    return fail("Open the Exeora dashboard to use this account feature.");
  if (url.pathname === "/api/machines" && url.searchParams.has("live"))
    return fail("Use the Exeora dashboard to refresh cloud machine details.");
  const reachable = await access.projects();
  const ids = new Set(reachable.map((project) => project.id));
  const match = /^\/api\/projects\/([^/]+)\//.exec(url.pathname);
  const named = match?.[1];
  const target = named ? await access.project(named) : undefined;
  let unrestricted = false;
  if (target) {
    const grant = access.projectId
      ? await resolveTarget(access.env, {
          userId: access.props.userId,
          projectId: target.id,
          clientId: access.props.clientId,
        })
      : await resolveAccountTarget(access.env, {
          userId: access.props.userId,
          projectId: target.id,
          clientId: access.props.clientId ?? "",
        });
    if (!grant || ("clientRevokedAt" in grant && grant.clientRevokedAt))
      return fail("This project is not available on this connection.");
    const policy = grant.policy;
    unrestricted =
      policy.mode === "allow_all" &&
      !policy.approve &&
      policy.deny.length === 0 &&
      policy.tools === null;
    if (
      !url.pathname.endsWith("/workspaces") &&
      !(await ownedTarget(
        access.env,
        access.props.userId,
        target.id,
        url.searchParams.get("workspace") ?? undefined,
      ))
    )
      return { status: 404, body: { error: "not_found" } };
    // The app transport must not restore file readers excluded from the MCP connection.
    let reader: ToolName | undefined;
    if (url.pathname.endsWith("/workspace/reads")) {
      const action = WorkspaceReadAction.safeParse(args.body);
      if (!action.success) return { status: 400, body: { error: "invalid_arguments" } };
      reader =
        action.data.action === "tree"
          ? "list_files"
          : action.data.action === "search"
            ? "grep"
            : "read_file";
    } else if (url.pathname.endsWith("/workspace/diff")) reader = "read_file";
    else if (url.pathname.endsWith("/workspace/status")) reader = "list_files";
    if (reader) {
      const verdict = policyAllows(policy, reader, args.body);
      if (!verdict.allowed)
        return fail(verdict.reason ?? "This read is not permitted by the project policy.");
    }
    // Logs include paths and search patterns from all readers, even when the host
    // ignores the app-only tool metadata. Check every reader before issuing a ticket.
    if (url.pathname.endsWith("/logs-ticket")) {
      for (const tool of ["list_files", "read_file", "grep"] as const) {
        const verdict = policyAllows(policy, tool, undefined);
        if (!verdict.allowed)
          return fail(verdict.reason ?? "Logs are not permitted by the project policy.");
      }
    }
    // Capability discovery wakes the machine. A connection with no permitted
    // workspace tools must be refused before reaching the dashboard router.
    if (
      url.pathname.endsWith("/workspace/capabilities") &&
      !(policy.tools ?? TOOL_NAMES).some(
        (tool) => policy.mode !== "read_only" || TOOL_DEFINITIONS[tool].readOnly,
      )
    )
      return fail("This connection does not permit any workspace tool.");
    if (url.pathname.endsWith("/workspace/actions")) {
      const action = WorkspaceAction.safeParse(args.body);
      if (!action.success) return { status: 400, body: { error: "invalid_arguments" } };
      // Unknown mutations require unrestricted access. Known file writes retain the tool allowlist.
      if (!unrestricted) {
        if (policy.approve)
          return fail(
            "This project requires confirmation. Complete this change in the Exeora dashboard.",
          );
        if (action.data.action !== "file_write")
          return fail("The project policy restricts this change. Open the Exeora dashboard.");
        const verdict = policyAllows(policy, "write_file", {
          path: action.data.path,
          content: action.data.content,
        });
        if (!verdict.allowed)
          return fail(verdict.reason ?? "This change is not permitted by the project policy.");
      }
      if (action.data.action.startsWith("chatgpt_") || action.data.action === "project_prepare")
        return fail("Use the dedicated Exeora dashboard feature for this action.");
    }
    if (
      url.pathname.endsWith("/terminal-ticket") ||
      (args.method === "DELETE" && url.pathname.endsWith("/terminal"))
    ) {
      if (!unrestricted)
        return fail(
          "Interactive terminals require an unrestricted project policy. Open the Exeora dashboard.",
        );
    }
    url.pathname = url.pathname.replace(`/projects/${named}/`, `/projects/${target.id}/`);
  }
  const origin = trustedPanelOrigin(args.origin);
  if (
    (url.pathname.endsWith("/terminal-ticket") || url.pathname.endsWith("/logs-ticket")) &&
    !origin
  )
    return fail("The host did not provide a supported panel origin for the live connection.");
  // This context is local to the allowlisted router call. No dashboard scope or bearer is minted.
  const ctx = {
    props: access.props,
    _exeoraPanelOrigin: origin,
    waitUntil: (_promise: Promise<unknown>) => {},
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
  const request = new Request(url, {
    method: args.method,
    ...(signal ? { signal } : {}),
    ...(args.body
      ? { body: JSON.stringify(args.body), headers: { "Content-Type": "application/json" } }
      : {}),
  });
  const response = await panelApi.fetch(request, access.env, ctx);
  let body: unknown = response.status === 204 ? null : await response.json().catch(() => null);
  if (response.ok && Array.isArray(body)) {
    if (url.pathname === "/api/projects") body = body.filter((project) => ids.has(project.id));
  }
  if (
    response.ok &&
    url.pathname === "/api/machines" &&
    body &&
    typeof body === "object" &&
    "machines" in body
  ) {
    body = {
      machines: (body as { machines: MachineView[] }).machines.flatMap<MachineView>((machine) => {
        if (machine.kind === "cloud")
          return ids.has(machine.project.id)
            ? [
                {
                  ...machine,
                  errorDetail: null,
                  hooks: {
                    ...machine.hooks,
                    install: withoutHookOutput(machine.hooks.install),
                    resume: withoutHookOutput(machine.hooks.resume),
                  },
                },
              ]
            : [];
        const projects = machine.projects.filter((project) => ids.has(project.projectId));
        return projects.length > 0 ? [{ ...machine, projects }] : [];
      }),
    };
  }
  if (
    response.ok &&
    url.pathname === "/api/terminals" &&
    body &&
    typeof body === "object" &&
    "items" in body
  ) {
    body = {
      items: (body as { items: { projectId: string }[] }).items.filter((terminal) =>
        ids.has(terminal.projectId),
      ),
    };
  }
  if (
    response.ok &&
    url.pathname.endsWith("/workspace/capabilities") &&
    body &&
    typeof body === "object"
  )
    body = { ...body, terminal: unrestricted && "terminal" in body && body.terminal };
  return { status: response.status, body };
}

function withoutHookOutput(run: CloudMachineView["hooks"]["install"]) {
  if (!run) return null;
  const { output: _output, ...metadata } = run;
  return metadata;
}
