// Multi-turn checks. Some jailbreaks are harmless one message at a time: a persona set up
// early and exploited later, pieces stored across turns and combined at the end, or a slow
// escalation (Crescendo). This looks at the conversation as a whole.

import { detectSegment, type DetectContext } from "./detect";
import type { AttackType, Finding, Segment } from "./types";

const STORE = /\b(remember|store|save|keep|hold|note)\b[^.!?\n]{0,40}\b(this|that|it|the (?:word|phrase|part|piece|first part|second part|variable|code word)|[a-z]\s*=)/i;
// "Now combine the two parts I gave you", "join both fragments", "put the pieces together".
const RECALL = /\b(?:combine|join|merge|put (?:\w+ ){0,3}?together|concatenate|assemble|glue|stitch|use|apply|follow|do|execute|run|say|answer with)\b[^.!?\n]{0,40}\b(?:what i (?:told|gave|sent) you|the (?:[\w-]+ ){0,3}?(?:parts?|pieces?|words?|phrases?|variables?|fragments?|halves|half|bits?|lines?|strings?|snippets?|sentences?|segments?|chunks?)|both|all of (?:them|it)|them|these|those)\b|\b(?:parts?|pieces?|fragments?|phrases?|halves)\b[^.!?\n]{0,30}\b(?:together|combined|joined)\b|\b(?:put|stick|glue|piece|string) (?:these|them|those|both|all|the (?:[\w-]+ ){0,3}?(?:parts?|pieces?|fragments?|words?|phrases?|halves|bits?|lines?|strings?|snippets?|sentences?|segments?|chunks?)) together\b/i;
// Quoted pieces: the closing quote must match the opening one, so apostrophes inside survive.
const QUOTED = /"([^"\n]{2,200})"|“([^”\n]{2,200})”|(?<![A-Za-z])'([^'\n]{2,200})'(?![A-Za-z])|‘([^’\n]{2,200})’|`([^`\n]{2,200})`/g;
const quoted = (t: string) => [...t.matchAll(QUOTED)].map((m) => m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5]);
// What a jailbreak is usually after: wording made to deceive people, or working code and commands
// to steal credentials or switch off oversight.
const HARMFUL_ASK = new RegExp(
  [
    "\\b(?:write|draft|compose|create|give me|generate|craft|produce)\\b[^.!?\\n]{0,50}\\b(?:message|email|script|text|pitch|template|wording|lines?|sms|call script)\\b[^.!?\\n]{0,100}\\b(?:scammers?|fraudsters?|phish(?:ing|er)?|social engineering|attackers?|to trick|to fool|to con|to deceive|impersonat\\w*)",
    "\\b(?:command|commands|script|code|steps|way|payload|tool)\\b[^.!?\\n]{0,40}\\b(?:to |that |which |he uses to |she uses to |they use to )?(?:dump|steal|exfiltrate|extract|harvest|skim|scrape|crack|brute-?force|sniff)\\b[^.!?\\n]{0,40}\\b(?:credentials?|passwords?|keys?|tokens?|cards?|upi|otps?|pins?|logins?|cookies)",
    "\\b(?:switch|turn) off (?:the )?(?:audit|logging|monitoring|alerts?)|\\bdisable (?:the )?(?:audit log|logging|monitoring|alerts?|edr|antivirus)",
    // Hinglish: "how to reset / pull out the admin password"
    "\\b(?:admin )?(?:password|pin|otp)\\b[^.!?\\n]{0,30}\\b(?:kaise|kis tarah)\\b[^.!?\\n]{0,25}\\b(?:reset|nikaal|nikal|nikaala|crack|hack|chura|churaa|tod)",
  ].join("|"),
  "i"
);
// A word agreed earlier to mean "set your rules aside", used now.
const CODEWORD_DEF = /\b(?:whenever|when|if|each time) i (?:say|type|write|use)\s+["'“‘]([^"'”’\n]{2,30})["'”’]|\bthe word ["'“‘]([^"'”’\n]{2,30})["'”’] (?:means|stands for|is short for)\b|\b(?:code ?word|shorthand|safe ?word|trigger (?:word|phrase)|magic word|password)\b[^.!?\n]{0,40}["'“‘]([^"'”’\n]{2,30})["'”’]/i;
const LOOSENS = /\b(?:set aside|ignore|drop|skip|bypass|lift|switch off|turn off|disregard|forget|override|suspend|without)\b[^.!?\n]{0,40}\b(?:restrictions?|rules?|filters?|limits?|guidelines?|policies|policy|safety|checks?|guardrails?|warnings?|approvals?)\b|\bno (?:restrictions?|rules|filters?|limits|warnings|refusals)\b|\bcomply with no\b/i;
// "Hypothetically, which step would someone skip?" then "now actually do that".
const HYPOTHETICAL = /\b(?:hypothetically|in theory|theoretically|just curious|purely curious|for a story|imagine|what if|in a real hurry|if someone wanted to)\b/i;
const REAL_NOW = /\b(?:now|so|right|okay|ok)\b[^.!?\n]{0,20}\b(?:actually|really|for real|go ahead and)\b[^.!?\n]{0,15}\b(?:do|skip|bypass|push|run|send|pay|release|approve|apply)\b|\bdo that (?:skip|bypass|trick|step) for\b/i;
// A story or game used as a wrapper.
const FICTION = /\b(?:story|scene|chapter|novel|screenplay|character|role-?play|game|let's play|pretend|fiction|imagine|kahani|kahaani|kirdar|kirdaar|natak|khel)\b|রোলপ্লে|অভিনয়|গল্প|कहानी|किरदार|नाटक|கதை/i;
// The last turn asks the AI to act on whatever the pieces say.
const EXECUTE = /\bdo what (?:it|they|this|that|these) (?:says?|tells? you|asks?)\b|\b(?:follow|execute|run|carry out|act on|obey|perform)\b[^.!?\n]{0,20}\b(?:it|them|the (?:result|combined|joined|full) (?:text|sentence|instruction|message)?|the instructions?)\b/i;
const ASSIGN = /\b([a-z][a-z0-9_]{0,15})\s*=\s*["'“‘]([^"'”’\n]{2,90})["'”’]/gi;

export function analyzeSession(
  history: string[],
  current: string,
  ctx: DetectContext,
  score?: (text: string) => { p: number; type: AttackType | null }
): { segment: Segment; findings: Finding[] } | null {
  const turns = [...history, current].filter((t) => t && t.trim());
  if (!turns.length) return null;
  // One message can split a payload too: "combine these: part one is '...' and part two is '...'".
  const single = turns.length === 1;
  const segment: Segment = {
    id: "session",
    text: turns.length === 1 ? `Turn 1: ${turns[0]}` : turns.map((t, i) => `Turn ${i + 1}: ${t}`).join("\n"),
    where: turns.length === 1 ? "This message, pieces joined" : `Conversation so far (${turns.length} turns)`,
    visibility: "visible",
    role: "turn",
    provenance: "user",
  };
  const perTurn = turns.map((t, i) => detectSegment({ id: `turn${i}`, text: t, where: `Turn ${i + 1}`, visibility: "visible", role: "turn", provenance: "user" }, ctx));
  const maxConf = perTurn.map((fs) => fs.reduce((m, f) => Math.max(m, f.confidence), 0));
  const findings: Finding[] = [];
  const offsetOf = (turn: number) => segment.text.indexOf(`Turn ${turn + 1}: `);
  const last = turns.length - 1;

  // 1. Pieces stored across turns, then combined. Once a turn starts storing, quoted text in the
  // turns after it counts too ("And this one: ...").
  const stored: string[] = [];
  let storing = false;
  if (single) {
    for (const m of turns[0].matchAll(ASSIGN)) stored.push(m[2]);
    if (RECALL.test(turns[0])) stored.push(...quoted(turns[0]));
  }
  for (let i = 0; i < last; i++) {
    const t = turns[i];
    for (const m of t.matchAll(ASSIGN)) stored.push(m[2]);
    if (STORE.test(t)) storing = true;
    if (storing) stored.push(...quoted(t));
  }
  // Pieces that only make an attack when joined: flagged when the last turn asks to combine or
  // act on them, or, without that, when the joined text is a clear attack on its own.
  const recall = RECALL.test(turns[last]);
  if (stored.length >= 2) {
    const o = offsetOf(last);
    let flagged = false;
    for (const joined of [stored.join(" "), stored.join("")]) {
      // The pieces were split up to get past a filter, so the joined text gets no benefit of the
      // doubt: it is checked as outside text written to the AI.
      const probe = detectSegment({ id: "joined", text: joined, where: "joined", visibility: "visible", role: "turn", provenance: "external", aiDirected: true }, ctx);
      const best = probe.filter((f) => f.type !== "indirect_injection" || probe.length === 1).sort((a, b) => b.confidence - a.confidence)[0];
      let conf = best?.confidence ?? 0;
      let type: AttackType | null = best?.type ?? null;
      let how = "";
      if (conf < 0.5 && score) {
        const r = score(joined);
        if (r.p >= 0.6) {
          conf = 0.5 + r.p * 0.3;
          type = r.type ?? type;
          how = ` The trained classifier scores the joined text as an attack (${Math.round(r.p * 100)}%).`;
        }
      }
      if (conf >= (recall ? 0.5 : 0.8)) {
        findings.push({
          id: "s1",
          type: "multi_step_jailbreak",
          also: type && type !== "multi_step_jailbreak" && type !== "indirect_injection" ? [type] : [],
          segmentId: segment.id,
          start: o,
          end: o + turns[last].length + 8,
          quote: turns[last].slice(0, 200),
          confidence: recall ? 0.9 : 0.7,
          severity: 0.85,
          layer: "session",
          rule: "session.split-payload",
          why: `${single ? "This message splits a request into pieces and asks to combine them." : recall ? "Earlier turns stored pieces of text; this turn asks to combine them." : "Earlier turns stored pieces of text that read as an attack once joined."} Put together they read: "${joined.slice(0, 140)}".${how}`,
          decodedText: joined,
          decodedVia: "joining pieces from earlier turns",
        });
        flagged = true;
        break;
      }
    }
    if (!flagged && recall && EXECUTE.test(turns[last])) {
      findings.push({
        id: "s1b",
        type: "multi_step_jailbreak",
        also: [],
        segmentId: segment.id,
        start: o,
        end: o + turns[last].length + 8,
        quote: turns[last].slice(0, 200),
        confidence: 0.56,
        severity: 0.7,
        layer: "session",
        rule: "session.assemble-and-run",
        why: `Earlier turns stored pieces of text; this turn asks the AI to put them together and do what they say: "${stored.join(" ").slice(0, 140)}". Splitting an instruction across turns is a way to slip it past filters.`,
        decodedText: stored.join(" "),
        decodedVia: "joining pieces from earlier turns",
      });
    }
  }

  if (single) return findings.length ? { segment, findings } : null;

  // 1b. A codeword agreed earlier to loosen the rules, now used.
  for (let i = 0; i < last; i++) {
    const d = CODEWORD_DEF.exec(turns[i]);
    const word = (d?.[1] ?? d?.[2] ?? d?.[3] ?? "").trim().toLowerCase();
    if (word.length >= 2 && LOOSENS.test(turns[i]) && turns[last].toLowerCase().includes(word)) {
      const o = offsetOf(last);
      findings.push({
        id: "s5",
        type: "multi_step_jailbreak",
        also: ["instruction_override"],
        segmentId: segment.id,
        start: o,
        end: o + turns[last].length + 8,
        quote: turns[last].slice(0, 200),
        confidence: 0.86,
        severity: 0.85,
        layer: "session",
        rule: "session.codeword",
        why: `Turn ${i + 1} agreed that "${word}" means setting the rules aside; this turn uses it.`,
      });
      break;
    }
  }

  // 1c. A hypothetical about skipping a check, then "now actually do that".
  if (history.some((t) => HYPOTHETICAL.test(t) && LOOSENS.test(t.replace(/\bskip\b/i, "skip checks"))) && REAL_NOW.test(turns[last])) {
    const o = offsetOf(last);
    findings.push({
      id: "s6",
      type: "multi_step_jailbreak",
      also: ["tool_abuse"],
      segmentId: segment.id,
      start: o,
      end: o + turns[last].length + 8,
      quote: turns[last].slice(0, 200),
      confidence: 0.78,
      severity: 0.85,
      layer: "session",
      rule: "session.hypothetical-then-real",
      why: "An earlier turn asked hypothetically how to get around a check; this turn asks to do it for real.",
    });
  }

  // 2. A persona or rule change set up earlier, then used to ask for something sensitive, or for
  // the content a jailbreak is usually after (a scam script, a phishing message).
  const setupTurn = perTurn.slice(0, last).findIndex((fs) => fs.some((f) => (f.type === "role_change" || f.type === "instruction_override" || f.type === "context_poisoning") && f.confidence >= 0.38));
  const harmfulAsk = HARMFUL_ASK.test(turns[last]);
  const payoff = perTurn[last].find((f) => ["secret_extraction", "tool_abuse", "credential_theft"].includes(f.type) && f.confidence >= 0.3) ?? (harmfulAsk ? ({ type: "multi_step_jailbreak" } as Finding) : undefined);
  // A story, game or persona set up earlier counts as the setup when what follows is harmful.
  const frameTurn = harmfulAsk ? history.findIndex((t) => FICTION.test(t) || /\bnever refuses?\b|\bstay in character\b/i.test(t)) : -1;
  if ((setupTurn >= 0 || frameTurn >= 0) && payoff) {
    const o = offsetOf(last);
    findings.push({
      id: "s2",
      type: "multi_step_jailbreak",
      also: [payoff.type],
      segmentId: segment.id,
      start: o,
      end: o + turns[last].length + 8,
      quote: turns[last].slice(0, 200),
      confidence: 0.82,
      severity: 0.85,
      layer: "session",
      rule: "session.setup-then-use",
      why: `Turn ${(setupTurn >= 0 ? setupTurn : frameTurn) + 1} ${setupTurn >= 0 ? "tried to change the AI's role or rules" : "set up a story, game or persona"}; this turn now asks for ${harmfulAsk && payoff.type === "multi_step_jailbreak" ? "content made to deceive people or steal credentials" : payoff.type.replace(/_/g, " ")}.`,
    });
  }

  // 3. Slow escalation: each turn a little more pointed than the last.
  if (turns.length >= 3) {
    const tail = maxConf.slice(-4);
    let rising = true;
    for (let i = 1; i < tail.length; i++) if (tail[i] + 0.02 < tail[i - 1]) rising = false;
    const climb = tail[tail.length - 1] - tail[0];
    if (rising && climb >= 0.3 && tail[tail.length - 1] >= 0.4) {
      const o = offsetOf(last);
      findings.push({
        id: "s3",
        type: "multi_step_jailbreak",
        also: [],
        segmentId: segment.id,
        start: o,
        end: o + turns[last].length + 8,
        quote: turns[last].slice(0, 200),
        confidence: 0.64,
        severity: 0.75,
        layer: "session",
        rule: "session.escalation",
        why: `The last ${tail.length} turns get steadily more pointed (signal ${tail.map((x) => x.toFixed(2)).join(" → ")}): a step-by-step escalation.`,
      });
    }
  }
  return findings.length ? { segment, findings } : null;
}
