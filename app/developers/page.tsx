import type { ReactNode } from "react";
import { ArrowRight, FileText, Robot, ShieldCheck, PaperPlaneTilt } from "@phosphor-icons/react/dist/ssr";
import { Card, Chip } from "@/components/ui";
import { ApiPlayground, CodeSamples } from "@/components/ApiPlayground";

export const metadata = {
  title: "API: Warden",
  description: "Use Warden from your own code: one call before your AI reads anything, one before it acts. Try both live on this page.",
};

function Section({ title, sub, children, id }: { title: string; sub?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className="mt-12" id={id}>
      <h2 className="text-[22px] font-semibold tracking-[-0.01em]">{title}</h2>
      {sub ? <p className="mt-1.5 max-w-[74ch] text-[14.5px] leading-relaxed text-muted">{sub}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Step({ icon, title, note, dark = false }: { icon: ReactNode; title: string; note: string; dark?: boolean }) {
  return (
    <div className={`flex min-w-0 items-center gap-3 rounded-[12px] border px-3.5 py-3 ${dark ? "border-ink bg-ink text-white" : "border-line bg-surface"}`}>
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-[9px] ${dark ? "bg-white/15" : "bg-sunken"}`}>{icon}</span>
      <div className="min-w-0">
        <div className={`text-[14px] font-semibold ${dark ? "text-white" : ""}`}>{title}</div>
        <div className={`mono text-[12px] ${dark ? "text-white/75" : "text-muted"}`}>{note}</div>
      </div>
    </div>
  );
}

const Arrow = () => (
  <div className="flex items-center justify-center text-faint" aria-hidden="true">
    <ArrowRight size={16} className="rotate-90 lg:rotate-0" />
  </div>
);

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-[12px] border border-line bg-surface">
      <table className="w-full min-w-[560px] border-collapse text-left text-[13.5px]">
        <thead>
          <tr className="bg-sunken text-[12.5px] text-muted">
            {head.map((h) => (
              <th key={h} className="px-4 py-2.5 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-line align-top">
              {r.map((c, j) => (
                <td key={j} className={`px-4 py-2.5 ${j === 0 ? "mono whitespace-nowrap text-[12.5px] text-ink" : "text-ink-2"}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const code = (s: string) => <span className="mono text-[12.5px] text-ink">{s}</span>;

export default function DevelopersPage() {
  return (
    <div className="mx-auto max-w-[1240px] px-5 pb-20 pt-8">
      <section>
        <h1 className="text-[34px] font-semibold leading-[1.08] tracking-[-0.02em] md:text-[40px]">Use Warden from your own code.</h1>
        <p className="mt-3 max-w-[72ch] text-[16px] leading-relaxed text-muted">
          Two calls: one before your AI reads anything, one before it sends or does anything. No sign-up or key for this demo. Try both live below; the answers come from the same API your code would call.
        </p>
      </section>

      <div className="mt-6 grid grid-cols-1 gap-2 lg:grid-cols-[minmax(0,1fr)_24px_minmax(0,1fr)_24px_minmax(0,1fr)_24px_minmax(0,1fr)_24px_minmax(0,1fr)]">
        <Step icon={<FileText size={20} />} title="Outside content" note="email, PDF, web page" />
        <Arrow />
        <Step dark icon={<ShieldCheck size={20} />} title="Warden scan" note="POST /api/scan" />
        <Arrow />
        <Step icon={<Robot size={20} />} title="Your AI agent" note="reads the cleaned text" />
        <Arrow />
        <Step dark icon={<ShieldCheck size={20} />} title="Warden guard" note="POST /api/guard" />
        <Arrow />
        <Step icon={<PaperPlaneTilt size={20} />} title="The world" note="reply, email, payment" />
      </div>

      <Section id="try" title="Try it here" sub="Pick Scan or Guard, start from an example, change anything you like, and press Send request. Copy as curl gives you the same request for your terminal.">
        <ApiPlayground />
      </Section>

      <Section id="decisions" title="What to do with the answer" sub="Every answer has a decision. Your code only needs to act on that field.">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2">
              <Chip tone="neutral">/api/scan</Chip>
              <span className="text-[13px] text-muted">before the AI reads</span>
            </div>
            <Table
              head={["decision", "Meaning", "Your code should"]}
              rows={[
                ["allow", "Nothing to stop", <>Give the AI {code("sanitized.envelope")}</>],
                ["neutralize", "Attack cut out, the rest is fine", <>Give the AI {code("sanitized.envelope")}, the cleaned version</>],
                ["quarantine", "Not sure, or a file could not be read fully", "Ask a person before the AI sees it"],
                ["block", "Mostly an attack", "Do not give it to the AI"],
              ]}
            />
          </div>
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2">
              <Chip tone="neutral">/api/guard</Chip>
              <span className="text-[13px] text-muted">before the AI sends or acts</span>
            </div>
            <Table
              head={["decision", "Meaning", "Your code should"]}
              rows={[
                ["allow", "Nothing leaks", "Send the reply or run the action"],
                ["redact", "A leak was removed", <>Send {code("output")} instead of the original reply</>],
                ["block", "The action is unsafe", "Do not run it; tell the user why (headline)"],
              ]}
            />
          </div>
        </div>
      </Section>

      <Section id="scan-fields" title="POST /api/scan: what you can send" sub="Send JSON, or a file as form-data with the same fields as text values. Only text or file is required.">
        <Table
          head={["Field", "What it is", "Example"]}
          rows={[
            ["text", "The content the AI is about to read", '"Hi team, the invoice is attached..."'],
            ["file", "Instead of text: PDF, Word, email (.eml), HTML, Markdown, image, code; up to 4 MB", "form-data field named file"],
            ["source", "What kind of content it is. Leave it out and Warden works it out.", "email, pdf, docx, web_page, html, markdown, api_response, source_code, ocr_text, image, user_message"],
            ["task", "What the user asked the agent to do. Lets Warden flag requests nobody made.", '"Pay the approved invoice from Shreeji"'],
            ["agent", "Which agent will read it, so Warden knows what it could do. A name, or your own tools.", '"finance", "support", "coding", "office", or { "tools": [{ "name": "pay_invoice" }] }'],
            ["history", "Earlier chat messages, for attacks spread over several turns", '["first message", "second message"]'],
            ["mode", "How readily Warden acts", "strict, balanced (default), permissive"],
            ["judge", "The AI judge for unclear passages", "auto (default), off (free and instant), force"],
            ["simulate", "Break one part on purpose to see the rest carry on", "classifier, judge, reader"],
          ]}
        />
      </Section>

      <Section id="scan-response" title="What /api/scan sends back" sub="The main fields. Choose Everything in the playground to see the full answer, including the step-by-step trace.">
        <Table
          head={["Field", "What it is"]}
          rows={[
            ["decision", "allow, neutralize, quarantine or block"],
            ["risk", "0 to 100"],
            ["headline", "One sentence a person can read"],
            ["findings[]", "Each attack found: type, the exact words (quote), confidence and why"],
            ["sanitized.envelope", "The cleaned content, wrapped and marked as outside content: give this to the AI"],
            ["sanitized.text", "The cleaned content without the wrapper"],
            ["trace[]", "Every step Warden took, how long it took, and whether it succeeded"],
            ["warnings[]", "Anything that went wrong while reading, such as a page it could not read"],
          ]}
        />
      </Section>

      <Section id="guard-fields" title="POST /api/guard: what you can send" sub="Send the reply, the action, or both.">
        <Table
          head={["Field", "What it is", "Example"]}
          rows={[
            ["output", "The reply your AI is about to send", '"Here is your summary..."'],
            ["call", "The action your AI is about to take", '{ "tool": "pay_invoice", "args": { "account": "50200098765432" } }'],
            ["task", "What the user asked for", '"Pay the Shreeji invoice"'],
            ["flagged", "Text Warden flagged in what the AI read (from the scan)", '["new A/C 50200098765432"]'],
            ["clean", "Text the AI read that was safe, such as the real account on file", '["A/C 50100012345678"]'],
            ["canaries", "Secret marker words that must never leave", '["WDN-7F3A9C2E"]'],
            ["allowedDomains", "Web addresses the reply may link to", '["yourcompany.com"]'],
          ]}
        />
        <p className="mt-3 text-[13.5px] leading-relaxed text-muted">
          It sends back {code("decision")} (allow, redact or block), a {code("headline")}, the {code("findings")}, and {code("output")}: the reply with any leak removed.
        </p>
      </Section>

      <Section id="code" title="Copy into your own code" sub="Plain HTTP, so any language works. These do the two checks around an AI agent.">
        <CodeSamples />
      </Section>

      <Section id="limits" title="Limits">
        <Card className="p-5">
          <ul className="grid grid-cols-1 gap-x-8 gap-y-2 text-[14px] leading-relaxed text-ink-2 md:grid-cols-2">
            <li>Text up to 400,000 characters; files up to 4 MB.</li>
            <li>No key needed for this demo. Call it from a terminal or a server.</li>
            <li>The AI judge is capped at 60 checks per visitor per hour; after that the free layers decide alone.</li>
            <li>A check takes milliseconds; one that needs the AI judge takes 2 to 8 seconds more.</li>
            <li>Nothing you send is stored.</li>
            <li>{code("GET /api/health")} shows which parts are running.</li>
          </ul>
        </Card>
      </Section>
    </div>
  );
}
