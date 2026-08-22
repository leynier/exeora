import { describe, expect, it } from "vitest";
import { adminShellLinks, isAdminSection, sectionTitle, shellLinks } from "./nav.js";

describe("sectionTitle", () => {
  const links = shellLinks(true);

  it("names the index Overview", () => {
    expect(sectionTitle("/", links)).toBe("Overview");
  });

  it("keeps nested project routes under Projects", () => {
    expect(sectionTitle("/projects", links)).toBe("Projects");
    expect(sectionTitle("/projects/prj_1", links)).toBe("Projects");
    expect(sectionTitle("/projects/prj_1/workspace", links)).toBe("Projects");
  });

  it("names destinations inside Admin from the admin rail", () => {
    const admin = adminShellLinks();
    expect(sectionTitle("/admin", admin)).toBe("Overview");
    expect(sectionTitle("/admin/users", admin)).toBe("Users");
    expect(sectionTitle("/admin/users/usr_1", admin)).toBe("Users");
  });

  it("names the git client Workspace", () => {
    expect(sectionTitle("/workspace", links)).toBe("Workspace");
  });

  it("does not treat a prefix of another path as a match", () => {
    expect(sectionTitle("/machines", links)).toBe("Machines");
    expect(sectionTitle("/settings", links)).toBe("Settings");
  });
});

describe("shellLinks", () => {
  it("hides Admin from ordinary accounts", () => {
    expect(shellLinks(false).map((link) => link.to)).not.toContain("/admin");
    expect(shellLinks(true).map((link) => link.to)).toContain("/admin");
  });

  it("places Workspace after Activity", () => {
    const destinations = shellLinks(false).map((link) => link.to);
    expect(destinations.indexOf("/workspace")).toBeGreaterThan(destinations.indexOf("/activity"));
  });
});

describe("adminShellLinks", () => {
  it("keeps Overview from staying lit on Users", () => {
    const overview = adminShellLinks().find((link) => link.to === "/admin");
    expect(overview?.end).toBe(true);
  });
});

describe("isAdminSection", () => {
  it("covers the admin screens and nothing else", () => {
    expect(isAdminSection("/admin")).toBe(true);
    expect(isAdminSection("/admin/users")).toBe(true);
    expect(isAdminSection("/admin/users/usr_1")).toBe(true);
    expect(isAdminSection("/")).toBe(false);
    expect(isAdminSection("/settings")).toBe(false);
  });
});
