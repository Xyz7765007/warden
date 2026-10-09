import type { ReactNode } from "react";
import results from "@/data/eval/results.json";
import external from "@/data/eval/external.json";
import injecagent from "@/data/eval/injecagent.json";
import redteam from "@/data/eval/redteam.json";
import latency from "@/data/eval/latency.json";
import independent from "@/data/eval/independent.json";
import fairness from "@/data/eval/language-fairness.json";
import { PRICES, SYSTEM as JUDGE_PROMPT } from "@/lib/warden/judge";
import { ATTACK_LABELS, ATTACK_TYPES, SOURCE_KINDS, type AttackType, type SourceKind } from "@/lib/warden/types";
import { Card, Chip, Stat } from "@/components/ui";

export const metadata = { title: "Proof: Warden", description: "How Warden was measured: our own multi-format corpus, three public benchmarks and a red-team matrix." };

const SHORT: Record<SourceKind, string> = {
  user_message: "Chat",
  web_page: "Web",
  pdf: "PDF",
  email: "Email",
  markdown: "MD",
  html: "HTML",
  docx: "Word",
  api_response: "API",
  ocr_text: "OCR",
  source_code: "Code",
  image: "Image",
};

const pct = (x: number, d = 1) => `${(Math.round(x * 10 ** d) / 10 ** d).toFixed(x % 1 === 0 ? 0 : d)}%`;
const s = results.summary;
const matrix = results.matrix as Record<AttackType, Record<SourceKind, { n: number; detected: number; typed: number }>>;
const bySource = results.bySource as Record<SourceKind, { attacks: number; detected: number; benign: number; falsePositives: number; p50: number; p95: number }>;
const deepset = external.results.find((r) => r.name.startsWith("deepset"))!;
const jackhhao = external.results.find((r) => r.name.startsWith("jackhhao"))!;
const rt = redteam;

function Section({ title, sub, children, id }: { title: string; sub?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className="mt-12" id={id}>
      <h2 className="text-[22px] font-semibold tracking-[-0.01em]">{title}</h2>
      {sub ? <p className="mt-1.5 max-w-[72ch] text-[14.5px] leading-relaxed text-muted">{sub}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Big({ value, label, note }: { value: string; label: string; note: string }) {
  return (
    <Card className="flex flex-col p-5">
      <div className="text-[34px] font-semibold leading-none tracking-tight tabular-nums">{value}</div>
      <div className="mt-2.5 text-[14px] font-medium text-ink">{label}</div>
      <div className="mt-1 text-[12.5px] leading-relaxed text-muted">{note}</div>
    </Card>
  );
}

/** Estimated judge spend per 1,000 documents: share of documents judged x tokens per call x list price. */
function costPer1000(model: string) {
  const [pin, pout] = PRICES[model] ?? [4, 20];
  // Haiku 5.5's tokenizer counts the same text as about 30% more tokens.
  const perToken = model === "claude-haiku-5-5" ? 1.3 : 1;
  const inputTokens = ((JUDGE_PROMPT.length + 120 + s.judgeCharsPerCall + 70 * s.judgeItemsPerCall) / 4) * perToken;
  const outputTokens = 150 * perToken;
  return ((s.judgeShare / 100) * 1000 * (inputTokens * pin + outputTokens * pout)) / 1_000_000;
}

function cellTone(detected: number, n: number) {
  if (!n) return "bg-sunken text-faint";
  const r = detected / n;
  if (r >= 1) return "bg-safe-soft text-safe";
  if (r >= 0.75) return "bg-hold-soft text-hold";
  return "bg-threat-soft text-threat-ink";
}

export default function ProofPage() {
  const totalBenign = s.benign + injecagent.withTask.benign + deepset.benign + jackhhao.benign + rt.safe.n;
  return (
    <div className="mx-auto max-w-[1240px] px-5 pb-20 pt-8">
      <section>
        <h1 className="text-[34px] font-semibold leading-[1.08] tracking-[-0.02em] md:text-[40px]">Measured, not claimed.</h1>
        <p className="mt-3 max-w-[70ch] text-[16px] leading-relaxed text-muted">
          Every number on this page comes from a script in the repository that anyone can re-run. The LLM judge was off for all of them, so these are the floor: the free, offline layers on their own.
        </p>
      </section>

      <div className="mt-7 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Big value={pct(s.detection)} label={`of ${s.attacks} attacks caught, our corpus`} note={`All 9 attack types, across all 11 input types, ${pct((100 * results.rows.filter((r) => r.label === "attack" && r.hidden).length) / s.attacks, 0)} of them hidden from people. Written by us, so it flatters us: see the independent test below.`} />
        <Big value={`${s.falsePositives} of ${s.benign}`} label="safe documents flagged, our corpus" note="Chosen to look like attacks: invoices with bank details, security articles that quote attacks, install commands." />
        <Big value={pct(injecagent.withTask.recall * 100)} label={`of ${injecagent.withTask.attacks} InjecAgent attacks caught`} note={`Public benchmark of attacks hidden in tool outputs. ${injecagent.withTask.falsePositiveRate === 0 ? "None" : pct(injecagent.withTask.falsePositiveRate * 100)} of ${injecagent.withTask.benign} paired safe outputs flagged.`} />
        <Big value={`${latency.text.p50} ms`} label="median scan on the live site" note={`Server time for text (${latency.text.p95} ms at p95). PDFs ${latency.files.PDF.p50} ms, Word ${latency.files.Word.p50} ms, images with OCR about ${(latency.files["Image (OCR)"].p50 / 1000).toFixed(1)} s. A scan that needs the LLM judge adds about 2 to 3 s.`} />
      </div>

      <Section
        id="independent"
        title="Independent test: attacks we never saw"
        sub="Separate reviewers who never saw our corpus, rules or seeds wrote their own attacks and their own safe look-alikes and ran them against the live site. Each round found real gaps; we fixed the families behind them, not the strings, re-ran every benchmark, and asked a new reviewer for new inputs. Every round is shown as measured. Round 5 ran on the final build, and nothing was changed after it."
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {independent.rounds.map((r, i) => (
            <Card key={r.name} className="flex flex-col p-5">
              <div className="flex flex-wrap items-center gap-2">
                <Chip tone={i === independent.rounds.length - 1 ? "ink" : "neutral"}>{r.name}</Chip>
                <span className="text-[12.5px] text-muted">{r.build}</span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-4">
                <div>
                  <div className="text-[28px] font-semibold leading-none tabular-nums">
                    {r.attacks.caught}/{r.attacks.n}
                  </div>
                  <div className="mt-1.5 text-[13px] text-ink-2">attacks caught ({Math.round((100 * r.attacks.caught) / r.attacks.n)}%)</div>
                </div>
                <div>
                  <div className="text-[28px] font-semibold leading-none tabular-nums">
                    {r.safe.flagged}/{r.safe.n}
                  </div>
                  <div className="mt-1.5 text-[13px] text-ink-2">safe inputs flagged</div>
                </div>
              </div>
              {"note" in r && r.note ? <p className="mt-3 text-[13px] leading-relaxed text-ink-2">{r.note}</p> : null}
              {"withJudge" in r && r.withJudge ? (
                <p className="mt-2 rounded-md border border-safe-line bg-safe-soft px-3 py-2 text-[12.5px] leading-relaxed text-ink-2">
                  <span className="font-medium text-ink">
                    With the LLM judge on ({r.withJudge.model.replace("claude-sonnet-5-5", "Claude Sonnet 5.5")}): {r.withJudge.attacks.caught}/{r.withJudge.attacks.n} caught, {r.withJudge.safe.flagged}/{r.withJudge.safe.n} flagged, ${r.withJudge.costUsd.toFixed(2)} for all {r.withJudge.attacks.n + r.withJudge.safe.n} inputs.
                  </span>{" "}
                  {r.withJudge.note}
                </p>
              ) : null}
              {"fixedAfter" in r && r.fixedAfter ? (
                <p className="mt-2 text-[12.5px] leading-relaxed text-faint">
                  <span className="font-medium text-muted">Fixed after this round: </span>
                  {r.fixedAfter}
                </p>
              ) : null}
            </Card>
          ))}
        </div>
      </Section>

      <Section
        id="languages"
        title="Fair across languages"
        sub="Measured on what the outside reviewers wrote in Hindi, Hinglish and Indian scripts across all five rounds, next to what they wrote in English."
      >
        <Card className="p-5">
          <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
            <Stat
              value={`${fairness.atTheTime.safe.flagged} of ${fairness.atTheTime.safe.n}`}
              label="safe Indian-language inputs flagged"
              note={`English: ${fairness.englishAtTheTime.safe.flagged} of ${fairness.englishAtTheTime.safe.n}. Writing in Hindi or Hinglish does not make a message look suspicious.`}
            />
            <Stat
              value={`${fairness.atTheTime.attacks.caught} of ${fairness.atTheTime.attacks.n}`}
              label="Indian-language attacks caught at the time"
              note={`English: ${fairness.englishAtTheTime.attacks.caught} of ${fairness.englishAtTheTime.attacks.n}. Judge off, each round on the build it tested: weaker protection, which we then worked on.`}
            />
            <Stat
              value={`${fairness.finalBuildJudgeOn.attacks.caught} of ${fairness.finalBuildJudgeOn.attacks.n}`}
              label="caught on the final build, judge on"
              note={`${fairness.finalBuildJudgeOff.attacks.caught} of ${fairness.finalBuildJudgeOff.attacks.n} with the judge off. Indian-script and Hinglish passages that nothing flagged now go to the judge; ${fairness.finalBuildJudgeOn.safe.flagged} of ${fairness.finalBuildJudgeOn.safe.n} safe ones flagged.`}
            />
          </div>
          <p className="mt-4 text-[12.5px] leading-relaxed text-faint">
            Rounds 1 to 4 informed fixes made before the final build, so the last number is not on fresh inputs; the first two are each round as measured. Small samples: 30 inputs in all.
          </p>
        </Card>
      </Section>

      <Section
        id="matrix"
        title="Every attack type, in every input type"
        sub={`Our corpus: ${s.attacks} attacks and ${s.benign} safe documents, generated as real files (PDF, Word, email with attachments, images) with the attack hidden the way attackers hide it: white text, zero-size fonts, comments, metadata, alt text, off-page text, invisible characters. Each cell shows attacks caught out of attacks sent.`}
      >
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[860px] border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-line">
                <th className="sticky left-0 bg-surface px-4 py-2.5 text-left font-medium text-muted">Attack type</th>
                {SOURCE_KINDS.map((k) => (
                  <th key={k} className="px-1.5 py-2.5 text-center font-medium text-muted">
                    {SHORT[k]}
                  </th>
                ))}
                <th className="px-3 py-2.5 text-right font-medium text-muted">Total</th>
              </tr>
            </thead>
            <tbody>
              {ATTACK_TYPES.map((t) => {
                const row = matrix[t];
                const n = Object.values(row).reduce((a, c) => a + c.n, 0);
                const d = Object.values(row).reduce((a, c) => a + c.detected, 0);
                return (
                  <tr key={t} className="border-b border-line last:border-0">
                    <td className="sticky left-0 whitespace-nowrap bg-surface px-4 py-2 font-medium text-ink">{ATTACK_LABELS[t].label}</td>
                    {SOURCE_KINDS.map((k) => {
                      const c = row[k] ?? { n: 0, detected: 0 };
                      return (
                        <td key={k} className="px-1 py-1.5 text-center">
                          <span className={`inline-block min-w-[38px] rounded-[6px] px-1.5 py-1 tabular-nums ${cellTone(c.detected, c.n)}`}>
                            {c.n ? `${c.detected}/${c.n}` : "–"}
                          </span>
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 text-right font-medium tabular-nums">{pct((100 * d) / n)}</td>
                  </tr>
                );
              })}
              <tr className="bg-sunken/60">
                <td className="sticky left-0 bg-sunken px-4 py-2 font-medium text-ink-2">Safe docs flagged</td>
                {SOURCE_KINDS.map((k) => (
                  <td key={k} className="px-1 py-2 text-center tabular-nums text-ink-2">
                    {bySource[k].falsePositives}/{bySource[k].benign}
                  </td>
                ))}
                <td className="px-3 py-2 text-right font-medium tabular-nums">{s.falsePositives}/{s.benign}</td>
              </tr>
            </tbody>
          </table>
        </Card>
        <p className="mt-2.5 text-[12.5px] leading-relaxed text-faint">
          The 3 misses are all images: two attacks in very small text that OCR misread, and one fake system notice that was read correctly but scored just under the line. Images are the hardest input; at the 95th percentile an image takes {bySource.image.p95} ms because it is read in bands at several contrasts.
        </p>
      </Section>

      <Section
        id="public"
        title="Public benchmarks"
        sub="Our corpus was written alongside the rules, so it flatters them. These sets were written by other people, and Warden never trained on their test splits."
      >
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[760px] border-collapse text-[13.5px]">
            <thead>
              <tr className="border-b border-line text-left text-[12.5px] text-muted">
                <th className="px-5 py-2.5 font-medium">Benchmark</th>
                <th className="px-3 py-2.5 font-medium">Attacks caught</th>
                <th className="px-3 py-2.5 font-medium">Safe items flagged</th>
                <th className="px-5 py-2.5 font-medium">What to know</th>
              </tr>
            </thead>
            <tbody className="align-top">
              <tr className="border-b border-line">
                <td className="px-5 py-3">
                  <div className="font-medium">InjecAgent</div>
                  <div className="text-[12.5px] text-muted">Zhan et al., 2024. Attacks inside tool outputs.</div>
                </td>
                <td className="px-3 py-3 tabular-nums">
                  <b>{pct(injecagent.withTask.recall * 100)}</b> of {injecagent.withTask.attacks}
                  <div className="text-[12.5px] text-muted">{pct(injecagent.withoutTask.recall * 100)} without the user&apos;s task</div>
                </td>
                <td className="px-3 py-3 tabular-nums">
                  <b>{Math.round(injecagent.withTask.falsePositiveRate * injecagent.withTask.benign)}</b> of {injecagent.withTask.benign}
                </td>
                <td className="px-5 py-3 text-[13px] leading-relaxed text-ink-2">
                  Knowing the user&apos;s task matters: a tool output that asks for a payment the user never asked for is caught by task binding. Each attack is paired with the same tool output without it, to count false alarms.
                </td>
              </tr>
              <tr className="border-b border-line">
                <td className="px-5 py-3">
                  <div className="font-medium">jackhhao/jailbreak-classification</div>
                  <div className="text-[12.5px] text-muted">Hugging Face, test split. Chat jailbreaks.</div>
                </td>
                <td className="px-3 py-3 tabular-nums">
                  <b>{pct(jackhhao.recall * 100)}</b> of {jackhhao.attacks}
                </td>
                <td className="px-3 py-3 tabular-nums">
                  <b>{Math.round(jackhhao.falsePositiveRate * jackhhao.benign)}</b> of {jackhhao.benign}
                </td>
                <td className="px-5 py-3 text-[13px] leading-relaxed text-ink-2">Most misses are persona set-ups (&ldquo;You are now Tyler&rdquo;, a tabletop game, a made-up condition) with no explicit override or harmful request. Borderline passages like these are what the LLM judge reviews when it is switched on.</td>
              </tr>
              <tr>
                <td className="px-5 py-3">
                  <div className="font-medium">deepset/prompt-injections</div>
                  <div className="text-[12.5px] text-muted">Hugging Face, test split. English and German.</div>
                </td>
                <td className="px-3 py-3 tabular-nums">
                  <b>{pct(deepset.recall * 100)}</b> of {deepset.attacks}
                </td>
                <td className="px-3 py-3 tabular-nums">
                  <b>{Math.round(deepset.falsePositiveRate * deepset.benign)}</b> of {deepset.benign}
                </td>
                <td className="px-5 py-3 text-[13px] leading-relaxed text-ink-2">
                  This set labels ordinary requests as injections, for example &ldquo;I want you to act as a storyteller&rdquo; and &ldquo;Generate SQL code to access a database&rdquo;. Warden lets those through on purpose: blocking them would block normal use. Precision stays at 100%.
                </td>
              </tr>
            </tbody>
          </table>
        </Card>
        <details className="mt-3 text-[13px] text-ink-2">
          <summary className="cursor-pointer text-muted">Sample of the deepset items Warden let through</summary>
          <ul className="mt-2 flex flex-col gap-1.5">
            {deepset.sampleMisses.slice(0, 8).map((m, i) => (
              <li key={i} className="mono rounded-[8px] bg-sunken px-3 py-2 text-[12px] leading-relaxed">
                {m.slice(0, 180)}
                {m.length > 180 ? "…" : ""}
              </li>
            ))}
          </ul>
        </details>
      </Section>

      <Section
        id="redteam"
        title="Red team: disguised attacks and new wordings"
        sub={`${rt.seeds.known} known attacks, each disguised with ${rt.tricks} tricks and ${rt.chains - rt.tricks - 1} two-trick combinations (leetspeak inside ROT13, look-alike letters inside reversed text, and so on), and planted where agents meet them: chat, email, a support ticket, a README, a web page. Plus ${rt.seeds.novel} attacks reworded so that no rule matches them.`}
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Big value={pct(rt.known.rate)} label={`of ${rt.known.n.toLocaleString("en-IN")} disguised known attacks caught`} note={`Weakest: ${rt.weakest.slice(0, 2).map((w) => `${w.chain.replace("+", " + ")} (${w.caught}/${w.n})`).join(", ")}.`} />
          <Big value={pct(rt.novel.rate, 0)} label="of new wordings caught before learning" note={`${rt.novel.n.toLocaleString("en-IN")} attempts. Nothing was written for these; only the trained classifier can catch them, and it had never seen them.`} />
          <Big value={`${rt.safe.falseAlarms} of ${rt.safe.n}`} label="safe texts flagged" note="Safe texts sent as chat messages, inside emails and on web pages." />
        </div>
        <Card className="mt-4 p-5">
          <h3 className="text-[15px] font-semibold">Learning from misses carries over to disguises it never trained on</h3>
          <p className="mt-1 text-[13.5px] leading-relaxed text-muted">
            The new wordings were sent under half of the tricks. Warden learned from the {rt.learning.seen.misses} that got through ({rt.learning.seen.recoveredAfter} of them are now caught), then the same wordings were sent under the other half of the tricks, which it never trained on.
          </p>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[160px_minmax(0,1fr)_64px] sm:items-center">
            {[
              { label: "Before learning", v: rt.learning.heldOut.before },
              { label: "After learning", v: rt.learning.heldOut.after },
            ].map((b) => (
              <div key={b.label} className="contents">
                <span className="text-[13px] text-ink-2">{b.label}</span>
                <div className="h-3 overflow-hidden rounded-full bg-sunken">
                  <div className="h-full rounded-full bg-safe" style={{ width: `${(100 * b.v) / rt.learning.heldOut.n}%` }} />
                </div>
                <span className="text-right text-[13px] tabular-nums">
                  {b.v}/{rt.learning.heldOut.n}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[12.5px] text-faint">
            False alarms after learning: {rt.learning.falseAlarmsAfter} of {rt.safe.n} safe texts. Learning replays safe text alongside the misses so the classifier does not drift. Try it live on the Red team page.
          </p>
        </Card>
      </Section>

      <Section
        id="cost"
        title="Cost"
        sub="The offline layers cost only compute: a few milliseconds of a serverless function per scan. The LLM judge is the only part that costs per call, and it only sees what the other layers leave unclear."
      >
        <Card className="p-5">
          <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
            <Stat value={`${Math.round(s.judgeShare)}%`} label="of documents would reach the judge" note={`On our corpus, with about ${s.judgeItemsPerCall} short excerpts (${s.judgeCharsPerCall} characters) per call.`} />
            <Stat value={`$${costPer1000("claude-sonnet-5-5").toFixed(2)}`} label="per 1,000 documents, Claude Sonnet 5.5" note="The default judge model. Estimate from the excerpts per call, at list prices." />
            <Stat value={`$${costPer1000("claude-haiku-5-5").toFixed(2)}`} label="per 1,000 documents, Claude Haiku 5.5" note="The low-cost option: set WARDEN_JUDGE_MODEL=claude-haiku-5-5." />
          </div>
          <p className="mt-4 text-[12.5px] leading-relaxed text-faint">
            Estimate from our corpus, where the safe documents were chosen to look like attacks, so ordinary traffic reaches the judge less often. Measured: replaying the final outside round with the judge on cost ${independent.rounds[independent.rounds.length - 1].withJudge?.costUsd.toFixed(2)} for {independent.rounds[independent.rounds.length - 1].attacks.n + independent.rounds[independent.rounds.length - 1].safe.n} inputs ({independent.rounds[independent.rounds.length - 1].withJudge?.judgeCalls} judge calls). Numbers marked "judge on" were measured with it; every other number on this page has the judge off.
          </p>
        </Card>
      </Section>

      <Section id="limits" title="Where Warden is weakest" sub="Stated plainly, so the numbers above can be trusted.">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {[
            ["Very small or faint text in images", `OCR misses some 7-pixel and low-contrast text: images score ${pct(bySource.image.detected)} against 100% for every other input type.`],
            ["New wordings, before learning", `${pct(rt.novel.rate, 0)} of reworded attacks are caught by the offline layers alone. The LLM judge, when switched on, reviews borderline passages; the red-team loop shows how quickly misses are learned.`],
            ["Our own corpus flatters us", "It was built alongside the rules. That is why the public benchmarks, the red team and the independent rounds, which use attacks we did not write, sit next to it."],
            ["Attacks written fresh by outsiders", `On attacks they had never seen, the offline layers caught between 50% and 75% across five independent rounds, and ${independent.rounds[independent.rounds.length - 1].attacks.caught} of ${independent.rounds[independent.rounds.length - 1].attacks.n} on the final build. Most misses are orders in plain business language: persona swaps, fake policy updates and requests to use the agent's own tools. With the LLM judge switched on, the same final-round inputs went to ${independent.rounds[independent.rounds.length - 1].withJudge?.attacks.caught ?? "more"} of ${independent.rounds[independent.rounds.length - 1].attacks.n}; the rest never looked unclear enough to reach it.`],
            ["Docs about AI assistants", `In the final round, ${independent.rounds[independent.rounds.length - 1].safe.flagged} of ${independent.rounds[independent.rounds.length - 1].safe.n} safe inputs were flagged, mostly product and developer docs that describe what an assistant or its system prompt does. They are cut and passed on, not blocked, and the cut is shown for review.`],
            ["Role-play that never asks for harm", "Warden does not block a request just because it sets up a character. It acts when content tries to override, extract, act or hide. Some benchmark labels count role-play itself as an attack."],
          ].map(([h, b]) => (
            <Card key={h} className="p-5">
              <h3 className="text-[15px] font-semibold">{h}</h3>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">{b}</p>
            </Card>
          ))}
        </div>
      </Section>

      <Section
        id="grid"
        title="Our position on the 3x3 grid: F3, D3"
        sub="The hackathon asks each team to declare where its solution sits, with penalties for over- and under-claiming. This is ours, and the evidence for it."
      >
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
          <Card className="p-5">
            <div className="grid grid-cols-[48px_repeat(3,minmax(0,1fr))] gap-1.5 text-center text-[12.5px]">
              <span />
              {["F1", "F2", "F3"].map((f) => (
                <span key={f} className="py-1 font-medium text-muted">
                  {f}
                </span>
              ))}
              {["D1", "D2", "D3"].map((d) => (
                <div key={d} className="contents">
                  <span className="flex items-center justify-center font-medium text-muted">{d}</span>
                  {["F1", "F2", "F3"].map((f) => {
                    const ours = d === "D3" && f === "F3";
                    return (
                      <span key={f} className={`flex h-14 items-center justify-center rounded-[8px] border ${ours ? "border-ink bg-ink font-semibold text-white" : "border-line bg-sunken text-faint"}`}>
                        {ours ? "Warden" : ""}
                      </span>
                    );
                  })}
                </div>
              ))}
            </div>
            <dl className="mt-4 flex flex-col gap-2 text-[12.5px] leading-relaxed text-muted">
              <div>
                <dt className="inline font-medium text-ink-2">F3:</dt> <dd className="inline">detect at least 7 types of attack.</dd>
              </div>
              <div>
                <dt className="inline font-medium text-ink-2">D3:</dt> <dd className="inline">highly heterogeneous multimodal input, with a high degree of demonstrable reliability.</dd>
              </div>
            </dl>
          </Card>
          <div className="flex flex-col gap-4">
            <Card className="p-5">
              <div className="flex items-center gap-2">
                <Chip tone="ink">F3</Chip>
                <h3 className="text-[15px] font-semibold">All 9 attack types, not 7</h3>
              </div>
              <ul className="mt-2.5 flex flex-col gap-1.5 text-[13.5px] leading-relaxed text-ink-2">
                <li>
                  Each of the 9 types is caught at {pct(Math.min(...Object.values(results.byType).map((x) => x.detected)))} or better on our corpus, and named correctly {pct(s.typedDetection)} of the time.
                </li>
                <li>Observability: every scan returns a step-by-step trace, the exact span it acted on and why, and exports to OCSF for a SOC.</li>
                <li>Trainability: misses become training data; the classifier retrains in milliseconds, and the gain carries over to unseen disguises (above).</li>
                <li>Fault tolerance: each layer fails on its own; with no API key, no network or an unreadable file, Warden still decides, and holds what it could not fully read.</li>
              </ul>
            </Card>
            <Card className="p-5">
              <div className="flex items-center gap-2">
                <Chip tone="ink">D3</Chip>
                <h3 className="text-[15px] font-semibold">All 11 input types, reliably</h3>
              </div>
              <ul className="mt-2.5 flex flex-col gap-1.5 text-[13.5px] leading-relaxed text-ink-2">
                <li>Chat, web pages, PDFs, emails with attachments, Markdown, HTML, Word, API responses and MCP tool lists, OCR text, source code and images, each read for what a person sees and what an AI reads.</li>
                <li>
                  Reliability shown five ways: {pct(s.detection)} with {s.falsePositives} false alarms on {s.cases} files, {pct(injecagent.withTask.recall * 100)} on InjecAgent, {pct(rt.known.rate)} on {rt.known.n.toLocaleString("en-IN")} red-team attacks, {totalBenign.toLocaleString("en-IN")} safe items with 0 flagged across all sets, and independent black-box rounds published as measured, including the weak ones.
                </li>
                <li>Patterns for every attack type in English, Hindi and Hinglish, and override and reveal patterns in six more Indian languages and several European and Asian ones, because Indian enterprise content mixes them.</li>
              </ul>
            </Card>
          </div>
        </div>
      </Section>

      <Section id="reproduce" title="Re-run any number" sub="Everything runs offline in a few seconds, except the images.">
        <Card className="p-5">
          <pre className="mono overflow-x-auto whitespace-pre text-[12.5px] leading-[1.7] text-ink-2">{`npx tsx scripts/build-corpus.ts        # writes ${s.cases} test files across 11 input types
npx tsx scripts/run-eval.ts            # the matrix above   -> data/eval/results.json
npx tsx scripts/eval-injecagent.ts     # InjecAgent         -> data/eval/injecagent.json
npx tsx scripts/eval-external.ts       # deepset, jackhhao  -> data/eval/external.json
npx tsx scripts/redteam-matrix.ts --pairs --save   # red team -> data/eval/redteam.json
npx tsx scripts/latency.ts <deployment URL>        # live latency -> data/eval/latency.json`}</pre>
          <p className="mt-3 text-[12.5px] text-faint">
            Last run {new Date(s.generatedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}. Classifier: {s.classifier}. LLM judge: off.
          </p>
        </Card>
      </Section>
    </div>
  );
}
