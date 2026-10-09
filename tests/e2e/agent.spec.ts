import { test, expect } from "@playwright/test";
import { SCENARIOS } from "../../lib/agent/scenarios";

for (const s of SCENARIOS) {
  test(`live attack ${s.id}: harmed without Warden, safe with it`, async ({ page }) => {
    await page.goto("/agent");
    await page.locator(`[data-scenario="${s.id}"]`).click();
    await page.getByTestId("run-agent").click();
    await expect(page.getByTestId("col-without").getByTestId("outcome")).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId("col-with").getByTestId("outcome")).toBeVisible();
    await expect(page.getByTestId("col-without").getByTestId("outcome")).toHaveAttribute("data-safe", "false");
    await expect(page.getByTestId("col-with").getByTestId("outcome")).toHaveAttribute("data-safe", "true");
  });
}
