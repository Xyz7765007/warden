// Server-side entry point: read the input with the right extractor, then run the planner.
// If a reader fails, Warden recovers: it falls back to plain text and holds the result for
// review rather than passing something it could not fully read.

import { extract, sniffBytes } from "./extract";
import { runCore, type ClassifierLike, type JudgeLike } from "./core";
import type { ScanInput, ScanResult, SourceKind } from "./types";
import { SegmentBuilder, bytesToText } from "./extract/util";

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export async function scan(input: ScanInput, deps: { classifier?: ClassifierLike | null; judge?: JudgeLike | null; classifierEntry?: number } = {}): Promise<ScanResult> {
  const t0 = now();
  let source: SourceKind;
  let guessed = false;
  let degraded = false;
  let ex: Awaited<ReturnType<typeof extract>>;
  try {
    if (input.simulate === "reader") throw new Error("simulated outage");
    ex = await extract({ source: input.source, text: input.text, file: input.file, pinnedTools: input.agent?.pinnedTools });
    source = ex.source;
    guessed = ex.guessed;
    if (ex.partial) degraded = true;
  } catch (e) {
    degraded = true;
    const raw = input.text ?? (input.file ? bytesToText(input.file.bytes).replace(/[^\x09\x0a\x0d\x20-\x7e -￿]+/g, " ") : "");
    const b = new SegmentBuilder("r", "external");
    b.add(raw.slice(0, 200_000), "Raw text (the file reader failed)", {});
    source = (input.source && input.source !== "auto" ? input.source : "user_message") as SourceKind;
    // Name what the file looked like, so "held for review" makes sense to the person reading it.
    const head = input.file ? bytesToText(input.file.bytes.subarray(0, 200_000)) : "";
    const unsupported = !input.file ? null : /xl\/workbook\.xml/.test(head) ? "an Excel workbook" : /ppt\/presentation\.xml/.test(head) ? "a PowerPoint deck" : /^PK/.test(head) && !/word\/document\.xml/.test(head) ? "a zip archive" : null;
    const sniffed = input.file ? sniffBytes(input.file.bytes, input.file.name, input.file.mime) : null;
    const message = unsupported
      ? `This looks like ${unsupported}, which Warden does not read yet, so it was held for review.`
      : `The ${sniffed ?? source} reader could not open this file (${(e as Error).message}), so it was held for review.`;
    ex = { segments: b.segments, warnings: [message], notes: [], source, guessed: false };
  }
  const extractMs = now() - t0;
  // A simulated outage swaps in a layer that fails, so the recovery paths can be seen working.
  const outage = () => {
    throw new Error("simulated outage");
  };
  const classifier = input.simulate === "classifier" ? { name: deps.classifier?.name ?? "classifier", score: outage } : deps.classifier;
  const judge = input.simulate === "judge" ? { name: deps.judge?.name ?? "LLM judge", available: true, judge: async () => outage() } : deps.judge;
  return runCore({
    source,
    guessed,
    segments: ex.segments,
    warnings: ex.warnings,
    notes: ex.notes,
    toolFindings: ex.toolFindings,
    history: input.history,
    task: input.task,
    agent: input.agent,
    mode: input.mode,
    judgeMode: input.judge,
    classifier,
    classifierEntry: deps.classifierEntry,
    judge,
    degraded,
    startedAt: t0,
    extractMs,
  });
}
