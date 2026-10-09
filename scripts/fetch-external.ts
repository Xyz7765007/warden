// Downloads two public prompt-injection datasets (train and test splits) for training the
// classifier and for an outside benchmark. Run once: npx tsx scripts/fetch-external.ts
import fs from "node:fs";
import path from "node:path";

const OUT = path.join(process.cwd(), "data", "external");
fs.mkdirSync(OUT, { recursive: true });

async function rows(dataset: string, config: string, split: string) {
  const out: any[] = [];
  for (let offset = 0; ; offset += 100) {
    const url = `https://datasets-server.huggingface.co/rows?dataset=${encodeURIComponent(dataset)}&config=${config}&split=${split}&offset=${offset}&length=100`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${dataset}/${split} ${r.status}`);
    const j: any = await r.json();
    out.push(...j.rows.map((x: any) => x.row));
    if (j.rows.length < 100) break;
  }
  return out;
}

async function main() {
  for (const split of ["train", "test"]) {
    const d = await rows("deepset/prompt-injections", "default", split);
    fs.writeFileSync(path.join(OUT, `deepset-${split}.json`), JSON.stringify(d.map((x) => ({ text: x.text, label: x.label }))));
    console.log(`deepset ${split}: ${d.length}`);
    const j = await rows("jackhhao/jailbreak-classification", "default", split);
    fs.writeFileSync(path.join(OUT, `jackhhao-${split}.json`), JSON.stringify(j.map((x) => ({ text: x.prompt, label: x.type === "jailbreak" ? 1 : 0 }))));
    console.log(`jackhhao ${split}: ${j.length}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
