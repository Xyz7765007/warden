// One scan as an OCSF Detection Finding (class 2004), so a SOC can pull Warden's decisions
// into its SIEM next to every other security event. Each finding names the rule behind it.

import { ATTACK_LABELS, type ScanResult } from "./warden/types";

const DISPOSITION: Record<ScanResult["decision"], { id: number; name: string }> = {
  allow: { id: 1, name: "Allowed" },
  neutralize: { id: 11, name: "Corrected" },
  quarantine: { id: 3, name: "Quarantined" },
  block: { id: 2, name: "Blocked" },
};

function severity(risk: number) {
  if (risk >= 85) return { id: 4, name: "High" };
  if (risk >= 60) return { id: 3, name: "Medium" };
  if (risk >= 25) return { id: 2, name: "Low" };
  return { id: 1, name: "Informational" };
}

/** `review` is a person's decision on held content; it resolves the finding and is kept in the record. */
export function toOcsf(r: ScanResult, review?: { approved: boolean; at: number }) {
  const sev = severity(r.risk);
  const disp = review ? (review.approved ? DISPOSITION.allow : DISPOSITION.block) : DISPOSITION[r.decision];
  return {
    class_uid: 2004,
    class_name: "Detection Finding",
    category_uid: 2,
    category_name: "Findings",
    activity_id: 1,
    activity_name: "Create",
    type_uid: 200401,
    time: Date.now(),
    severity_id: sev.id,
    severity: sev.name,
    status: r.decision === "quarantine" && !review ? "New" : "Resolved",
    disposition_id: disp.id,
    disposition: disp.name,
    message: r.headline,
    risk_score: r.risk,
    metadata: { product: { name: "Warden", vendor_name: "Warden", feature: { name: "Prompt-injection firewall" } }, version: "1.1.0", log_name: "warden.scan" },
    finding_info: {
      uid: r.id,
      title: r.headline,
      types: r.attackTypes.map((t) => ATTACK_LABELS[t].label),
      analytic: { name: "Warden layered detection", type: "Rule", type_id: 1 },
      src_url: undefined,
    },
    evidences: r.findings.map((f) => ({
      name: ATTACK_LABELS[f.type].label,
      data: { rule: f.rule, layer: f.layer, confidence: f.confidence, quote: f.quote.slice(0, 500), decoded: f.decodedText?.slice(0, 500), why: f.why },
    })),
    unmapped: {
      source_type: r.source,
      hidden_segments: r.stats.hiddenSegments,
      removed_passages: r.sanitized.removed,
      trace: r.trace.map((t) => ({ step: t.step, status: t.status, ms: t.ms })),
      latency_ms: r.stats.ms,
      llm_judge_calls: r.stats.judgeCalls,
      cost_usd: r.stats.costUsd,
      human_review: review ? { decision: review.approved ? "let through by a person" : "kept out by a person", time: review.at } : undefined,
    },
  };
}
