"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowCounterClockwise, Brain, Lightning } from "@phosphor-icons/react";
import { runCore } from "@/lib/warden/core";
import { extractText } from "@/lib/warden/extract/text";
import { LinearClassifier, type ClassifierJson } from "@/lib/warden/classifier";
import { arrivedIn, makeAttempt, reseed, TECHNIQUES, type Attempt, type Seed } from "@/lib/redteam/mutators";
import { SAFE_SET } from "@/lib/redteam/benign";
import { learnFromMisses } from "@/lib/redteam/learn";
import { ATTACK_LABELS, LAYER_LABELS, type Layer, type SourceKind } from "@/lib/warden/types";
import { Button, Card, Chip, Segmented, Stat } from "./ui";

const ROUND = 40;

interface Row {
  a: Attempt;
  caught: boolean;
  layer?: Layer;
  round: number;
  retry?: boolean;
  afterLearning?: boolean;
}
interface RoundStat {
  n: number;
  caught: number;
  learned: boolean;
  retries: number;
  retriesCaught: number;
}
interface Report {
  trained: number;
  ms: number;
  recovered: number;
  total: number;
  faBefore: number;
  faAfter: number;
}

async function check(source: SourceKind, text: string, history: string[] | undefined, clf: LinearClassifier | null) {
  const ex = await extractText({ source, text });
  const r = await runCore({ source: ex.source, guessed: false, segments: ex.segments, toolFindings: ex.toolFindings, history, mode: "balanced", classifier: clf, judge: null, judgeMode: "off" });
  return { caught: r.decision !== "allow", layer: r.findings[0]?.layer as Layer | undefined };
}

async function falseAlarms(clf: LinearClassifier | null) {
  let n = 0;
  for (const s of SAFE_SET) if ((await check(s.source, s.text, undefined, clf)).caught) n++;
  return n;
}

const tick = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

export function RedTeam() {
  const [clf, setClf] = useState<LinearClassifier | null>(null);
  const base = useRef<ClassifierJson | null>(null);
  const [enabled, setEnabled] = useState<string[]>(Object.keys(TECHNIQUES));
  const [set, setSet] = useState<"all" | "known">("all");
  const [rows, setRows] = useState<Row[]>([]);
  const [rounds, setRounds] = useState<RoundStat[]>([]);
  const [busy, setBusy] = useState<"" | "attack" | "learn">("");
  const [report, setReport] = useState<Report | null>(null);
  const learnedSinceRound = useRef(false);

  useEffect(() => {
    import("@/data/model/classifier.json").then((m) => {
      base.current = m.default as unknown as ClassifierJson;
      setClf(LinearClassifier.fromJSON(base.current));
    });
  }, []);

  async function runRound() {
    if (!clf) return;
    setBusy("attack");
    setReport(null);
    const round = rounds.length + 1;
    const learned = learnedSinceRound.current;
    learnedSinceRound.current = false;
    reseed((Date.now() % 99991) + round);
    // The attacker adapts: it retries the attacks that got through before, in new disguises.
    const worked: Seed[] = [...new Set(rows.filter((r) => !r.caught || r.afterLearning).map((r) => r.a.seed))];
    let caught = 0;
    let retries = 0;
    let retriesCaught = 0;
    for (let i = 0; i < ROUND; i++) {
      const a = makeAttempt(round * 1000 + i, enabled, set === "all", worked);
      const retry = worked.includes(a.seed);
      const res = await check(a.source, a.text, a.history, clf);
      if (res.caught) caught++;
      if (retry) {
        retries++;
        if (res.caught) retriesCaught++;
      }
      setRows((r) => [{ a, caught: res.caught, layer: res.layer, round, retry }, ...r].slice(0, 400));
      await tick(40);
    }
    setRounds((r) => [...r, { n: ROUND, caught, learned, retries, retriesCaught }]);
    setBusy("");
  }

  const misses = rows.filter((r) => !r.caught && !r.afterLearning);

  async function learn() {
    if (!clf || !misses.length) return;
    setBusy("learn");
    await tick(30);
    const faBefore = await falseAlarms(clf);
    const ms = learnFromMisses(clf, misses.map((m) => m.a), Date.now() % 1000);
    let recovered = 0;
    const updated: Row[] = [];
    for (const m of misses) {
      const res = await check(m.a.source, m.a.text, m.a.history, clf);
      if (res.caught) recovered++;
      updated.push({ ...m, caught: res.caught, layer: res.layer, afterLearning: true });
    }
    const faAfter = await falseAlarms(clf);
    const ids = new Set(misses.map((m) => m.a.id));
    setRows((r) => r.map((x) => (ids.has(x.a.id) && !x.afterLearning ? updated.find((u) => u.a.id === x.a.id)! : x)));
    setReport({ trained: misses.length, ms, recovered, total: misses.length, faBefore, faAfter });
    learnedSinceRound.current = true;
    setBusy("");
  }

  function reset() {
    if (base.current) setClf(LinearClassifier.fromJSON(base.current));
    setRows([]);
    setRounds([]);
    setReport(null);
    learnedSinceRound.current = false;
  }

  const tried = rows.length;
  const caught = rows.filter((r) => r.caught && !r.afterLearning).length;
  const slipped = rows.filter((r) => !r.caught).length;
  const byTech = Object.keys(TECHNIQUES)
    .map((k) => {
      const xs = rows.filter((r) => r.a.techniques.includes(k));
      return { k, n: xs.length, c: xs.filter((r) => r.caught && !r.afterLearning).length };
    })
    .filter((x) => x.n > 0)
    .sort((a, b) => a.c / a.n - b.c / b.n);

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-4">
        <Card className="p-5">
          <h3 className="text-[15px] font-semibold">Attacker&apos;s tricks</h3>
          <p className="mt-1 text-[13px] leading-relaxed text-muted">Each attempt takes a known attack, disguises it with one or two of these, and plants it where agents really meet it: chat, email, a support ticket, a README or a web page.</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {Object.entries(TECHNIQUES).map(([k, t]) => {
              const on = enabled.includes(k);
              return (
                <button
                  key={k}
                  onClick={() => setEnabled((e) => (on ? e.filter((x) => x !== k) : [...e, k]))}
                  aria-pressed={on}
                  disabled={!!busy}
                  className={`rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors ${on ? "border-ink bg-ink text-white" : "border-line bg-surface text-muted hover:text-ink"}`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
          <div className="mt-4">
            <div className="mb-1.5 text-[12.5px] font-medium text-ink-2">Attacks to draw from</div>
            <Segmented
              ariaLabel="Attack set"
              size="sm"
              value={set}
              onChange={setSet}
              options={[
                { value: "all", label: "Known + new wordings" },
                { value: "known", label: "Known only" },
              ]}
            />
            <p className="mt-1.5 text-[12px] leading-relaxed text-faint">New wordings say the same thing in words no rule was written for, the way a fresh attack would.</p>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={runRound} disabled={!clf || !!busy || !enabled.length} data-testid="run-round">
              <Lightning size={16} weight="fill" />
              {busy === "attack" ? "Attacking" : rounds.length ? "Run another round" : `Run ${ROUND} attacks`}
            </Button>
            <Button variant="secondary" onClick={learn} disabled={!misses.length || !!busy} data-testid="learn">
              <Brain size={16} />
              {busy === "learn" ? "Learning" : misses.length ? `Learn from ${misses.length} miss${misses.length === 1 ? "" : "es"}` : "Learn from misses"}
            </Button>
            <Button variant="ghost" onClick={reset} disabled={!!busy || !rows.length}>
              <ArrowCounterClockwise size={16} />
              Reset
            </Button>
          </div>
          <p className="mt-3 text-[12px] leading-relaxed text-faint">Runs in your browser on the same engine as the API, with the LLM judge off, so it costs nothing.</p>
        </Card>

        {report ? (
          <Card className="border-safe-line p-5" data-testid="learn-report">
            <h3 className="text-[15px] font-semibold">Learned from {report.trained} miss{report.trained === 1 ? "" : "es"}</h3>
            <ul className="mt-2 flex flex-col gap-1.5 text-[13.5px] leading-relaxed text-ink-2">
              <li>Retrained the classifier in {report.ms} ms, here in your browser.</li>
              <li>
                Re-ran the misses: <b className="text-ink">{report.recovered} of {report.total}</b> now caught.
              </li>
              <li>
                False alarms on {SAFE_SET.length} safe messages, emails and web pages: <b className="text-ink">{report.faBefore} before, {report.faAfter} after</b>.
              </li>
            </ul>
            <p className="mt-2 text-[12px] text-faint">Run another round to see whether the lesson carries over to attacks it has not seen.</p>
          </Card>
        ) : null}

        {byTech.length ? (
          <Card className="p-5">
            <h3 className="text-[15px] font-semibold">Catch rate by trick</h3>
            <div className="mt-2 flex flex-col">
              {byTech.map((t) => (
                <div key={t.k} className="flex items-center justify-between border-b border-line py-1.5 text-[13px] last:border-0">
                  <span className="text-ink-2">{TECHNIQUES[t.k].label}</span>
                  <span className={`tabular-nums ${t.c < t.n ? "font-medium text-hold" : "text-ink"}`}>
                    {t.c}/{t.n}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <Card className="grid grid-cols-2 gap-6 p-5 sm:grid-cols-4" data-testid="rt-stats">
          <Stat value={String(tried)} label="Attacks tried" />
          <Stat value={String(caught)} label="Caught first time" />
          <Stat value={String(slipped)} label="Still slipping through" />
          <Stat value={tried ? `${Math.round((100 * caught) / tried)}%` : "0%"} label="First-time catch rate" />
        </Card>

        {rounds.length ? (
          <Card className="p-5" data-testid="rounds">
            <h3 className="text-[15px] font-semibold">Rounds</h3>
            <div className="mt-3 flex flex-col gap-2">
              {rounds.map((r, i) => {
                const pct = Math.round((100 * r.caught) / r.n);
                return (
                  <div key={i} className="grid grid-cols-[88px_minmax(0,1fr)_72px] items-center gap-3 text-[13px]">
                    <span className="text-ink-2">Round {i + 1}</span>
                    <div className="h-2.5 overflow-hidden rounded-full bg-sunken">
                      <div className="h-full rounded-full bg-safe" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-right tabular-nums text-ink">
                      {r.caught}/{r.n}
                    </span>
                    {r.retries ? (
                      <span className="col-start-2 -mt-1 text-[11.5px] leading-snug text-faint">
                        {r.retriesCaught} of {r.retries} retries of attacks that got through before were caught{r.learned ? ", after learning" : ""}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </Card>
        ) : null}

        <Card className="p-0">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <span className="text-[15px] font-semibold">Live feed</span>
            {rows.length ? <span className="text-[12px] text-faint">Newest first</span> : null}
          </div>
          {!rows.length ? (
            <p className="px-5 py-12 text-center text-[13.5px] text-muted">Run a round to watch the attacker try to get past Warden.</p>
          ) : (
            <ul className="scrollbar-thin max-h-[680px] divide-y divide-line overflow-auto" data-testid="feed">
              {rows.map((r) => (
                <li key={r.a.id} className="px-5 py-3" data-caught={r.caught}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Chip tone={r.caught ? "safe" : "threat"}>{r.caught ? (r.afterLearning ? "Caught after learning" : "Caught") : "Slipped through"}</Chip>
                    <Chip>{ATTACK_LABELS[r.a.seed.type].label}</Chip>
                    <Chip>{arrivedIn(r.a)}</Chip>
                    {r.a.seed.novel ? <Chip tone="hold">New wording</Chip> : null}
                    {r.retry ? <Chip>Retry</Chip> : null}
                    {r.a.techniques.map((t) => (
                      <Chip key={t}>{TECHNIQUES[t].label}</Chip>
                    ))}
                    {r.caught && r.layer ? <span className="ml-auto whitespace-nowrap text-[11.5px] text-faint">by {LAYER_LABELS[r.layer]?.toLowerCase() ?? r.layer}</span> : null}
                  </div>
                  <div className="mono mt-1.5 line-clamp-2 break-all text-[12px] leading-[1.55] text-muted">
                    {r.a.history ? [...r.a.history, r.a.text].join("  |  ") : (r.a.disguised ?? r.a.text).replace(/[\u{E0000}-\u{E007F}]+/gu, " [invisible text] ").replace(/[​-‏⁠﻿]/g, "·")}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
