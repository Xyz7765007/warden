import type { ReactNode } from "react";
import { ArrowRight, ArrowsClockwise } from "@phosphor-icons/react/dist/ssr";
import latency from "@/data/eval/latency.json";
import { RULES } from "@/lib/warden/rules";
import { Card, Chip } from "@/components/ui";

export const metadata = { title: "How it works: Warden", description: "Warden's architecture: readers, decoders, patterns, task binding, a trained classifier, conversation memory and an optional LLM judge, planned cheapest first." };

function Section({ title, sub, children, id }: { title: string; sub?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className="mt-12" id={id}>
      <h2 className="text-[22px] font-semibold tracking-[-0.01em]">{title}</h2>
      {sub ? <p className="mt-1.5 max-w-[74ch] text-[14.5px] leading-relaxed text-muted">{sub}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Stage({ step, title, children }: { step: string; title: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <span className="text-[12px] font-semibold tabular-nums text-faint">{step}</span>
        <span className="text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-2">{title}</span>
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

function Box({ title, children, tone = "plain" }: { title: string; children?: ReactNode; tone?: "plain" | "judge" | "decide" }) {
  const t = { plain: "border-line bg-surface", judge: "border-dashed border-line-2 bg-surface", decide: "border-ink bg-ink text-white" }[tone];
  return (
    <div className={`rounded-[10px] border px-3 py-2.5 ${t}`}>
      <div className={`text-[13.5px] font-semibold ${tone === "decide" ? "text-white" : "text-ink"}`}>{title}</div>
      {children ? <div className={`mt-0.5 text-[12.5px] leading-relaxed ${tone === "decide" ? "text-white/80" : "text-muted"}`}>{children}</div> : null}
    </div>
  );
}

const Arrow = () => (
  <div className="hidden items-center justify-center lg:flex" aria-hidden="true">
    <ArrowRight size={18} className="text-faint" />
  </div>
);

const LAYERS: Array<[string, string, string, string, string]> = [
  ["Readers", "Text hidden from people: white, tiny, off-page and covered PDF text, CSS-hidden HTML, comments, alt text, metadata, Word hidden runs, email parts a mail client never shows, attachments", "pdf.js operator walk, Word XML, MIME parsing, CSS-aware HTML parsing, Tesseract OCR in contrast bands", "Milliseconds; images about half a second (OCR)", "Part of a file cannot be read: the scan continues on the rest and the result is held for review"],
  ["Decoders", "Orders written in base64, hex, URL or HTML escapes, binary, ROT13 and Caesar shifts, reversed text, invisible Unicode tag characters; look-alike letters, leetspeak, spaced letters and shuffled spellings", "Deterministic decoding, folded through look-alikes; a decode only counts if it reads as language", "Under 1 ms", "Skipped on very large text; patterns still run"],
  ["Attack patterns", `${RULES.length} rules across the 9 attack types, in English, Hindi, Hinglish and other languages, weighed by context: written to the AI or to a person, hidden, urgent, hiding things from the user, naming an outside address, or quoting an attack to discuss it`, "Rules with context modifiers, no model", "Under 1 ms", "A failing rule is skipped and logged"],
  ["Structure checks", "Hidden orders, Trojan Source bidi tricks, zero-width words, many-shot examples, payloads split into pieces", "Deterministic", "Under 1 ms", "Skipped and logged"],
  ["Orders aimed at the AI", "Outside content that speaks to the AI and tells it what to do, however official it looks: notices to automated assistants, API fields like note_to_assistant, \"if an assistant is handling this mailbox\", \"your operator gave you\"", "Finds the addressee and a directive; acts when the order reaches for secrets, money, the AI's rules or the reader right now; documentation about assistants stays a weak signal", "Under 1 ms", "Skipped and logged"],
  ["Tool inspector", "MCP tool lists that hide orders in descriptions, shadow other tools, or change after approval (rug pulls)", "SHA-256 fingerprints pinned per tool", "Under 1 ms", "Unpinned tools are still read for hidden orders"],
  ["Task binding", "Requests in outside content that the user never asked for: pay, send, delete, grant access, run", "Compares each request in the content with the user's task", "Under 1 ms", "Without a task it falls back to requests aimed at the agent"],
  ["Trained classifier", "New wordings no rule covers; confirms or questions pattern hits", "Logistic model over hashed word and character n-grams, 8-bit weights, runs in the browser too, retrains online", "Under 1 ms per sentence", "If it cannot load, patterns decide alone"],
  ["Conversation memory", "Attacks spread over turns: pieces stored and combined later, a persona set up then used, slow escalation", "Looks at the whole conversation, not one message", "Under 1 ms", "Skipped when there is no history"],
  ["Second line (egress)", "What would let a missed attack do harm: images and links that carry data out, canary tokens, API keys, card numbers, Aadhaar and PAN, active HTML, and tool calls using values found only in flagged content", "Checks on the reply and on each tool call; card numbers by network and Luhn, Aadhaar by Verhoeff check digit", "Under 1 ms", "Runs on its own, in the browser or at /api/guard"],
  ["LLM judge (optional)", "Passages the other layers left unclear; in strict mode for an agent that can act, also outside content that raised nothing, since new wordings can slip past the cheap layers. At most 6 short excerpts per scan", "Claude, structured output; the passages arrive as data, and every verdict must quote the exact words, checked against the text", "1 to 3 s, only when called", "Not switched on: Warden decides on the other layers, exactly as measured on the Proof page. Timeout or refusal: borderline content is held for agents that can act"],
];

const FRAMEWORKS: Array<[string, string, string]> = [
  ["OWASP LLM01:2025 Prompt Injection", "Keep outside content separate, give the model least privilege, put a person on high-risk actions.", "Spotlighting envelope for outside content; decisions scale with the agent's tools; held items wait for a person."],
  ["OWASP LLM02:2025 Sensitive Information Disclosure and LLM05:2025 Improper Output Handling", "Keep secrets and personal data out of replies; treat model output as untrusted before it is shown or used.", "The second line masks keys, card numbers, Aadhaar and PAN, removes images and links that carry data, and strips code from replies."],
  ["OWASP Top 10 for Agentic Applications: ASI01 Agent Goal Hijack, ASI06 Memory & Context Poisoning", "Stop outside content from changing what the agent is trying to do, or what it remembers.", "Task binding and the action guard for goal hijack; context-poisoning patterns and conversation memory for poisoning."],
  ["MITRE ATLAS AML.T0051 LLM Prompt Injection", "Direct and indirect injection.", "Both: user messages and the 10 kinds of outside content."],
  ["CERT-In advisory CIAD-2025-0013", "Names prompt injection as a risk in AI applications.", "A dedicated control, with OCSF findings for the security team."],
  ["RBI FREE-AI framework", "AI red-teaming and AI incident reporting.", "A red-team agent with live retraining; every finding exportable as an incident record."],
  ["DPDP Rules 2025", "Safeguards and monitoring for personal data; logs kept at least a year; breaches reported fast.", "Scans run in memory and store nothing; Aadhaar, PAN and card numbers are masked in replies; exfiltration attempts are flagged; OCSF export lets the SIEM keep the log."],
  ["Five Eyes agentic AI guidance (Apr 2026)", "No single probabilistic defence is enough; people approve financial transactions; unified audit logs.", "Deterministic, trained and LLM layers in one plan, plus a second line on what leaves; payments to unknown accounts are held for a person; one trace per scan."],
];

export default function HowPage() {
  return (
    <div className="mx-auto max-w-[1240px] px-5 pb-20 pt-8">
      <section>
        <h1 className="text-[34px] font-semibold leading-[1.08] tracking-[-0.02em] md:text-[40px]">How Warden decides.</h1>
        <p className="mt-3 max-w-[72ch] text-[16px] leading-relaxed text-muted">
          Everything an agent is about to read goes through Warden first. A planner runs the cheap checks on everything, spends on the expensive one only when something is still unclear, and returns one of four decisions with the reason and the exact words it acted on.
        </p>
      </section>

      <Section id="architecture" title="Architecture" sub="Read, check, decide, act. The free layers run on every scan; the LLM judge runs only on what they leave unclear.">
        <Card className="p-5 md:p-6">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_20px_minmax(0,1.35fr)_20px_minmax(0,0.9fr)_20px_minmax(0,1fr)]">
            <Stage step="1" title="Read">
              <Box title="11 readers">Chat, web pages, HTML, Markdown, PDF, Word, email with attachments, API and MCP responses, source code, OCR text, images.</Box>
              <Box title="Two views of every input">What a person sees, and what the AI will actually read. The difference is where most attacks hide.</Box>
            </Stage>
            <Arrow />
            <Stage step="2" title="Check, cheapest first">
              <Box title="Decoders">Base64, ROT13, reversed text, invisible Unicode, look-alike letters, leetspeak, shuffled spellings.</Box>
              <Box title="Patterns and structure">{RULES.length} rules over 9 attack types, weighed by context; hidden orders, bidi tricks, split payloads.</Box>
              <Box title="Orders aimed at the AI">Notices to automated assistants, fields like note_to_assistant, &ldquo;if an assistant is handling this mailbox&rdquo;.</Box>
              <Box title="Tool inspector and task binding">Poisoned MCP tools and rug pulls; requests the user never asked for.</Box>
              <Box title="Trained classifier and conversation memory">New wordings; attacks spread over several turns.</Box>
              <Box title="LLM judge, only if unclear" tone="judge">
                Claude reviews at most 6 short passages and must quote the exact words.
              </Box>
            </Stage>
            <Arrow />
            <Stage step="3" title="Decide">
              <Box title="Policy">Mode (strict, balanced, permissive) and what this agent can do: an agent that can pay or send gets less benefit of the doubt.</Box>
              <Box title="Allow · Cut out · Hold · Block" tone="decide">
                One decision, a risk score, and the reason in plain words.
              </Box>
            </Stage>
            <Arrow />
            <Stage step="4" title="Act and record">
              <Box title="Neutraliser">Cuts the attack sentences, strips invisible characters, and passes the rest marked as outside content.</Box>
              <Box title="Second line: what leaves">Every reply and tool call on the way out: data hidden in links and images, canary tokens, secrets, and values that came only from flagged content.</Box>
              <Box title="Trace and export">Every step with timing, OCSF findings for the SOC, and a person&apos;s call on anything held.</Box>
            </Stage>
          </div>
          <div className="mt-5 flex flex-col gap-2 rounded-[10px] border border-line bg-sunken px-4 py-3 sm:flex-row sm:items-center">
            <ArrowsClockwise size={18} className="shrink-0 text-ink-2" />
            <p className="text-[13px] leading-relaxed text-ink-2">
              <b className="text-ink">Learning loop.</b> A red-team agent disguises attacks and retries whatever gets through. Each miss becomes training data, the classifier retrains in milliseconds, and safe text is replayed so false alarms do not creep in.
            </p>
          </div>
        </Card>
      </Section>

      <Section id="layers" title="Every layer, what it costs and how it fails" sub="Each layer runs on its own. If one fails, the scan carries on with the rest and says so in the trace.">
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[980px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-[12.5px] text-muted">
                <th className="px-5 py-2.5 font-medium">Layer</th>
                <th className="px-3 py-2.5 font-medium">What it catches</th>
                <th className="px-3 py-2.5 font-medium">How</th>
                <th className="px-3 py-2.5 font-medium">Time</th>
                <th className="px-5 py-2.5 font-medium">If it fails</th>
              </tr>
            </thead>
            <tbody className="align-top">
              {LAYERS.map(([name, what, how, time, fail]) => (
                <tr key={name} className="border-b border-line last:border-0">
                  <td className="whitespace-nowrap px-5 py-3 font-medium text-ink">{name}</td>
                  <td className="max-w-[360px] px-3 py-3 leading-relaxed text-ink-2">{what}</td>
                  <td className="max-w-[260px] px-3 py-3 leading-relaxed text-ink-2">{how}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-ink-2">{time}</td>
                  <td className="max-w-[240px] px-5 py-3 leading-relaxed text-ink-2">{fail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <p className="mt-2.5 text-[12.5px] text-faint">
          On the live site, server time: median {latency.text.p50} ms for text, {latency.files.PDF.p50} ms for a PDF, about {(latency.files["Image (OCR)"].p50 / 1000).toFixed(1)} s for an image. LLM judge off.
        </p>
      </Section>

      <Section id="agentic" title="What makes it an agent, not a filter">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {[
            ["It plans", "The planner chooses checks for each input: OCR only where there are images, decoded copies only where something is encoded, conversation checks only when there is history, the LLM judge only for passages still unclear. The trace shows the plan it ran."],
            ["It acts", "It does not just score. It cuts out the attack and passes the rest, holds content for a person, or blocks it, and its action guard stops tool calls built from flagged content."],
            ["It recovers", "A file that half-parses, an OCR failure, a judge timeout or a missing API key does not stop the scan. Warden decides on what it could read and holds what it could not check fully. Try it: \"Simulate an outage\" on the Scan page."],
            ["It learns", "The red-team agent adapts to what gets through. Misses retrain the classifier on the spot, and the gain carries over to disguises it never trained on (see Proof)."],
          ].map(([h, b]) => (
            <Card key={h} className="p-5">
              <h3 className="text-[15px] font-semibold">{h}</h3>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">{b}</p>
            </Card>
          ))}
        </div>
      </Section>

      <Section id="supporting" title="Built for the team that runs it" sub="The hackathon's supporting features: observability, trainability and fault tolerance.">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {[
            ["Observability", ["A trace for every scan: each step, its result and its timing.", "The exact words acted on, and why, in plain language.", "OCSF Detection Finding export for any SIEM.", "A live status of which layers are on."]],
            ["Trainability", ["Online learning from misses, in milliseconds, in the browser or on the server.", "Safe-text replay keeps false alarms flat.", "Rules are plain data with a reason each, easy to add to.", "Three modes to trade catch rate for friction."]],
            ["Fault tolerance", ["Every layer isolated: one failure never stops a scan.", "Works with no API key and no network.", "Unreadable or partly read files are held, not passed.", "The judge is optional and time-boxed, with one retry.", "See it: Scan page, Simulate an outage."]],
          ].map(([h, items]) => (
            <Card key={h as string} className="p-5">
              <h3 className="text-[15px] font-semibold">{h as string}</h3>
              <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-4 text-[13.5px] leading-relaxed text-ink-2 marker:text-faint">
                {(items as string[]).map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      </Section>

      <Section id="responsible" title="Responsible by design">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {[
            ["It cannot be talked out of it", "The layers that decide are code and a trained model, not a chatbot, so the text they inspect cannot instruct them. The optional judge gets the passages as data, is told never to follow them, and a verdict whose quote is not in the text is thrown away."],
            ["People stay in charge", "Held content waits for a person to let it through or keep it out, and that decision goes into the exported record. In the agent, payments to accounts not on file are held for approval, whatever the content says."],
            ["Privacy", "Scans run in memory and nothing is stored. The red-team page runs entirely in your browser. When the judge is on, it sees at most six short excerpts, never the whole document."],
            ["Fair across languages", "Measured on outsiders' inputs: 0 of 13 safe Hindi, Hinglish or Indian-script messages flagged, against 16 of 166 in English. For equal protection, Indian-language passages that nothing flagged go to the judge when it is on (Proof page)."],
            ["Explains itself", "Every decision names the attack type, quotes the words, and says why in one sentence a non-specialist can follow."],
            ["Honest numbers", "False-alarm rates are published next to catch rates, along with where Warden is weakest."],
          ].map(([h, b]) => (
            <Card key={h} className="p-5">
              <h3 className="text-[15px] font-semibold">{h}</h3>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">{b}</p>
            </Card>
          ))}
        </div>
      </Section>

      <Section id="frameworks" title="Mapped to what your security team already follows">
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[860px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-[12.5px] text-muted">
                <th className="px-5 py-2.5 font-medium">Framework</th>
                <th className="px-3 py-2.5 font-medium">What it asks for</th>
                <th className="px-5 py-2.5 font-medium">How Warden answers</th>
              </tr>
            </thead>
            <tbody className="align-top">
              {FRAMEWORKS.map(([f, ask, ans]) => (
                <tr key={f} className="border-b border-line last:border-0">
                  <td className="max-w-[280px] px-5 py-3 font-medium leading-relaxed text-ink">{f}</td>
                  <td className="max-w-[300px] px-3 py-3 leading-relaxed text-ink-2">{ask}</td>
                  <td className="px-5 py-3 leading-relaxed text-ink-2">{ans}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </Section>

      <Section id="api" title="Put it in front of any agent" sub="One HTTP call before the content reaches the model. Send text or a file, the user's task, and the tools the agent has.">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card className="min-w-0 p-5">
            <div className="mb-2 flex items-center gap-2">
              <Chip>Request</Chip>
              <span className="mono text-[12px] text-muted">POST /api/scan</span>
            </div>
            <pre className="mono overflow-x-auto whitespace-pre rounded-[8px] bg-sunken p-3 text-[12px] leading-[1.6] text-ink-2">{`{
  "source": "email",
  "text": "Hi, please find the October invoice...",
  "task": "Pay this week's approved invoices",
  "agent": { "tools": [
    { "name": "pay_invoice" },
    { "name": "send_email" }
  ] },
  "mode": "balanced"
}`}</pre>
            <p className="mt-2 text-[12.5px] leading-relaxed text-muted">Files go up as multipart form data (PDF, Word, email, images, up to 4 MB). Leave out the source and Warden works it out.</p>
          </Card>
          <Card className="min-w-0 p-5">
            <div className="mb-2 flex items-center gap-2">
              <Chip>Response</Chip>
              <span className="mono text-[12px] text-muted">200 OK</span>
            </div>
            <pre className="mono overflow-x-auto whitespace-pre rounded-[8px] bg-sunken p-3 text-[12px] leading-[1.6] text-ink-2">{`{
  "decision": "neutralize",
  "risk": 92,
  "headline": "Cut out one attack (tool abuse), including text hidden from people.",
  "findings": [{ "type": "tool_abuse", "quote": "...",
                 "why": "...", "layer": "signature" }],
  "sanitized": { "text": "...", "envelope": "<untrusted_content ...>" },
  "trace": [{ "step": "Decode hidden encodings", "ms": 0 }, ...]
}`}</pre>
            <p className="mt-2 text-[12.5px] leading-relaxed text-muted">Pass the sanitized envelope to the model instead of the raw content. Send findings to your SIEM as OCSF.</p>
          </Card>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
          {[
            ["Before the model, and after it", "A proxy around the agent's LLM calls: tool results, pages and attachments are scanned on the way in (/api/scan); replies and tool calls are checked on the way out (/api/guard)."],
            ["On MCP tool lists", "Scan tool descriptions when a server connects and pin their fingerprints, so a later change is caught."],
            ["At ingestion", "Scan emails, tickets and documents as they enter a RAG index, so poisoned content never gets stored."],
          ].map(([h, b]) => (
            <Card key={h} className="p-5">
              <h3 className="text-[14.5px] font-semibold">{h}</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">{b}</p>
            </Card>
          ))}
        </div>
      </Section>
    </div>
  );
}
