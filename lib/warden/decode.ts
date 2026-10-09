// Finds text that has been encoded or hidden on purpose and decodes it, so the detectors
// can read what the attacker actually wrote. Each result points back at the encoded span.

import { fold } from "./normalize";
import { EN_WORDS } from "./vocab";
import { fixScrambled } from "./ocrfix";

export interface Decoded {
  start: number;
  end: number;
  via: string;
  text: string;
}

const TRIGGERS = [
  "ignore", "instruction", "instructions", "previous", "system", "prompt", "password", "secret", "reveal",
  "send", "email", "forward", "admin", "rules", "assistant", "delete", "execute", "override", "disregard",
  "token", "credentials", "transfer", "ai", "agent", "bypass", "jailbreak", "developer", "confidential",
];
const TRIGGER_RE = new RegExp(`\\b(${TRIGGERS.join("|")})\\b`, "gi");

function triggerCount(s: string) {
  return (s.match(TRIGGER_RE) || []).length;
}

function decodeBytesToText(bytes: Uint8Array): string | null {
  if (bytes.length < 6) return null;
  let printable = 0;
  for (const b of bytes) if ((b >= 0x20 && b <= 0x7e) || b === 0x0a || b === 0x0d || b === 0x09 || b >= 0x80) printable++;
  if (printable / bytes.length < 0.92) return null;
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (/�/.test(text) && (text.match(/�/g) || []).length > text.length * 0.05) return null;
  const letters = (text.match(/\p{L}/gu) || []).length;
  if (letters < 4 || letters / text.length < 0.45) return null;
  return text;
}

function base64ToBytes(b64: string): Uint8Array | null {
  try {
    let s = b64.replace(/-/g, "+").replace(/_/g, "/").replace(/\s+/g, "");
    while (s.length % 4) s += "=";
    const bin = typeof atob === "function" ? atob(s) : Buffer.from(s, "base64").toString("binary");
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function rot(s: string, n: number) {
  return s.replace(/[a-z]/gi, (c) => {
    const base = c <= "Z" ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + n) % 26) + base);
  });
}

const COMMON = /\b(the|and|to|of|a|in|is|you|that|for|it|on|with|as|are|this|be|at|or|your|from|please|we|our|not)\b/gi;

const EN = EN_WORDS;
const LEET_DIGITS: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t" };
// Leetspeak and shuffled spellings survive ROT13 and reversal, so read through them before judging.
const readable = (s: string) => fixScrambled(s.replace(/[a-z0-9]+/gi, (t) => (/[a-z]/i.test(t) && /[0-9]/.test(t) ? t.replace(/[013457]/g, (d) => LEET_DIGITS[d]) : t)));
// `forgiving` reads through leetspeak and shuffled spellings: right for a decoded candidate, wrong for
// the encoded original (reversed "elbanE" would read as "Enable").
function englishness(raw: string, forgiving = false): { share: number; words: number } {
  const words = (forgiving ? readable(raw) : raw).toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) || [];
  let hit = 0;
  for (const w of words) if (EN.has(w.replace(/'[a-z]+$/, ""))) hit++;
  return { share: words.length ? hit / words.length : 0, words: words.length };
}
// Web addresses and shell commands appear out of nowhere when ROT13 or reversed text is decoded.
const TECH = /\bhttps?:\/\/|\bwww\.|\b(?:curl|wget|sudo|chmod|powershell|bash)\b/i;
const techAppears = (encoded: string, decoded: string) => TECH.test(decoded) && !TECH.test(encoded) && englishness(decoded).words >= 4;

/** True when the decoded string reads as English and the encoded one did not. */
function decodesToEnglish(encoded: string, decoded: string, minWords = 5): boolean {
  const a = englishness(encoded);
  const b = englishness(decoded, true);
  return b.words >= minWords && b.share >= 0.4 && b.share - a.share >= 0.25;
}
const stripHidden = (s: string) => s.replace(/[\u00AD\u200B-\u200F\u2060-\u2064\uFEFF]/g, "");

export function findEncoded(text: string, depth = 0): Decoded[] {
  const found: Decoded[] = [];
  const taken: Array<[number, number]> = [];
  const overlaps = (s: number, e: number) => taken.some(([a, b]) => s < b && e > a);
  const push = (d: Decoded) => {
    if (overlaps(d.start, d.end)) return;
    taken.push([d.start, d.end]);
    found.push(d);
  };

  // 1. Unicode tag characters: invisible ASCII ("ASCII smuggling").
  {
    let runStart = -1;
    let buf = "";
    for (let i = 0; i <= text.length; ) {
      const cp = i < text.length ? text.codePointAt(i)! : -1;
      const w = cp > 0xffff ? 2 : 1;
      if (cp >= 0xe0020 && cp <= 0xe007e) {
        if (runStart < 0) runStart = i;
        buf += String.fromCharCode(cp - 0xe0000);
      } else if (cp !== 0xe0001 && cp !== 0xe007f) {
        if (runStart >= 0 && buf.trim().length >= 3) push({ start: runStart, end: i, via: "hidden Unicode tag characters", text: buf });
        runStart = -1;
        buf = "";
      }
      i += i < text.length ? w : 1;
    }
  }

  // 2. Base64 (standard and URL-safe).
  for (const m of text.matchAll(/(?<![A-Za-z0-9+/=_-])([A-Za-z0-9+/]{16,}={0,2}|[A-Za-z0-9_-]{24,})(?![A-Za-z0-9+/=_-])/g)) {
    const token = m[1];
    if (/^[0-9a-f]+$/i.test(token) && token.length % 2 === 0) continue; // plain hex, handled below
    if (/^[A-Za-z]+$/.test(token) && token.length < 40) continue; // a long word, not base64
    const bytes = base64ToBytes(token);
    if (!bytes) continue;
    const decoded = decodeBytesToText(bytes);
    if (decoded && /[\s.,:]/.test(decoded)) push({ start: m.index!, end: m.index! + token.length, via: "base64", text: decoded });
  }

  // 3. Hex: plain runs, \x escapes, 0x lists.
  for (const m of text.matchAll(/(?<![0-9a-fA-F])((?:[0-9a-fA-F]{2}){10,})(?![0-9a-fA-F])/g)) {
    const hex = m[1];
    const bytes = new Uint8Array(hex.match(/../g)!.map((h) => parseInt(h, 16)));
    const decoded = decodeBytesToText(bytes);
    if (decoded && /\s/.test(decoded)) push({ start: m.index!, end: m.index! + hex.length, via: "hex", text: decoded });
  }
  for (const m of text.matchAll(/(?:\\x[0-9a-fA-F]{2}){6,}/g)) {
    const bytes = new Uint8Array(m[0].match(/\\x([0-9a-fA-F]{2})/g)!.map((h) => parseInt(h.slice(2), 16)));
    const decoded = decodeBytesToText(bytes);
    if (decoded) push({ start: m.index!, end: m.index! + m[0].length, via: "hex escapes", text: decoded });
  }

  // 4. Percent-encoding.
  for (const m of text.matchAll(/(?:%[0-9A-Fa-f]{2}[A-Za-z0-9 ._~-]{0,3}){6,}/g)) {
    try {
      const decoded = decodeURIComponent(m[0]);
      if (decoded !== m[0] && (decoded.match(/\p{L}/gu) || []).length >= 4) push({ start: m.index!, end: m.index! + m[0].length, via: "URL encoding", text: decoded });
    } catch {
      /* not valid */
    }
  }

  // 5. Numeric HTML entities and \u escapes.
  for (const m of text.matchAll(/(?:&#x?[0-9a-fA-F]+;){5,}/g)) {
    const decoded = m[0].replace(/&#(x?)([0-9a-fA-F]+);/g, (_, x, n) => String.fromCodePoint(parseInt(n, x ? 16 : 10)));
    push({ start: m.index!, end: m.index! + m[0].length, via: "HTML entities", text: decoded });
  }
  for (const m of text.matchAll(/(?:\\u[0-9a-fA-F]{4}){5,}/g)) {
    const decoded = m[0].replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    push({ start: m.index!, end: m.index! + m[0].length, via: "Unicode escapes", text: decoded });
  }

  // 6. Binary octets.
  for (const m of text.matchAll(/(?:\b[01]{8}\b[\s,]*){6,}/g)) {
    const bytes = new Uint8Array(m[0].match(/[01]{8}/g)!.map((b) => parseInt(b, 2)));
    const decoded = decodeBytesToText(bytes);
    if (decoded) push({ start: m.index!, end: m.index! + m[0].length, via: "binary", text: decoded });
  }

  // 7. ROT13 / Caesar shifts and reversed text. Look-alike letters and invisible characters are
  // folded first, in both orders, since attackers stack them on top of the encoding.
  if (text.length < 40000) {
    // 7a. Sentence by sentence first, so a readable sentence next to an encoded one stays as it is.
    // A dot inside a token (an address, "backup.com") does not end the sentence.
    for (const m of text.matchAll(/(?:[^\n.!?]|[.!?](?=[^\s.!?]))+/g)) {
      const chunk = m[0];
      if (chunk.length < 14 || chunk.length > 400) continue;
      if (overlaps(m.index!, m.index! + chunk.length)) continue;
      const clean = fold(chunk);
      const letters = (clean.match(/[a-z]/gi) || []).length;
      if (letters < clean.length * 0.6) continue;
      const baseTriggers = triggerCount(clean);
      const commonWords = (clean.match(COMMON) || []).length;
      const words = clean.split(/\s+/).filter(Boolean).length;
      const gibberish = words > 0 && (commonWords / words < 0.12 || englishness(clean).share < 0.25);
      const candidates: Array<[string, string]> = [
        ["ROT13", fold(rot(stripHidden(chunk), 13))],
        ["ROT13", rot(clean, 13)],
        ["reversed text", [...clean].reverse().join("")],
      ];
      if (gibberish) for (let n = 1; n < 26; n++) if (n !== 13) candidates.push([`Caesar shift ${26 - n}`, rot(clean, n)]);
      // Of the candidates that pass, keep the most readable (ROT13 folded before or after rotating).
      const passing = candidates.filter(([, dec]) => (triggerCount(dec) >= 2 && triggerCount(dec) > baseTriggers + 1 && (dec.match(COMMON) || []).length >= 1) || (gibberish && (decodesToEnglish(clean, dec) || techAppears(clean, dec))));
      const best = passing.sort((x, y) => englishness(y[1], true).share - englishness(x[1], true).share)[0];
      if (best) push({ start: m.index!, end: m.index! + chunk.length, via: best[0], text: best[1] });
    }
    // 7b. Then whole lines: reversed text mirrors its punctuation, so sentence splits can cut it apart.
    for (const m of text.matchAll(/[^\n]{14,2000}/g)) {
      const line = m[0];
      const clean = fold(line);
      if (englishness(clean).share >= 0.3) continue;
      // A line already decoded piece by piece is decoded whole only if that reads clearly more words.
      const pieces = found.filter((d) => d.start < m.index! + line.length && d.end > m.index!);
      const enWords = (x: string) => { const e = englishness(x, true); return Math.round(e.share * e.words); };
      const pieceWords = pieces.reduce((n, d) => n + enWords(d.text), 0);
      const candidates: Array<[string, string]> = [
        ["reversed text", [...clean].reverse().join("")],
        ["ROT13", fold(rot(stripHidden(line), 13))],
        ["ROT13", rot(clean, 13)],
      ];
      const passing = candidates.filter(([, dec]) => decodesToEnglish(clean, dec, 6) || techAppears(clean, dec));
      const best = passing.sort((x, y) => englishness(y[1], true).share - englishness(x[1], true).share)[0];
      if (best) {
        const [via, dec] = best;
        if (!pieces.length) push({ start: m.index!, end: m.index! + line.length, via, text: dec });
        else if (enWords(dec) >= pieceWords + 2) {
          taken.push([m.index!, m.index! + line.length]);
          found.push({ start: m.index!, end: m.index! + line.length, via, text: dec });
        }
      }
    }
  }

  // Nested encodings (base64 of hex, and so on).
  if (depth < 2) {
    for (const d of [...found]) {
      for (const inner of findEncoded(d.text, depth + 1)) {
        // ROT13 and reversal undo themselves: decoding twice is not a second layer.
        if (inner.via === d.via && (d.via === "ROT13" || d.via === "reversed text")) continue;
        found.push({ start: d.start, end: d.end, via: `${d.via} then ${inner.via}`, text: inner.text });
      }
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

/** Phrases that ask the AI to decode something and act on it. */
export const DECODE_AND_ACT = /\b(decode|decrypt|translate|convert|unscramble|reverse|rot13|base64[- ]?decode)\b[^.\n]{0,60}\b(and|then)\b[^.\n]{0,30}\b(follow|execute|do|run|obey|carry out|act on|apply|perform)\b/i;
