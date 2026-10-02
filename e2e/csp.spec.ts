import { expect, type Page, test } from "@playwright/test";
import { openWorkspace, signedIn } from "./dashboard-mock.js";
import { mockWorkspaceV2, project } from "./workspace-v2-mock.js";

function dashboardPolicy(requestUrl: string): string {
  const url = new URL(requestUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' https: data:",
    "font-src 'self'",
    `connect-src 'self' ${url.origin}`,
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join("; ");
}

/** Applies the same document policy as the gateway's dashboard shell. */
async function dashboardCsp(page: Page) {
  await page.route("**/dashboard/**", async (route) => {
    if (route.request().resourceType() !== "document") {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: {
        ...response.headers(),
        "content-security-policy": dashboardPolicy(route.request().url()),
      },
    });
  });
}

test("renders source control diffs under the dashboard CSP", async ({ page }) => {
  const policyErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /content security policy/i.test(message.text())) {
      policyErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    if (/content security policy|wasm/i.test(error.message)) policyErrors.push(error.message);
  });

  await dashboardCsp(page);
  await signedIn(page);
  await mockWorkspaceV2(page);
  await openWorkspace(page, `/dashboard/workspace?project=${project.id}`);
  await page.getByRole("button", { name: /main\.txt/ }).click();

  await expect(page.locator(".git-diff")).toContainText("new");
  expect(policyErrors).toEqual([]);
});
