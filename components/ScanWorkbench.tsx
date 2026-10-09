"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { SAMPLES, type Sample } from "@/lib/samples";
import { PROFILES } from "@/lib/agent/profiles";
import { SOURCE_KINDS, SOURCE_LABELS, type Mode, type Outage, type ScanResult, type SourceKind } from "@/lib/warden/types";
import { ResultView } from "./ResultView";
import { Button, Card, Chip, Label, Segmented } from "./ui";

type Tab = "examples" | "own";

const OUTAGE_LABELS: Array<[Outage | "", string]> = [
  ["", "No outage"],
  ["classifier", "Classifier down"],
  ["judge", "LLM judge down"],
  ["reader", "File reader down"],
];

async function runSample(s: Sample, mode: Mode, outage: Outage | ""): Promise<ScanResult> {
  if (s.file) {
    const blob = await fetch(s.file).then((r) => r.blob());
    const fd = new FormData();
    fd.append("file", new File([blob], s.file.split("/").pop() || "file"));
    fd.append("source", s.source);
    fd.append("task", s.task);
    fd.append("agent", s.agent);
    fd.append("mode", mode);
    if (outage) fd.append("simulate", outage);
    if (s.pinned) fd.append("pinned", JSON.stringify(s.pinned));
    if (s.history) fd.append("history", JSON.stringify(s.history));
    const r = await fetch("/api/scan", { method: "POST", body: fd });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "Scan failed");
    return j;
  }
  const r = await fetch("/api/scan", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: s.text, source: s.source, task: s.task, agent: s.agent, pinned: s.pinned, history: s.history, mode, simulate: outage || undefined }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || "Scan failed");
  return j;
}

export function ScanWorkbench() {
  const params = useSearchParams();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("examples");
  const [active, setActive] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [agentLabel, setAgentLabel] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("balanced");
  const [outage, setOutage] = useState<Outage | "">("");
  // Own content
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState<SourceKind | "auto">("auto");
  const [agent, setAgent] = useState("finance");
  const [task, setTask] = useState("");
  const [dragging, setDragging] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);
  const ran = useRef<string | null>(null);

  const scrollToResult = () => {
    if (typeof window !== "undefined" && window.innerWidth < 1024) setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  };

  const pick = useCallback(
    async (s: Sample, push = true) => {
      setActive(s.id);
      setLoading(true);
      setError(null);
      setResult(null);
      setAgentLabel(PROFILES[s.agent]?.label);
      if (push) router.replace(`/?sample=${s.id}`, { scroll: false });
      scrollToResult();
      try {
        setResult(await runSample(s, mode, outage));
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [mode, outage, router]
  );

  // Changing the simulated outage re-runs the open sample, so the failure shows straight away.
  const lastOutage = useRef(outage);
  useEffect(() => {
    if (lastOutage.current === outage) return;
    lastOutage.current = outage;
    const s = SAMPLES.find((x) => x.id === active);
    if (s) pick(s, false);
  }, [outage, active, pick]);

  useEffect(() => {
    const id = params.get("sample");
    if (id && ran.current !== id) {
      const s = SAMPLES.find((x) => x.id === id);
      if (s) {
        ran.current = id;
        pick(s, false);
      }
    }
  }, [params, pick]);

  async function scanOwn() {
    if (!text.trim() && !file) {
      setError("Paste some text or drop a file first.");
      return;
    }
    setActive(null);
    setLoading(true);
    setError(null);
    setResult(null);
    setAgentLabel(PROFILES[agent]?.label);
    scrollToResult();
    try {
      let r: Response;
      if (file) {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("source", source);
        fd.append("agent", agent);
        fd.append("mode", mode);
        if (outage) fd.append("simulate", outage);
        if (task.trim()) fd.append("task", task.trim());
        r = await fetch("/api/scan", { method: "POST", body: fd });
      } else {
        r = await fetch("/api/scan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, source, agent, mode, task: task.trim() || undefined, simulate: outage || undefined }) });
      }
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Scan failed");
      setResult(j);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const attacks = SAMPLES.filter((s) => !s.safe);
  const safe = SAMPLES.filter((s) => s.safe);

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Segmented
            ariaLabel="Input"
            value={tab}
            onChange={setTab}
            options={[
              { value: "examples", label: "Try an attack" },
              { value: "own", label: "Use your own" },
            ]}
          />
          <Segmented
            ariaLabel="Strictness"
            size="sm"
            value={mode}
            onChange={setMode}
            options={[
              { value: "strict", label: "Strict", title: "Lower bar: catches more, may hold more for review" },
              { value: "balanced", label: "Balanced" },
              { value: "permissive", label: "Relaxed", title: "Only clear attacks are acted on" },
            ]}
          />
          <select
            aria-label="Simulate an outage"
            title="Make one layer fail on purpose and watch the others carry on"
            value={outage}
            onChange={(e) => setOutage(e.target.value as Outage | "")}
            data-testid="outage"
            className={`h-8 rounded-[var(--radius-ctl)] border px-2 text-[12.5px] ${outage ? "border-hold-line bg-hold-soft text-hold" : "border-line-2 bg-surface text-muted"}`}
          >
            {OUTAGE_LABELS.map(([v, l]) => (
              <option key={v || "none"} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>

        {tab === "examples" ? (
          <Card className="overflow-hidden">
            <div className="scrollbar-thin max-h-[calc(100dvh-230px)] min-h-[360px] overflow-auto">
              <ul className="divide-y divide-line" data-testid="samples">
                {attacks.map((s) => (
                  <SampleRow key={s.id} s={s} active={active === s.id} onPick={() => pick(s)} />
                ))}
                <li className="bg-sunken px-4 py-2 text-[12px] font-medium text-muted">Safe look-alikes: these should pass</li>
                {safe.map((s) => (
                  <SampleRow key={s.id} s={s} active={active === s.id} onPick={() => pick(s)} />
                ))}
              </ul>
            </div>
          </Card>
        ) : (
          <Card className="flex flex-col gap-4 p-4">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const f = e.dataTransfer.files?.[0];
                if (f) {
                  setFile(f);
                  setText("");
                }
              }}
              className={`rounded-[10px] border border-dashed px-4 py-5 text-center transition-colors ${dragging ? "border-ink bg-sunken" : "border-line-2"}`}
            >
              {file ? (
                <div className="flex items-center justify-center gap-2 text-[13.5px]">
                  <span className="font-medium">{file.name}</span>
                  <span className="text-muted">{Math.max(1, Math.round(file.size / 1024))} KB</span>
                  <button className="text-muted underline" onClick={() => setFile(null)}>
                    Remove
                  </button>
                </div>
              ) : (
                <div className="text-[13.5px] text-muted">
                  Drop a PDF, Word file, email (.eml), image, HTML, Markdown, JSON or code file, or{" "}
                  <label className="cursor-pointer font-medium text-ink underline">
                    choose one
                    <input type="file" className="sr-only" data-testid="file-input" onChange={(e) => e.target.files?.[0] && (setFile(e.target.files[0]), setText(""))} />
                  </label>
                  .
                </div>
              )}
            </div>
            {!file ? (
              <div>
                <Label htmlFor="own-text">Or paste anything an agent might read</Label>
                <textarea
                  id="own-text"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={8}
                  placeholder="An email, a web page's HTML, a chat message, an API response, a README…"
                  className="mono w-full resize-y rounded-[var(--radius-ctl)] border border-line-2 bg-surface px-3 py-2 text-[13px] text-ink outline-none placeholder:text-faint focus:border-ink"
                />
              </div>
            ) : null}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="own-source">Content type</Label>
                <select id="own-source" value={source} onChange={(e) => setSource(e.target.value as SourceKind | "auto")} className="h-9 w-full rounded-[var(--radius-ctl)] border border-line-2 bg-surface px-2 text-[13.5px]">
                  <option value="auto">Work it out for me</option>
                  {SOURCE_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {SOURCE_LABELS[k]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="own-agent">Agent that will read it</Label>
                <select id="own-agent" value={agent} onChange={(e) => setAgent(e.target.value)} className="h-9 w-full rounded-[var(--radius-ctl)] border border-line-2 bg-surface px-2 text-[13.5px]">
                  {Object.entries(PROFILES).map(([k, p]) => (
                    <option key={k} value={k}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <Label htmlFor="own-task">What the user asked the agent (optional)</Label>
              <input id="own-task" value={task} onChange={(e) => setTask(e.target.value)} placeholder="Summarise this email" className="h-9 w-full rounded-[var(--radius-ctl)] border border-line-2 bg-surface px-3 text-[13.5px] outline-none placeholder:text-faint focus:border-ink" />
              <p className="mt-1.5 text-[12px] text-muted">With the task, Warden also flags requests in the content that the user never made.</p>
            </div>
            <div className="flex justify-end">
              <Button onClick={scanOwn} disabled={loading} data-testid="scan-own">
                {loading ? "Scanning" : "Scan"}
              </Button>
            </div>
          </Card>
        )}
      </div>

      <div ref={resultRef} className="min-w-0 scroll-mt-20">
        {error ? (
          <Card className="border-threat-line p-5 text-[14px] text-threat-ink" role="alert">
            {error}
          </Card>
        ) : loading ? (
          <Loading />
        ) : result ? (
          <ResultView result={result} agentLabel={agentLabel} onReview={() => undefined} />
        ) : (
          <Empty onStart={() => pick(SAMPLES[0])} />
        )}
      </div>
    </div>
  );
}

function SampleRow({ s, active, onPick }: { s: Sample; active: boolean; onPick: () => void }) {
  return (
    <li>
      <button onClick={onPick} className={`flex w-full flex-col items-start gap-1 px-4 py-3 text-left transition-colors ${active ? "bg-sunken" : "hover:bg-sunken/60"}`} data-sample={s.id} aria-pressed={active}>
        <span className="flex w-full items-center gap-2">
          <span className="text-[14px] font-medium">{s.title}</span>
          <span className="ml-auto">
            <Chip tone={s.safe ? "safe" : "neutral"}>{SOURCE_LABELS[s.source]}</Chip>
          </span>
        </span>
        <span className="text-[13px] leading-snug text-muted">{s.blurb}</span>
      </button>
    </li>
  );
}

function Loading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Scanning">
      <Card className="p-5">
        <div className="skeleton h-7 w-40" />
        <div className="skeleton mt-4 h-5 w-full" />
        <div className="skeleton mt-2 h-5 w-3/4" />
      </Card>
      <Card className="p-5">
        <div className="skeleton h-5 w-48" />
        <div className="skeleton mt-4 h-24 w-full" />
      </Card>
      <Card className="p-5">
        <div className="skeleton h-5 w-32" />
        <div className="skeleton mt-4 h-16 w-full" />
      </Card>
    </div>
  );
}

function Empty({ onStart }: { onStart: () => void }) {
  return (
    <Card className="flex min-h-[420px] flex-col justify-center gap-5 p-8">
      <div>
        <h2 className="text-[20px] font-semibold tracking-tight">Pick an attack on the left.</h2>
        <p className="mt-2 max-w-[56ch] text-[14.5px] leading-relaxed text-muted">
          Warden reads it the way an AI agent would, shows you what was hidden from people, cuts out the attack, and explains each decision.
        </p>
      </div>
      <ul className="grid grid-cols-1 gap-x-6 gap-y-2 text-[13.5px] text-ink-2 sm:grid-cols-2">
        <li>11 kinds of content, from PDFs to screenshots</li>
        <li>9 attack types, in 14 languages including Hinglish</li>
        <li>Hidden text, invisible characters, encodings</li>
        <li>Requests the user never made</li>
      </ul>
      <div>
        <Button onClick={onStart}>Start with the invoice</Button>
      </div>
    </Card>
  );
}
