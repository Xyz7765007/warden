// InjecAgent (MIT, uiuc-kang-lab): attacker instructions hidden in tool responses, plus our
// paired benign controls (the same response with harmless text in the slot).
//   npx tsx scripts/eval-injecagent.ts
import fs from "node:fs";
import path from "node:path";
import { scan } from "../lib/warden/scan";
import { classifierFromJson } from "../lib/warden/classifier";

async function run(withTask: boolean) {
  const clf = classifierFromJson(JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "model", "classifier.json"), "utf8")));
  const rows: any[] = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "external", "injecagent.json"), "utf8"));
  let tp = 0, fn = 0, fp = 0, tn = 0;
  const byKind: Record<string, { n: number; hit: number }> = {};
  const misses = new Map<string, number>();
  const fps: string[] = [];
  for (const r of rows) {
    const res = await scan({ source: "api_response", text: r.text, task: withTask ? r.task : undefined, agent: { tools: r.tools.map((n: string) => ({ name: n })) }, judge: "off" }, { classifier: clf });
    const yes = res.decision !== "allow";
    if (r.label) {
      byKind[r.kind] ??= { n: 0, hit: 0 };
      byKind[r.kind].n++;
      if (yes) { tp++; byKind[r.kind].hit++; } else { fn++; misses.set(r.instruction, (misses.get(r.instruction) ?? 0) + 1); }
    } else if (yes) { fp++; fps.push(res.findings[0]?.quote.slice(0, 90) ?? ""); } else tn++;
  }
  const out = { withTask, attacks: tp + fn, benign: fp + tn, recall: +(tp / (tp + fn)).toFixed(3), falsePositiveRate: +(fp / (fp + tn)).toFixed(3), byKind: Object.fromEntries(Object.entries(byKind).map(([k, v]) => [k, +(v.hit / v.n).toFixed(3)])) };
  console.log(JSON.stringify(out));
  console.log("  top misses:", [...misses.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${v}x ${k.slice(0, 100)}`));
  if (fps.length) console.log("  false positives:", fps.slice(0, 6));
  return out;
}
async function main() {
  const a = await run(true);
  const b = await run(false);
  fs.writeFileSync(path.join(process.cwd(), "data", "eval", "injecagent.json"), JSON.stringify({ generatedAt: new Date().toISOString(), judge: "off", withTask: a, withoutTask: b }, null, 1));
}
main().then(() => process.exit(0));
