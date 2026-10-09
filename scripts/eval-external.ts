// Runs the full pipeline (patterns + classifier, LLM judge off) on the public test splits.
//   npx tsx scripts/eval-external.ts
import fs from "node:fs";
import path from "node:path";
import { scan } from "../lib/warden/scan";
import { classifierFromJson } from "../lib/warden/classifier";

async function main() {
  const clf = classifierFromJson(JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "model", "classifier.json"), "utf8")));
  const results: any[] = [];
  for (const [name, file] of [["deepset/prompt-injections (test)", "deepset-test.json"], ["jackhhao/jailbreak-classification (test)", "jackhhao-test.json"]] as const) {
    const rows: Array<{ text: string; label: 0 | 1 }> = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "external", file), "utf8"));
    let tp = 0, fp = 0, tn = 0, fn = 0;
    const misses: string[] = [];
    const fps: string[] = [];
    const ms: number[] = [];
    for (const r of rows) {
      const t0 = performance.now();
      const res = await scan({ source: "user_message", text: r.text, mode: "balanced", judge: "off" }, { classifier: clf });
      ms.push(performance.now() - t0);
      const yes = res.decision !== "allow";
      if (yes && r.label) tp++;
      else if (yes && !r.label) { fp++; fps.push(r.text.slice(0, 110)); }
      else if (!yes && !r.label) tn++;
      else { fn++; misses.push(r.text.slice(0, 110)); }
    }
    const out = { name, n: rows.length, attacks: tp + fn, benign: tn + fp, recall: +(tp / (tp + fn)).toFixed(3), precision: +(tp / Math.max(1, tp + fp)).toFixed(3), falsePositiveRate: +(fp / Math.max(1, fp + tn)).toFixed(3), accuracy: +((tp + tn) / rows.length).toFixed(3), p50ms: Math.round(ms.sort((a, b) => a - b)[Math.floor(ms.length / 2)]) };
    console.log(JSON.stringify(out));
    console.log("  sample misses:", JSON.stringify(misses.slice(0, 6), null, 1));
    console.log("  sample false positives:", JSON.stringify(fps.slice(0, 6), null, 1));
    results.push({ ...out, sampleMisses: misses.slice(0, 10), sampleFalsePositives: fps.slice(0, 10) });
  }
  fs.writeFileSync(path.join(process.cwd(), "data", "eval", "external.json"), JSON.stringify({ generatedAt: new Date().toISOString(), judge: "off", results }, null, 1));
}
main().then(() => process.exit(0));
