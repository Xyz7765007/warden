// The second line: what the agent says or does on the way out. An injection only hurts through
// what the agent then does: carry data out in a link or an image (images load by themselves, no
// click needed), call a tool with an attacker's account, or repeat a secret. These checks run on
// the agent's reply and on each tool call, whatever the inbound scan concluded, so an attack the
// first line misses still cannot move data or money. Runs in the browser and on the server.

export type EgressKind = "image_exfil" | "link_exfil" | "canary" | "secret" | "tainted_value" | "active_html";

export interface EgressFinding {
  kind: EgressKind;
  quote: string;
  start: number;
  end: number;
  why: string;
  severity: number;
}

export interface EgressInput {
  /** The agent's reply (Markdown or HTML). */
  output?: string;
  /** A tool call the agent is about to make. */
  call?: { tool: string; args: Record<string, unknown> };
  /** What the user asked for: values the user gave are trusted. */
  task?: string;
  /** Passages Warden flagged or cut out of what the agent read (the quotes from /api/scan findings). */
  flagged?: string[];
  /** Content that passed the scan. A value found here, or in the task, is not tainted. */
  clean?: string[];
  /** Canary tokens planted in the system prompt or a secret store: if one shows up, a secret is leaving. */
  canaries?: string[];
  /** Domains the agent may link to or load images from. */
  allowedDomains?: string[];
}

export interface EgressResult {
  decision: "allow" | "redact" | "block";
  headline: string;
  findings: EgressFinding[];
  /** The reply with the dangerous parts removed. */
  output?: string;
}

export const EGRESS_LABELS: Record<EgressKind, string> = {
  image_exfil: "Data in an image link",
  link_exfil: "Data in a link",
  canary: "Canary token",
  secret: "Secret or personal data",
  tainted_value: "Value from outside content",
  active_html: "Active HTML",
};

// ---------- checksums ----------

function luhn(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

const VD = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6], [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1], [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4], [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const VP = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2], [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1], [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];
/** Aadhaar numbers carry a Verhoeff check digit. */
function verhoeff(digits: string): boolean {
  let c = 0;
  const r = digits.split("").reverse().map(Number);
  for (let i = 0; i < r.length; i++) c = VD[c][VP[i % 8][r[i]]];
  return c === 0;
}

// Card networks by prefix and length (Visa, Mastercard, Amex, RuPay, Discover, Diners, JCB), so a
// bank account number that happens to pass Luhn is not called a card.
const CARD_IIN = /^(?:4\d{12}(?:\d{3}){0,2}|5[1-5]\d{14}|2(?:2[2-9]\d|[3-6]\d{2}|7[01]\d|720)\d{12}|3[47]\d{13}|6(?:011|5\d{2})\d{12,15}|60\d{14}|8[12]\d{14}|508\d{13}|3(?:0[0-5]|[68]\d)\d{11}|35\d{14})$/;

// ---------- secrets and personal data ----------

const SECRET_PATTERNS: Array<{ re: RegExp; what: string; check?: (m: string) => boolean }> = [
  { re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g, what: "a private key" },
  { re: /\bsk-ant-[A-Za-z0-9_-]{16,}/g, what: "an Anthropic API key" },
  { re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g, what: "an OpenAI API key" },
  { re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{8,}/g, what: "a payment API key" },
  { re: /\bAKIA[0-9A-Z]{16}\b/g, what: "an AWS access key" },
  { re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g, what: "a GitHub token" },
  { re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, what: "a Slack token" },
  { re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, what: "a login token (JWT)" },
  { re: /\b(?:\d[ -]?){13,19}\b/g, what: "a card number", check: (m) => CARD_IIN.test(m.replace(/\D/g, "")) && luhn(m.replace(/\D/g, "")) },
  { re: /\b[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}\b/g, what: "an Aadhaar number", check: (m) => verhoeff(m.replace(/\D/g, "")) },
  { re: /\b[A-Z]{3}[PCHFATBLJG][A-Z]\d{4}[A-Z]\b/g, what: "a PAN" },
];

function secretsIn(text: string): Array<{ start: number; end: number; quote: string; what: string }> {
  const out: Array<{ start: number; end: number; quote: string; what: string }> = [];
  for (const p of SECRET_PATTERNS) {
    for (const m of text.matchAll(p.re)) {
      if (p.check && !p.check(m[0])) continue;
      const start = m.index!;
      const end = start + m[0].length;
      if (out.some((o) => start < o.end && end > o.start)) continue;
      out.push({ start, end, quote: m[0], what: p.what });
    }
  }
  return out;
}

// ---------- data hidden in URLs ----------

function b64text(s: string): string | null {
  if (s.length < 16 || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(s)) return null;
  try {
    const norm = s.replace(/-/g, "+").replace(/_/g, "/");
    const bin = typeof atob === "function" ? atob(norm + "=".repeat((4 - (norm.length % 4)) % 4)) : Buffer.from(norm, "base64").toString("binary");
    const printable = [...bin].filter((c) => c >= " " && c <= "~").length;
    if (printable / bin.length < 0.9) return null;
    return bin;
  } catch {
    return null;
  }
}

/** What data a URL carries out, if any. */
function urlData(raw: string, canaries: string[]): { data: string; why: string } | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const parts = [...url.searchParams.values(), ...url.pathname.split("/").filter(Boolean), url.hash.replace(/^#/, "")].filter(Boolean);
  for (const p0 of parts) {
    let p = p0;
    try {
      p = decodeURIComponent(p0);
    } catch {
      /* keep raw */
    }
    const canary = canaries.find((c) => c && p.includes(c));
    if (canary) return { data: p.slice(0, 120), why: "carries a canary token planted in the agent's secrets" };
    const sec = secretsIn(p);
    if (sec.length) return { data: sec[0].quote, why: `carries ${sec[0].what}` };
    const dec = b64text(p);
    if (dec) {
      const inner = secretsIn(dec);
      return { data: dec.slice(0, 120), why: inner.length ? `carries ${inner[0].what}, base64-encoded` : "carries base64-encoded text" };
    }
    if (/^[0-9a-f]{32,}$/i.test(p) && !/^[0-9a-f]{32}$/i.test(p)) return { data: p.slice(0, 120), why: "carries a long hex-encoded value" };
    if (p.split(/[\s+]+/).filter((w) => /[a-z]{2,}/i.test(w)).length >= 4) return { data: p.slice(0, 120), why: "carries readable text" };
  }
  return null;
}

const hostOf = (raw: string) => {
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return "";
  }
};
const allowed = (host: string, list: string[]) => list.some((d) => host === d.toLowerCase() || host.endsWith(`.${d.toLowerCase()}`));

// ---------- values that came from outside content ----------

const VALUE_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+|https?:\/\/[^\s"'<>)]+|\b[A-Z]{4}0[A-Z0-9]{6}\b|\b\d{9,18}\b|\b[\w.-]+@(?:upi|ok[a-z]+|ybl|paytm|ibl|axl)\b|(?:curl|wget)\s[^|\n]+\|\s*(?:ba|z)?sh/gi;

function stringify(v: unknown): string {
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

// ---------- main ----------

export function guardEgress(input: EgressInput): EgressResult {
  const canaries = (input.canaries || []).filter((c) => c && c.length >= 6);
  const domains = input.allowedDomains || [];
  const findings: EgressFinding[] = [];
  const remove: Array<{ start: number; end: number; with: string }> = [];
  const task = input.task || "";
  const flagged = (input.flagged || []).join("\n").toLowerCase();
  const clean = (input.clean || []).join("\n").toLowerCase();

  if (input.output) {
    const out = input.output;
    // Images load by themselves when the reply is shown, so an image link leaks without a click.
    const images = [...out.matchAll(/!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)].map((m) => ({ m, url: m[2], alt: m[1] }));
    for (const m of out.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']?([^"'\s>]+)[^>]*>/gi)) images.push({ m, url: m[1], alt: "" });
    for (const { m, url, alt } of images) {
      const host = hostOf(url);
      if (!host || allowed(host, domains)) continue;
      const data = urlData(url, canaries);
      const start = m.index!;
      const end = start + m[0].length;
      findings.push({
        kind: data?.why.startsWith("carries a canary") ? "canary" : "image_exfil",
        quote: m[0].slice(0, 300),
        start,
        end,
        why: data
          ? `An image from ${host} that ${data.why}${data.data ? ` ("${data.data.slice(0, 80)}")` : ""}. Images load the moment the reply is shown, so this sends the data out without a click.`
          : `An image from ${host}, a site not on the allow-list. Images load by themselves, so they can carry data out or track the reader.`,
        severity: data ? 0.95 : 0.6,
      });
      remove.push({ start, end, with: `[image removed: ${host}]${alt ? ` ${alt}` : ""}` });
    }
    // Links only matter when they carry data; a plain link is the user's to click.
    const links = [...out.matchAll(/(?<!!)\[([^\]]+)\]\(\s*<?(https?:\/\/[^)\s>]+)>?\s*\)/g)].map((m) => ({ m, url: m[2], text: m[1] }));
    for (const m of out.matchAll(/(?<![("'=\]])\bhttps?:\/\/[^\s<>"')\]]+/g)) {
      if (images.some((i) => m.index! >= i.m.index! && m.index! < i.m.index! + i.m[0].length) || links.some((l) => m.index! >= l.m.index! && m.index! < l.m.index! + l.m[0].length)) continue;
      links.push({ m, url: m[0], text: "" });
    }
    for (const { m, url, text } of links) {
      const host = hostOf(url);
      if (!host || allowed(host, domains)) continue;
      const data = urlData(url, canaries);
      if (!data) continue;
      const start = m.index!;
      const end = start + m[0].length;
      findings.push({
        kind: data.why.startsWith("carries a canary") ? "canary" : "link_exfil",
        quote: m[0].slice(0, 300),
        start,
        end,
        why: `A link to ${host} that ${data.why} ("${data.data.slice(0, 80)}"). Opening it would hand the data to that site.`,
        severity: 0.85,
      });
      remove.push({ start, end, with: text ? `${text} [link removed]` : "[link removed]" });
    }
    // Canary tokens anywhere else in the reply.
    for (const c of canaries) {
      for (let i = out.indexOf(c); i >= 0; i = out.indexOf(c, i + c.length)) {
        if (findings.some((f) => i >= f.start && i < f.end)) continue;
        findings.push({ kind: "canary", quote: c, start: i, end: i + c.length, why: "A canary token planted in the agent's system prompt or secrets is in the reply: something got the agent to reveal what it was told to keep.", severity: 1 });
        remove.push({ start: i, end: i + c.length, with: "[redacted]" });
      }
    }
    // Secrets and personal data the user did not supply.
    for (const s of secretsIn(out)) {
      if (findings.some((f) => s.start < f.end && s.end > f.start) || task.includes(s.quote)) continue;
      findings.push({ kind: "secret", quote: s.quote, start: s.start, end: s.end, why: `The reply contains ${s.what}.`, severity: s.what.includes("key") || s.what.includes("token") ? 0.9 : 0.7 });
      remove.push({ start: s.start, end: s.end, with: `[redacted ${s.what.replace(/^an? /, "")}]` });
    }
    // Active HTML: scripts, event handlers and javascript: links run in the reader's browser.
    for (const m of out.matchAll(/<script\b[\s\S]*?(?:<\/script>|$)|<iframe\b[^>]*>|\bon(?:error|load|click|mouseover)\s*=\s*["'][^"']*["']|javascript:[^\s"')]+/gi)) {
      const start = m.index!;
      const end = start + m[0].length;
      if (findings.some((f) => start < f.end && end > f.start)) continue;
      findings.push({ kind: "active_html", quote: m[0].slice(0, 200), start, end, why: "Code that would run in the reader's browser.", severity: 0.8 });
      remove.push({ start, end, with: "[code removed]" });
    }
  }

  let blocked = false;
  if (input.call) {
    const argText = Object.entries(input.call.args || {})
      .map(([k, v]) => `${k}: ${stringify(v)}`)
      .join("\n");
    for (const c of canaries) {
      if (argText.includes(c)) {
        blocked = true;
        findings.push({ kind: "canary", quote: c, start: -1, end: -1, why: `The ${input.call.tool} call carries a canary token: a planted secret is about to leave.`, severity: 1 });
      }
    }
    for (const s of secretsIn(argText)) {
      if (task.includes(s.quote)) continue;
      blocked = true;
      findings.push({ kind: "secret", quote: s.quote, start: -1, end: -1, why: `The ${input.call.tool} call carries ${s.what}.`, severity: 0.9 });
    }
    // A value the call uses that appears only in flagged content, never in the user's request or
    // the clean content, is how an injection steers a tool: an account, an address, a link, a command.
    for (const m of argText.matchAll(VALUE_RE)) {
      const v = m[0].toLowerCase();
      if (task.toLowerCase().includes(v) || clean.includes(v)) continue;
      if (flagged.includes(v)) {
        blocked = true;
        findings.push({ kind: "tainted_value", quote: m[0], start: -1, end: -1, why: `"${m[0]}" appears only in content Warden flagged, never in the user's request or the clean content. The ${input.call.tool} call would act on the attacker's value.`, severity: 0.9 });
      }
    }
  }

  // The sanitised reply: dangerous spans replaced from the end so offsets stay valid.
  let sanitised = input.output;
  if (sanitised !== undefined) {
    const spans = remove.sort((a, b) => b.start - a.start).filter((s, i, arr) => i === 0 || s.end <= arr[i - 1].start);
    for (const s of spans) sanitised = sanitised.slice(0, s.start) + s.with + sanitised.slice(s.end);
  }

  const n = findings.length;
  const decision: EgressResult["decision"] = blocked || findings.some((f) => f.kind === "canary") ? "block" : n ? "redact" : "allow";
  const what = [...new Set(findings.map((f) => EGRESS_LABELS[f.kind].toLowerCase()))];
  const headline =
    decision === "allow"
      ? `Nothing leaves that should not: no data in links or images, no secrets${canaries.length ? ", no canary" : ""}${input.call ? ", and every value in the call came from the user or clean content" : ""}.`
      : decision === "block"
        ? `Blocked: ${what.join(", ")}.${input.call ? ` The ${input.call.tool} call does not run.` : " The reply is not sent."}`
        : `Cleaned the reply: removed ${n === 1 ? "one item" : `${n} items`} (${what.join(", ")}). The rest goes through.`;
  return { decision, headline, findings, output: sanitised };
}
