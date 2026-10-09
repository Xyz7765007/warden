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

test("your own content: the form takes text, and only the live agent runs it", async ({ page }) => {
  await page.goto("/agent");
  await page.locator('[data-scenario="custom"]').click();
  await expect(page.getByTestId("own-agent")).toBeVisible();
  await page.locator("#own-agent-text").fill("Hi team, the offsite has moved to Friday at 10 am.");
  await expect(page.locator("#own-agent-task")).toHaveValue("Summarise this for me.");
  await expect(page.getByRole("radio", { name: "Reference agent" })).toBeDisabled();
});

test("your own content is refused on the reference agent and when empty", async ({ request }) => {
  const a = await request.post("/api/agent", { data: { scenario: "custom", mode: "reference", text: "hello" } });
  expect(a.status()).toBe(400);
  const b = await request.post("/api/agent", { data: { scenario: "custom", mode: "live", text: "  " } });
  expect(b.status()).toBe(400);
});
