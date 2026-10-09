// Normalisation that keeps a map back to the original text, so every finding can be
// highlighted exactly where it sits in what the user pasted.
//
// The detectors run on `norm`. `map[i]` is the index in the original string of norm[i];
// `map[norm.length]` is the original length.

export interface Span {
  start: number;
  end: number;
}

import { isKnownWord, SHORT_SPELLED } from "./vocab";

export interface Normalized {
  norm: string;
  map: number[];
  evidence: {
    invisible: number;
    tagChars: number;
    bidi: number;
    mixedScript: Span[];
    leet: Span[];
    spaced: Span[];
  };
}

// Zero-width and other invisible format characters (not including Unicode tags, handled below).
const ZERO_WIDTH = new Set([
  0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x2060, 0x2061, 0x2062, 0x2063, 0x2064, 0xfeff, 0x00ad,
  0x180e, 0x034f, 0x061c, 0x115f, 0x1160, 0x3164, 0xffa0,
]);
const BIDI = new Set([0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069]);

export function isTagChar(cp: number) {
  return cp >= 0xe0000 && cp <= 0xe007f;
}

export function isInvisibleCodePoint(cp: number) {
  return ZERO_WIDTH.has(cp) || BIDI.has(cp) || isTagChar(cp) || (cp >= 0xfe00 && cp <= 0xfe0f && false);
}

// Cyrillic and Greek letters that look like Latin ones.
const CONFUSABLES: Record<string, string> = {
  "а": "a", "в": "b", "е": "e", "ё": "e", "к": "k", "м": "m", "н": "h", "о": "o", "р": "p", "с": "c",
  "т": "t", "у": "y", "х": "x", "ѕ": "s", "і": "i", "ї": "i", "ј": "j", "ԁ": "d", "ӏ": "l", "ԛ": "q",
  "ԝ": "w", "ɡ": "g", "ɩ": "i", "ⅰ": "i", "ⅼ": "l",
  "α": "a", "β": "b", "ε": "e", "η": "n", "ι": "i", "κ": "k", "ν": "v", "ο": "o", "ρ": "p", "τ": "t",
  "υ": "u", "χ": "x", "ω": "w", "ϲ": "c", "ϳ": "j",
  "А": "a", "В": "b", "Е": "e", "К": "k", "М": "m", "Н": "h", "О": "o", "Р": "p", "С": "c", "Т": "t",
  "Х": "x", "Ѕ": "s", "І": "i", "Ј": "j", "Α": "a", "Β": "b", "Ε": "e", "Ζ": "z", "Η": "h", "Ι": "i",
  "Κ": "k", "Μ": "m", "Ν": "n", "Ο": "o", "Ρ": "p", "Τ": "t", "Υ": "y", "Χ": "x",
};

/** Drops invisible characters and maps look-alike letters to Latin, with no offset map (for decoders). */
export function fold(text: string): string {
  let out = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (isInvisibleCodePoint(cp) || cp === 0xad) continue;
    out += CONFUSABLES[ch] ?? ch;
  }
  return out;
}

const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i", "|": "l" };

interface Ch {
  c: string;
  i: number;
}

const LATIN = /[a-z]/i;
const isLetter = (c: string) => /\p{L}/u.test(c);

export function normalize(text: string): Normalized {
  const evidence: Normalized["evidence"] = { invisible: 0, tagChars: 0, bidi: 0, mixedScript: [], leet: [], spaced: [] };

  // Pass 1: drop invisible characters, NFKC each code point, lowercase.
  let chars: Ch[] = [];
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i)!;
    const width = cp > 0xffff ? 2 : 1;
    if (isTagChar(cp)) {
      evidence.tagChars++;
      evidence.invisible++;
      i += width;
      continue;
    }
    if (ZERO_WIDTH.has(cp) || BIDI.has(cp)) {
      if (BIDI.has(cp)) evidence.bidi++;
      evidence.invisible++;
      i += width;
      continue;
    }
    const raw = String.fromCodePoint(cp);
    const confusable = CONFUSABLES[raw];
    const nf = (confusable ? raw : raw.normalize("NFKC")).toLowerCase();
    for (const c of nf) chars.push({ c, i });
    i += width;
  }

  // Emails, web addresses and @handles keep their characters: leet fixes would break them. They are
  // found after invisible characters are dropped, so "h​a​r​v​e​s​t​@mailer.top" is still an address.
  const protectedIdx = new Set<number>();
  {
    const flat = chars.map((c) => c.c).join("");
    for (const m of flat.matchAll(/(?<![a-z0-9._%+-])[a-z0-9._%+-]{1,64}@[a-z0-9.-]{1,253}\.[a-z]{2,24}|https?:\/\/[^\s)<>"']+|www\.[^\s)<>"']+|(?<![\w.])@[a-z0-9_]{3,}|(?<![\w.-])[\w.-]{1,64}@(?:upi|ok[a-z]+|ybl|paytm|ibl|axl)\b/g)) {
      for (let k = m.index!; k < m.index! + m[0].length; k++) protectedIdx.add(chars[k].i);
    }
  }
  const isProtected = (i: number) => protectedIdx.has(i);

  // Pass 2: per token, fix mixed-script look-alikes and leetspeak.
  const out: Ch[] = [];
  let t = 0;
  while (t < chars.length) {
    const c = chars[t].c;
    const tokenish = isLetter(c) || /[0-9@$!|]/.test(c);
    if (!tokenish) {
      out.push(chars[t]);
      t++;
      continue;
    }
    let e = t;
    while (e < chars.length && (isLetter(chars[e].c) || /[0-9@$!|]/.test(chars[e].c))) e++;
    const token = chars.slice(t, e);
    if (token.some((x) => isProtected(x.i))) {
      out.push(...token);
      t = e;
      continue;
    }
    const s = token.map((x) => x.c).join("");
    const hasLatin = LATIN.test(s);
    const hasConfusable = token.some((x) => CONFUSABLES[x.c] !== undefined || CONFUSABLES[text[x.i]] !== undefined);
    let fixed = token;
    if (hasConfusable && (hasLatin || token.every((x) => CONFUSABLES[x.c] !== undefined || /[a-z]/.test(x.c)))) {
      fixed = token.map((x) => ({ c: CONFUSABLES[x.c] ?? CONFUSABLES[text[x.i]] ?? x.c, i: x.i }));
      if (hasLatin) evidence.mixedScript.push({ start: token[0].i, end: token[token.length - 1].i + 1 });
    }
    const letters = fixed.filter((x) => /[a-z]/.test(x.c)).length;
    const leetChars = fixed.filter((x) => LEET[x.c] !== undefined).length;
    // Leet only inside a word that is mostly letters (avoid "covid19", "a1", phone numbers).
    // Mostly-digit words count only when they decode to a known word ("r357r1c710n5").
    const de = leetChars > 0 ? fixed.map((x) => ({ c: LEET[x.c] ?? x.c, i: x.i })) : fixed;
    if (leetChars > 0 && letters >= 2 && (letters >= leetChars || isKnownWord(de.map((x) => x.c).join(""))) && !/^[0-9]+$/.test(s) && !/^[a-z]+[0-9]{2,}$/.test(s)) {
      evidence.leet.push({ start: token[0].i, end: token[token.length - 1].i + 1 });
      fixed = de;
    }
    out.push(...fixed);
    t = e;
  }
  chars = out;

  // Pass 3: collapse spaced-out letters ("i g n o r e", "i.g.n.o.r.e") when the run is 4+ letters.
  const collapsed: Ch[] = [];
  let k = 0;
  while (k < chars.length) {
    if (/[a-z]/.test(chars[k].c) && (k === 0 || !/[a-z]/.test(chars[k - 1].c))) {
      const run: Ch[] = [chars[k]];
      let j = k + 1;
      while (j + 1 < chars.length && /[ .\-_*\/]/.test(chars[j].c) && /[a-z]/.test(chars[j + 1].c) && (j + 2 >= chars.length || !/[a-z]/.test(chars[j + 2].c))) {
        run.push(chars[j + 1]);
        j += 2;
      }
      // Short runs ("Y O U", "A I") count only in capitals and only when they spell a known word.
      const shortWord = run.length >= 2 && run.length <= 3 && run.every((x) => /[A-Z]/.test(text[x.i] ?? "")) && SHORT_SPELLED.has(run.map((x) => x.c).join(""));
      if (run.length >= 4 || shortWord) {
        evidence.spaced.push({ start: run[0].i, end: run[run.length - 1].i + 1 });
        // A lone dot before the run joins it too (". E N V" is ".env").
        if (collapsed.length >= 2 && collapsed[collapsed.length - 1].c === " " && collapsed[collapsed.length - 2].c === "." && (collapsed.length < 3 || /\s/.test(collapsed[collapsed.length - 3].c))) collapsed.pop();
        collapsed.push(...run);
        k = j;
        continue;
      }
    }
    collapsed.push(chars[k]);
    k++;
  }

  // Pass 4: collapse whitespace. A line break is kept when it is a real break (after end
  // punctuation, before a capital, a digit or a bullet, or a blank line); a wrapped line
  // becomes a space so phrases split across lines still match.
  const final: Ch[] = [];
  for (let k2 = 0; k2 < collapsed.length; k2++) {
    const ch = collapsed[k2];
    if (!/\s/.test(ch.c)) {
      final.push(ch);
      continue;
    }
    let j = k2;
    let newlines = 0;
    while (j < collapsed.length && /\s/.test(collapsed[j].c)) {
      if (collapsed[j].c === "\n") newlines++;
      j++;
    }
    const prev = final.length ? text[final[final.length - 1].i] ?? "" : "";
    const next = j < collapsed.length ? text[collapsed[j].i] ?? "" : "";
    const hard = newlines >= 2 || (newlines === 1 && (/[.!?:;।。|]/.test(prev) || /[A-Z0-9#>*\-•(\[]/.test(next) || !next));
    if (final.length) final.push({ c: newlines && hard ? "\n" : " ", i: ch.i });
    k2 = j - 1;
  }

  const norm = final.map((x) => x.c).join("");
  const map = final.map((x) => x.i);
  map.push(text.length);
  return { norm, map, evidence };
}

/** Map a [start, end) span in normalized text back to the original text. */
export function toOriginal(n: Normalized, start: number, end: number, originalLength: number): [number, number] {
  const s = n.map[Math.max(0, Math.min(start, n.map.length - 1))] ?? 0;
  const lastIdx = Math.max(start, end - 1);
  const e = (n.map[Math.min(lastIdx, n.map.length - 2)] ?? originalLength - 1) + 1;
  return [s, Math.min(Math.max(e, s + 1), originalLength)];
}

/** Remove invisible characters from text (used when sanitising). */
export function stripInvisible(text: string): { text: string; removed: number } {
  let removed = 0;
  let outText = "";
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i)!;
    const width = cp > 0xffff ? 2 : 1;
    if (isTagChar(cp) || ZERO_WIDTH.has(cp) || BIDI.has(cp)) {
      // Keep the zero-width joiner when it sits between two emoji (family emoji etc.).
      if (cp === 0x200d && /\p{Extended_Pictographic}/u.test(text.slice(Math.max(0, i - 2), i)) && /\p{Extended_Pictographic}/u.test(text.slice(i + 1, i + 3))) {
        outText += text.slice(i, i + width);
      } else removed++;
      i += width;
      continue;
    }
    outText += text.slice(i, i + width);
    i += width;
  }
  return { text: outText, removed };
}

/** Split text into sentence-ish chunks with offsets (for the classifier and the judge). */
export function sentences(text: string): Span[] {
  const spans: Span[] = [];
  const re = /(?:[^.!?\n।]|[.!?](?=[^\s.!?]))+[.!?।]*|\n+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const s = m.index;
    const e = s + m[0].length;
    if (m[0].trim().length === 0) continue;
    spans.push({ start: s, end: e });
  }
  return spans;
}
