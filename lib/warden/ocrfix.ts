// OCR on small or faint text makes systematic mistakes ("syatom" for "system", "provioss" for
// "previous"). For detection only, words that are a near miss of an attack-relevant word are
// snapped to it. The original OCR text is what people see; this corrected copy is checked.

import { ATTACK_WORDS, EN_WORDS, isKnownWord, SCRAMBLE_EXCEPTIONS } from "./vocab";

const LEXICON = ATTACK_WORDS;
const WORDS = new Set(LEXICON);
const COMMON = new Set("road roads wood word words world would could should their there these those where when what with from have this that will your yours were been being here also into over only some such than then them they very just like make made more most much must need next once said same each both many well".split(" "));

function dist(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = new Array(b.length + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length];
}

export const OCR_VIA = "OCR clean-up";

export function correctOcr(text: string): string {
  return text.replace(/[A-Za-z][A-Za-z_~./-]*[A-Za-z]/g, (tok) => {
    const lower = tok.toLowerCase();
    if (lower.length < 4 || WORDS.has(lower) || COMMON.has(lower)) return tok;
    if (/[_./~-]/.test(lower)) {
      // Paths and identifiers: fix a leading "l" for "i" (ld_rsa -> id_rsa) and similar.
      return tok.replace(/\bld_rsa\b/i, "id_rsa").replace(/\.ssb\b/, ".ssh");
    }
    const max = lower.length <= 5 ? 1 : lower.length <= 8 ? 2 : 3;
    let best: string | null = null;
    let bestD = max + 1;
    for (const w of LEXICON) {
      if (Math.abs(w.length - lower.length) > max) continue;
      const d = dist(lower, w, max);
      if (d < bestD) {
        bestD = d;
        best = w;
        if (d === 1) break;
      }
    }
    if (!best || bestD > max) return tok;
    return tok[0] === tok[0].toUpperCase() ? best[0].toUpperCase() + best.slice(1) : best;
  });
}

export const TYPO_VIA = "typo clean-up";

/** Derived copies made for reading, not hidden by anyone: OCR fixes and unscrambled typos. */
export const isCleanup = (via?: string) => via === OCR_VIA || via === TYPO_VIA;

const sig = (w: string) => w[0] + w[w.length - 1] + [...w.slice(1, -1)].sort().join("");
const SCRAMBLED = new Map<string, string>();
for (const w of [...ATTACK_WORDS, ...EN_WORDS]) if (w.length >= 5 && /^[a-z]+$/.test(w) && !SCRAMBLED.has(sig(w))) SCRAMBLED.set(sig(w), w);

/**
 * Typoglycemia: words with their middle letters shuffled ("ignroe", "isntructions") still read
 * fine to people and to AI models, so attackers use them to dodge filters (OWASP LLM prompt
 * injection cheat sheet). Snaps such words back to the attack word they spell. Word lengths are
 * kept, so offsets in the copy match the original exactly.
 */
export function fixScrambled(text: string): string {
  return text.replace(/[A-Za-z]{5,}/g, (tok) => {
    const lower = tok.toLowerCase();
    if (isKnownWord(lower) || SCRAMBLE_EXCEPTIONS.has(lower)) return tok;
    const w = SCRAMBLED.get(sig(lower));
    if (!w) return tok;
    return tok[0] === tok[0].toUpperCase() ? w[0].toUpperCase() + w.slice(1) : w;
  });
}
