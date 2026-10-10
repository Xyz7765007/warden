import { test, expect, type Page } from "@playwright/test";

const PAGES = ["/", "/agent", "/redteam", "/proof", "/how", "/developers"];
const WIDTHS = [390, 1190, 1440];

function watch(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

for (const path of PAGES) {
  for (const width of WIDTHS) {
    test(`${path} at ${width}px: loads clean, no sideways scroll`, async ({ page }) => {
      const errors = watch(page);
      await page.setViewportSize({ width, height: 900 });
      await page.goto(path, { waitUntil: "networkidle" });
      await expect(page.locator("h1").first()).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      expect(errors).toEqual([]);
    });
  }
}

test("nav reaches every page and shows layer status", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  for (const [label, path] of [["Live attack", "/agent"], ["Red team", "/redteam"], ["Proof", "/proof"], ["How it works", "/how"], ["API", "/developers"], ["Scan", "/"]]) {
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: label }).click();
    await expect(page).toHaveURL(new RegExp(`${path === "/" ? "/$" : path}`));
  }
  await expect(page.getByTestId("layer-status")).toContainText(/layers on/);
});

test("health endpoint reports the layers", async ({ request }) => {
  const r = await request.get("/api/health");
  expect(r.ok()).toBe(true);
  const j = await r.json();
  expect(j.layers.patterns).toBe("on");
  expect(j.layers.classifier).toBe("on");
});
