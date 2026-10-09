"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ATTACK_LABELS, ATTACK_TYPES, DECISION_LABELS, LAYER_LABELS, SOURCE_LABELS, type Finding, type ScanResult, type Segment } from "@/lib/warden/types";
import { Button, Card, Chip, DecisionPill, Segmented, SourceChip, TypeChip } from "./ui";
import { toOcsf } from "@/lib/ocsf";
import { isCleanup } from "@/lib/warden/ocrfix";

const DETECT = 0.5;

function spansFor(seg: Segment, findings: Finding[]) {
  const list = findings
    .filter((f) => f.segmentId === seg.id && f.end > f.start)
    .map((f) => ({ s: Math.max(0, f.start), e: Math.min(seg.text.length, f.end), strong: f.confidence >= DETECT, label: ATTACK_LABELS[f.type].label }))
    .sort((a, b) => a.s - b.s);
  const merged: typeof list = [];
  for (const sp of list) {
    const last = merged[merged.length - 1];
    if (last && sp.s <= last.e) {
      last.e = Math.max(last.e, sp.e);
      last.strong = last.strong || sp.strong;
    } else merged.push({ ...sp });
  }
  return merged;
}

function Marked({ seg, findings }: { seg: Segment; findings: Finding[] }) {
  const spans = spansFor(seg, findings);
  const out: ReactNode[] = [];
  let pos = 0;
  spans.forEach((sp, i) => {
    if (sp.s > pos) out.push(<span key={`t${i}`}>{seg.text.slice(pos, sp.s)}</span>);
    out.push(
      <mark key={`m${i}`} className={`hit ${sp.strong ? "" : "weak"}`} title={sp.label}>
        {seg.text.slice(sp.s, sp.e)}
      </mark>
    );
    pos = sp.e;
  });
  if (pos < seg.text.length) out.push(<span key="end">{seg.text.slice(pos)}</span>);
  return <>{out}</>;
}

function visibleText(s: string) {
  // Make invisible characters visible as a marker so the AI view shows they exist.
  return s.replace(/[\u{E0000}-\u{E007F}]+/gu, (m) => `⟦${[...m].length} invisible characters⟧`).replace(/[​-‏⁠﻿]/g, "·");
}

function SegmentBlock({ seg, findings, children }: { seg: Segment; findings: Finding[]; children?: ReactNode }) {
  const hidden = seg.visibility === "hidden";
  // Red only when the hidden text carries an attack; harmless hidden text (a PDF title, a menu) stays neutral.
  const hot = hidden && findings.some((f) => f.segmentId === seg.id && f.confidence >= DETECT);
  const display = { ...seg, text: visibleText(seg.text) };
  const sameLength = display.text.length === seg.text.length;
  return (
    <div className={`rounded-[10px] border px-3.5 py-3 ${hot ? "border-threat-line bg-threat-soft/60" : hidden ? "border-dashed border-line-2 bg-sunken" : "border-line bg-surface"}`} data-testid={hidden ? "hidden-segment" : "visible-segment"} data-hot={hot}>
      <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[12px] text-muted">
        {hidden ? <Chip tone={hot ? "threat" : "neutral"}>Hidden from people</Chip> : null}
        <span>{seg.where}</span>
        {hidden && seg.hiddenDetail ? <span className={hot ? "text-threat-ink" : "text-muted"}>{seg.hiddenDetail}</span> : null}
      </div>
      <div className="mono whitespace-pre-wrap break-words text-[13px] leading-[1.6] text-ink">{sameLength ? <Marked seg={display} findings={findings} /> : display.text}</div>
      {children}
    </div>
  );
}

function Sanitized({ text }: { text: string }) {
  const parts = text.split(/(\[removed by Warden: [^\]]+\])/g);
  return (
    <div className="mono whitespace-pre-wrap break-words text-[13px] leading-[1.6]" data-testid="sanitized">
      {parts.map((p, i) => {
        const m = p.match(/^\[removed by Warden: ([^\]]+)\]$/);
        return m ? (
          <span key={i} className="removed-chip">
            removed: {m[1]}
          </span>
        ) : (
          <span key={i}>{p}</span>
        );
      })}
    </div>
  );
}

function download(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ResultView({ result, agentLabel, onReview }: { result: ScanResult; agentLabel?: string; onReview?: (approved: boolean) => void }) {
  const top = result.segments.filter((s) => !s.decodedVia && s.id !== "session");
  const session = result.segments.find((s) => s.id === "session");
  const hiddenCount = top.filter((s) => s.visibility === "hidden").length;
  const [view, setView] = useState<"ai" | "person">(hiddenCount ? "ai" : "person");
  const [showEnvelope, setShowEnvelope] = useState(false);
  const [reviewed, setReviewed] = useState<null | boolean>(null);
  const [reviewedAt, setReviewedAt] = useState(0);
  const [copied, setCopied] = useState(false);
  const strong = result.findings.filter((f) => f.confidence >= DETECT);
  const weak = result.findings.filter((f) => f.confidence < DETECT);
  const segById = useMemo(() => new Map(result.segments.map((s) => [s.id, s])), [result]);
  const shown = view === "ai" ? top : top.filter((s) => s.visibility === "visible");
  const decodedFor = (id: string) => result.segments.filter((s) => s.parentId === id && s.decodedVia && !isCleanup(s.decodedVia));

  return (
    <div className="flex flex-col gap-4" data-testid="result" data-decision={result.decision}>
      <Card className="p-5">
        <div className="flex flex-wrap items-center gap-3">
          <DecisionPill decision={result.decision} large />
          <span className="text-[14px] font-medium tabular-nums text-ink-2" data-testid="risk">
            Risk {result.risk}/100
          </span>
          <span className="ml-auto flex flex-wrap items-center gap-1.5">
            <SourceChip source={result.source} guessed={result.sourceGuessed} />
            {agentLabel ? <Chip>{agentLabel}</Chip> : null}
            <Chip>{result.stats.ms < 1 ? "<1" : result.stats.ms} ms</Chip>
          </span>
        </div>
        <p className="mt-3 text-[17px] font-medium leading-snug tracking-[-0.005em]" data-testid="headline">
          {result.headline}
        </p>
        <p className="mt-1 text-[13.5px] text-muted">{DECISION_LABELS[result.decision].plain}</p>
        <div className="mt-4 flex flex-wrap gap-1.5" aria-label="Attack types">
          {ATTACK_TYPES.map((t) => {
            const hit = result.attackTypes.includes(t);
            return (
              <span key={t} className={`rounded-full border px-2 py-0.5 text-[11.5px] ${hit ? "border-threat-line bg-threat-soft font-medium text-threat-ink" : "border-line text-faint"}`} data-hit={hit}>
                {ATTACK_LABELS[t].label}
              </span>
            );
          })}
        </div>
        {result.decision === "quarantine" && onReview ? (
          <div className="mt-4 flex flex-wrap items-center gap-2 rounded-[10px] border border-hold-line bg-hold-soft px-3 py-2.5 text-[13.5px]">
            <span className="mr-auto text-hold">{reviewed === null ? "A person decides whether this content reaches the agent." : reviewed ? "Let through by you. Your decision is in the OCSF export." : "Kept out by you. Your decision is in the OCSF export."}</span>
            {reviewed === null ? (
              <>
                <Button variant="secondary" onClick={() => (setReviewed(false), setReviewedAt(Date.now()), onReview(false))}>
                  Keep it out
                </Button>
                <Button onClick={() => (setReviewed(true), setReviewedAt(Date.now()), onReview(true))}>Let it through</Button>
              </>
            ) : null}
          </div>
        ) : null}
      </Card>

      <Card className="p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-[15px] font-semibold">{view === "ai" ? "What the AI reads" : "What a person sees"}</h3>
          <Segmented
            ariaLabel="View"
            size="sm"
            value={view}
            onChange={setView}
            options={[
              { value: "person", label: "Person" },
              { value: "ai", label: `AI${hiddenCount ? ` (+${hiddenCount} hidden)` : ""}` },
            ]}
          />
        </div>
        <div className="scrollbar-thin flex max-h-[440px] flex-col gap-2 overflow-auto pr-1">
          {shown.map((seg) => (
            <SegmentBlock key={seg.id} seg={seg} findings={result.findings}>
              {view === "ai" &&
                decodedFor(seg.id).map((d) => (
                  <div key={d.id} className="mt-2 rounded-[8px] border border-dashed border-threat-line bg-surface px-3 py-2 text-[12.5px]">
                    <span className="font-medium text-threat-ink">Decoded from {d.decodedVia}: </span>
                    <span className="mono">{d.text.slice(0, 400)}</span>
                  </div>
                ))}
            </SegmentBlock>
          ))}
          {view === "ai" && session ? <SegmentBlock seg={session} findings={result.findings} /> : null}
          {view === "person" && hiddenCount ? (
            <p className="px-1 text-[12.5px] text-muted">
              {hiddenCount} piece{hiddenCount === 1 ? "" : "s"} of text {hiddenCount === 1 ? "is" : "are"} not shown here because a person cannot see {hiddenCount === 1 ? "it" : "them"}. Switch to the AI view.
            </p>
          ) : null}
          {!shown.length ? <p className="px-1 text-[13px] text-muted">No readable text.</p> : null}
        </div>
      </Card>

      <Card className="p-5">
        <h3 className="text-[15px] font-semibold">
          {strong.length ? `${strong.length} finding${strong.length === 1 ? "" : "s"}` : "No findings"}
        </h3>
        <div className="mt-3 flex flex-col divide-y divide-line">
          {strong.map((f) => (
            <FindingRow key={f.id} f={f} where={segById.get(f.segmentId)?.where} />
          ))}
          {!strong.length ? <p className="py-2 text-[13.5px] text-muted">Nothing here tries to steer the agent.</p> : null}
        </div>
        {weak.length ? (
          <details className="mt-3 rounded-[10px] border border-line bg-sunken px-3 py-2">
            <summary className="cursor-pointer text-[13px] text-ink-2">
              {weak.length} weak signal{weak.length === 1 ? "" : "s"}, not acted on
            </summary>
            <div className="mt-1 flex flex-col divide-y divide-line">
              {weak.map((f) => (
                <FindingRow key={f.id} f={f} where={segById.get(f.segmentId)?.where} weak />
              ))}
            </div>
          </details>
        ) : null}
      </Card>

      <Card className="p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[15px] font-semibold">What reaches the agent</h3>
          <Segmented
            ariaLabel="Output format"
            size="sm"
            value={showEnvelope ? "env" : "text"}
            onChange={(v) => setShowEnvelope(v === "env")}
            options={[
              { value: "text", label: "Clean text" },
              { value: "env", label: "Wrapped for the agent" },
            ]}
          />
        </div>
        <div className="scrollbar-thin max-h-[320px] overflow-auto rounded-[10px] border border-line bg-sunken px-3.5 py-3">
          {showEnvelope ? <pre className="mono whitespace-pre-wrap break-words text-[12.5px] leading-[1.6]">{result.sanitized.envelope}</pre> : <Sanitized text={result.sanitized.text || "(nothing passed on)"} />}
        </div>
        <p className="mt-2 text-[12.5px] text-muted">
          {result.sanitized.removed ? `${result.sanitized.removed} passage${result.sanitized.removed === 1 ? "" : "s"} cut. ` : ""}Invisible characters are stripped, and the text is labelled as outside data so the agent treats it as information, not instructions.
        </p>
      </Card>

      <Card className="p-5">
        <h3 className="text-[15px] font-semibold">How Warden decided</h3>
        <ol className="mt-3 flex flex-col gap-0" data-testid="trace">
          {result.trace.map((t, i) => (
            <li key={i} className="grid grid-cols-[24px_1fr_auto] gap-3 py-2">
              <span className={`mt-[3px] flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold ${t.status === "ok" ? "bg-ink text-white" : t.status === "skipped" ? "bg-sunken text-muted" : "bg-hold text-white"}`}>{i + 1}</span>
              <div>
                <div className="text-[14px] font-medium">{t.step}</div>
                <div className="text-[13px] text-muted">{t.detail}</div>
              </div>
              <span className="text-[12px] tabular-nums text-faint">{t.status === "skipped" ? "skipped" : `${t.ms < 1 ? "<1" : t.ms} ms`}</span>
            </li>
          ))}
        </ol>
        {result.warnings.length ? (
          <ul className="mt-2 list-inside list-disc text-[12.5px] text-muted">
            {result.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
          <Button variant="secondary" onClick={() => download(`warden-${result.id}.ocsf.json`, toOcsf(result, reviewed === null ? undefined : { approved: reviewed, at: reviewedAt }))}>
            Download audit record
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              navigator.clipboard?.writeText(JSON.stringify(result, null, 2)).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            {copied ? "Copied" : "Copy as JSON"}
          </Button>
          <span className="ml-auto self-center text-[12px] text-faint">Audit record in OCSF Detection Finding format, ready for a SIEM.</span>
        </div>
      </Card>
    </div>
  );
}

function FindingRow({ f, where, weak = false }: { f: Finding; where?: string; weak?: boolean }) {
  return (
    <div className="py-3" data-testid={weak ? "weak-finding" : "finding"} data-type={f.type}>
      <div className="flex flex-wrap items-center gap-1.5">
        <TypeChip type={f.type} muted={weak} />
        {f.also.filter((a) => a !== f.type).map((a) => (
          <Chip key={a}>{ATTACK_LABELS[a].label}</Chip>
        ))}
        <span className="ml-auto text-[12px] text-muted">
          {LAYER_LABELS[f.layer]}
          {f.rule.startsWith("intent.") ? ", task check" : ""} · {Math.round(f.confidence * 100)}%
        </span>
      </div>
      <p className="mt-2 text-[13.5px] leading-relaxed text-ink-2">{f.why}</p>
      <div className="mt-2 rounded-[8px] bg-sunken px-3 py-2">
        <div className="mono break-words text-[12.5px] text-ink">{f.quote.length > 280 ? f.quote.slice(0, 280) + "…" : f.quote}</div>
        {f.decodedText && !isCleanup(f.decodedVia) ? <div className="mono mt-1 break-words text-[12.5px] text-threat-ink">Decoded: {f.decodedText.slice(0, 280)}</div> : null}
        {where ? <div className="mt-1 text-[11.5px] text-faint">{where}</div> : null}
      </div>
    </div>
  );
}

export { SOURCE_LABELS };
