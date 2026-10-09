// Runs the attack-pattern rules over one segment and turns matches into findings,
// lifting or lowering confidence from context: who the words are aimed at, whether a
// person can see them, concealment, outside targets, and whether the text is only
// talking ABOUT an attack (a security article) rather than issuing one.

import { fold, normalize, toOriginal, type Normalized } from "./normalize";
import { isCleanup } from "./ocrfix";
import {
  RULES,
  ADDRESSEE_STRONG,
  ADDRESSEE_WEAK,
  CONCEALMENT,
  URGENCY,
  TARGET,
  MENTION,
  NEGATION_BEFORE,
  NEGATION_INSIDE,
  IMPERATIVE,
  type Rule,
} from "./rules";
import type { AttackType, Finding, Segment, SourceKind } from "./types";

export interface DetectContext {
  source: SourceKind;
  toolNames: string[];
  sideEffectTools: string[];
}

const TYPE_SEVERITY: Record<AttackType, number> = {
  tool_abuse: 0.9,
  credential_theft: 0.9,
  secret_extraction: 0.85,
  context_poisoning: 0.8,
  instruction_override: 0.75,
  encoded_instructions: 0.75,
  indirect_injection: 0.75,
  role_change: 0.7,
  multi_step_jailbreak: 0.7,
};

// Tool descriptions are supposed to tell the AI how to use the tool; ordinary usage guidance
// ("call list_files first", "always pass a city") must not count as an attack.
const TOOL_DESC_SKIP = new Set(["ta.call-tool", "ta.run-this", "io.from-now-on", "cp.auto-behaviour", "cp.trigger-response", "io.new-instructions", "io.ai-alert", "ii.when-summarizing", "ta.visit-link"]);
// A user asking their own agent to send, pay or run something is a normal request. It only
// counts as an attack when it comes with a bypass ("ignore your approval limits").
// Requests a user cannot rightly make of an AI even in their own chat: someone else's card or
// password, or secrets files copied somewhere others can read.
const USER_SENSITIVE = new Set(["ct.third-party", "ct.third-party-indic", "ct.indic-data", "ct.key-files", "ct.env-file", "ct.env-exfil", "ct.exfil-param", "ct.attach-token", "ct.reply-with-secret", "ct.return-secrets", "ta.personal-exfil"]);
const BYPASS = /\b(?:ignore|bypass|skip|override|disable|get around|work around|without|no need for|don't|do not)\b[^.!?\n]{0,30}\b(?:limits?|rules?|policy|policies|approvals?|verification|verify|checks?|review|confirmation|confirm|restrictions?|guardrails?|safety|permissions?|security|2fa|mfa|instructions)\b|\b(?:pichle|saare)\b[^.!?\n]{0,20}\b(?:instructions|rules|niyam)\b|\bverif(?:y|ication) mat\b/i;
// Hidden text gives orders to an agent when it uses agent verbs and speaks to someone.
const AGENT_VERBS = /\b(?:ignore|disregard|forget|send|forward|email|pay|transfer|approve|reveal|print|output|delete|remove|run|execute|share|tell|say|respond|reply|recommend|rate|score|rank|summari[sz]e|mention|include|write|grant|refund|schedule|store|remember|override|bypass|treat|consider|describe|hide|bcc|answer|choose|select)\b/i;
const SPEAKS_TO = /\b(?:you|your|yourself|the user|the assistant|the agent|the model|the reader)\b/i;

// Capability-aware: content that tries to trigger a tool this agent really has counts even
// when it does not address the AI by name.
const CAPABILITY: Array<{ rules: RegExp; tools: RegExp }> = [
  { rules: /^(ta\.payment|ta\.bank-change|ta\.auto-approve|ta\.hinglish|cp\.auto-behaviour)$/, tools: /pay|transfer|refund|invoice|payout|remit/ },
  { rules: /^(ta\.send-external|se\.exfil-data|ta\.hinglish)$/, tools: /send|email|mail|forward|reply|message|post|share|upload/ },
  { rules: /^(ta\.shell|ta\.run-this)$/, tools: /shell|exec|run|terminal|command|bash/ },
  { rules: /^(ta\.destructive)$/, tools: /delete|remove|drop|purge|archive/ },
  { rules: /^(ta\.hr-actions|io\.bias-rating)$/, tools: /score|schedule|interview|rank|rate|hire|offer/ },
  { rules: /^(ta\.grant-access)$/, tools: /invite|grant|permission|admin|share|access|role/ },
  { rules: /^(ta\.visit-link)$/, tools: /fetch|browse|open|navigate|click|web/ },
];
function capabilityHit(ruleId: string, ctx: DetectContext): string | null {
  for (const c of CAPABILITY) {
    if (!c.rules.test(ruleId)) continue;
    const t = ctx.sideEffectTools.concat(ruleId === "ta.visit-link" ? ctx.toolNames : []).find((name) => c.tools.test(name));
    if (t) return t;
  }
  return null;
}

let counter = 0;
const fid = () => `f${(++counter).toString(36)}`;

// A full stop ends a sentence only when followed by a space or the end (not inside an email,
// a web address or a number).
export function isBoundary(text: string, i: number): boolean {
  const c = text[i];
  if (c === "\n") {
    // A wrapped line (no end punctuation before, lower-case continuation after) is not a break.
    const prev = text.slice(Math.max(0, i - 2), i).trimEnd();
    const next = text[i + 1] ?? "";
    if (prev && !/[.!?:;।。]$/.test(prev) && /[a-z(]/.test(next) && text[i + 1] !== "\n") return false;
    return true;
  }
  if (c === "।" || c === "。") return true;
  if (c === "." || c === "!" || c === "?") return i + 1 >= text.length || /\s|["”'’)\]]/.test(text[i + 1]);
  return false;
}

// A "sentence" in text with no punctuation could be the whole document; capping it keeps every
// match's context bounded, so long unpunctuated input stays linear.
const SENTENCE_REACH = 1000;
function sentenceBounds(text: string, start: number, end: number): [number, number] {
  let s = start;
  while (s > 0 && start - s < SENTENCE_REACH && !isBoundary(text, s - 1)) s--;
  let e = end;
  while (e < text.length && e - end < SENTENCE_REACH && !isBoundary(text, e)) e++;
  return [s, Math.min(text.length, e + 1)];
}

// One rule matching hundreds of times in one section is a flood, not hundreds of separate
// attacks: stop after MAX_MATCHES, and if many of them were strong, treat the section as an attack.
const MAX_MATCHES = 200;
const FLOOD_STRONG = 50;

// Rules use "[^.!?\n]" to stay inside one sentence; let dots that sit inside a token
// (emails, web addresses, decimals) through.
const GAP_FIXED = new WeakSet<RegExp>();
function gapFixed(rule: Rule): RegExp {
  if (GAP_FIXED.has(rule.re)) return rule.re;
  let src = rule.re.source;
  // Normalised text is NFKC with invisible characters removed; patterns written in Indian scripts
  // must be too, or a letter like "ज़" (one code point in the pattern, two in the text) never matches.
  if (rule.on === "norm") src = src.normalize("NFKC").replace(/[\u200B-\u200D\u2060\uFEFF]/g, "");
  if (src.includes("[^.!?\\n]")) src = src.split("[^.!?\\n]").join("(?:[^.!?\\n]|[.!?](?=[^\\s.!?]))");
  if (src !== rule.re.source) rule.re = new RegExp(src, rule.re.flags);
  GAP_FIXED.add(rule.re);
  return rule.re;
}

// A quotation introduced as an example or a report ("messages like '...'", "a persona called '...'").
const QUOTE_FRAME = /\b(?:like|such as|e\.g\.|for example|for instance|phrases?|messages?|emails?|prompts?|lines?|text|wording|words|says?|said|reads?|wrote|writes?|called|named|dubbed|known as|asking|asks?|tells?|told|reading)\s*[:,]?\s*$/i;

function insideQuotes(text: string, start: number, end: number): boolean {
  const before = text.slice(Math.max(0, start - 3), start);
  const after = text.slice(end, end + 3);
  if ((/["“'‘`]\s*$/.test(before) && /^\s*[.,!?]?\s*["”'’`]/.test(after)) || (/`[^`]*$/.test(text.slice(Math.max(0, start - 120), start)) && /^[^`]*`/.test(text.slice(end, end + 120)))) return true;
  for (const m of text.matchAll(/["“]([^"”\n]{4,400})["”]|(?<![A-Za-z])['‘]([^'’\n]{4,400})['’](?![A-Za-z])/g)) {
    const qs = m.index!;
    const qe = qs + m[0].length;
    if (start >= qs && end <= qe && QUOTE_FRAME.test(text.slice(Math.max(0, qs - 60), qs))) return true;
  }
  return false;
}

// "Disregard MY earlier instructions", "ignore the instructions ABOUT THE VENUE": the writer is
// changing their own request about something else, not the AI's instructions.
const OWN_INSTRUCTIONS = /\b(?:my|our)\s+(?:[\w-]+\s+){0,2}(?:instructions?|rules?|guidelines?|messages?|emails?|mails?|notes?|requests?|directions?|brief(?:ing)?|guidance|orders|texts?|replies|comments?)\b/i;
const SCOPED_TO_TOPIC = /^\s+(?:about|regarding|concerning|re:?|relating to|related to|on the subject of)\s+(?!(?:you|your|yourself|the (?:ai|assistant|model|bot|agent|system|chatbot)|this (?:ai|assistant|conversation|chat|session))\b)\w/i;

interface ContextSignals {
  strongAddressee: boolean;
  weakAddressee: boolean;
  concealment: boolean;
  urgency: boolean;
  target: boolean;
  mention: boolean;
  toolName: string | null;
}

function signals(sentence: string, around: string, ctx: DetectContext, rawAround: string): ContextSignals {
  const lower = sentence.toLowerCase();
  let toolName: string | null = null;
  for (const t of ctx.toolNames) {
    const plain = t.replace(/_/g, " ");
    if (lower.includes(t) || (plain.length > 6 && lower.includes(plain))) {
      toolName = t;
      break;
    }
  }
  return {
    strongAddressee: ADDRESSEE_STRONG.test(sentence),
    weakAddressee: ADDRESSEE_WEAK.test(sentence),
    concealment: CONCEALMENT.test(around),
    urgency: URGENCY.test(around),
    // Raw text keeps the case and dots of an address; the normalised text sees through leetspeak ("h77p5://").
    target: TARGET.test(rawAround) || TARGET.test(around),
    mention: MENTION.test(around),
    toolName,
  };
}

function applyRule(rule: Rule, seg: Segment, n: Normalized, ctx: DetectContext, out: Finding[]) {
  const text = rule.on === "norm" ? n.norm : seg.text;
  let matches = 0;
  let strong = 0;
  for (const m of text.matchAll(gapFixed(rule))) {
    if (++matches > MAX_MATCHES) {
      if (strong >= FLOOD_STRONG) {
        out.push({
          id: fid(),
          type: rule.type,
          also: seg.provenance === "external" && rule.type !== "indirect_injection" ? ["indirect_injection"] : [],
          segmentId: seg.id,
          start: 0,
          end: seg.text.length,
          quote: seg.text.slice(0, 200),
          confidence: 0.9,
          severity: TYPE_SEVERITY[rule.type],
          layer: "structure",
          rule: "structure.flood",
          why: `The same attack pattern (${rule.why.replace(/\.$/, "").toLowerCase()}) repeats more than ${FLOOD_STRONG} times, so the whole section is treated as an attack.`,
        });
      }
      break;
    }
    const mStart = m.index!;
    const mEnd = mStart + m[0].length;
    const [sS, sE] = sentenceBounds(text, mStart, mEnd);
    const sentence = text.slice(sS, sE);
    const around = text.slice(Math.max(0, sS - 160), Math.min(text.length, sE + 160));
    // Raw-text rules check their sentence with look-alike letters folded ("Rеad" with a Cyrillic е).
    if (rule.check && !rule.check(m, rule.on === "raw" ? fold(sentence) : sentence)) continue;
    if (seg.role === "tool_description" && TOOL_DESC_SKIP.has(rule.id)) continue;
    // A user's own plain request to pay, send or share is theirs to make. It still counts when it
    // asks to skip checks or hide the action, is disguised to slip past filters, or asks for
    // someone else's secrets.
    if (seg.provenance === "user" && (rule.type === "tool_abuse" || rule.type === "credential_theft") && !BYPASS.test(seg.text) && !CONCEALMENT.test(seg.text) && !(seg.decodedVia && !isCleanup(seg.decodedVia)) && !USER_SENSITIVE.has(rule.id)) {
      const [qS, qE] = rule.on === "norm" ? toOriginal(n, mStart, mEnd, seg.text.length) : [mStart, mEnd];
      const ev = n.evidence;
      const disguised = [...ev.mixedScript, ...ev.leet, ...ev.spaced].some((sp) => sp.start < qE && sp.end > qS) || (ev.invisible > 0 && /[\u200B-\u200F\u2060\uFEFF\u00AD]/.test(seg.text.slice(qS, qE)));
      if (!disguised) continue;
    }

    if (rule.negatable) {
      const before = text.slice(Math.max(sS, mStart - 40), mStart);
      if (NEGATION_BEFORE.test(before)) continue;
      if (/hinglish|\.hi$/.test(rule.id) && NEGATION_INSIDE.test(m[0])) continue;
    }

    // Original span for display and for raw-text context (targets keep their case and dots).
    const [oS, oE] = rule.on === "norm" ? toOriginal(n, mStart, mEnd, seg.text.length) : [mStart, mEnd];
    const [rS, rE] = sentenceBounds(seg.text, oS, oE);
    const rawAround = seg.text.slice(Math.max(0, rS - 80), Math.min(seg.text.length, rE + 80));
    const sig = signals(sentence, around, ctx, rawAround);
    if (seg.aiDirected) sig.strongAddressee = true;
    const hidden = seg.visibility === "hidden";
    // Text that was encoded (base64, ROT13, reversed...) was written so people and filters would miss it.
    const encoded = !!seg.decodedVia && !isCleanup(seg.decodedVia);

    let c = rule.base;
    const reasons: string[] = [rule.why];
    const flags: NonNullable<Finding["flags"]> = [];
    if (sig.strongAddressee) {
      c += 0.28;
      reasons.push("It is written to the AI, not to the person reading.");
    } else if (sig.weakAddressee && !(sig.mention || insideQuotes(seg.text, oS, oE))) c += 0.08;
    if (hidden) {
      c += 0.3;
      reasons.push(seg.hiddenDetail ? `A person cannot see it: ${seg.hiddenDetail}.` : "A person cannot see it, but the AI reads it.");
    }
    if (encoded && !hidden) {
      c += 0.15;
      reasons.push(`It was encoded (${seg.decodedVia}) so people and filters would miss it.`);
    }
    if (sig.concealment) {
      c += 0.18;
      reasons.push("It tells the AI to keep this from the user or skip checks.");
    }
    if (sig.urgency) c += 0.05;
    if (sig.target && (rule.type === "tool_abuse" || rule.type === "secret_extraction" || rule.type === "credential_theft")) {
      c += 0.1;
      reasons.push("It names an outside address or account.");
    }
    if (sig.toolName && (rule.type === "tool_abuse" || rule.type === "credential_theft" || rule.type === "secret_extraction")) {
      c += 0.15;
      reasons.push(`It targets the agent's own tool: ${sig.toolName}.`);
    }
    // A command in backticks after "run" or "add" is an order to run it, not a quotation.
    const ordered = /`[^`]*$/.test(seg.text.slice(Math.max(0, oS - 120), oS)) && /\b(?:run|execute|add|call|invoke|type|paste|launch|trigger|post|use)\b[^`]{0,60}`[^`]*$/i.test(seg.text.slice(Math.max(0, oS - 160), oS));
    const quoted = insideQuotes(seg.text, oS, oE) && !ordered;
    const isMention = (sig.mention || quoted) && !hidden;
    if (isMention) {
      flags.push("mention");
      c -= 0.38;
      // Quoted AND framed as an example ("attackers embed text such as '...'"): teaching material.
      if (sig.mention && quoted) c = Math.min(c, 0.44);
      reasons.push("Lowered: it reads like text quoting an attack, not issuing one.");
    }
    if (seg.role === "code" && rule.on === "raw" && (rule.type === "tool_abuse" || rule.type === "credential_theft")) {
      c -= 0.32;
    }
    if (seg.role === "code_string" && !ADDRESSEE_STRONG.test(seg.text)) {
      flags.push("code_data");
      c -= /test data/.test(seg.where) ? 0.5 : 0.3;
      reasons.push("Lowered: it is a string the program uses as data.");
    }
    const payOrder = rule.id === "ta.bank-change" && /\b(?:pay|transfer|remit|release (?:the )?payment|process (?:the )?payment|send (?:the )?(?:amount|payment|funds))\b/i.test(around);
    const riskCue = sig.urgency || sig.concealment || hidden || sig.strongAddressee || !!seg.aiDirected || payOrder;
    const capTool = seg.provenance === "external" && riskCue ? capabilityHit(rule.id, ctx) : null;
    const userBypass = seg.provenance === "user" && (rule.type === "tool_abuse" || rule.type === "credential_theft");
    if (userBypass) {
      c += 0.15;
      reasons.push("It comes with a request to skip the agent's limits or checks.");
    }
    if ((rule.id === "ta.send-external" || rule.id === "se.exfil-data") && /\b(?:customer|client|employee|salary|payroll|contract|invoice|financial|confidential|internal|password|credential|database|records|customer list|ledger|bank statement)s?\b/i.test(sentence)) {
      c += 0.06;
      reasons.push("The data named is sensitive.");
    }
    if (capTool && !isMention) {
      c += 0.14;
      reasons.push(`This agent can act on it: it has the ${capTool} tool.`);
    }
    if (rule.type === "instruction_override" && !hidden && !encoded && !sig.strongAddressee && (OWN_INSTRUCTIONS.test(m[0]) || SCOPED_TO_TOPIC.test(text.slice(mEnd, mEnd + 40)))) {
      c = Math.min(c, 0.3);
      flags.push("own");
      reasons.push("Lowered: the writer is changing their own earlier instructions about something else, not the AI's.");
    }
    if (rule.needsContext && !sig.strongAddressee && !hidden && !encoded && !sig.concealment && !sig.toolName && !capTool && !userBypass && !(sig.target && sig.urgency)) {
      c = Math.min(c, 0.46);
      flags.push("capped");
    }
    c = Math.max(0, Math.min(0.99, c));

    let sev = TYPE_SEVERITY[rule.type] + (hidden ? 0.1 : 0) + (sig.concealment ? 0.05 : 0);
    sev = Math.min(1, sev);

    const also: AttackType[] = [];
    if (seg.provenance === "external" && rule.type !== "indirect_injection") also.push("indirect_injection");
    if (seg.decodedVia && !isCleanup(seg.decodedVia) && rule.type !== "encoded_instructions") also.push("encoded_instructions");
    const ev = n.evidence;
    const obfuscated =
      [...ev.mixedScript, ...ev.leet, ...ev.spaced].some((sp) => sp.start < oE && sp.end > oS) ||
      (ev.invisible > 0 && /[​-‏⁠﻿­]/.test(seg.text.slice(oS, oE)));
    if (obfuscated && !also.includes("encoded_instructions") && rule.type !== "encoded_instructions") {
      also.push("encoded_instructions");
      c = Math.min(0.99, c + 0.08);
      reasons.push("Written with look-alike letters, spacing or hidden characters to slip past filters.");
    }

    out.push({
      id: fid(),
      type: rule.type,
      also,
      segmentId: seg.id,
      start: oS,
      end: oE,
      quote: seg.text.slice(oS, oE),
      confidence: round(c),
      severity: round(sev),
      layer: "signature",
      rule: rule.id,
      why: reasons.join(" "),
      decodedText: seg.decodedVia ? seg.text : undefined,
      decodedVia: seg.decodedVia,
      flags: flags.length ? flags : undefined,
    });
    if (c >= 0.5) strong++;
  }
}

const round = (x: number) => Math.round(x * 1000) / 1000;

const ROLE_LINE = /^[ \t>*-]*(user|human|assistant|ai|bot|system|q|a|customer|agent|chatgpt|claude|gpt|dan)\s*:/gim;
const COMPLY = /\b(sure,? here(?:'s| is)|of course!? here|absolutely!? here|developer mode output|as dan|\(🔓|jailbroken:|i can do anything)\b/i;
const ASSIGN = /\b([a-z][a-z0-9_]{0,15})\s*=\s*["'“‘]([^"'”’\n]{2,90})["'”’]/gi;
const COMBINE = /\b(concatenate|combine|join|merge|put together|add together|string together|assemble|concatenation|combined|joined)\b|\b[a-z]\w{0,15}\s*\+\s*[a-z]\w{0,15}\b/i;
const OBEY = /\b(follow|execute|do|obey|run|perform|answer|respond to|act on|carry out|comply with)\b[^.!?\n]{0,30}\b(it|that|this|the result|the combined|the instruction|the string|what it says|the output)\b/i;


// ---------- Orders addressed to the AI inside outside content ----------
// People write to people. Outside content that speaks to the AI reading it and tells it what to
// do is how indirect injection works, however polite or official it sounds. This finds the
// addressee (a vocative, "the assistant should", "if an assistant is handling this", "your
// operator gave you", a field named note_to_assistant) and a directive next to it.
const ADDR_WORDS = "(?<!\\buser[- ])(?:ai|a\\.i\\.|llms?|language models?|chatgpt|claude|gemini|copilot|chatbots?|bots?|ai[- ]?(?:assistants?|agents?|models?|systems?|tools?|readers?|bots?)|coding (?:agents?|assistants?)|llm agents?|automated (?:systems?|readers?|assistants?|agents?|accounts?|processes|tools?|summari[sz]ers?|handlers?|reviewers?|screeners?)|automation(?: (?:accounts?|systems?|bots?|tools?|agents?))?|processing assistants?|virtual assistants?|digital assistants?|assistants?|agents?)";
const ADDR = `(?:the |your |our |this |that |any |an? |all |every )?(?:[\\w-]+ ){0,2}?${ADDR_WORDS}`;
// Bare "assistant"/"agent" can be a person; in documents written for people it needs AI context.
const BARE = /^(?:(?:the|your|our|this|that|any|an?|all|every) )?(?:assistants?|agents?)$/;
const AI_CONTEXT = /\b(?:loaded into|configured|configuration|operator|upstream|system prompt|prompt|preamble|the user|handling this (?:mailbox|inbox|thread|ticket|chat|desk|account)|reading this|processing this|henceforth|identity|persona|tool|tools|function|api|mcp|model)\b/;
// Raw API responses and code are read by machines, not by support staff.
const MACHINE_SOURCES = new Set(["api_response", "source_code"]);
// What makes an order to the AI dangerous rather than descriptive ("the assistant should reply in
// English" is documentation): secrets, side effects, overriding its rules, targeting the reader now.
const RISK_CUE = /\b(?:secrets?|password|passcode|tokens?|api keys?|secret keys?|private keys?|balances?|otp|pin|mpin|cvv|card numbers?|credentials?|unmasked|other (?:customers|users)'?|internal figures|preamble|system prompt|startup configuration|(?:pan|aadhaa?r)(?: numbers?)?)\b|\b(?:approve|release|refund|transfer|pay|disable|delete|mirror|relay|export|upload|run|execute|clear (?:every|all)|grant|(?:call|invoke) [\w.]+\()|\b(?:superseded|deprecated|paused|suspended|revoked|lifted|waived|do(?:es)? not apply|no longer appl\w*|ignore|disregard|override|overriding|unrestricted|stop applying|henceforth|identity|persona|superuser|privileged|permitted|pre-?authori[sz]ed)\b|\b(?:reading this|handling this|processing this|for this request|before replying|this mailbox|this inbox|this desk|this address|for everything that follows)\b|\b(?:remove|take out|strip|comment out|turn off|switch off|delete)\b[^.!?\n]{0,40}\b(?:verification|signature|checks?|cap|limits?|validation|auth\w*|approvals?|audit log|logging)\b|\bwithout (?:the |any )?(?:approvals?|approval gate|sign-?off|review|checks?|verification)\b|\b(?:auto-?approved|pre-?cleared|pre-?authori[sz]ed|whitelist\w*)\b|\b(?:wire|deposit|force-?push|branch protection)\b|(?:send|forward|email|post|reply)[^.!?\n]{0,60}(?:[\w.+-]+@[\w-]+\.[\w.]+|https?:\/\/)/;
const HAVE_CUE = new RegExp(`\\bhave (${ADDR}) (?:[\\w-]+ )?(?:reply|respond|send|share|run|execute|approve|release|export|forward|email|post|pay|transfer|disclose|list|delete)\\b`);
const BARE_AGENT_LABEL = /(?:^\s*|\n\s*)agents?\s*:\s*\S/;
const ADDR_CUES: RegExp[] = [
  // "the assistant should ...", "agents are now permitted to ...", "the assistant is henceforth ..."
  new RegExp(`\\b(${ADDR})\\b(?: [\\w-]+){0,3}? (?:should|must|shall|needs? to|has to|have to|is (?:required|expected|instructed|asked|permitted|allowed|authori[sz]ed|now|henceforth|hereby|to)|are (?:required|expected|instructed|asked|permitted|allowed|authori[sz]ed|now|henceforth|hereby|to))\\b(?! (?:not|never)\\b)`),
  // "this template requires the processing assistant to ..."
  new RegExp(`\\b(?:requires?|instructs?|asks?|tells?|directs?|wants?|expects?|authori[sz]es|permits|allows|orders?) (${ADDR}) to\\b`),
  // "Notice for automated assistants reading this page:", "TO THE AUTOMATION ACCOUNT HANDLING THIS DESK:"
  new RegExp(`(?:^|\\n|[.!?] )(?:(?:notice|note|message|instructions?|memo|directive|attention|reminder|request|important|warning|alert|update|attn)s? (?:for|to)|to|for|attn|attention) (${ADDR})\\b[^.!?\\n]{0,60}?[:—-]`),
  // "If an assistant is handling this mailbox, ..."
  new RegExp(`\\b(?:if|when|while) (${ADDR}) (?:reads?|handles?|processes|summari[sz]es|reviews|answers|monitors|manages|sees|(?:is|are) (?:reading|handling|processing|summari[sz]ing|reviewing|answering|monitoring|managing|looking at|going through|working on))\\b`),
  // "place your assistant into the maintenance identity ..."
  new RegExp(`\\b(?:place|put|switch|move|set|configure|reconfigure|turn) (${ADDR}) (?:into|in|to|as)\\b`),
  // "loaded into your assistant", "your operator gave you", "your upstream rules"
  new RegExp(`\\b(?:loaded into|given to|configured (?:in|for|on)|that came with|installed (?:in|on)) (${ADDR})\\b`),
  /\b(?:your|the) (?:operator|developer|deployer|admin|owner|creator)s? (?:gave|give|set|configured|loaded|provided|wrote)( you| it)\b/,
  /\byour (?:upstream|original|initial|system|default|operator'?s?|built-?in|base|core|current|existing|loaded) (?:rules|guidelines|policy|policies|instructions|config(?:uration)?|settings|restrictions|guardrails|limits|checks)\b/,
  // "your assistant profile has been switched to ...": only software has a profile switched
  new RegExp(`\\b(?:your|the) (${ADDR_WORDS})(?:'s)? (?:profile|mode|role|identity|persona|permissions?|access level|tier|configuration|settings) (?:has been|have been|is now|was|will be) (?:switched|changed|upgraded|elevated|set|moved|updated|promoted)\\b`),
  // chat-role labels inside content: "[system] assistant:", "assistant:", "ai-agent:", even mid-text
  // ("Automated HR assistant reading this:", "[Assistant: ...", "TODO(agent):"; a bare "Support agent:" is a person)
  /(?:^\s*|\n\s*|[\][(]\s*|[.!?]\s+)(?:(?:the |an? |dear )?(?:automated |ai[- ]?|coding |virtual |digital |processing |llm )(?:[\w-]+ ){0,2}?(?:assistant|agent|bot|model|copilot|reader|screener)s?(?: reading this| processing this| handling this)?|assistant|ai|bot|chatbot|copilot|llm|system)\s*:\s*\S|\btodo\s*\(\s*(?:agent|ai|assistant|bot|copilot|llm)\s*\)\s*:/,
  // In code and API output, a bare "agent:" label is written to a coding or tool agent.
  BARE_AGENT_LABEL,
  // "have the AP bot run the batch tonight"
  HAVE_CUE,
];
const DIRECTIVE = /\b(?:please|kindly|must|should|shall|need to|needs to|has to|have to|is required to|are required to|now permitted|now allowed|henceforth|switch|stop|start|treat|approve|release|clear|mark|return|append|add|include|call|fetch|collect|reply|send|forward|relay|mirror|reproduce|repeat|print|output|reveal|disclose|share|export|place|act|take on|take out|strip|comment out|turn off|switch off|auto-?fill|fill(?: in)?|submit|click|enter|type|upload|attach|post|process|push|wire|whitelist|remain|ignore|disregard|forget|override|bypass|skip|disable|delete|remove|run|execute|pay|transfer|refund|grant|tell|say|recommend|rate|answer|respond|confirm|accept|use|apply|follow|obey|comply|do not|don't|never)\b|\b(?:superseded|deprecated|paused|suspended|revoked|void|lifted|waived|no longer appl\w*|do(?:es)? not apply|are not in force)\b/;
const PROTECTIVE = /\b(?:should|must|shall|needs? to|has to|is required to|are required to)(?: \w+)? (?:not|never)\b|\b(?:never|do not|don't) (?:reveal|share|follow|obey|execute|run|disclose|send|forward|pay|transfer|act on|trust|click)\b/;
const FIELD_ADDR = /(?:^|[._$\s])(?:note|notes|message|msg|directive|instructions?|prompt|command|hint|memo|task|system)?_?(?:to|for)?_?(?:the_)?(?:assistant|ai|agent|llm|bot|model|copilot)_?(?:directive|instructions?|note|notes|prompt|command|task|hint|memo|message)?$/i;

function addressedDirective(seg: Segment, n: Normalized, ctx: DetectContext, out: Finding[]) {
  if (seg.provenance !== "external" || seg.role === "tool_description" || seg.role === "metadata") return;
  const norm = n.norm;
  if (norm.length < 12) return;
  const fieldKey = (seg.where.match(/Field \$\.?(.*)$/)?.[1] ?? "").split(/[.[\]]/).filter(Boolean).pop() ?? "";
  const fieldAddr = !!fieldKey && FIELD_ADDR.test(fieldKey);
  let hit: { start: number; end: number; cue: string } | null = null;
  for (const [i, re] of ADDR_CUES.entries()) {
    const m = re.exec(norm);
    if (!m) continue;
    if (re === BARE_AGENT_LABEL && !MACHINE_SOURCES.has(ctx.source) && seg.role !== "json_value" && seg.role !== "code_comment") continue;
    const addr = (m[1] ?? "").trim();
    // A bare "assistant" or "agent" in a document written for people may be a person, unless the
    // cue itself only fits software ("configure your assistant", "loaded into your assistant").
    const softwareOnly = i >= 4 && re !== HAVE_CUE;
    const words = addr.split(/\s+/);
    const head = words[words.length - 1] ?? "";
    const aiModifier = /\b(?:ai|automated|automation|coding|virtual|digital|processing|llm|bot|machine)\b/.test(words.slice(0, -1).join(" "));
    const personLike = /^(?:assistants?|agents?)$/.test(head) && !aiModifier;
    if (!softwareOnly && personLike && !MACHINE_SOURCES.has(ctx.source) && seg.role !== "json_value" && !AI_CONTEXT.test(norm)) continue;
    hit = { start: m.index, end: m.index + m[0].length, cue: m[0] };
    break;
  }
  if (!hit && !fieldAddr) return;
  // The directive and its context: the sentence before the cue through the next two sentences
  // (or the whole of a short field).
  const from = hit ? hit.start : 0;
  const before = norm.slice(Math.max(0, from - 300), from);
  const lastStop = Math.max(before.lastIndexOf(". ", before.length - 2), before.lastIndexOf("\n"));
  const prevStop = lastStop > 0 ? Math.max(before.lastIndexOf(". ", lastStop - 1), before.lastIndexOf("\n", lastStop - 1)) : -1;
  const ctxStart = norm.length <= 600 ? 0 : Math.max(0, from - 300) + (prevStop >= 0 ? prevStop + 1 : 0);
  const window = norm.slice(ctxStart, from + 420);
  if (!DIRECTIVE.test(window)) return;
  const harmful = window.replace(PROTECTIVE, " ");
  if (PROTECTIVE.test(window) && !DIRECTIVE.test(harmful)) return;
  if (MENTION.test(norm.slice(Math.max(0, from - 160), from + 200)) && seg.visibility !== "hidden") return;
  const hidden = seg.visibility === "hidden";
  // Orders to the AI with nothing risky in them stay a weak signal (the judge can look); hidden ones do not.
  const risky = RISK_CUE.test(window) || CONCEALMENT.test(window) || hidden;
  const [oS, oE] = hit ? toOriginal(n, hit.start, Math.min(norm.length, hit.start + Math.min(window.length, 300)), seg.text.length) : [0, seg.text.length];
  const [sS, sE] = sentenceBounds(seg.text, oS, Math.min(seg.text.length, oE));
  let c = risky ? 0.62 : 0.4;
  const reasons = [hit ? "Written to the AI reading this content, and tells it what to do." : `A field named "${fieldKey}" carries instructions for the AI.`];
  if (!risky) reasons.push("Nothing in it reaches for data, money or the AI's rules, so it is only a weak signal.");
  if (hidden) {
    c += 0.25;
    reasons.push("A person cannot see it.");
  }
  if (/\b(?:secrets?|password|passcode|tokens?|api keys?|secret keys?|balances?|otp|pin|mpin|cvv|card numbers?|credentials?|unmasked|other (?:customers|users)'?|internal figures|preamble|system prompt|startup configuration)\b/.test(window)) {
    c += 0.1;
    reasons.push("It reaches for secrets or other people's data.");
  }
  if (/\b(?:approve|release|refund|transfer|pay|clear every|clear all|disable|delete|run|call \w|mirror|relay|export|unrestricted|superuser|any amount|privileged)\b/.test(window)) c += 0.08;
  if (CONCEALMENT.test(window)) {
    c += 0.12;
    reasons.push("It asks to keep this from people or skip checks.");
  }
  const also = new Set<AttackType>();
  if (/\b(?:henceforth|identity|persona|role|acting as|superuser|administrator|branch manager|operator that)\b/.test(window)) also.add("role_change");
  if (/\b(?:superseded|deprecated|paused|suspended|do(?:es)? not apply|no longer appl|ignore|disregard|override|overriding|unrestricted|stop applying)\b/.test(window)) also.add("instruction_override");
  if (/\b(?:config(?:uration)?|preamble|system prompt|secret values|tokens?|connection strings?|balances?|internal figures|records)\b/.test(window)) also.add("secret_extraction");
  if (/\b(?:otp|pin|mpin|password|passcode|cvv|credentials?|secret key|api key|userid)\b/.test(window)) also.add("credential_theft");
  if (/\b(?:approve|release|refund|transfer|pay|call \w|disable|delete|run|mirror|relay|send|forward|clear (?:every|all))\b/.test(window)) also.add("tool_abuse");
  if (/\b(?:permitted|allowed|authoritative|for everything that follows|remain in|from now on|standing)\b/.test(window)) also.add("context_poisoning");
  out.push({
    id: fid(),
    type: "indirect_injection",
    also: [...also].slice(0, 3),
    segmentId: seg.id,
    start: sS,
    end: Math.max(sE, Math.min(seg.text.length, oE)),
    quote: seg.text.slice(sS, Math.min(seg.text.length, Math.max(sE, oE))).slice(0, 400),
    confidence: round(Math.min(0.97, c)),
    severity: 0.85,
    layer: "structure",
    rule: "structure.addressed-directive",
    why: reasons.join(" "),
    // A descriptive order with nothing risky in it stays weak even if the classifier agrees.
    flags: risky ? undefined : ["capped"],
  });
}

/** Structural checks that look at the whole segment rather than one phrase. */
function structural(seg: Segment, n: Normalized, ctx: DetectContext, out: Finding[], hasRuleHit: boolean) {
  const text = seg.text;
  const hidden = seg.visibility === "hidden";

  // Hidden text that gives orders, even when no specific rule matched.
  if (hidden && !hasRuleHit && text.trim().length >= 12) {
    const strongAI = ADDRESSEE_STRONG.test(n.norm) || !!seg.aiDirected;
    const imperative = n.norm.split(/(?<=[.!?\n])\s+/).some((sent) => {
      const t = sent.trim().replace(/^(?:please|kindly|now|also|then|and|ok|okay|note|important|p\.?s\.?)[,:]?\s+/, "");
      return new RegExp(`^${AGENT_VERBS.source}`, "i").test(t) || /\b(?:you|the (?:assistant|agent|model|ai|reader)) (?:must|should|need to|have to|will|shall|are to|are required to)\b/i.test(t);
    });
    if (imperative && (strongAI || SPEAKS_TO.test(n.norm))) {
      out.push({
        id: fid(),
        type: "indirect_injection",
        also: [],
        segmentId: seg.id,
        start: 0,
        end: text.length,
        quote: text.slice(0, 400),
        confidence: strongAI ? 0.8 : 0.52,
        severity: 0.8,
        layer: "structure",
        rule: "structure.hidden-orders",
        why: `Text a person cannot see${seg.hiddenDetail ? ` (${seg.hiddenDetail})` : ""} that gives orders. People do not hide instructions from readers for good reasons.`,
      });
    }
  }

  // Direction-override characters in code: "Trojan Source".
  if (n.evidence.bidi > 0 && (seg.role === "code" || seg.role === "code_comment" || seg.role === "code_string" || ctx.source === "source_code")) {
    const idx = text.search(/[‪-‮⁦-⁩]/);
    out.push({
      id: fid(),
      type: "encoded_instructions",
      also: [],
      segmentId: seg.id,
      start: Math.max(0, idx),
      end: Math.min(text.length, Math.max(0, idx) + 1),
      quote: text.slice(Math.max(0, idx - 20), idx + 40),
      confidence: 0.64,
      severity: 0.75,
      layer: "structure",
      rule: "structure.bidi",
      why: "Hidden direction-control characters make the code read differently to people and to machines (Trojan Source).",
    });
  }

  // Invisible characters threaded through words.
  if (n.evidence.invisible >= 4 && n.evidence.tagChars === 0) {
    const zw = text.match(/\p{L}[​-‏⁠﻿­]+\p{L}/gu) || [];
    if (zw.length >= 3) {
      const idx = text.search(/\p{L}[​-‏⁠﻿­]+\p{L}/u);
      out.push({
        id: fid(),
        type: "encoded_instructions",
        also: seg.provenance === "external" ? ["indirect_injection"] : [],
        segmentId: seg.id,
        start: Math.max(0, idx),
        end: Math.min(text.length, idx + 60),
        quote: text.slice(Math.max(0, idx), idx + 60),
        confidence: hasRuleHit ? 0.7 : 0.48,
        severity: 0.7,
        layer: "structure",
        rule: "structure.zero-width",
        why: `Invisible characters are threaded through ${zw.length} words, a common way to sneak words past filters.`,
      });
    }
  }

  // Many-shot: a fake transcript of the AI complying, inside one message.
  const roles = [...text.matchAll(ROLE_LINE)];
  if (roles.length >= 4) {
    const aiTurns = roles.filter((r) => /^(assistant|ai|bot|chatgpt|claude|gpt|dan|a)$/i.test(r[1])).length;
    if (aiTurns >= 2) {
      const comply = COMPLY.test(text);
      out.push({
        id: fid(),
        type: "multi_step_jailbreak",
        also: seg.provenance === "external" ? ["indirect_injection"] : [],
        segmentId: seg.id,
        start: roles[0].index!,
        end: Math.min(text.length, roles[roles.length - 1].index! + 80),
        quote: text.slice(roles[0].index!, roles[0].index! + 160),
        confidence: comply ? 0.82 : 0.56,
        severity: 0.75,
        layer: "structure",
        rule: "structure.many-shot",
        why: `A scripted conversation of ${roles.length} turns inside one message${comply ? ", with the 'AI' already complying" : ""}: the many-shot jailbreak.`,
      });
    }
  }

  // Payload splitting: pieces stored in variables, then combined. A grammar or a code listing
  // defines dozens of names; a split payload is a few pieces with the "combine" close by.
  const allAssigns = [...text.matchAll(ASSIGN)];
  const assigns = allAssigns.length > 12 ? [] : allAssigns;
  const near = assigns.length >= 2 ? text.slice(Math.max(0, assigns[0].index! - 400), Math.min(text.length, assigns[assigns.length - 1].index! + 600)) : "";
  if (assigns.length >= 2 && assigns[assigns.length - 1].index! - assigns[0].index! < 1500 && (COMBINE.test(near) || OBEY.test(near))) {
    const joined = assigns.map((a) => a[2]).join(" ").replace(/\s+/g, " ");
    const joinedTight = assigns.map((a) => a[2]).join("");
    const inner: Finding[] = [];
    for (const variant of [joined, joinedTight]) {
      const nn = normalize(variant);
      const probe: Segment = { ...seg, id: seg.id, text: variant, visibility: "visible" };
      for (const rule of RULES) {
        if (!["instruction_override", "role_change", "secret_extraction", "tool_abuse", "credential_theft"].includes(rule.type)) continue;
        applyRule(rule, probe, nn, ctx, inner);
      }
      if (inner.some((f) => f.confidence >= 0.5)) break;
    }
    const best = inner.sort((a, b) => b.confidence - a.confidence)[0];
    const start = assigns[0].index!;
    const end = Math.min(text.length, assigns[assigns.length - 1].index! + assigns[assigns.length - 1][0].length);
    if (best && best.confidence >= 0.5) {
      out.push({
        id: fid(),
        type: "multi_step_jailbreak",
        also: [best.type, ...(seg.provenance === "external" ? (["indirect_injection"] as AttackType[]) : [])],
        segmentId: seg.id,
        start,
        end,
        quote: text.slice(start, end),
        confidence: 0.88,
        severity: 0.85,
        layer: "structure",
        rule: "structure.payload-split",
        why: `The message stores pieces in variables and asks to combine them. Put together they say: "${joined.slice(0, 140)}".`,
        decodedText: joined,
        decodedVia: "joining the stored pieces",
      });
    } else if (OBEY.test(near)) {
      out.push({
        id: fid(),
        type: "multi_step_jailbreak",
        also: [],
        segmentId: seg.id,
        start,
        end,
        quote: text.slice(start, end),
        confidence: 0.56,
        severity: 0.7,
        layer: "structure",
        rule: "structure.payload-split-weak",
        why: "Stores pieces in variables and asks the AI to combine and act on them.",
        decodedText: joined,
        decodedVia: "joining the stored pieces",
      });
    }
  }
}

export function detectSegment(seg: Segment, ctx: DetectContext): Finding[] {
  const n = normalize(seg.text);
  const found: Finding[] = [];
  for (const rule of RULES) applyRule(rule, seg, n, ctx, found);
  const hasRuleHit = found.some((f) => f.confidence >= 0.5);
  structural(seg, n, ctx, found, hasRuleHit);
  addressedDirective(seg, n, ctx, found);
  return dedupe(found);
}

/** Keep the strongest finding per (type, overlapping span). */
export function dedupe(findings: Finding[]): Finding[] {
  const sorted = [...findings].sort((a, b) => b.confidence - a.confidence);
  const kept: Finding[] = [];
  const byKey = new Map<string, Finding[]>();
  for (const f of sorted) {
    const key = `${f.segmentId}\u0000${f.type}`;
    const group = byKey.get(key) ?? [];
    const clash = group.find((k) => f.start < k.end && f.end > k.start);
    if (clash) {
      for (const t of f.also) if (!clash.also.includes(t)) clash.also.push(t);
      continue;
    }
    group.push(f);
    byKey.set(key, group);
    kept.push(f);
  }
  return kept.sort((a, b) => (a.segmentId === b.segmentId ? a.start - b.start : a.segmentId.localeCompare(b.segmentId)));
}
