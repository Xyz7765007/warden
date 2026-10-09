// Turns findings into one decision. Thresholds depend on the mode and on what the protected
// agent can do: an agent that can send email or move money gets less benefit of the doubt.

import { ATTACK_LABELS, type AgentProfile, type AttackType, type Decision, type Finding, type Mode, type Segment } from "./types";

export const THRESHOLDS: Record<Mode, { detect: number; weak: number }> = {
  strict: { detect: 0.42, weak: 0.3 },
  balanced: { detect: 0.5, weak: 0.35 },
  permissive: { detect: 0.62, weak: 0.45 },
};

const SIDE_EFFECT = /\b(send|email|mail|pay|transfer|refund|delete|remove|write|post|publish|run|exec|shell|deploy|approve|invite|grant|schedule|book|purchase|order|update|create|upload|forward|reply|message|issue)\b/i;

export function sideEffectTools(agent?: AgentProfile): string[] {
  return (agent?.tools || []).filter((t) => t.sideEffects ?? SIDE_EFFECT.test(`${t.name} ${t.description || ""}`.replace(/_/g, " "))).map((t) => t.name);
}

export interface PolicyOutcome {
  decision: Decision;
  risk: number;
  headline: string;
  detected: Finding[];
  weak: Finding[];
  attackTypes: AttackType[];
}

export function decide(
  findings: Finding[],
  segments: Segment[],
  opts: { agent?: AgentProfile; mode?: Mode; degraded?: boolean; judgeFailed?: boolean }
): PolicyOutcome {
  const mode = opts.mode ?? "balanced";
  const t = THRESHOLDS[mode];
  const detected = findings.filter((f) => f.confidence >= t.detect);
  const weak = findings.filter((f) => f.confidence >= t.weak && f.confidence < t.detect);
  const canAct = sideEffectTools(opts.agent).length > 0;

  const types = new Set<AttackType>();
  for (const f of detected) {
    types.add(f.type);
    for (const a of f.also) types.add(a);
  }
  const attackTypes = [...types];

  let keep = 1;
  for (const f of detected) keep *= 1 - Math.min(0.99, f.confidence * f.severity);
  let risk = Math.round(100 * (1 - keep));
  if (canAct && detected.length) risk = Math.min(99, Math.round(risk * 1.12));
  if (!detected.length) risk = Math.round(Math.max(0, ...weak.map((f) => f.confidence * 40)));

  const total = segments.filter((s) => s.role !== "metadata" && !s.decodedVia).reduce((n, s) => n + s.text.length, 0) || 1;
  const bySeg = new Map<string, Array<[number, number]>>();
  for (const f of detected) {
    const seg = segments.find((s) => s.id === f.segmentId);
    if (!seg || seg.decodedVia) continue;
    const spans = bySeg.get(seg.id) ?? [];
    spans.push(seg.visibility === "hidden" ? [0, seg.text.length] : [f.start, f.end]);
    bySeg.set(seg.id, spans);
  }
  let bad = 0;
  for (const spans of bySeg.values()) {
    spans.sort((a, b) => a[0] - b[0]);
    let curS = -1, curE = -1;
    for (const [s, e] of spans) {
      if (s > curE) {
        if (curE > curS) bad += curE - curS;
        curS = s;
        curE = e;
      } else curE = Math.max(curE, e);
    }
    if (curE > curS) bad += curE - curS;
  }
  const badShare = bad / total;

  const names = (ts: AttackType[]) => ts.filter((x) => x !== "indirect_injection" || ts.length === 1).map((x) => ATTACK_LABELS[x].label.toLowerCase());
  const hiddenHit = detected.some((f) => segments.find((s) => s.id === f.segmentId)?.visibility === "hidden");
  const list = (arr: string[]) => (arr.length <= 1 ? arr.join("") : `${arr.slice(0, -1).join(", ")} and ${arr[arr.length - 1]}`);

  let decision: Decision = "allow";
  let headline = "Nothing here tries to steer the AI. It was passed on, marked as outside content.";
  if (detected.length) {
    const typeNames = list([...new Set(names(attackTypes))]);
    if ((badShare >= 0.6 && risk >= 70) || (segments.length === 1 && badShare >= 0.5 && risk >= 85)) {
      decision = "block";
      headline = `Blocked. Most of this content is an attack (${typeNames}).`;
    } else if (opts.degraded) {
      decision = "quarantine";
      headline = `Held for review. The file could not be read fully, and it contains ${typeNames}.`;
    } else {
      decision = "neutralize";
      const n = detected.length;
      headline = `Cut out ${n === 1 ? "one attack" : `${n} attack signals`} (${typeNames})${hiddenHit ? ", including text hidden from people" : ""}. The rest went through.`;
    }
  } else if (weak.length) {
    const strong = weak.reduce((m, f) => Math.max(m, f.confidence * f.severity), 0);
    if ((mode === "strict" && canAct) || (opts.judgeFailed && canAct && strong >= 0.4 && mode !== "permissive")) {
      decision = "quarantine";
      headline = `Held for review. ${weak.length === 1 ? "One phrase looks" : `${weak.length} phrases look`} like ${list([...new Set(weak.map((f) => ATTACK_LABELS[f.type].label.toLowerCase()))])}, and this agent can act on it.`;
    } else {
      headline = `Passed on. ${weak.length === 1 ? "One phrase was" : `${weak.length} phrases were`} close to an attack pattern but not enough to act on.`;
    }
  }
  if (opts.degraded && decision === "allow") {
    decision = "quarantine";
    headline = "Held for review. Part of the file could not be read, so it was not checked fully.";
  }
  return { decision, risk, headline, detected, weak, attackTypes };
}
