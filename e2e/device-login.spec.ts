import { expect, test } from "@playwright/test";
import { gatewayResponse } from "../apps/gateway/src/gateway-response.js";

// Exercise the gateway's real headers with a native form submission. Synthetic
// Worker requests set Origin themselves and miss how browsers derive it from
// the document's referrer policy.
test("keeps the browser Origin when submitting and retrying a device code", async ({ page }) => {
  const origins: (string | undefined)[] = [];
  await page.route("**/oauth/device", async (route) => {
    const request = route.request();
    const posted = request.method() === "POST";
    if (posted) {
      origins.push(request.headers().origin);
      expect(new URLSearchParams(request.postData() ?? "").get("user_code")).toBe("ABCD-EFGH");
    }
    const response = gatewayResponse(
      new Request(request.url()),
      new Response(
        `<form method="post" action="/oauth/device">
          <label>Code<input name="user_code" required></label>
          <button type="submit">Continue</button>
        </form>`,
        { status: posted ? 400 : 200, headers: { "Content-Type": "text/html" } },
      ),
    );
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: await response.text(),
    });
  });

  await page.goto("/oauth/device");
  const origin = new URL(page.url()).origin;
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.getByRole("textbox", { name: "Code" }).fill("ABCD-EFGH");
    const submitted = page.waitForResponse(
      (response) =>
        response.url().endsWith("/oauth/device") && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Continue" }).click();
    expect((await submitted).status()).toBe(400);
    await page.waitForLoadState();
    expect(origins).toEqual(Array(attempt + 1).fill(origin));
  }
});

test("does not disclose the device page URL when navigating to another site", async ({ page }) => {
  await page.route("**/oauth/device?private=value", async (route) => {
    const response = gatewayResponse(
      new Request(route.request().url()),
      new Response('<a href="https://elsewhere.example/">Leave</a>', {
        headers: { "Content-Type": "text/html" },
      }),
    );
    await route.fulfill({
      headers: Object.fromEntries(response.headers),
      body: await response.text(),
    });
  });
  await page.route("https://elsewhere.example/", (route) => route.fulfill({ body: "Elsewhere" }));
  await page.goto("/oauth/device?private=value");
  const navigation = page.waitForRequest("https://elsewhere.example/");
  await page.getByRole("link", { name: "Leave" }).click();
  expect((await navigation).headers().referer).toBeUndefined();
});
