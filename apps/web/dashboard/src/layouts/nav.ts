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
