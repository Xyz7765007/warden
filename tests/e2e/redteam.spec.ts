import { test, expect } from "@playwright/test";

test("red team: attack, learn from misses, attack again", async ({ page }) => {
  await page.goto("/redteam");
  const run = page.getByTestId("run-round");
  await expect(run).toBeEnabled();
  await run.click();
  await expect(page.locator('[data-testid="feed"] li')).toHaveCount(40, { timeout: 90_000 });
  await expect(run).toBeEnabled({ timeout: 90_000 });
  const learn = page.getByTestId("learn");
  if (await learn.isEnabled()) {
    await learn.click();
    const report = page.getByTestId("learn-report");
    await expect(report).toBeVisible({ timeout: 90_000 });
    await expect(report).toContainText("0 before, 0 after");
  }
  await run.click();
  await expect(page.locator('[data-testid="feed"] li')).toHaveCount(80, { timeout: 90_000 });
  await expect(page.getByTestId("rounds")).toContainText("Round 2");
});
