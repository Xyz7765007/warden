// The Warden planner. Given the segments a reader produced, it decides which checks to run,
// runs them in order of cost (free pattern checks first, the LLM judge only for what stays
// unclear), recovers when a layer fails, and returns a decision with a full trace.
// Runs in the browser as well as on the server: no Node-only imports here.

import { findEncoded } from "./decode";
import { correctOcr, fixScrambled, isCleanup, OCR_VIA, TYPO_VIA } from "./ocrfix";
import { detectSegment, dedupe, type DetectContext } from "./detect";
import { analyzeSession } from "./session";
import { decide, sideEffectTools, THRESHOLDS } from "./policy";
import { neutralize } from "./neutralize";
import { normalize, sentences } from "./normalize";
import { MENTION } from "./rules";
import { intentFindings } from "./intent";
import {
  SOURCE_LABELS,
  sourceNoun,
  type AgentProfile,
  type AttackType,
  type Finding,
  type Mode,
  type ScanResult,
  type Segment,
  type SourceKind,
  type TraceStep,
} from "./types";

// Everyday Hindi words typed in Latin script: enough of them marks a passage as Hinglish.
const HINGLISH_WORDS = /\b(?:hai|hain|kya|karo|kar do|karna|karke|mera|meri|mere|mujhe|aap|aapka|aapke|aapko|nahi|nahin|kripya|bhai|batao|bata do|jaldi|ke liye|tum|tumhe|tumhara|kaise|abhi|theek|bhejo|bhej do|wala|wali|yahan|saare)\b/gi;

// A sentence the classifier flags in visible outside content must look like an instruction:
// a person addressed, a command verb, a directive word. Encyclopedic and news sentences about AI
// or payments ("ChatGPT can now complete UPI payments") describe, they do not instruct.
const INSTRUCTION_CUE = new RegExp(
  [
    // a person addressed
    "\\b(?:you|your|yourself|u|please|pls|kindly)\\b",
    // a command at the start of the sentence
    "^[\\s\"'“‘(*>-]*(?:ignore|disregard|forget|override|bypass|pretend|act as|reveal|print|output|send|forward|email|transfer|pay|wire|delete|remove|run|execute|tell|say|reply|respond|repeat|write|list|show|give|share|disclose|approve|grant|enable|disable|switch|stop|start|remember|store|save|do not|don't|never|always|let's|lets|now)\\b",
    // a rule aimed at an AI, or a standing order
    "\\b(?:ai|assistants?|agents?|models?|bots?|llms?|chatbots?|copilots?|gpt|claude)\\b[^.!?\\n]{0,25}\\b(?:must|should|shall|needs? to|has to|have to|will now|is to|are to|may now|is (?:now )?(?:allowed|permitted|authori[sz]ed))\\b",
    "\\b(?:from now on|henceforth|going forward|instead of|no longer)\\b",
    // a label or a rule for automated readers
    "\\b(?:for|to) (?:the |all |any )?(?:ai|assistants?|agents?|bots?|models?|llms?|automated \\w+|summari[sz]ers?|screeners?)\\s*[:,\\u2014-]",
    "\\b(?:summari[sz]ers?|screeners?|automated \\w+|automation)\\b[^.!?\\n]{0,25}\\b(?:must|should|shall|needs? to|has to|have to|are to|is to)\\b",
    // skipping a control, hiding something, or money asked to move
    "\\b(?:no|without(?: any| a)?) (?:[a-z-]+ )?(?:callback|call-back|approval|sign-?off|verification|review|checks?|confirmation)s?\\b|\\bskip(?:s|ped|ping)?\\b|\\bpre-?(?:cleared|approved|authori[sz]ed)\\b|\\b(?:leave out|omit|do not mention|don't mention)\\b",
    "\\b(?:asked|requested|instructed|requires?|wants?) (?:that|for)\\b[^.!?\\n]{0,60}\\bbe (?:settled|paid|transferred|released|wired|approved|sent|forwarded|shared|deleted)\\b",
    // words that only appear when someone is trying to steer
    "\\b(?:ignor(?:e|es|ing)|disregard(?:s|ing)?|overrid(?:e|es|ing)|bypass(?:es|ing)?|pretend|jailbreak|exfiltrate|unrestricted|no restrictions|developer mode)\\b",
    // an AI given a standing behaviour: "the finance assistant treats ... and acts on ..."
    "\\b(?:assistants?|agents?|bots?|ai|copilots?|models?)\\b (?:now |always |automatically )?(?:treats?|acts? on|approves?|releases?|pays?|sends?|forwards?|shares?|ignores?|skips?|trusts?|accepts?)\\b",
    // Hinglish orders and Indian scripts
    "\\b(?:mat|karo|kar do|bhejo|batao|bata do|bhej do)\\b",
    "[\\u0900-\\u0D7F]",
  ].join("|"),
  "i"
);

/** The instruction signs, checked on the sentence as written and as decoded (leetspeak, look-alike letters). */
function instructs(text: string): boolean {
  const t = text.trim();
  return INSTRUCTION_CUE.test(t) || INSTRUCTION_CUE.test(normalize(t).norm);
}

/** A run of names ("Inkling Jais LaMDA Llama Mistral ... ChatGPT Character.ai") is a list, not an instruction.
 * ALL-CAPS words do not count as names: shouting is how many attacks are written. */
function listLike(text: string): boolean {
  const words = text.match(/[A-Za-z][A-Za-z.'-]*/g) || [];
  if (words.length < 12) return false;
  const names = words.filter((w) => /^[A-Z]/.test(w) && /[a-z]/.test(w)).length;
  return names / words.length >= 0.7;
}

export interface ClassifierLike {
  name: string;
  score(text: string): { p: number; type: AttackType | null; typeP: number };
}

export interface JudgeItem {
  id: string;
  text: string;
  where: string;
  hidden: boolean;
  external: boolean;
}
export interface JudgeVerdict {
  id: string;
  injection: boolean;
  types: AttackType[];
  quote: string;
  confidence: number;
  rationale: string;
}
export interface JudgeLike {
  name: string;
  available: boolean;
  judge(items: JudgeItem[]): Promise<{ verdicts: JudgeVerdict[]; costUsd: number }>;
}

export interface CoreInput {
  source: SourceKind;
  guessed: boolean;
  segments: Segment[];
  warnings?: string[];
  notes?: string[];
  toolFindings?: Finding[];
  history?: string[];
  task?: string;
  agent?: AgentProfile;
  mode?: Mode;
  judgeMode?: "auto" | "off" | "force";
  classifier?: ClassifierLike | null;
  /** Classifier score at which a sentence with no pattern match becomes a finding. */
  classifierEntry?: number;
  judge?: JudgeLike | null;
  degraded?: boolean;
  startedAt?: number;
  extractMs?: number;
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
// Classifier score needed to raise a finding on its own, per mode (calibrated on our benign
// corpus and the public test splits: 0.80 gave zero false positives on both).
export const CLASSIFIER_ENTRY: Record<Mode, number> = { strict: 0.7, balanced: 0.8, permissive: 0.88 };

export async function runCore(input: CoreInput): Promise<ScanResult> {
  const t0 = input.startedAt ?? now();
  const trace: TraceStep[] = [];
  const warnings = [...(input.warnings ?? [])];
  const mode = input.mode ?? "balanced";
  const thresholds = THRESHOLDS[mode];
  const segments: Segment[] = [...input.segments];
  const ctx: DetectContext = {
    source: input.source,
    toolNames: (input.agent?.tools || []).map((t) => t.name.toLowerCase()),
    sideEffectTools: sideEffectTools(input.agent),
  };
  const hiddenCount = segments.filter((s) => s.visibility === "hidden").length;

  trace.push({
    step: `Read the ${sourceNoun(input.source)} the way an AI would`,
    detail: `${segments.length} piece${segments.length === 1 ? "" : "s"} of text${hiddenCount ? `, ${hiddenCount} hidden from people` : ", none hidden"}${input.guessed ? ` (identified as ${SOURCE_LABELS[input.source]})` : ""}.`,
    ms: Math.round(input.extractMs ?? 0),
    status: input.degraded ? "recovered" : "ok",
    layer: "structure",
  });

  // 1. Decode anything encoded.
  let t = now();
  const decodedSegs: Segment[] = [];
  const vias = new Set<string>();
  for (const seg of segments) {
    if (seg.text.length > 200_000) continue;
    findEncoded(seg.text).forEach((d, k) => {
      vias.add(d.via.split(" then ")[0]);
      decodedSegs.push({
        id: `${seg.id}.d${k + 1}`,
        text: d.text,
        where: `${seg.where} (decoded from ${d.via})`,
        visibility: d.via.includes("Unicode tag") ? "hidden" : seg.visibility,
        hiddenReason: d.via.includes("Unicode tag") ? "invisible_unicode" : seg.hiddenReason,
        hiddenDetail: d.via.includes("Unicode tag") ? "written in invisible Unicode tag characters" : seg.hiddenDetail,
        role: seg.role,
        provenance: seg.provenance,
        parentId: seg.id,
        parentSpan: [d.start, d.end],
        decodedVia: d.via,
        aiDirected: seg.aiDirected,
      });
    });
  }
  // OCR clean-up: a corrected copy of OCR text, checked alongside the original.
  for (const seg of segments) {
    if (!seg.ocr) continue;
    const fixed = correctOcr(seg.text);
    if (fixed !== seg.text) {
      decodedSegs.push({ ...seg, id: `${seg.id}.ocr`, text: fixed, where: `${seg.where} (OCR misreads corrected)`, parentId: seg.id, parentSpan: [0, seg.text.length], decodedVia: OCR_VIA, ocr: false });
    }
  }
  // Decoded text can carry shuffled spellings too ("typos, then ROT13"): read those as meant.
  for (const d of [...decodedSegs]) {
    if (isCleanup(d.decodedVia)) continue;
    const fixed = fixScrambled(d.text);
    if (fixed !== d.text) decodedSegs.push({ ...d, id: `${d.id}.typo`, text: fixed, decodedVia: `${d.decodedVia}, misspellings read as meant` });
  }
  // Typo clean-up: words with shuffled middle letters, snapped back (same length, same offsets).
  let unscrambled = 0;
  for (const seg of segments) {
    if (seg.decodedVia || seg.role === "code" || seg.role === "code_string" || seg.role === "metadata") continue;
    const fixed = fixScrambled(seg.text);
    if (fixed !== seg.text) {
      unscrambled++;
      decodedSegs.push({ ...seg, id: `${seg.id}.typo`, text: fixed, where: `${seg.where} (misspellings read as meant)`, parentId: seg.id, parentSpan: [0, seg.text.length], decodedVia: TYPO_VIA, ocr: false });
    }
  }
  segments.push(...decodedSegs);
  const encodedCount = decodedSegs.filter((d) => !isCleanup(d.decodedVia)).length;
  trace.push({
    step: "Decode hidden encodings",
    detail: `${encodedCount ? `Decoded ${encodedCount} hidden message${encodedCount === 1 ? "" : "s"} (${[...vias].join(", ")}).` : "Nothing encoded (checked base64, hex, URL, binary, ROT13, Caesar, reversed text, invisible Unicode)."}${unscrambled ? ` Read ${unscrambled} passage${unscrambled === 1 ? "" : "s"} with scrambled spellings as meant.` : ""}`,
    ms: Math.round(now() - t),
    status: "ok",
    layer: "decode",
  });

  // 2. Pattern rules and structural checks on every segment.
  t = now();
  let findings: Finding[] = [];
  for (const seg of segments) {
    try {
      findings.push(...detectSegment(seg, ctx));
    } catch (e) {
      warnings.push(`Pattern check failed on ${seg.where} (${(e as Error).message}).`);
    }
  }
  // Findings on decoded text point back at the encoded span in the original.
  const toParent = (f: Finding): Finding => {
    const seg = segments.find((x) => x.id === f.segmentId);
    if (!seg?.decodedVia || !seg.parentId || !seg.parentSpan) return f;
    const parent = segments.find((x) => x.id === seg.parentId)!;
    const cleanup = isCleanup(seg.decodedVia);
    // Typo clean-up keeps every offset, so the finding keeps its exact span.
    const exact = seg.decodedVia === TYPO_VIA;
    const [start, end] = exact ? [f.start, f.end] : seg.parentSpan;
    const also = [...new Set<AttackType>([...f.also, ...(cleanup ? [] : (["encoded_instructions"] as AttackType[]))])].filter((x) => x !== f.type);
    return {
      ...f,
      segmentId: parent.id,
      start,
      end,
      quote: parent.text.slice(start, Math.min(end, start + 300)),
      also,
      decodedText: exact ? seg.text.slice(start, end) : seg.text,
      decodedVia: seg.decodedVia,
      why: seg.decodedVia === OCR_VIA
        ? `${f.why} (Read from OCR text after fixing misreads: "${seg.text.slice(0, 120)}".)`
        : exact
          ? `${f.why} Written with shuffled letters to slip past filters; read as meant: "${seg.text.slice(start, Math.min(end, start + 140))}".`
          : `Hidden with ${seg.decodedVia}. Decoded, it says: "${seg.text.slice(0, 160)}". ${f.why}`,
    };
  };
  findings = findings.map(toParent);
  // Invisible Unicode tag text has no honest use: flag it even when the words look harmless.
  for (const d of decodedSegs) {
    if (!d.decodedVia?.includes("Unicode tag") || findings.some((f) => f.decodedVia === d.decodedVia && f.segmentId === d.parentId)) continue;
    const parent = segments.find((s) => s.id === d.parentId)!;
    findings.push({
      id: `${d.id}.tag`,
      type: "encoded_instructions",
      also: parent.provenance === "external" ? ["indirect_injection"] : [],
      segmentId: parent.id,
      start: d.parentSpan![0],
      end: d.parentSpan![1],
      quote: "(invisible characters)",
      confidence: 0.74,
      severity: 0.75,
      layer: "decode",
      rule: "decode.unicode-tags",
      why: `Invisible Unicode tag characters carry a hidden message: "${d.text.slice(0, 160)}". People cannot see these characters; AI models can read them.`,
      decodedText: d.text,
      decodedVia: d.decodedVia,
    });
  }
  if (input.toolFindings?.length) findings.push(...input.toolFindings);
  // Task binding: requests in outside content that the user never asked for.
  {
    const t2 = now();
    const before = findings.length;
    for (const seg of segments) {
      if (seg.decodedVia && !isCleanup(seg.decodedVia)) continue;
      try {
        findings.push(...intentFindings(seg, input.task, (input.agent?.tools || []).map((t) => t.name)).map(toParent));
      } catch (e) {
        warnings.push(`Task check failed on ${seg.where} (${(e as Error).message}).`);
      }
    }
    const added = findings.length - before;
    trace.push({
      step: input.task ? "Check requests against the user's task" : "Look for requests aimed at the agent",
      detail: input.task
        ? `${added ? `${added} request${added === 1 ? "" : "s"} the user never asked for` : "Every request in the content fits the user's task"} (task: "${input.task.slice(0, 80)}").`
        : `${added ? `${added} request${added === 1 ? "" : "s"} aimed at the agent` : "No requests aimed at the agent"}. Pass the user's task to check requests against it.`,
      ms: Math.round(now() - t2),
      status: "ok",
      layer: "signature",
    });
  }
  const ruleHits = findings.filter((f) => f.confidence >= thresholds.weak).length;
  trace.push({
    step: "Check against attack patterns",
    detail: `${ruleHits ? `${ruleHits} match${ruleHits === 1 ? "" : "es"}` : "No matches"} across 9 attack types and 14 languages${input.toolFindings?.length ? `, plus ${input.toolFindings.length} tool-definition finding${input.toolFindings.length === 1 ? "" : "s"}` : ""}.`,
    ms: Math.round(now() - t),
    status: "ok",
    layer: "signature",
  });

  // 3. Trained classifier: catches paraphrased attacks the patterns miss, and confirms or questions pattern hits.
  const uncertain: Array<{ seg: Segment; start: number; end: number; p: number; type: AttackType | null }> = [];
  if (input.classifier) {
    t = now();
    let added = 0;
    let scored = 0;
    try {
      const baseEntry = input.classifierEntry ?? CLASSIFIER_ENTRY[mode];
      for (const seg of segments) {
        if (seg.role === "code" || seg.role === "code_string") continue;
        // Decoded text: score it whole. Encoding an instruction on purpose is itself a signal, so the bar is a little lower.
        if (seg.decodedVia) {
          if (seg.decodedVia === OCR_VIA || !seg.parentId || !seg.parentSpan || seg.text.trim().length < 16) continue;
          const [ps, pe] = seg.parentSpan;
          if (findings.some((f) => f.segmentId === seg.parentId && f.start < pe && f.end > ps && f.confidence >= thresholds.detect)) continue;
          const r = input.classifier.score(seg.text);
          scored++;
          const typo = seg.decodedVia === TYPO_VIA;
          if (r.p >= (typo ? baseEntry + 0.04 : baseEntry - 0.1)) {
            const parent = segments.find((x) => x.id === seg.parentId)!;
            const type: AttackType = r.type ?? (parent.provenance === "external" ? "indirect_injection" : "instruction_override");
            added++;
            findings.push({
              id: `${seg.id}.cd`,
              type,
              also: [...new Set<AttackType>([...(typo ? [] : (["encoded_instructions"] as AttackType[])), ...(parent.provenance === "external" ? (["indirect_injection"] as AttackType[]) : [])])].filter((x) => x !== type),
              segmentId: parent.id,
              start: ps,
              end: pe,
              quote: parent.text.slice(ps, Math.min(pe, ps + 300)),
              confidence: +Math.min(0.92, r.p * 0.7 + 0.12).toFixed(3),
              severity: 0.8,
              layer: "classifier",
              rule: input.classifier.name,
              why: typo
                ? `Read with its misspellings fixed ("${seg.text.slice(0, 140)}"), the trained classifier scores this as an attack (${Math.round(r.p * 100)}%).`
                : `Hidden with ${seg.decodedVia}. Decoded, it says: "${seg.text.slice(0, 160)}". The trained classifier scores the decoded text as an attack (${Math.round(r.p * 100)}%).`,
              decodedText: seg.text,
              decodedVia: seg.decodedVia,
            });
          }
          continue;
        }
        // Security-education text talks about attacks; ask for more certainty there.
        const entry = MENTION.test(seg.text) && seg.visibility === "visible" ? Math.min(0.97, baseEntry + 0.14) : baseEntry;
        // Short pieces are also scored whole: many attacks only read as one when taken together.
        const wholeLimit = seg.provenance === "user" ? 2500 : 600;
        const quotesAttacks = findings.some((f) => f.segmentId === seg.id && f.flags?.includes("mention"));
        const asksSomething = seg.provenance === "user" || (!listLike(seg.text) && sentences(seg.text).some((sp) => instructs(seg.text.slice(sp.start, sp.end))));
        if (asksSomething && !quotesAttacks && seg.text.length >= 40 && seg.text.length <= wholeLimit && !findings.some((f) => f.segmentId === seg.id && f.confidence >= thresholds.detect)) {
          const r = input.classifier.score(seg.text);
          scored++;
          if (r.p >= entry + 0.04) {
            added++;
            const type: AttackType = r.type ?? (seg.provenance === "external" ? "indirect_injection" : "instruction_override");
            findings.push({
              id: `${seg.id}.cw`,
              type,
              also: seg.provenance === "external" && type !== "indirect_injection" ? ["indirect_injection"] : [],
              segmentId: seg.id,
              start: 0,
              end: seg.text.length,
              quote: seg.text.slice(0, 300),
              confidence: +Math.min(0.92, r.p * 0.78 + (seg.visibility === "hidden" ? 0.18 : 0)).toFixed(3),
              severity: 0.75,
              layer: "classifier",
              rule: input.classifier.name,
              why: `Read as a whole, the trained classifier scores this as an attack (${Math.round(r.p * 100)}%), though no single pattern matched.`,
            });
            continue;
          }
        }
        for (const sp of sentences(seg.text)) {
          const s = seg.text.slice(sp.start, sp.end);
          if (s.trim().length < 20) continue;
          scored++;
          const r = input.classifier.score(s);
          const overlapping = findings.filter((f) => f.segmentId === seg.id && f.start < sp.end && f.end > sp.start);
          if (overlapping.length) {
            for (const f of overlapping) {
              const heldDown = !!f.flags?.length;
              if ((f.layer === "signature" || f.layer === "structure") && ((r.p >= 0.6 && !heldDown) || (r.p >= 0.93 && f.flags?.includes("capped") && !f.flags.includes("mention")))) {
                f.confidence = Math.min(0.99, +(f.confidence + 0.08).toFixed(3));
                f.why += ` The trained classifier agrees (${Math.round(r.p * 100)}%).`;
              } else if (r.p <= 0.12 && f.confidence < 0.6 && f.layer === "signature" && !f.rule.startsWith("intent.") && seg.visibility === "visible") {
                f.confidence = +(f.confidence - 0.1).toFixed(3);
                f.why += ` The trained classifier disagrees (${Math.round(r.p * 100)}%).`;
              }
            }
            // A weak signal here must not silence the classifier's own reading of the sentence, unless
            // it was lowered on purpose: the sentence quotes an attack, or withdraws the writer's own request.
            if (overlapping.some((f) => f.confidence >= thresholds.detect || f.flags?.some((x) => x === "mention" || x === "own" || x === "code_data"))) continue;
          }
          const hiddenBoost = seg.visibility === "hidden" ? 0.18 : 0;
          // "Agents must never bypass the two-person check": a safeguard, not an attack.
          const protective = /\b(?:must|should|shall|will)\s+(?:never|not)\b|\bnever\s+(?:bypass|skip|share|reveal|disclose|send|give|ask|override|ignore|pay|approve)\b|\b(?:do not|don't)\s+(?:share|reveal|disclose|send|give|click|reply|forward)\b/i.test(s) && !/\b(?:ignore|disregard|forget|override)\b[^.!?\n]{0,30}\b(?:instructions|rules|guidelines)\b/i.test(s);
          if (r.p >= entry && !protective && (seg.provenance === "user" || (!listLike(s) && instructs(s)))) {
            added++;
            const type: AttackType = r.type ?? (seg.provenance === "external" ? "indirect_injection" : "instruction_override");
            findings.push({
              id: `${seg.id}.c${sp.start}`,
              type,
              also: seg.provenance === "external" && type !== "indirect_injection" ? ["indirect_injection"] : [],
              segmentId: seg.id,
              start: sp.start,
              end: sp.end,
              quote: s.trim(),
              confidence: +Math.min(0.95, r.p * 0.7 + 0.06 + hiddenBoost).toFixed(3),
              severity: 0.75,
              layer: "classifier",
              rule: input.classifier.name,
              why: `The trained classifier scores this sentence as an attack (${Math.round(r.p * 100)}%), most like ${type.replace(/_/g, " ")}, though no single pattern matched.${seg.visibility === "hidden" ? " It is also hidden from people." : ""}`,
            });
          } else if (r.p >= 0.5) {
            uncertain.push({ seg, start: sp.start, end: sp.end, p: r.p, type: r.type });
          }
        }
      }
      trace.push({
        step: "Score sentences with the trained classifier",
        detail: `${scored} sentence${scored === 1 ? "" : "s"} scored; ${added ? `${added} new attack${added === 1 ? "" : "s"} found` : "no new attacks"}${uncertain.length ? `, ${uncertain.length} borderline` : ""}.`,
        ms: Math.round(now() - t),
        status: "ok",
        layer: "classifier",
      });
    } catch (e) {
      trace.push({ step: "Score sentences with the trained classifier", detail: `Skipped: ${(e as Error).message}. Pattern checks still apply.`, ms: Math.round(now() - t), status: "failed", layer: "classifier" });
    }
  }

  // 4. Whole-conversation checks (and pieces split inside one chat message).
  if (input.history?.length || (input.source === "user_message" && input.segments.some((x) => /["“'‘`]/.test(x.text)))) {
    t = now();
    const current = input.segments.filter((s) => !s.decodedVia).map((s) => s.text).join("\n");
    const clf = input.classifier;
    const res = analyzeSession(input.history ?? [], current, ctx, clf ? (x: string) => clf.score(x) : undefined);
    if (res) {
      segments.push(res.segment);
      findings.push(...res.findings);
    }
    const turnsN = (input.history?.length ?? 0) + 1;
    trace.push({
      step: turnsN > 1 ? "Check the whole conversation" : "Check for a request split into pieces",
      detail: res ? `${res.findings.length} multi-step pattern${res.findings.length === 1 ? "" : "s"}${turnsN > 1 ? ` across ${turnsN} turns` : ""}.` : turnsN > 1 ? `${turnsN} turns checked; no step-by-step attack.` : "No split request.",
      ms: Math.round(now() - t),
      status: "ok",
      layer: "session",
    });
  }

  findings = dedupe(findings);

  // 5. LLM judge, only for what is still unclear.
  const band = findings.filter((f) => f.confidence >= thresholds.weak - 0.05 && f.confidence < thresholds.detect + 0.12 && f.layer !== "judge");
  const items: Array<JudgeItem & { kind: "finding" | "sentence"; ref: any }> = [];
  for (const f of band.slice(0, 5)) {
    const seg = segments.find((s) => s.id === f.segmentId);
    if (!seg) continue;
    const s = Math.max(0, f.start - 240), e = Math.min(seg.text.length, f.end + 240);
    items.push({ id: `f:${f.id}`, text: seg.text.slice(s, e), where: seg.where, hidden: seg.visibility === "hidden", external: seg.provenance === "external", kind: "finding", ref: f });
  }
  for (const u of uncertain.slice(0, Math.max(0, 6 - items.length))) {
    items.push({ id: `s:${u.seg.id}:${u.start}`, text: u.seg.text.slice(Math.max(0, u.start - 200), Math.min(u.seg.text.length, u.end + 200)), where: u.seg.where, hidden: u.seg.visibility === "hidden", external: u.seg.provenance === "external", kind: "sentence", ref: u });
  }
  // Equal protection across languages: passages in Indian scripts (Devanagari included), in
  // Hinglish, or in other scripts the patterns cover more thinly (Arabic, CJK...) go to the judge
  // when it is on and nothing else flagged them. Outsiders' attacks in Indian languages slipped
  // past the free layers more often than English ones.
  if (input.judgeMode !== "off" && input.judge?.available) {
    for (const seg of segments.filter((x) => !x.decodedVia && x.id !== "session")) {
      if (items.length >= 6) break;
      const thin = (seg.text.match(/[\u0900-\u0D7F\u0600-\u06FF\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/g) || []).length;
      const hinglish = (seg.text.match(HINGLISH_WORDS) || []).length;
      if ((thin < 20 && hinglish < 3) || items.some((i) => i.where === seg.where) || findings.some((f) => f.segmentId === seg.id && f.confidence >= thresholds.detect)) continue;
      items.push({ id: `l:${seg.id}`, text: seg.text.slice(0, 600), where: seg.where, hidden: seg.visibility === "hidden", external: seg.provenance === "external", kind: "sentence", ref: { seg, start: 0, end: Math.min(seg.text.length, 600), p: 0.5, type: null } });
    }
  }
  // Strict mode on an agent that can act: the cheap layers miss some new wordings outright (no
  // signal at all), so the judge also reads outside content that raised nothing, up to six excerpts.
  if (input.judgeMode !== "off" && mode === "strict" && sideEffectTools(input.agent).length && input.judge?.available) {
    for (const seg of segments.filter((x) => !x.decodedVia && x.provenance === "external" && x.text.trim().length >= 24)) {
      if (items.length >= 6) break;
      if (items.some((i) => i.where === seg.where)) continue;
      items.push({ id: `x:${seg.id}`, text: seg.text.slice(0, 600), where: seg.where, hidden: seg.visibility === "hidden", external: true, kind: "sentence", ref: { seg, start: 0, end: Math.min(seg.text.length, 600), p: 0.5, type: null } });
    }
  }
  if (input.judgeMode === "force") {
    for (const seg of segments.filter((s) => !s.decodedVia).slice(0, 4)) {
      if (!items.some((i) => i.where === seg.where)) items.push({ id: `g:${seg.id}`, text: seg.text.slice(0, 3000), where: seg.where, hidden: seg.visibility === "hidden", external: seg.provenance === "external", kind: "sentence", ref: { seg, start: 0, end: Math.min(seg.text.length, 3000), p: 0.5, type: null } });
    }
  }
  let judgeCalls = 0;
  let costUsd = 0;
  // A judge that is switched on but fails is an anomaly, so borderline content is held. A judge
  // that is not switched on is a configuration: Warden decides exactly as in its measured setup.
  let judgeFailed = false;
  const judgeWanted = items.length > 0 && input.judgeMode !== "off";
  if (judgeWanted && input.judge?.available) {
    t = now();
    try {
      const { verdicts, costUsd: c } = await input.judge.judge(items.map(({ id, text, where, hidden, external }) => ({ id, text, where, hidden, external })));
      judgeCalls = 1;
      costUsd += c;
      let confirmed = 0, cleared = 0, rejected = 0;
      for (const v of verdicts) {
        const item = items.find((i) => i.id === v.id);
        if (!item) continue;
        const quoteOk = !v.injection || (v.quote && item.text.includes(v.quote.trim()));
        if (!quoteOk) {
          rejected++;
          continue;
        }
        if (item.kind === "finding") {
          const f = item.ref as Finding;
          if (v.injection && v.confidence >= 0.6) {
            f.confidence = Math.max(f.confidence, Math.min(0.95, 0.55 + v.confidence * 0.4));
            f.why += ` The LLM judge confirms: ${v.rationale}`;
            confirmed++;
          } else if (!v.injection && v.confidence >= 0.6) {
            f.confidence = +(f.confidence * 0.5).toFixed(3);
            f.why += ` The LLM judge clears it: ${v.rationale}`;
            cleared++;
          }
        } else if (v.injection && v.confidence >= 0.6) {
          const u = item.ref as { seg: Segment; start: number; end: number };
          const qStart = u.seg.text.indexOf(v.quote.trim());
          const start = qStart >= 0 ? qStart : u.start;
          const end = qStart >= 0 ? qStart + v.quote.trim().length : u.end;
          const type = v.types[0] ?? (u.seg.provenance === "external" ? "indirect_injection" : "instruction_override");
          findings.push({
            id: `${u.seg.id}.j${start}`,
            type,
            also: [...v.types.slice(1), ...(u.seg.provenance === "external" && type !== "indirect_injection" ? (["indirect_injection"] as AttackType[]) : [])],
            segmentId: u.seg.id,
            start,
            end,
            quote: u.seg.text.slice(start, end),
            confidence: Math.min(0.92, 0.5 + v.confidence * 0.4),
            severity: 0.8,
            layer: "judge",
            rule: input.judge.name,
            why: `The LLM judge found an attack the patterns missed: ${v.rationale}`,
          });
          confirmed++;
        }
      }
      trace.push({
        step: "Ask the LLM judge about unclear passages",
        detail: `${items.length} passage${items.length === 1 ? "" : "s"}: ${confirmed} confirmed, ${cleared} cleared${rejected ? `, ${rejected} answer${rejected === 1 ? "" : "s"} dropped because the quote was not in the text` : ""}.`,
        ms: Math.round(now() - t),
        status: "ok",
        layer: "judge",
      });
    } catch (e) {
      judgeFailed = true;
      trace.push({ step: "Ask the LLM judge about unclear passages", detail: `The judge did not answer (${(e as Error).message}). Unclear passages are treated cautiously instead.`, ms: Math.round(now() - t), status: "recovered", layer: "judge" });
    }
  } else if (judgeWanted) {
    trace.push({ step: "Ask the LLM judge about unclear passages", detail: `${items.length} unclear passage${items.length === 1 ? "" : "s"}, but the LLM judge is not switched on. Decided on patterns and the classifier alone.`, ms: 0, status: "skipped", layer: "judge" });
  }

  findings = dedupe(findings);

  // 6. Decide.
  t = now();
  const outcome = decide(findings, segments, { agent: input.agent, mode, degraded: input.degraded, judgeFailed });
  trace.push({
    step: "Decide",
    detail: `${outcome.headline} Risk ${outcome.risk}/100${sideEffectTools(input.agent).length ? `, stricter because this agent can ${sideEffectTools(input.agent).slice(0, 3).join(", ")}` : ""}.`,
    ms: Math.round(now() - t),
    status: "ok",
  });

  // 7. Clean and wrap.
  t = now();
  const n = neutralize(segments.filter((s) => s.id !== "session"), outcome.detected.filter((f) => f.segmentId !== "session"), outcome.decision, input.source);
  trace.push({
    step: "Cut the attack out and label the rest",
    detail: outcome.decision === "neutralize" ? `${n.removed} passage${n.removed === 1 ? "" : "s"} removed; the rest wrapped as outside data.` : outcome.decision === "allow" ? "Invisible characters stripped; content wrapped as outside data." : outcome.decision === "block" ? "Nothing passed on." : "Held back until a person approves it.",
    ms: Math.round(now() - t),
    status: "ok",
  });

  const plan = trace.map((s) => s.step);
  const ms = Math.round(now() - t0);
  const sorted = [...findings].filter((f) => f.confidence >= thresholds.weak).sort((a, b) => b.confidence * b.severity - a.confidence * a.severity);
  return {
    id: Math.random().toString(36).slice(2, 10),
    decision: outcome.decision,
    risk: outcome.risk,
    headline: outcome.headline,
    source: input.source,
    sourceGuessed: input.guessed,
    segments,
    humanView: n.humanView,
    aiView: n.aiView,
    findings: sorted,
    attackTypes: outcome.attackTypes,
    sanitized: { text: n.text, envelope: n.envelope, removed: n.removed },
    plan,
    trace,
    warnings: [...warnings, ...(input.notes ?? [])],
    stats: {
      chars: segments.filter((s) => !s.decodedVia && s.id !== "session").reduce((x, s) => x + s.text.length, 0),
      segments: segments.filter((s) => !s.decodedVia && s.id !== "session").length,
      hiddenSegments: hiddenCount,
      ms,
      judgeCalls,
      judgeItems: items.length,
      judgeChars: items.reduce((n, i) => n + i.text.length, 0),
      costUsd: +costUsd.toFixed(5),
    },
  };
}
