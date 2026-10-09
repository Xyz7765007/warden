// Task binding. Content the agent reads should inform the user's task, not add new ones.
// This finds requests inside outside content ("please transfer...", "send this list to...")
// and checks them against what the user actually asked. A request to pay, send, share,
// delete, unlock or sell that the user never asked for is how indirect injection steers an
// agent, even when it is written as an ordinary polite sentence.

import { normalize } from "./normalize";
import type { AttackType, Finding, Segment } from "./types";

interface Category {
  key: string;
  label: string;
  verbs: RegExp;
  task: RegExp;
  tool: RegExp;
}

const CATEGORIES: Category[] = [
  { key: "payment", label: "move money", verbs: /\b(?:pay|transfer|wire|remit|withdraw|deposit|refund|(?:initiate|process|make|complete|execute|release|approve|authori[sz]e) (?:a |the |this |that |an |our )?(?:payment|transfer|wire|remittance|refund|payout|funds|amount|disbursement)|settle (?:the |this |our |an |any )?(?:amount|invoice|bill|balance|dues|outstanding)|clear (?:the |this |our )?(?:payment|dues|invoice|bill|balance)|send (?:money|funds|a payment|the payment|\$|rs\.?|₹|inr))\b/, task: /\b(?:pay|transfer|refund|remit|wire|settle|disburse)\w*\b/, tool: /pay|transfer|bank|refund|wallet|venmo|paypal|wire|payout|remit/ },
  { key: "trade", label: "buy or sell", verbs: /\b(?:sell|buy|purchase|place (?:an? )?order|trade|invest|short)\b/, task: /\b(?:sell|buy|purchase|order|trade|invest)\w*\b/, tool: /order|trade|binance|coinbase|buy|sell|shop|purchase|amazon|invest/ },
  { key: "send", label: "send or share data", verbs: /\b(?:send|email|e-mail|mail|forward|share|post|publish|upload|tweet|message|dm|text|cc|bcc)\b/, task: /\b(?:send|forward|share|post|publish|upload|tweet|reply|notify|email (?:it|this|them|that|the|a|an|my|to|him|her)|mail (?:it|this|them|to)|message (?:him|her|them|to))\w*\b/, tool: /send|email|mail|gmail|share|post|tweet|message|slack|upload|publish|reply|forward/ },
  { key: "delete", label: "delete data", verbs: /\b(?:delete|remove|erase|wipe|purge|drop|destroy)\b/, task: /\b(?:delete|remove|erase|wipe|clean|purge|clear|tidy)\w*\b/, tool: /delete|remove|erase|purge|drop|trash/ },
  { key: "modify", label: "change records or settings", verbs: /\b(?:update|change|modify|edit|alter|rename|reset|replace|overwrite)\b/, task: /\b(?:update|change|modify|edit|alter|rename|reset|replace|fix|correct)\w*\b/, tool: /update|edit|modify|set|change|write|patch|reset/ },
  { key: "access", label: "grant or remove access", verbs: /\b(?:grant|revoke|unlock|lock|invite|disable|deactivate|add [^.!?\n]{0,30} as (?:an? )?(?:admin|guest|owner|member|collaborator))\b/, task: /\b(?:grant|unlock|lock|invite|revoke|disable|deactivate|add (?:\w+ )?(?:as|to))\w*\b/, tool: /grant|access|lock|unlock|invite|permission|guest|admin|security|2fa|identity/ },
  { key: "device", label: "control a device or service", verbs: /\b(?:turn (?:on|off)|switch (?:on|off)|play|dispatch|schedule|book|redirect|reroute|cancel|guide|move|navigate|drive|operate|activate|set (?:the |my )?(?:thermostat|light|lights|alarm|temperature|traffic light|state))\b/, task: /\b(?:turn|switch|play|dispatch|schedule|book|redirect|cancel|guide|move|navigate|drive|operate|activate|set)\w*\b/, tool: /light|thermostat|lock|speaker|device|dispatch|emergency|traffic|schedule|calendar|appointment|shipment|ship|fedex|alarm|book|robot|drone|car|vehicle/ },
  { key: "run", label: "run code or install software", verbs: /\b(?:run|execute|install|download|launch|deploy|generate a deepfake|generate)\b/, task: /\b(?:run|execute|install|download|launch|deploy|build|test|generate)\w*\b/, tool: /run|exec|shell|terminal|install|deploy|deepfake|generate|script/ },
];

const GATHER_THEN_SEND = /\b(?:retrieve|retrive|get|fetch|find|search(?: for)?|list|look up|read|access|extract|collect|gather|check|export)\b[^.!?\n]{0,120}?\b(?:and|then|,)\s+(?:then\s+)?(?:send|email|e-mail|mail|forward|share|post|upload|message)\b/;
const REQUEST_START = /^(?:(?:p\.?s\.?|note|also|then|and|first|next|finally|ok|okay)[,:]?\s+)?(?:(?:please|pls|kindly)\s+|(?:can|could|would|will) you(?: please)?\s+|i (?:want|need|would like) you to\s+|you (?:must|should|need to|have to)\s+|go ahead and\s+|make sure (?:to|you)\s+|be sure to\s+)?/;
const SENSITIVE = /\b(?:password|passcode|pin|otp|credentials?|bank|account|card|ssn|aadhaa?r|pan|medical|health|diagnos\w*|genetic|dna|location|address(?:es)?|contacts?|history|records?|files?|documents?|photos?|emails?|messages?|data|statement|logs?|keys?|tokens?|secrets?|salary|payroll|confidential|private|personal|identity|recordings?|voice)\b/;
const TARGET = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|https?:\/\/\S+|\bwww\.\S+|\b\d{6,}\b|\b[a-z]{2,}[_-]?\d{2,}\b|['"][^'"]{3,40}['"]|\b(?:id|account|acct|payee|number|no)\s*[:#]?\s*[a-z0-9-]{3,}/i;
const FIRST_PERSON = /\b(?:my|mine|me)\b/;
const GENERIC_TOOL_WORDS = new Set(["get", "list", "search", "read", "view", "details", "info", "information", "fetch", "find", "retrieve", "manage", "show", "check", "query", "lookup", "data", "tool", "with", "from", "send", "email", "user", "account", "file", "files", "items", "item", "post", "posts", "create", "update", "delete", "message", "messages", "note", "notes", "event", "events"]);
const NEGATED = /\b(?:cannot|can't|can not|will not|won't|does not|doesn't|do not|don't|is not able to|isn't able to|unable to|not able to|never|not allowed to|may not|must not)\b/;
const RECIPIENT = /\bto\s+(?:[\w.+-]+@[\w-]+\.[\w.]+|https?:\/\/|www\.|(?:the |our |your |my )?(?:\w+ )?(?:team|vendor|customer|client|address|email|inbox|link|url|server|endpoint|account|number|channel|group)\b|me\b|us\b|them\b|him\b|her\b|[A-Z][a-z]+)|[\w.+-]+@[\w-]+\.[\w.]+|https?:\/\/|\b(?:outside|external|personal)\b/;
const URGENT = /\b(?:immediately|right now|asap|urgently|at once|without delay|now)\b/;

function words(name: string) {
  return name.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase();
}

function requestSentences(text: string): Array<{ start: number; end: number; s: string }> {
  const out: Array<{ start: number; end: number; s: string }> = [];
  const re = /(?:[^.!?\n]|[.!?](?=\S))+[.!?]?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const raw = m[0];
    const lead = raw.length - raw.trimStart().length;
    const s = raw.trim();
    if (s.length < 12) continue;
    const start = m.index + lead;
    out.push({ start, end: start + s.length, s });
    // A request can start mid-sentence: "Amazon Discount: Please sell...", "new flavor, Please unlock..."
    for (const inner of s.matchAll(/(?:[:;,\u2014-]\s*|\s)(?=(?:please|pls|kindly|can you|could you|would you|i (?:want|need) you to)\s)|[:;,]\s+(?=[A-Z][a-z]{2,}\s)/gi)) {
      const at = inner.index! + inner[0].length;
      if (at <= 2) continue;
      out.push({ start: start + at, end: start + s.length, s: s.slice(at) });
    }
    const colon = s.search(/:\s+\S/);
    if (colon > 0 && colon < s.length - 8) {
      const at = colon + s.slice(colon).search(/\S/, ) + 1;
      const at2 = colon + 1 + (s.slice(colon + 1).length - s.slice(colon + 1).trimStart().length);
      out.push({ start: start + at2, end: start + s.length, s: s.slice(at2) });
      void at;
    }
  }
  return out;
}

export function intentFindings(seg: Segment, task: string | undefined, toolNames: string[]): Finding[] {
  if (seg.provenance !== "external" || seg.role === "tool_description" || seg.role === "code" || seg.role === "metadata") return [];
  const toolWords = toolNames.map(words);
  const taskNorm = task ? normalize(task).norm : "";
  const out: Finding[] = [];
  for (const sent of requestSentences(seg.text)) {
    const n = normalize(sent.s).norm;
    const lead = n.match(REQUEST_START)?.[0] ?? "";
    const rest = n.slice(lead.length);
    const gather = GATHER_THEN_SEND.test(n);
    const asks = lead.length > 0 || CATEGORIES.some((c) => new RegExp(`^${c.verbs.source}`).test(rest)) || gather;
    if (!asks) continue;
    // The action verb has to open the request ("please SEND...", "TRANSFER..."), not sit later as a noun.
    const opener = rest.replace(/^(?:immediately|quickly|also|then|now|just|first|urgently|go ahead and|make sure to)\s+/, "");
    // "Change of address", "Update on shipment", "Transfer details": noun phrases, not orders.
    if (!lead && /^(?:change|update|transfer|payment|refund|delete|deletion|share|order|cancel|cancellation|access|invite|post|upload|download|install|schedule|booking|book|move|reset|lock|unlock|set|run) (?:of|on|in|for|to|request|requests|details|notice|summary|status|confirmation|history|policy|form|reminder|alert)\b/.test(opener)) continue;
    // Invoice and cheque labels: "Pay to A/C ...", "Payable to ...", "Remit to ...".
    if (!lead && /^(?:pay|remit|payable|remittance) (?:to|in favou?r of)\b/.test(opener)) continue;
    if (!lead && (seg.role === "subject" || seg.role === "header")) continue;
    let cats = CATEGORIES.filter((c) => new RegExp(`^(?:${c.verbs.source})`).test(opener) || (gather && c.key === "send"));
    // "The assistant cannot process payments": a statement of what will not happen, not a request.
    if (NEGATED.test(n.slice(0, Math.max(0, n.length - opener.length) + 30))) continue;
    // A request inside quotation marks is being reported ("a message saying 'share your credentials'").
    const before120 = seg.text.slice(Math.max(0, sent.start - 200), sent.start + 1);
    if ((before120.match(/["“]/g) || []).length % 2 === 1 || /\b(?:saying|says|said|like|such as|e\.g\.)\s*['"“‘]/i.test(seg.text.slice(Math.max(0, sent.start - 40), sent.start + 200))) continue;
    // ... including a negation earlier in the same sentence: "cannot process payments, reset your password ..."
    const lead0 = seg.text.slice(Math.max(0, sent.start - 120), sent.start);
    const clause = lead0.slice(Math.max(lead0.lastIndexOf(". "), lead0.lastIndexOf("\n")) + 1);
    if (NEGATED.test(normalize(clause).norm)) continue;
    // "Send your API token in the Authorization header" is a docs instruction; a send needs a recipient.
    if (cats.length === 1 && cats[0].key === "send" && !gather && !RECIPIENT.test(sent.s)) continue;
    // A request that names one of the agent's own tools by its words ("home robot", "lock").
    const toolHit = toolWords.find((w) => w.split(" ").some((tw) => tw.length >= 4 && !GENERIC_TOOL_WORDS.has(tw) && new RegExp(`\\b${tw}`).test(n)));
    if (!cats.length && toolHit && lead.length > 0) cats = [{ key: "tool", label: `use its "${toolHit}" tool`, verbs: /./, task: new RegExp(toolHit.split(" ").filter((x) => x.length >= 4 && !GENERIC_TOOL_WORDS.has(x)).join("|") || "$^"), tool: /./ }];
    if (!cats.length) continue;
    // Requests the user's own task already covers are the user's business, not an injection.
    // Even when the user asked to send or pay, an outside address or account the user never
    // mentioned makes the request foreign.
    const targets = (sent.s.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|https?:\/\/\S+/gi) || []).map((x) => x.toLowerCase());
    const newTarget = targets.some((x) => !taskNorm.includes(x));
    const foreign = cats.filter((c) => !task || !c.task.test(taskNorm) || (c.key === "send" && newTarget));
    if (!foreign.length) continue;
    const cat = foreign[0];
    const capTool = toolWords.find((w) => foreign.some((c) => c.key !== "tool" && c.tool.test(w))) ?? (toolHit && foreign.some((c) => c.key === "tool") ? toolHit : undefined);
    const ctxText = seg.text.length < 400 ? seg.text : sent.s;
    let c = task ? 0.44 : 0.34;
    const reasons: string[] = [];
    if (task) reasons.push(`The content asks the agent to ${cat.label}, which the user never asked for (the user asked: "${task.slice(0, 90)}").`);
    else reasons.push(`The content asks the agent to ${cat.label}.`);
    if (capTool) {
      c += 0.06;
      reasons.push(`This agent could do it (it has a "${capTool}" tool).`);
    }
    if (TARGET.test(ctxText)) {
      c += 0.08;
      reasons.push("It names a specific target, account or ID.");
    }
    if (SENSITIVE.test(n)) c += 0.06;
    if (FIRST_PERSON.test(n)) {
      c += 0.04;
      reasons.push('It speaks as if it were the user ("my account").');
    }
    if (gather) {
      c += 0.06;
      reasons.push("It asks for data to be collected and sent out.");
    }
    if (URGENT.test(n)) c += 0.03;
    if (seg.visibility === "hidden") {
      c += 0.2;
      reasons.push("It is hidden from people.");
    }
    const type: AttackType = gather || (cat.key === "send" && SENSITIVE.test(n)) ? "secret_extraction" : "tool_abuse";
    out.push({
      id: `${seg.id}.i${sent.start}`,
      type,
      also: type === "secret_extraction" ? ["tool_abuse", "indirect_injection"] : ["indirect_injection"],
      segmentId: seg.id,
      start: sent.start,
      end: sent.end,
      quote: sent.s.slice(0, 300),
      confidence: +Math.min(0.9, c).toFixed(3),
      severity: 0.85,
      layer: "signature",
      rule: task ? "intent.task-mismatch" : "intent.request",
      why: reasons.join(" "),
    });
  }
  return out;
}
