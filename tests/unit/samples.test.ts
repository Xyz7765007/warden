import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { scan } from "@/lib/warden/scan";
import { SAMPLES } from "@/lib/samples";
import { PROFILES } from "@/lib/agent/profiles";
import { shutdownOcr } from "@/lib/warden/extract/image";
import { loadClassifier } from "./helpers";

const clf = loadClassifier();
afterAll(() => shutdownOcr());

describe("every gallery sample makes the decision it promises", () => {
  for (const s of SAMPLES) {
    it(s.id, async () => {
      const file = s.file ? { name: path.basename(s.file), bytes: new Uint8Array(fs.readFileSync(path.join("public", s.file))) } : undefined;
      const r = await scan({ source: s.source, text: s.text, file, task: s.task, history: s.history, agent: { ...PROFILES[s.agent], pinnedTools: s.pinned }, judge: "off", compareModes: true }, { classifier: clf });
      if (s.expect === "flagged") expect(r.decision).not.toBe("allow");
      else if (s.expect === "depends") expect(r.byMode?.strict?.decision).not.toBe(r.byMode?.permissive?.decision);
      else expect(r.decision).toBe(s.expect);
      // No setting lets a clear attack through. Balanced and Relaxed pass the safe look-alikes;
      // Strict has the lower bar, so it may cut or hold a phrase in one, but never blocks it.
      if (s.expect === "flagged") for (const d of Object.values(r.byMode ?? {})) expect(d?.decision).not.toBe("allow");
      if (s.safe) {
        expect(r.byMode?.strict?.decision).not.toBe("block");
        expect(r.byMode?.balanced?.decision).toBe("allow");
        expect(r.byMode?.permissive?.decision).toBe("allow");
      }
      expect(r.trace.length).toBeGreaterThan(2);
    });
  }
});
