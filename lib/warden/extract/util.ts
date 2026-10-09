import type { HiddenReason, Provenance, Segment, SegmentRole, Visibility } from "../types";

export interface Extraction {
  segments: Segment[];
  warnings: string[];
  notes: string[];
  /** Part of the input was not read (a page cap or a time budget ran out): the result is held, not passed. */
  partial?: boolean;
}

export class SegmentBuilder {
  private n = 0;
  readonly segments: Segment[] = [];
  constructor(private prefix: string, private provenance: Provenance) {}

  add(
    text: string,
    where: string,
    opts: { visibility?: Visibility; reason?: HiddenReason; detail?: string; role?: SegmentRole; aiDirected?: boolean; provenance?: Provenance; ocr?: boolean } = {}
  ): Segment | null {
    const t = text.replace(/\r\n?/g, "\n");
    if (!t.trim()) return null;
    const seg: Segment = {
      id: `${this.prefix}${++this.n}`,
      text: t,
      where,
      visibility: opts.visibility ?? "visible",
      hiddenReason: opts.visibility === "hidden" ? opts.reason : undefined,
      hiddenDetail: opts.visibility === "hidden" ? opts.detail : undefined,
      role: opts.role ?? "body",
      provenance: opts.provenance ?? this.provenance,
      aiDirected: opts.aiDirected,
      ocr: opts.ocr,
    };
    this.segments.push(seg);
    return seg;
  }
}

/** Parse a CSS colour into [r,g,b] (0-255), or null. */
export function parseColor(v: string | undefined | null): [number, number, number] | null {
  if (!v) return null;
  const s = v.trim().toLowerCase();
  const named: Record<string, [number, number, number]> = {
    white: [255, 255, 255], black: [0, 0, 0], transparent: [255, 255, 255], snow: [255, 250, 250], ivory: [255, 255, 240],
    whitesmoke: [245, 245, 245], ghostwhite: [248, 248, 255], azure: [240, 255, 255], mintcream: [245, 255, 250],
    floralwhite: [255, 250, 240], linen: [250, 240, 230], seashell: [255, 245, 238], honeydew: [240, 255, 240],
  };
  if (named[s]) return named[s];
  let m = s.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split("").map((c) => c + c).join("");
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  m = s.match(/^rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)(?:[ ,/]+([\d.]+%?))?\s*\)$/);
  if (m) {
    const a = m[4] ? (m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4])) : 1;
    if (a < 0.08) return [255, 255, 255];
    return [+m[1], +m[2], +m[3]];
  }
  return null;
}

export function luminance([r, g, b]: [number, number, number]) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

export function nearlySame(a: [number, number, number], b: [number, number, number]) {
  return Math.abs(luminance(a) - luminance(b)) < 0.06 && Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 60;
}

export function hexOf([r, g, b]: [number, number, number]) {
  return "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("").toUpperCase();
}

export function decodeEntities(s: string) {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

export function bytesToText(bytes: Uint8Array) {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

/** Common OCR misreads that matter for detection ("Al assistant" for "AI assistant"). */
export function fixOcrText(text: string) {
  return text.replace(/\bA[l1|I](?=[\s:,-]+(?:assistants?|agents?|models?|systems?|bots?|readers?|screeners?|reviewers?|tools?|summari[sz]ers?|coding|recruiters?)\b)/gi, "AI").replace(/\bAl\b(?=\s*[:,])/g, "AI");
}
