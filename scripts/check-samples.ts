// Every gallery sample must produce the decision it promises.  npx tsx scripts/check-samples.ts
import fs from "node:fs";
import path from "node:path";
import { scan } from "../lib/warden/scan";
import { classifierFromJson } from "../lib/warden/classifier";
import { SAMPLES } from "../lib/samples";
import { PROFILES } from "../lib/agent/profiles";
import { shutdownOcr } from "../lib/warden/extract/image";
async function main() {
  const clf = classifierFromJson(JSON.parse(fs.readFileSync("data/model/classifier.json", "utf8")));
  let bad = 0;
  for (const s of SAMPLES) {
    const file = s.file ? { name: path.basename(s.file), bytes: new Uint8Array(fs.readFileSync(path.join("public", s.file))) } : undefined;
    const r = await scan({ source: s.source, text: s.text, file, task: s.task, history: s.history, agent: { ...PROFILES[s.agent], pinnedTools: s.pinned }, judge: "off", compareModes: s.expect === "depends" }, { classifier: clf });
    const ok = s.expect === "flagged" ? r.decision !== "allow" : s.expect === "depends" ? r.byMode?.strict?.decision !== r.byMode?.permissive?.decision : r.decision === s.expect;
    if (!ok) bad++;
    console.log(`${ok ? "ok  " : "FAIL"} ${s.id.padEnd(20)} ${r.decision.padEnd(10)} risk ${String(r.risk).padStart(3)} [${r.attackTypes.join(", ")}] ${r.stats.ms}ms  ${r.headline}`);
  }
  await shutdownOcr();
  process.exit(bad ? 1 : 0);
}
main();
