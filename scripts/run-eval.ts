// Runs every case in data/eval/cases.json through the real scan pipeline and writes the
// coverage matrix, false-positive rate and latency to data/eval/results.json.
//   npx tsx scripts/run-eval.ts [--only=pdf] [--verbose]

import fs from "node:fs";
import path from "node:path";
import { scan } from "../lib/warden/scan";
import { shutdownOcr } from "../lib/warden/extract/image";
import { PROFILES } from "../lib/agent/profiles";
import { classifierFromJson } from "../lib/warden/classifier";
import { ATTACK_TYPES, SOURCE_KINDS, type AttackType, type SourceKind } from "../lib/warden/types";
import type { EvalCase } from "./build-corpus";

const DIR = path.join(process.cwd(), "data", "eval");
const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith("--only="))?.split("=")[1];
const verbose = args.includes("--verbose");
const noClassifier = args.includes("--no-classifier");

const pct = (a: number, b: number) => (b ? Math.round((1000 * a) / b) / 10 : null);
const quantile = (xs: number[], q: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

async function main() {
  const cases: EvalCase[] = JSON.parse(fs.readFileSync(path.join(DIR, "cases.json"), "utf8"));
  const modelPath = path.join(process.cwd(), "data", "model", "classifier.json");
  const classifier = noClassifier || !fs.existsSync(modelPath) ? null : classifierFromJson(JSON.parse(fs.readFileSync(modelPath, "utf8")));
  const rows: any[] = [];
  const started = Date.now();
  for (const c of cases) {
    if (only && c.source !== only) continue;
    const profile = PROFILES[c.agent] ?? PROFILES.chat;
    const file = c.file ? { name: path.basename(c.file), bytes: new Uint8Array(fs.readFileSync(path.join(DIR, c.file))) } : undefined;
    const t0 = performance.now();
    const r = await scan({ source: c.source, text: c.text, file, history: c.history, agent: { ...profile, pinnedTools: c.pinned }, mode: "balanced", judge: "off" }, { classifier });
    const ms = performance.now() - t0;
    const detected = r.decision !== "allow";
    const typeMatch = c.type ? r.attackTypes.includes(c.type) : false;
    rows.push({
      id: c.id, label: c.label, type: c.type, family: c.family, split: c.split, lang: c.lang, source: c.source, carrier: c.carrier, hidden: c.hidden,
      decision: r.decision, risk: r.risk, types: r.attackTypes, detected, typeMatch, ms: Math.round(ms),
      hiddenSegments: r.stats.hiddenSegments, top: r.findings[0] ? { type: r.findings[0].type, rule: r.findings[0].rule, layer: r.findings[0].layer, conf: r.findings[0].confidence, quote: r.findings[0].quote.slice(0, 140) } : null,
      headline: r.headline,
      judgeItems: r.stats.judgeItems ?? 0,
      judgeChars: r.stats.judgeChars ?? 0,
    });
    if (verbose) console.log(`${c.id} ${c.label} ${c.type ?? ""} ${c.source}/${c.carrier} -> ${r.decision} [${r.attackTypes.join(",")}]`);
  }

  const attacks = rows.filter((r) => r.label === "attack");
  const benign = rows.filter((r) => r.label === "benign");
  const matrix: Record<string, Record<string, { n: number; detected: number; typed: number }>> = {};
  for (const t of ATTACK_TYPES) {
    matrix[t] = {};
    for (const s of SOURCE_KINDS) matrix[t][s] = { n: 0, detected: 0, typed: 0 };
  }
  for (const r of attacks) {
    const cell = matrix[r.type][r.source];
    cell.n++;
    if (r.detected) cell.detected++;
    if (r.detected && r.typeMatch) cell.typed++;
  }
  const byType = Object.fromEntries(ATTACK_TYPES.map((t) => {
    const xs = attacks.filter((r) => r.type === t);
    return [t, { n: xs.length, detected: pct(xs.filter((r) => r.detected).length, xs.length), typed: pct(xs.filter((r) => r.detected && r.typeMatch).length, xs.length) }];
  }));
  const bySource = Object.fromEntries(SOURCE_KINDS.map((s) => {
    const a = attacks.filter((r) => r.source === s);
    const b = benign.filter((r) => r.source === s);
    const lat = rows.filter((r) => r.source === s).map((r) => r.ms);
    return [s, {
      attacks: a.length, detected: pct(a.filter((r) => r.detected).length, a.length), typed: pct(a.filter((r) => r.detected && r.typeMatch).length, a.length),
      benign: b.length, falsePositives: b.filter((r) => r.detected).length, fpr: pct(b.filter((r) => r.detected).length, b.length),
      p50: Math.round(quantile(lat, 0.5)), p95: Math.round(quantile(lat, 0.95)),
    }];
  }));
  const hiddenAttacks = attacks.filter((r) => r.hidden);
  const summary = {
    generatedAt: new Date().toISOString(),
    classifier: classifier?.name ?? null,
    judge: "off",
    cases: rows.length,
    attacks: attacks.length,
    benign: benign.length,
    detection: pct(attacks.filter((r) => r.detected).length, attacks.length),
    typedDetection: pct(attacks.filter((r) => r.detected && r.typeMatch).length, attacks.length),
    hiddenDetection: pct(hiddenAttacks.filter((r) => r.detected).length, hiddenAttacks.length),
    falsePositiveRate: pct(benign.filter((r) => r.detected).length, benign.length),
    falsePositives: benign.filter((r) => r.detected).length,
    p50ms: Math.round(quantile(rows.map((r) => r.ms), 0.5)),
    p95ms: Math.round(quantile(rows.map((r) => r.ms), 0.95)),
    textP50ms: Math.round(quantile(rows.filter((r) => !["pdf", "docx", "image", "email"].includes(r.source)).map((r) => r.ms), 0.5)),
    typesCovered: ATTACK_TYPES.filter((t) => (byType[t].typed ?? 0) >= 80).length,
    wallSeconds: Math.round((Date.now() - started) / 1000),
    // How often the optional LLM judge would be asked, and about how much text (for cost estimates).
    judgeShare: pct(rows.filter((r) => r.judgeItems > 0).length, rows.length),
    judgeItemsPerCall: +(rows.filter((r) => r.judgeItems > 0).reduce((n, r) => n + r.judgeItems, 0) / Math.max(1, rows.filter((r) => r.judgeItems > 0).length)).toFixed(2),
    judgeCharsPerCall: Math.round(rows.filter((r) => r.judgeItems > 0).reduce((n, r) => n + r.judgeChars, 0) / Math.max(1, rows.filter((r) => r.judgeItems > 0).length)),
  };
  const out = { summary, byType, bySource, matrix, rows };
  if (!only) fs.writeFileSync(path.join(DIR, "results.json"), JSON.stringify(out, null, 1));

  console.log(JSON.stringify(summary, null, 1));
  console.log("\nBy type (detected% / typed%):");
  for (const t of ATTACK_TYPES) console.log(`  ${t.padEnd(22)} n=${String(byType[t].n).padStart(3)}  ${byType[t].detected}% / ${byType[t].typed}%`);
  console.log("\nBy source (detected% / typed% | FP):");
  for (const s of SOURCE_KINDS) {
    const b = bySource[s];
    console.log(`  ${s.padEnd(14)} attacks=${String(b.attacks).padStart(3)} ${b.detected}% / ${b.typed}% | FP ${b.falsePositives}/${b.benign}  p50 ${b.p50}ms p95 ${b.p95}ms`);
  }
  const misses = attacks.filter((r) => !r.detected || !r.typeMatch);
  if (misses.length) {
    console.log(`\nMisses (${misses.length}):`);
    for (const m of misses.slice(0, 80)) console.log(`  ${m.id} ${m.type} ${m.source}/${m.carrier} fam=${m.family} -> ${m.decision} [${m.types.join(",")}] top=${m.top ? `${m.top.rule}:${m.top.conf}` : "-"}`);
  }
  const fps = benign.filter((r) => r.detected);
  if (fps.length) {
    console.log(`\nFalse positives (${fps.length}):`);
    for (const f of fps) console.log(`  ${f.id} ${f.source}/${f.carrier} -> ${f.decision} [${f.types.join(",")}] ${f.top ? `${f.top.rule}:${f.top.conf} "${f.top.quote}"` : ""}`);
  }
}

main()
  .then(async () => {
    await shutdownOcr();
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
