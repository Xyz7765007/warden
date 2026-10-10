import path from "node:path";
import { test, expect, type Page } from "@playwright/test";

// The API page: a judge picks an example, presses Send request, and reads the live answer.
async function send(page: Page, endpoint: "Scan" | "Guard" | "Health", example?: string) {
  await page.getByRole("radiogroup", { name: "Endpoint" }).getByRole("radio", { name: endpoint, exact: true }).click();
  if (example) await page.getByRole("group", { name: "Examples" }).getByRole("button", { name: example, exact: true }).click();
  await page.getByTestId("api-send").click();
  await expect(page.getByTestId("api-status")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/developers");
});

test("scan: a hidden order is stopped, a normal email is let through", async ({ page }) => {
  await send(page, "Scan", "Email with a hidden order");
  await expect(page.getByTestId("api-status")).toContainText("200");
  await expect(page.getByTestId("api-plain")).toContainText(/decision: (block|neutralize|quarantine)/);
  await expect(page.getByTestId("api-json")).toContainText('"findings"');

  await send(page, "Scan", "Normal email");
  await expect(page.getByTestId("api-plain")).toContainText("decision: allow");
});

test("scan: Everything shows the trace, outage example still answers", async ({ page }) => {
  await send(page, "Scan", "Simulate an outage");
  await expect(page.getByTestId("api-plain")).toContainText(/decision: /);
  await page.getByRole("radiogroup", { name: "Response view" }).getByRole("radio", { name: "Everything" }).click();
  await expect(page.getByTestId("api-json")).toContainText('"trace"');
  await expect(page.getByTestId("api-json")).toContainText("classifier");
});

test("scan: an attached file is read by its own type, not as the example's source", async ({ page }) => {
  await page.getByTestId("api-file").setInputFiles(path.join("public", "samples", "invoice-hidden.pdf"));
  const curl = page.getByLabel("The same request as a curl command");
  await expect(curl).toContainText("file=@'invoice-hidden.pdf'");
  await expect(curl).not.toContainText("source=");
  await page.getByTestId("api-send").click();
  await expect(page.getByTestId("api-plain")).toContainText(/decision: (block|neutralize|quarantine)/);
});

test("guard: a leak is caught, a normal reply goes out", async ({ page }) => {
  await send(page, "Guard", "Reply that leaks through an image");
  await expect(page.getByTestId("api-plain")).toContainText(/decision: (redact|block)/);

  await send(page, "Guard", "Payment to a flagged account");
  await expect(page.getByTestId("api-plain")).toContainText("decision: block");

  await send(page, "Guard", "Normal reply");
  await expect(page.getByTestId("api-plain")).toContainText("decision: allow");
});

test("health answers, broken JSON cannot be sent, curl matches the request", async ({ page }) => {
  await send(page, "Health");
  await expect(page.getByTestId("api-status")).toContainText("200");
  await expect(page.getByTestId("api-json")).toContainText('"layers"');

  await page.getByRole("radiogroup", { name: "Endpoint" }).getByRole("radio", { name: "Scan", exact: true }).click();
  const curl = page.getByLabel("The same request as a curl command");
  await expect(curl).toContainText("curl");
  await expect(curl).toContainText("/api/scan");
  await page.locator("#api-body").fill("{ not json");
  await expect(page.getByTestId("api-send")).toBeDisabled();
  await expect(page.getByText("Not valid JSON yet")).toBeVisible();
});

test("code samples switch language", async ({ page }) => {
  const code = page.getByTestId("api-code");
  await code.getByRole("radio", { name: "Python" }).click();
  await expect(code).toContainText("requests.post");
  await code.getByRole("radio", { name: "JavaScript" }).click();
  await expect(code).toContainText("fetch(");
});
