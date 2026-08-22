/**
 * The signed-in destinations, named once.
 *
 * The sidebar draws them as a list and the topbar as the current section. Both
 * have to agree on what a path belongs to, including the nested ones: a
 * project detail is still Projects, an admin user is still Users. The git
 * client lives at `/workspace`, not under a project.
 */

export type NavIconName =
  | "overview"
  | "machines"
  | "projects"
  | "clients"
  | "activity"
  | "workspace"
  | "settings"
  | "admin"
  | "users";

export type ShellLink = {
  to: string;
  label: string;
  icon: NavIconName;
  end?: boolean;
};

export function shellLinks(isAdmin: boolean): ShellLink[] {
  return [
    { to: "/", label: "Overview", icon: "overview", end: true },
    { to: "/machines", label: "Machines", icon: "machines" },
    { to: "/projects", label: "Projects", icon: "projects" },
    { to: "/clients", label: "Clients", icon: "clients" },
    { to: "/activity", label: "Activity", icon: "activity" },
    { to: "/workspace", label: "Workspace", icon: "workspace" },
    { to: "/settings", label: "Settings", icon: "settings" },
    ...(isAdmin ? [{ to: "/admin", label: "Admin", icon: "admin" as const }] : []),
  ];
}

/**
 * Destinations inside the administration panel.
 *
 * Entering Admin swaps the rail: the owner dashboard goes away and these take
 * its place, with a way back. `/admin` is Overview and must not stay lit on
 * `/admin/users`.
 */
export function adminShellLinks(): ShellLink[] {
  return [
    { to: "/admin", label: "Overview", icon: "overview", end: true },
    { to: "/admin/users", label: "Users", icon: "users" },
  ];
}

export function isAdminSection(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

export function sectionTitle(pathname: string, links: readonly ShellLink[]): string {
  const ranked = [...links].sort((a, b) => b.to.length - a.to.length);
  for (const link of ranked) {
    if (link.to === "/") {
      if (pathname === "/") return link.label;
      continue;
    }
    if (pathname === link.to || pathname.startsWith(`${link.to}/`)) return link.label;
  }
  return "Dashboard";
}

/**
 * A screen that is one record, not a list. The shell treats these as nested:
 * a trail back to the list, and a mark that you are inside that record.
 */
export type DetailPlace = {
  parentTo: string;
  parentLabel: string;
  kind: "project" | "user";
  id: string;
};

export function detailPlace(pathname: string): DetailPlace | null {
  const project = /^\/projects\/([^/]+)$/.exec(pathname);
  if (project?.[1]) {
    return {
      parentTo: "/projects",
      parentLabel: "Projects",
      kind: "project",
      id: project[1],
    };
  }
  const user = /^\/admin\/users\/([^/]+)$/.exec(pathname);
  if (user?.[1]) {
    return {
      parentTo: "/admin/users",
      parentLabel: "Users",
      kind: "user",
      id: user[1],
    };
  }
  return null;
}

export function detailKindLabel(kind: DetailPlace["kind"]): string {
  return kind === "project" ? "Project" : "User";
}
