import { describe, expect, it } from "vitest";
import { httpsRepositoryUrl, repositoryKey, sshRepositoryUrl } from "./repository.js";

describe("repositoryKey", () => {
  it("reduces every spelling of one repository to the same key", () => {
    const spellings = [
      "https://github.com/Acme/API.git",
      "https://github.com/acme/api",
      "https://github.com/acme/api/",
      "https://user@github.com/acme/api.git",
      "https://www.github.com/acme/api",
      "git@github.com:acme/api.git",
      "git@github.com:Acme/api",
      "ssh://git@github.com/acme/api.git",
      "ssh://git@github.com:22/acme/api.git",
      "git://github.com/acme/api.git",
      "  https://github.com/acme/api.git  ",
    ];

    expect(new Set(spellings.map(repositoryKey))).toEqual(new Set(["github.com/acme/api"]));
  });

  it("keeps groups and other hosts apart", () => {
    expect(repositoryKey("https://gitlab.com/group/sub/project.git")).toBe(
      "gitlab.com/group/sub/project",
    );
    expect(repositoryKey("git@bitbucket.org:team/repo.git")).toBe("bitbucket.org/team/repo");
    expect(repositoryKey("https://github.com/acme/api")).not.toBe(
      repositoryKey("https://github.com/acme/api-docs"),
    );
  });

  it("is null for what is not a repository on a host", () => {
    for (const value of [
      "",
      "   ",
      null,
      undefined,
      "/home/me/code/api",
      "./api",
      "C:\\code\\api",
      "file:///home/me/code/api.git",
      "https://github.com",
      "https://github.com/",
      "not a url",
    ]) {
      expect(repositoryKey(value), String(value)).toBeNull();
    }
  });
});

describe("slashes", () => {
  it("trims a long run of slashes in linear time", () => {
    const slashes = "/".repeat(100_000);
    expect(repositoryKey(`https://github.com/${slashes}acme/api${slashes}x`)).toBe(
      `github.com/acme/api${slashes}x`,
    );
    expect(repositoryKey(`https://github.com/acme/api.git${slashes}`)).toBe("github.com/acme/api");
  });
});

describe("clone addresses", () => {
  it("writes the https and ssh forms of whatever it was given", () => {
    expect(httpsRepositoryUrl("git@github.com:Acme/API.git")).toBe(
      "https://github.com/Acme/API.git",
    );
    expect(httpsRepositoryUrl("https://github.com/acme/api")).toBe(
      "https://github.com/acme/api.git",
    );
    expect(sshRepositoryUrl("https://github.com/Acme/API")).toBe("git@github.com:Acme/API.git");
    expect(sshRepositoryUrl("/home/me/code")).toBeNull();
  });
});
