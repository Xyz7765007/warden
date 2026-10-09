// PDF: walks each page's drawing operations and tracks fill colour, text size, position and
// render mode for every piece of text. White text, 1-point text, text drawn off the page and
// "invisible" render-mode text are all read by AI tools but never seen by a person.
// Scanned PDFs carry an invisible OCR layer on purpose; that case is recognised and allowed.

import { extractImages, getDocumentProxy, getResolvedPDFJS } from "unpdf";
import { SegmentBuilder, type Extraction } from "./util";
import type { HiddenReason } from "../types";

type M = [number, number, number, number, number, number];
const mul = (a: M, b: M): M => [
  a[0] * b[0] + a[1] * b[2],
  a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2],
  a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4],
  a[4] * b[1] + a[5] * b[3] + b[5],
];

function toM(v: any): M {
  if (Array.isArray(v)) return v.slice(0, 6).map(Number) as M;
  if (v && typeof v === "object") return [0, 1, 2, 3, 4, 5].map((i) => Number(v[i] ?? v[String(i)] ?? 0)) as M;
  return [1, 0, 0, 1, 0, 0];
}

function hexLum(hex: string): number {
  const h = hex.replace("#", "");
  if (h.length < 6) return 0;
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

interface Piece {
  text: string;
  hidden: { reason: HiddenReason; detail: string } | null;
  y: number;
  page: number;
  invisibleMode: boolean;
}

// Every page is read up to these limits; whatever is left unread holds the file for review
// rather than passing it unchecked.
const MAX_PAGES = 300;
const READ_BUDGET_MS = 20_000;
// A scan has no text layer: OCR the page images of the first few pages, within a time budget.
const SCAN_PAGES = 5;
const SCAN_BUDGET_MS = 25_000;

export async function extractPdf(bytes: Uint8Array): Promise<Extraction> {
  const b = new SegmentBuilder("p", "external");
  const warnings: string[] = [];
  const notes: string[] = [];
  const pdfjs: any = await getResolvedPDFJS();
  const OPS = pdfjs.OPS;
  const doc = await getDocumentProxy(new Uint8Array(bytes));

  // Document properties.
  try {
    const meta: any = await doc.getMetadata();
    const info = meta?.info || {};
    for (const key of ["Title", "Subject", "Keywords", "Author"]) {
      const v = info[key];
      if (typeof v === "string" && v.trim().length >= 12) {
        b.add(v, `PDF property: ${key}`, { visibility: "hidden", reason: "metadata", detail: `the PDF's ${key} property, not shown on the page`, role: "metadata" });
      }
    }
    const xmp = meta?.metadata?.getAll?.();
    if (xmp) {
      for (const [k, v] of Object.entries(xmp)) {
        if (typeof v === "string" && v.trim().length >= 20 && /description|subject|title|keywords/i.test(k)) {
          b.add(v, `PDF XMP: ${k}`, { visibility: "hidden", reason: "metadata", detail: `the PDF's XMP ${k} field`, role: "metadata" });
        }
      }
    }
  } catch {
    /* metadata is optional */
  }

  const pages = Math.min(doc.numPages, MAX_PAGES);
  const started = Date.now();
  let read = 0;
  let partial = false;

  for (let p = 1; p <= pages; p++) {
    if (Date.now() - started > READ_BUDGET_MS) break;
    read = p;
    const page: any = await doc.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const W = vp.width, H = vp.height;
    const ol = await page.getOperatorList();
    const pieces: Piece[] = [];
    let hasImage = false;
    // Areas painted dark (or covered by an image): white text drawn on them is visible.
    const covers: Array<[number, number, number, number]> = [];
    const coverBox = (minMax: number[], m: M) => {
      const pts = [[minMax[0], minMax[1]], [minMax[2], minMax[1]], [minMax[0], minMax[3]], [minMax[2], minMax[3]]].map(([x, y]) => [x * m[0] + y * m[2] + m[4], x * m[1] + y * m[3] + m[5]]);
      covers.push([Math.min(...pts.map((q) => q[0])), Math.min(...pts.map((q) => q[1])), Math.max(...pts.map((q) => q[0])), Math.max(...pts.map((q) => q[1]))]);
    };
    const onCover = (x: number, y: number) => covers.some(([x0, y0, x1, y1]) => x >= x0 - 2 && x <= x1 + 2 && y >= y0 - 2 && y <= y1 + 2);

    let gs = { fill: "#000000", mode: 0, ctm: [1, 0, 0, 1, 0, 0] as M };
    const stack: (typeof gs)[] = [];
    let fontSize = 12;
    let leading = 0;
    let tm: M = [1, 0, 0, 1, 0, 0];
    let tlm: M = [1, 0, 0, 1, 0, 0];

    const emit = (glyphs: any) => {
      let s = "";
      for (const g of Array.isArray(glyphs) ? glyphs : []) {
        if (typeof g === "number") {
          if (g < -150) s += " ";
        } else if (g && typeof g === "object") s += g.unicode ?? "";
      }
      if (!s.trim()) return;
      const full = mul(tm, gs.ctm);
      const x = full[4], y = full[5];
      const scale = Math.hypot(full[2], full[3]) || 1;
      const size = fontSize * scale;
      let hidden: Piece["hidden"] = null;
      const invisibleMode = gs.mode === 3 || gs.mode === 7;
      if (invisibleMode) hidden = { reason: "invisible_render", detail: "drawn in invisible render mode" };
      else if ([0, 2, 4, 6].includes(gs.mode) && hexLum(gs.fill) > 0.92 && !onCover(x, y)) hidden = { reason: "white_text", detail: `${gs.fill.toUpperCase()} text on a white page` };
      else if (size > 0 && size < 3) hidden = { reason: "tiny_text", detail: `${size.toFixed(1)}-point text, too small to read` };
      else if (x < -2 || x > W + 2 || y < -2 || y > H + 2) hidden = { reason: "off_page", detail: "placed outside the visible page" };
      pieces.push({ text: s, hidden, y, page: p, invisibleMode });
    };

    for (let i = 0; i < ol.fnArray.length; i++) {
      const fn = ol.fnArray[i];
      const a = ol.argsArray[i];
      switch (fn) {
        case OPS.save:
          stack.push({ ...gs, ctm: [...gs.ctm] as M });
          break;
        case OPS.restore:
          gs = stack.pop() ?? gs;
          break;
        case OPS.transform:
          gs.ctm = mul(toM(a), gs.ctm);
          break;
        case OPS.setFillRGBColor:
          gs.fill = typeof a?.[0] === "string" ? a[0] : `#${[a?.[0], a?.[1], a?.[2]].map((x: number) => Math.round(Number(x) || 0).toString(16).padStart(2, "0")).join("")}`;
          break;
        case OPS.setFillGray:
          gs.fill = `#${Math.round((Number(a?.[0]) || 0) * 255).toString(16).padStart(2, "0").repeat(3)}`;
          break;
        case OPS.setTextRenderingMode:
          gs.mode = Number(a?.[0]) || 0;
          break;
        case OPS.setFont:
          fontSize = Math.abs(Number(a?.[1]) || fontSize);
          break;
        case OPS.setLeading:
          leading = Number(a?.[0]) || 0;
          break;
        case OPS.beginText:
          tm = [1, 0, 0, 1, 0, 0];
          tlm = [1, 0, 0, 1, 0, 0];
          break;
        case OPS.setTextMatrix:
          tm = toM(a?.[0] ?? a);
          if (Array.isArray(a) && a.length >= 6 && typeof a[0] === "number") tm = a.slice(0, 6) as M;
          tlm = [...tm] as M;
          break;
        case OPS.moveText:
        case OPS.setLeadingMoveText:
          if (fn === OPS.setLeadingMoveText) leading = -Number(a?.[1]) || leading;
          tlm = mul([1, 0, 0, 1, Number(a?.[0]) || 0, Number(a?.[1]) || 0], tlm);
          tm = [...tlm] as M;
          break;
        case OPS.nextLine:
          tlm = mul([1, 0, 0, 1, 0, -leading], tlm);
          tm = [...tlm] as M;
          break;
        case OPS.showText:
        case OPS.showSpacedText:
          emit(a?.[0]);
          break;
        case OPS.nextLineShowText:
        case OPS.nextLineSetSpacingShowText:
          tlm = mul([1, 0, 0, 1, 0, -leading], tlm);
          tm = [...tlm] as M;
          emit(a?.[a.length - 1]);
          break;
        case OPS.paintImageXObject:
        case OPS.paintInlineImageXObject:
        case OPS.paintImageMaskXObject:
          hasImage = true;
          coverBox([0, 0, 1, 1], gs.ctm);
          break;
        case OPS.constructPath: {
          const paint = Number(a?.[0]);
          const mm = a?.[2];
          const fills = [OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke];
          if (fills.includes(paint) && mm && mm.length >= 4 && hexLum(gs.fill) < 0.75) coverBox(Array.from(mm as ArrayLike<number>), gs.ctm);
          break;
        }
      }
    }

    // A scanned page: mostly invisible text over an image is an OCR layer, not an attack.
    const total = pieces.reduce((n, x) => n + x.text.length, 0);
    const invisible = pieces.filter((x) => x.invisibleMode).reduce((n, x) => n + x.text.length, 0);
    if (hasImage && total > 0 && invisible / total > 0.8) {
      for (const x of pieces) if (x.invisibleMode) x.hidden = null;
      notes.push(`Page ${p} is a scanned page with an OCR text layer; that layer is treated as the page's visible text.`);
    }

    // Group into lines, then into runs that share visibility.
    let run: { text: string; hidden: Piece["hidden"]; lastY: number } | null = null;
    let line = 1;
    const flush = () => {
      if (!run) return;
      if (run.hidden) b.add(run.text, `Page ${p}, near line ${line}`, { visibility: "hidden", reason: run.hidden.reason, detail: run.hidden.detail });
      else b.add(run.text, `Page ${p}`, {});
      run = null;
    };
    for (const piece of pieces) {
      const same = run && ((run.hidden === null && piece.hidden === null) || (run.hidden && piece.hidden && run.hidden.reason === piece.hidden.reason));
      if (run && same) {
        const newLine = Math.abs(piece.y - run.lastY) > 1;
        run.text += newLine ? "\n" + piece.text : piece.text;
        if (newLine) line++;
        run.lastY = piece.y;
      } else {
        flush();
        line++;
        run = { text: piece.text, hidden: piece.hidden, lastY: piece.y };
      }
    }
    flush();

    try {
      const annots: any[] = await page.getAnnotations();
      for (const an of annots) {
        const t = [an.titleObj?.str, an.contentsObj?.str ?? an.contents].filter(Boolean).join(": ").trim();
        if (t.length >= 8) b.add(t, `Page ${p} annotation (${an.subtype || "note"})`, { visibility: "hidden", reason: "annotation", detail: "a PDF annotation, shown only if a reader opens it", role: "comment" });
      }
    } catch {
      /* annotations are optional */
    }
  }
  if (read < doc.numPages) {
    partial = true;
    warnings.push(`Read ${read} of ${doc.numPages} pages in the time allowed; the rest were not checked, so the file is held for review.`);
  }
  if (!b.segments.some((s) => s.role === "body")) {
    // A scan: no text layer, so read the page images with OCR, the way a vision model would see them.
    const { extractImage } = await import("./image");
    const sharp = (await import("sharp")).default;
    const scanStart = Date.now();
    let scanned = 0;
    for (let p = 1; p <= Math.min(doc.numPages, SCAN_PAGES); p++) {
      if (Date.now() - scanStart > SCAN_BUDGET_MS) break;
      try {
        const images = (await extractImages(doc, p)).filter((im) => im.width * im.height >= 10_000).sort((x, y) => y.width * y.height - x.width * x.height).slice(0, 2);
        for (const im of images) {
          const png = await sharp(Buffer.from(im.data), { raw: { width: im.width, height: im.height, channels: im.channels } }).png().toBuffer();
          const r = await extractImage(new Uint8Array(png), `page ${p}`);
          for (const seg of r.segments) b.add(seg.text, `Page ${p} image: ${seg.where}`, { visibility: seg.visibility, reason: seg.hiddenReason, detail: seg.hiddenDetail, role: seg.role, ocr: true });
          if (r.partial) partial = true;
        }
        scanned = p;
      } catch (e) {
        partial = true;
        warnings.push(`Could not read the images on page ${p} (${(e as Error).message}).`);
      }
    }
    if (scanned < doc.numPages) {
      partial = true;
      warnings.push(`The PDF has no text layer (it may be a scan). Read the page images of ${scanned} of ${doc.numPages} pages with OCR; the rest were not checked, so the file is held for review.`);
    } else notes.push(`The PDF has no text layer (it may be a scan); its page images were read with OCR.`);
  }
  return { segments: b.segments, warnings, notes, partial };
}
