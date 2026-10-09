import fs from "node:fs";
import { runCore } from "@/lib/warden/core";
import { extractText } from "@/lib/warden/extract/text";
import { LinearClassifier } from "@/lib/warden/classifier";
import type { AgentProfile, Mode, SourceKind } from "@/lib/warden/types";

export const loadClassifier = () => LinearClassifier.fromJSON(JSON.parse(fs.readFileSync("data/model/classifier.json", "utf8")));
const shared = loadClassifier();

/** Scans text the way the red-team page does: browser-safe readers, judge off. */
export async function scanText(text: string, opts: { source?: SourceKind; history?: string[]; task?: string; mode?: Mode; agent?: AgentProfile; classifier?: LinearClassifier | null } = {}) {
  const ex = await extractText({ source: opts.source ?? "user_message", text });
  return runCore({
    source: ex.source,
    guessed: false,
    segments: ex.segments,
    toolFindings: ex.toolFindings,
    history: opts.history,
    task: opts.task,
    agent: opts.agent,
    mode: opts.mode ?? "balanced",
    classifier: opts.classifier === undefined ? shared : opts.classifier,
    judge: null,
    judgeMode: "off",
  });
}

export const flagged = (d: string) => d !== "allow";
