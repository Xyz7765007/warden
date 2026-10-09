// The red-team matrix: every seed attack x every trick (and word trick x wrapper pairs), several
// random draws each, through the same engine the red-team page uses. Known attacks and novel
// wordings are reported apart. Safe texts are checked as chat, email and web page.
// Usage: npx tsx scripts/redteam-matrix.ts [--draws 2] [--pairs] [--save]

import { readFileSync, writeFileSync } from "node:fs";
import { runCore } from "../lib/warden/core";
import { extractText } from "../lib/warden/extract/text";
import { LinearClassifier } from "../lib/warden/classifier";
import { SEEDS, TECHNIQUES, WORD_TRICKS, WRAPPERS, buildAttempt, reseed, type Attempt } from "../lib/redteam/mutators";
import { SAFE_SET } from "../lib/redteam/benign";
import { learnFromMisses } from "../lib/redteam/learn";
import type { SourceKind } from "../lib/warden/types";

const args = process.argv.slice(2);
const draws = Number(args[args.indexOf("--draws") + 1] || 2) || 2;
const pairs = args.includes("--pairs");
const shipped = () => LinearClassifier.fromJSON(JSON.parse(readFileSync("data/model/classifier.json", "utf8")));
let clf: LinearClassifier | null = args.includes("--no-classifier") ? null : shipped();

async function decide(source: SourceKind, text: string, history?: string[]) {
  const ex = await extractText({ source, text });
  const r = await runCore({ source: ex.source, guessed: false, segments: ex.segments, toolFindings: ex.toolFindings, history, mode: "balanced", classifier: clf, judge: null, judgeMode: "off" });
  return r.decision;
}

async function main() {
  const t0 = Date.now();
  const chains: string[][] = [[]];
  for (const t of Object.keys(TECHNIQUES)) chains.push([t]);
  if (pairs) for (const w of WORD_TRICKS) for (const x of WRAPPERS) chains.push([w, x]);

  const tally = { known: { n: 0, caught: 0 }, novel: { n: 0, caught: 0 } };
  const misses: Array<{ seed: number; chain: string; text: string }> = [];
  const byTech: Record<string, [number, number]> = {};
  let id = 0;
  for (const chain of chains) {
    for (let s = 0; s < SEEDS.length; s++) {
      for (let d = 0; d < (chain.length ? draws : 1); d++) {
        reseed(1 + s * 97 + d * 7919 + chain.join("").length * 31);
        const a: Attempt = buildAttempt(id++, SEEDS[s], chain);
        const ok = (await decide(a.source, a.text, a.history)) !== "allow";
        const bucket = SEEDS[s].novel ? tally.novel : tally.known;
        bucket.n++;
        if (ok) bucket.caught++;
        if (!SEEDS[s].novel) {
          const key = chain.join("+") || "(plain)";
          byTech[key] ??= [0, 0];
          byTech[key][1]++;
          if (ok) byTech[key][0]++;
          else misses.push({ seed: s, chain: key, text: (a.history ? a.history.join(" | ") + " | " : "") + a.text.replace(/[\u{E0000}-\u{E007F}]+/gu, "⟦tags⟧").slice(0, 220) });
        }
      }
    }
  }
  let fa = 0;
  const faList: string[] = [];
  for (const x of SAFE_SET) {
    const dcs = await decide(x.source, x.text);
    if (dcs !== "allow") {
      fa++;
      faList.push(`${dcs} (${x.where}): ${x.text.slice(0, 120)}`);
    }
  }
  const pct = (b: { n: number; caught: number }) => +((100 * b.caught) / Math.max(1, b.n)).toFixed(1);

  // Learning experiment: novel wordings under half the tricks are the "seen" round; the misses
  // are learned (as the page does), then the same wordings under the other half of the tricks
  // (disguises never trained on) are checked before and after.
  const novel = SEEDS.map((x, i) => [x, i] as const).filter(([x]) => x.novel);
  const all = [[], ...Object.keys(TECHNIQUES).map((t) => [t])] as string[][];
  const seenTricks = all.filter((_, i) => i % 2 === 0);
  const heldOut = all.filter((_, i) => i % 2 === 1);
  const runSet = async (tricks: string[][], c: LinearClassifier | null) => {
    const out: Array<{ a: Attempt; ok: boolean }> = [];
    for (const chain of tricks)
      for (const [seed, si] of novel) {
        reseed(5 + si * 131 + chain.join("").length * 17);
        const a = buildAttempt(id++, seed, chain);
        clf = c;
        out.push({ a, ok: (await decide(a.source, a.text, a.history)) !== "allow" });
      }
    return out;
  };
  const base = shipped();
  const seenRound = await runSet(seenTricks, base);
  const heldBefore = await runSet(heldOut, base);
  const learner = shipped();
  const missesSeen = seenRound.filter((x) => !x.ok);
  learnFromMisses(learner, missesSeen.map((x) => x.a));
  const recovered = (await runSet(seenTricks, learner)).filter((x, i) => !seenRound[i].ok && x.ok).length;
  const heldAfter = await runSet(heldOut, learner);
  clf = learner;
  let faLearned = 0;
  for (const x of SAFE_SET) if ((await decide(x.source, x.text)) !== "allow") faLearned++;
  const learning = {
    seen: { n: seenRound.length, caught: seenRound.filter((x) => x.ok).length, misses: missesSeen.length, recoveredAfter: recovered },
    heldOut: { n: heldBefore.length, before: heldBefore.filter((x) => x.ok).length, after: heldAfter.filter((x) => x.ok).length },
    falseAlarmsAfter: faLearned,
  };
  console.log(`learning: seen round ${learning.seen.caught}/${learning.seen.n}, learned ${learning.seen.misses} misses, ${recovered} now caught`);
  console.log(`learning: held-out disguises ${learning.heldOut.before}/${learning.heldOut.n} before -> ${learning.heldOut.after}/${learning.heldOut.n} after; false alarms after ${faLearned}/${SAFE_SET.length}`);
  console.log(`known attacks: caught ${tally.known.caught}/${tally.known.n} (${pct(tally.known)}%)`);
  console.log(`novel wordings: caught ${tally.novel.caught}/${tally.novel.n} (${pct(tally.novel)}%)`);
  console.log(`false alarms: ${fa}/${SAFE_SET.length}`);
  for (const [k, [c, n]] of Object.entries(byTech).filter(([, [c, n]]) => c < n).sort((a, b) => a[1][0] / a[1][1] - b[1][0] / b[1][1]).slice(0, 15)) console.log(`  ${k.padEnd(28)} ${c}/${n}`);
  if (faList.length) console.log("false alarms:\n  " + faList.join("\n  "));
  writeFileSync("/tmp/claude-501/rt-misses.json", JSON.stringify(misses, null, 1));
  if (args.includes("--save")) {
    writeFileSync(
      "data/eval/redteam.json",
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          classifier: clf ? "warden-linear-v1" : "off",
          judge: "off",
          seeds: { known: SEEDS.filter((x) => !x.novel).length, novel: SEEDS.filter((x) => x.novel).length },
          tricks: Object.keys(TECHNIQUES).length,
          chains: chains.length,
          known: { ...tally.known, rate: pct(tally.known) },
          novel: { ...tally.novel, rate: pct(tally.novel) },
          safe: { n: SAFE_SET.length, falseAlarms: fa },
          learning,
          weakest: Object.entries(byTech).filter(([, [c, n]]) => c < n).sort((a, b) => a[1][0] / a[1][1] - b[1][0] / b[1][1]).slice(0, 6).map(([k, [c, n]]) => ({ chain: k, caught: c, n })),
          wallSeconds: Math.round((Date.now() - t0) / 1000),
        },
        null,
        1
      )
    );
    console.log("saved data/eval/redteam.json");
  }
}
main().then(() => process.exit(0));
