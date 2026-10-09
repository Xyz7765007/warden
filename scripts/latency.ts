// Server-side scan time on a live deployment (the response's stats.ms, so the network is not
// counted). Text samples five times each, sample files three times each, warm.
// Usage: npx tsx scripts/latency.ts [https://your-deployment] -> data/eval/latency.json

import fs from "node:fs";
import path from "node:path";
import { SAMPLES } from "../lib/samples";

const base = process.argv[2] || "https://warden-cyan-beta.vercel.app";
const q = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};

async function main() {
  const text: number[] = [];
  for (let round = 0; round < 5; round++)
    for (const s of SAMPLES.filter((x) => x.text && !x.file)) {
      const r = await fetch(`${base}/api/scan`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source: s.source, text: s.text, task: s.task, history: s.history, judge: "off" }) });
      text.push((await r.json()).stats.ms);
    }
  const files: Record<string, number[]> = {};
  const kinds: Record<string, string> = { ".pdf": "PDF", ".docx": "Word", ".eml": "Email", ".png": "Image (OCR)", ".html": "Web page" };
  for (const s of SAMPLES.filter((x) => x.file)) {
    const ext = path.extname(s.file!);
    for (let i = 0; i < 3; i++) {
      const fd = new FormData();
      fd.append("file", new Blob([fs.readFileSync(path.join("public", s.file!))]), path.basename(s.file!));
      fd.append("judge", "off");
      const r = await fetch(`${base}/api/scan`, { method: "POST", body: fd });
      (files[kinds[ext] ?? ext] ??= []).push((await r.json()).stats.ms);
    }
  }
  const out = {
    generatedAt: new Date().toISOString(),
    base,
    text: { n: text.length, p50: q(text, 0.5), p95: q(text, 0.95) },
    files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, { n: v.length, p50: q(v, 0.5), max: Math.max(...v) }])),
  };
  fs.writeFileSync("data/eval/latency.json", JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1));
}
main();
