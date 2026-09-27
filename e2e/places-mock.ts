import type { Page, Request, Route } from "@playwright/test";
import {
  accountClient,
  cloudUser,
  github,
  machines,
  project,
  repositories,
  widgets,
  widgetsWorkspaces,
} from "./fixtures.js";

export type Sent = { method: string; path: string; body: unknown };

export interface PlacesOptions {
  me?: Record<string, unknown>;
  projects?: unknown[];
  machines?: unknown[];
  workspaces?: Record<string, unknown[]>;
  github?: unknown;
  repositories?: unknown[];
  accountClients?: unknown[];
  /** Answers a request itself and returns true, or leaves it to the defaults. */
  handle?: (route: Route, request: Request, path: string) => Promise<boolean> | boolean;
}

function bodyOf(request: Request): unknown {
  try {
    return request.postDataJSON();
  } catch {
    return null;
  }
}

/**
 * The gateway as the Projects and Machines pages see it.
 *
 * Every request that changes something is recorded in the array it returns,
 * in order, and answered the way the real routes answer when all goes well.
 * A spec that needs a refusal answers that one request itself through
 * `handle`.
 */
export async function mockPlaces(page: Page, options: PlacesOptions = {}): Promise<Sent[]> {
  const sent: Sent[] = [];
  const workspaces = options.workspaces ?? { [widgets.id]: widgetsWorkspaces, [project.id]: [] };

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    if (method !== "GET") sent.push({ method, path, body: bodyOf(request) });
    if (await options.handle?.(route, request, path)) return;

    if (method === "GET") {
      const lists: Record<string, unknown> = {
        "/api/me": options.me ?? cloudUser,
        "/api/projects": options.projects ?? [widgets, project],
        "/api/machines": { machines: options.machines ?? machines },
        "/api/clients": [],
        "/api/account-clients": options.accountClients ?? [accountClient()],
        "/api/tool-calls": { items: [], cursor: null },
        "/api/approvals": { items: [] },
        "/api/terminals": { items: [] },
        "/api/github": options.github ?? github,
      };
      if (path === "/api/github/repositories") {
        const needle = (url.searchParams.get("q") ?? "").toLowerCase();
        const found = (options.repositories ?? repositories) as Array<{ fullName: string }>;
        await route.fulfill({
          status: 200,
          json: {
            enabled: true,
            connected: true,
            repositories: found.filter((row) => row.fullName.toLowerCase().includes(needle)),
          },
        });
        return;
      }
      const match = /^\/api\/projects\/([^/]+)\/workspaces$/.exec(path);
      const body = match?.[1] ? (workspaces[match[1]] ?? []) : lists[path];
      if (body !== undefined) {
        await route.fulfill({ status: 200, json: body });
        return;
      }
      await route.fulfill({ status: 404, json: { error: "not_found" } });
      return;
    }

    if (method === "POST" && path === "/api/cloud/projects") {
      await route.fulfill({
        status: 202,
        json: {
          projectId: "prj_new",
          deviceId: "dev_new",
          status: "creating",
          location: "created",
        },
      });
      return;
    }
    if (method === "POST" && /\/workspaces$/.test(path)) {
      const body = bodyOf(request) as { branch: string; where?: string };
      const where = body.where ?? "laptop";
      const slug = body.branch.replaceAll("/", "-");
      await route.fulfill(
        where === "cloud"
          ? {
              status: 202,
              json: {
                workspaceId: "wsp_new",
                deviceId: "dev_new",
                slug,
                where,
                status: "creating",
              },
            }
          : {
              status: 201,
              json: {
                workspace: {
                  id: "wsp_new",
                  slug,
                  name: body.branch,
                  branch: body.branch,
                  localPath: `/work/widgets/.worktrees/${slug}`,
                },
                where,
                status: "ready",
              },
            },
      );
      return;
    }
    if (method === "POST" && path.endsWith("/remove")) {
      await route.fulfill({ status: 200, json: { ok: true, status: "removed" } });
      return;
    }
    if (method === "POST" && path.endsWith("/retry")) {
      await route.fulfill({ status: 202, json: { ok: true, status: "creating" } });
      return;
    }
    if (path.endsWith("/locations") || path.endsWith("/default-location")) {
      await route.fulfill({
        status: method === "POST" ? 201 : 200,
        json: { locations: widgets.locations },
      });
      return;
    }
    if (method === "DELETE" && path.startsWith("/api/github/installations/")) {
      await route.fulfill({
        status: 200,
        json: { ok: true, manageUrl: github.installations[0]?.manageUrl },
      });
      return;
    }
    // Revoking and deleting a machine, removing a location or a project,
    // saving a token, changing a client's projects: all of them answer `ok`.
    await route.fulfill({ status: 200, json: { ok: true } });
  });

  return sent;
}
