import { expect, test } from "@playwright/test";
import { mockApi, openWorkspace, project, signedIn, workspace } from "./dashboard-mock.js";

test("moves between views with the bar along the bottom", async ({ page }) => {
  await signedIn(page);
  await mockApi(page);
  await openWorkspace(page, `/dashboard/workspace?project=${project.id}`);

  const bar = page.getByRole("navigation", { name: "Workspace views" });
  await expect(bar).toBeVisible();
  await expect(bar.getByRole("button")).toHaveCount(5);
  await expect(page.getByRole("heading", { name: "Workspace" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /main\.txt/ })).toBeVisible();

  await bar.getByRole("button", { name: "Terminal" }).click();
  await expect(page).toHaveURL(`/dashboard/workspace?project=${project.id}&view=terminal`);
  await expect(page.getByText("Start an interactive shell in main")).toBeVisible();

  await bar.getByRole("button", { name: "Explorer" }).click();
  await expect(page).toHaveURL(`/dashboard/workspace?project=${project.id}&view=explorer`);
  await expect(page.getByText("CLI update required")).toBeVisible();
  await expect(
    page.getByText("Update the Exeora CLI on Laptop to use the Explorer."),
  ).toBeVisible();

  await bar.getByRole("button", { name: "Source Control" }).click();
  await expect(page).toHaveURL(`/dashboard/workspace?project=${project.id}`);
  await expect(page.getByRole("button", { name: /main\.txt/ })).toBeVisible();
});

test("keeps the compact selector and the views on a workspace", async ({ page }) => {
  await signedIn(page);
  await mockApi(page);
  await openWorkspace(
    page,
    `/dashboard/workspace?project=${project.id}&workspace=${workspace.slug}`,
  );
  await expect(
    page.getByRole("button", { name: "Workspace feature/trees · Laptop" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Project details" })).toHaveAttribute(
    "href",
    `/dashboard/projects/${project.id}`,
  );
  await expect(page.getByRole("button", { name: /feature-tree\.txt/ })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Workspace views" })).toBeVisible();
});

test("pushes a file's diff over the list and comes back", async ({ page }) => {
  await signedIn(page);
  await mockApi(page);
  await openWorkspace(page, `/dashboard/workspace?project=${project.id}`);
  await page.getByRole("button", { name: /main\.txt/ }).click();
  await expect(page).toHaveURL(/detail=diff%3Aworking%3Amain\.txt/);
  const screen = page.getByRole("region", { name: "main.txt" });
  await expect(screen).toBeVisible();
  await expect(screen.getByText("Working tree", { exact: true })).toBeVisible();
  await expect(screen.getByRole("button", { name: "Stage", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /notes\.md/ })).toHaveCount(0);

  await screen.getByRole("button", { name: "Back" }).click();
  await expect(page).toHaveURL(`/dashboard/workspace?project=${project.id}`);
  await expect(page.getByRole("button", { name: /notes\.md/ })).toBeVisible();
});
