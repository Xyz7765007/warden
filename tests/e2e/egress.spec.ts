import { test, expect } from "@playwright/test";

const cases: Array<[string, string]> = [
  ["image", "redact"],
  ["canary", "block"],
  ["call", "block"],
  ["clean", "allow"],
];

for (const [preset, decision] of cases) {
  test(`second line: ${preset} -> ${decision}`, async ({ page }) => {
    await page.goto("/agent");
    await page.locator(`[data-preset="${preset}"]`).click();
    await page.getByTestId("egress-check").click();
    await expect(page.getByTestId("egress-result")).toHaveAttribute("data-decision", decision);
  });
}

test("guard API", async ({ request }) => {
  const r = await request.post("/api/guard", { data: { call: { tool: "pay_invoice", args: { account: "50200098765432" } }, task: "Pay the Shreeji invoice", flagged: ["new A/C 50200098765432"], clean: ["A/C 50100012345678"] } });
  expect((await r.json()).decision).toBe("block");
});
