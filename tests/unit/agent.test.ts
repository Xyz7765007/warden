import { describe, it, expect, afterAll } from "vitest";
import { SCENARIOS } from "@/lib/agent/scenarios";
import { runScenario } from "@/lib/agent/reference";
import { shutdownOcr } from "@/lib/warden/extract/image";

afterAll(() => shutdownOcr());

describe("the reference agent", () => {
  for (const s of SCENARIOS) {
    it(`${s.id}: harmed without Warden, safe with it`, async () => {
      const without = await runScenario(s.id, false);
      const withW = await runScenario(s.id, true);
      expect(without.outcome.safe).toBe(false);
      expect(withW.outcome.safe).toBe(true);
    });
  }
});
