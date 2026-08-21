import { describe, expect, it } from "vitest";
import { sectionTitle, shellLinks } from "./nav.js";

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

  it("keeps nested admin routes under Admin", () => {
    expect(sectionTitle("/admin", links)).toBe("Admin");
    expect(sectionTitle("/admin/users/usr_1", links)).toBe("Admin");
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
