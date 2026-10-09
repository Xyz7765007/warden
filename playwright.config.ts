import { defineConfig } from "@playwright/test";

// Runs against a local dev server by default; set WARDEN_URL to test a deployment.
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: { timeout: 60_000 },
  workers: 2,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: process.env.WARDEN_URL || "http://localhost:3100", trace: "off" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
