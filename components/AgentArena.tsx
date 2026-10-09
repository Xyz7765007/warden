"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, ShieldCheck, ShieldWarning, Wrench, Prohibit, ChatText, CheckCircle, XCircle, Pause } from "@phosphor-icons/react";
import { SCENARIOS } from "@/lib/agent/scenarios";
import type { Run, Step } from "@/lib/agent/reference";
import { Button, Card, Chip, Segmented } from "./ui";

interface Both {
  mode: "reference" | "live";
  without: Run & { costUsd?: number; model?: string };
  with: Run & { costUsd?: number; model?: string };
}

export function AgentArena() {
  const [id, setId] = useState(SCENARIOS[0].id);
  const [mode, setMode] = useState<"reference" | "live">("reference");
  const [liveOn, setLiveOn] = useState(false);
  const [data, setData] = useState<Both | null>(null);
  const [shown, setShown] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const s = SCENARIOS.find((x) => x.id === id)!;

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((h) => setLiveOn(h?.layers?.llmJudge === "on"))
      .catch(() => setLiveOn(false));
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  async function run() {
    setLoading(true);
    setError(null);
    setData(null);
    setShown(0);
    if (timer.current) clearInterval(timer.current);
    try {
      const r = await fetch("/api/agent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scenario: id, mode }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "The run failed");
      setData(j);
      const total = Math.max(j.without.steps.length, j.with.steps.length) + 1;
      let i = 0;
      timer.current = setInterval(() => {
        i++;
        setShown(i);
        if (i >= total && timer.current) clearInterval(timer.current);
      }, 520);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const total = data ? Math.max(data.without.steps.length, data.with.steps.length) + 1 : 0;
  const finished = data && shown >= total;

  return (
    <div className="flex flex-col gap-5">
      <div className="scrollbar-thin -mx-5 flex gap-3 overflow-x-auto px-5 pb-1" role="tablist" aria-label="Scenarios">
        {SCENARIOS.map((x) => (
          <button
            key={x.id}
            role="tab"
            aria-selected={x.id === id}
            data-scenario={x.id}
            onClick={() => {
              setId(x.id);
              setData(null);
              setShown(0);
            }}
            className={`min-w-[210px] flex-1 rounded-[var(--radius-card)] border px-4 py-3 text-left transition-colors ${x.id === id ? "border-ink bg-surface shadow-[var(--shadow-card)]" : "border-line bg-surface/60 hover:bg-surface"}`}
          >
            <div className="text-[14.5px] font-semibold">{x.title}</div>
            <div className="mt-0.5 text-[12.5px] text-muted">{x.who}</div>
          </button>
        ))}
      </div>

      <Card className="grid grid-cols-1 gap-5 p-5 md:grid-cols-[1.4fr_1fr]">
        <div>
          <p className="text-[14px] leading-relaxed text-ink-2">{s.blurb}</p>
          <div className="mt-4 rounded-[10px] bg-sunken px-4 py-3">
            <div className="text-[12px] font-medium text-muted">The user asks the agent</div>
            <div className="mt-1 text-[15px] font-medium">&ldquo;{s.task}&rdquo;</div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted">
            Reads:
            {s.inbox.map((i) => (
              <Chip key={i.id}>{i.label}</Chip>
            ))}
          </div>
        </div>
        <div className="flex flex-col justify-between gap-4">
          <dl className="grid grid-cols-1 gap-3 text-[13.5px]">
            <div>
              <dt className="text-[12px] font-medium text-safe">A correct run</dt>
              <dd className="mt-0.5 text-ink-2">{s.goodOutcome}</dd>
            </div>
            <div>
              <dt className="text-[12px] font-medium text-threat-ink">What the attacker wants</dt>
              <dd className="mt-0.5 text-ink-2">{s.attackerGoal}</dd>
            </div>
          </dl>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              ariaLabel="Agent"
              size="sm"
              value={mode}
              onChange={setMode}
              options={[
                { value: "reference", label: "Reference agent" },
                { value: "live", label: "Live Claude agent", disabled: !liveOn, title: liveOn ? undefined : "Switches on when the server has an Anthropic API key" },
              ]}
            />
            <Button onClick={run} disabled={loading} className="ml-auto" data-testid="run-agent">
              {loading ? "Running both" : data ? "Run again" : "Run both"}
            </Button>
          </div>
        </div>
      </Card>

      {error ? (
        <Card className="border-threat-line p-4 text-[14px] text-threat-ink" role="alert">
          {error}
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Column title="Without Warden" run={data?.without} shown={shown} loading={loading} protectedSide={false} />
        <Column title="With Warden" run={data?.with} shown={shown} loading={loading} protectedSide />
      </div>

      {finished ? (
        <p className="text-[12.5px] leading-relaxed text-muted">
          {data!.mode === "reference"
            ? "Reference agent: a deterministic agent that does the user's task and, like unprotected LLM agents in public benchmarks (AgentDojo, InjecAgent), also follows instructions it finds in what it reads. Tools are sandboxed; nothing was really paid, sent or run."
            : `Live agent: ${data!.with.model} with the same sandboxed tools. This run cost about $${((data!.without.costUsd || 0) + (data!.with.costUsd || 0)).toFixed(3)}.`}
        </p>
      ) : null}
    </div>
  );
}

function StepIcon({ step }: { step: Step }) {
  const cls = "mt-0.5 shrink-0";
  if (step.kind === "read") return <FileText size={18} className={`${cls} text-muted`} />;
  if (step.kind === "warden") return step.tone === "good" ? <ShieldCheck size={18} weight="fill" className={`${cls} text-safe`} /> : <ShieldWarning size={18} weight="fill" className={`${cls} text-hold`} />;
  if (step.kind === "guard") return step.status === "held" ? <Pause size={18} weight="fill" className={`${cls} text-hold`} /> : <Prohibit size={18} weight="bold" className={`${cls} text-hold`} />;
  if (step.kind === "answer") return <ChatText size={18} className={`${cls} text-ink-2`} />;
  return <Wrench size={18} className={`${cls} ${step.tone === "bad" ? "text-threat" : "text-ink-2"}`} />;
}

function Column({ title, run, shown, loading, protectedSide }: { title: string; run?: Run; shown: number; loading: boolean; protectedSide: boolean }) {
  const steps = run?.steps ?? [];
  const done = run && shown > steps.length;
  return (
    <Card className={`flex min-h-[380px] flex-col p-5 ${protectedSide ? "" : ""}`} data-testid={protectedSide ? "col-with" : "col-without"}>
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-[15px] font-semibold">{title}</h3>
        {protectedSide ? <Chip tone="ink">Warden on</Chip> : <Chip>No protection</Chip>}
      </div>
      {loading ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-14 w-full" />
          ))}
        </div>
      ) : !run ? (
        <p className="m-auto max-w-[36ch] text-center text-[13.5px] text-muted">Press Run both to watch the same agent do the same task.</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {steps.slice(0, shown).map((st, i) => (
            <li
              key={i}
              className={`flex gap-3 rounded-[10px] border px-3 py-2.5 ${st.tone === "bad" ? "border-threat-line bg-threat-soft/70" : st.kind === "guard" || (st.kind === "warden" && st.tone === "warn") ? "border-hold-line bg-hold-soft/70" : st.kind === "warden" ? "border-safe-line bg-safe-soft/70" : "border-line bg-surface"}`}
              data-step={st.kind}
            >
              <StepIcon step={st} />
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-medium">{st.title}</div>
                {st.args ? (
                  <div className="mono mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-ink-2">
                    {Object.entries(st.args).map(([k, v]) => (
                      <span key={k}>
                        <span className="text-faint">{k}:</span> {v.length > 60 ? v.slice(0, 60) + "…" : v}
                      </span>
                    ))}
                  </div>
                ) : null}
                {st.detail && st.kind !== "read" ? <div className="mt-1 text-[12.5px] leading-relaxed text-muted">{st.detail}</div> : null}
                {st.kind === "read" && st.detail ? (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-[12px] text-muted">What it read</summary>
                    <pre className="mono mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-[8px] bg-sunken p-2 text-[11.5px] leading-[1.5]">{st.detail}</pre>
                  </details>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}
      {done ? (
        <div className={`mt-auto rounded-[12px] border p-4 ${run!.outcome.safe ? "border-safe-line bg-safe-soft" : "border-threat-line bg-threat-soft"}`} data-testid="outcome" data-safe={run!.outcome.safe}>
          <div className="flex items-start gap-2.5">
            {run!.outcome.safe ? <CheckCircle size={22} weight="fill" className="shrink-0 text-safe" /> : <XCircle size={22} weight="fill" className="shrink-0 text-threat" />}
            <div>
              <div className={`text-[15px] font-semibold ${run!.outcome.safe ? "text-safe" : "text-threat-ink"}`}>{run!.outcome.headline}</div>
              <ul className="mt-1.5 flex flex-col gap-0.5 text-[13px] text-ink-2">
                {run!.outcome.lines.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
