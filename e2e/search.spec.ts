import { expect, test } from "@playwright/test";
import { openWorkspace, signedIn } from "./dashboard-mock.js";
import { mockWorkspaceV2, project } from "./workspace-v2-mock.js";

test("searches as one types, groups hits by file, and opens a hit on its line", async ({
  page,
}) => {
  const searches: { query: string; regex?: boolean; wholeWord?: boolean }[] = [];
  await signedIn(page);
  await mockWorkspaceV2(page, {
    onRequest: (request) => {
      if (request.url().includes("/workspace/reads")) {
        const body = request.postDataJSON() as { action: string; query?: string };
        if (body.action === "search") searches.push(body as { query: string });
      }
    },
  });
  await openWorkspace(page, `/dashboard/workspace?project=${project.id}&view=search`);
  await expect(page.getByText("Search the workspace")).toBeVisible();

  await page.getByRole("searchbox", { name: "Search" }).fill("answer");
  const results = page.getByRole("tree", { name: "Search results" });
  await expect(results.getByRole("treeitem")).toHaveCount(4);
  await expect(page.getByText("2 matches in 2 files")).toBeVisible();
  await expect.poll(() => searches.length).toBe(1);
  expect(searches[0]).toMatchObject({ query: "answer", regex: false, wholeWord: false });

  await page.getByRole("button", { name: "Match whole word" }).click();
  await expect.poll(() => searches.at(-1)?.wholeWord).toBe(true);

  await results.getByRole("treeitem", { name: /export const answer/ }).click();
  const tabs = page.getByRole("tablist", { name: "Open files and diffs" });
  await expect(tabs.getByRole("tab")).toHaveText(["main.ts"]);
  await expect(page.locator(".cm-content")).toContainText("answer");
});

test("replaces one match, one file, or everything, with the tokens it searched at", async ({
  page,
}) => {
  const replaces: {
    targets: { path: string; token: string; lines?: number[] }[];
    replacement: string;
  }[] = [];
  await signedIn(page);
  await mockWorkspaceV2(page, {
    onRequest: (request) => {
      if (request.method() === "POST" && request.url().includes("/workspace/actions")) {
        const body = request.postDataJSON() as { action: string };
        if (body.action === "replace") replaces.push(body as never);
      }
    },
  });
  await openWorkspace(page, `/dashboard/workspace?project=${project.id}&view=search`);
  await page.getByRole("searchbox", { name: "Search" }).fill("answer");
  await page.getByRole("button", { name: "Show replace" }).click();
  await page.getByRole("textbox", { name: "Replace with" }).fill("reply");
  const results = page.getByRole("tree", { name: "Search results" });
  await expect(results.getByText("reply").first()).toBeVisible();

  await results.getByRole("treeitem", { name: /export const answer/ }).hover();
  await results.getByRole("button", { name: "Replace this match" }).first().click();
  await expect.poll(() => replaces.length).toBe(1);
  expect(replaces[0]).toMatchObject({
    replacement: "reply",
    targets: [{ path: "src/main.ts", token: "tok1", lines: [1] }],
  });

  await page.getByRole("button", { name: /^Replace all/ }).click();
  await expect.poll(() => replaces.length).toBe(2);
  expect(replaces[1]?.targets.map((target) => target.path)).toEqual(["src/main.ts", "readme.md"]);
});
