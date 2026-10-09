// Images: OCR reads the text a vision model would see. A second pass on an "ink map"
// (every pixel that differs from the background, however faintly) finds text drawn in near-
// background colours that a person cannot see. Tiny text and text hidden in the file's
// metadata (PNG text chunks, EXIF, XMP) are reported too.

import sharp from "sharp";
import zlib from "node:zlib";
import path from "node:path";
import { SegmentBuilder, fixOcrText, type Extraction } from "./util";

let workerPromise: Promise<any> | null = null;

/** OCR is time-boxed: a stuck worker fails this reader (the scan then holds the file) instead of hanging the request. */
function within<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    p.finally(() => clearTimeout(timer)),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} took longer than ${Math.round(ms / 1000)} s`)), ms);
    }),
  ]);
}

async function getWorker() {
  if (!workerPromise) {
    workerPromise = within((async () => {
      const { createWorker } = await import("tesseract.js");
      const cachePath = process.env.WARDEN_TESSDATA || path.join(process.cwd(), "data", "tessdata");
      const w = await createWorker("eng", 1, { cachePath, cacheMethod: "readOnly", gzip: false });
      await w.setParameters({ user_defined_dpi: "300" });
      return w;
    })(), 25_000, "Starting OCR").catch((e) => {
      workerPromise = null;
      throw e;
    });
  }
  return workerPromise;
}

interface OcrLine {
  text: string;
  height: number;
  conf: number;
  y0: number;
  y1: number;
}

async function ocrLines(png: Buffer): Promise<{ text: string; lines: OcrLine[] }> {
  const worker = await getWorker();
  const r = await within<any>(worker.recognize(png, {}, { text: true, blocks: true }), 20_000, "OCR");
  const lines: OcrLine[] = [];
  for (const block of r.data.blocks || []) {
    for (const para of block.paragraphs || []) {
      for (const line of para.lines || []) {
        const t = (line.text || "").trim();
        if (t) lines.push({ text: t, height: (line.bbox?.y1 ?? 0) - (line.bbox?.y0 ?? 0), conf: line.confidence ?? 0, y0: line.bbox?.y0 ?? 0, y1: line.bbox?.y1 ?? 0 });
      }
    }
  }
  return { text: r.data.text || "", lines };
}

async function inkMap(img: Buffer): Promise<{ png: Buffer; data: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(img).grayscale().raw().toBuffer({ resolveWithObject: true });
  const hist = new Array(256).fill(0);
  for (const v of data) hist[v]++;
  const bg = hist.indexOf(Math.max(...hist));
  const out = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) out[i] = Math.abs(data[i] - bg) > 3 ? 0 : 255;
  const png = await sharp(out, { raw: { width: info.width, height: info.height, channels: 1 } }).png().toBuffer();
  return { png, data: out, width: info.width, height: info.height };
}

/** Horizontal bands that contain ink: candidate text lines. */
function inkBands(ink: { data: Buffer; width: number; height: number }): Array<[number, number]> {
  const rows: number[] = [];
  for (let y = 0; y < ink.height; y++) {
    let c = 0;
    const off = y * ink.width;
    for (let x = 0; x < ink.width; x++) if (ink.data[off + x] === 0) c++;
    rows.push(c);
  }
  const bands: Array<[number, number]> = [];
  let start = -1;
  let gap = 0;
  for (let y = 0; y <= rows.length; y++) {
    const on = y < rows.length && rows[y] >= 2;
    if (on) {
      if (start < 0) start = y;
      gap = 0;
    } else if (start >= 0) {
      gap++;
      if (gap > 2 || y === rows.length) {
        const end = y - gap + 1;
        if (end - start >= 3) bands.push([start, end]);
        start = -1;
        gap = 0;
      }
    }
  }
  return bands;
}

function words(s: string) {
  return new Set(s.toLowerCase().replace(/[^a-z0-9@.\s]/g, " ").split(/\s+/).filter((w) => w.length >= 3));
}

function pngTextChunks(buf: Buffer): Array<{ key: string; text: string }> {
  const out: Array<{ key: string; text: string }> = [];
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) return out;
  let off = 8;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("latin1", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    try {
      if (type === "tEXt") {
        const z = data.indexOf(0);
        out.push({ key: data.toString("latin1", 0, z), text: data.toString("latin1", z + 1) });
      } else if (type === "zTXt") {
        const z = data.indexOf(0);
        out.push({ key: data.toString("latin1", 0, z), text: zlib.inflateSync(data.subarray(z + 2)).toString("latin1") });
      } else if (type === "iTXt") {
        const z = data.indexOf(0);
        const compressed = data[z + 1] === 1;
        let p = z + 3;
        p = data.indexOf(0, p) + 1; // language tag
        p = data.indexOf(0, p) + 1; // translated keyword
        const body = data.subarray(p);
        out.push({ key: data.toString("latin1", 0, z), text: (compressed ? zlib.inflateSync(body) : body).toString("utf8") });
      }
    } catch {
      /* skip a broken chunk */
    }
    if (type === "IEND") break;
    off += 12 + len;
  }
  return out;
}

function printableRuns(buf: Buffer | undefined, min = 16): string[] {
  if (!buf) return [];
  const s = buf.toString("latin1");
  return (s.match(new RegExp(`[\\x20-\\x7E]{${min},}`, "g")) || []).filter((r) => /[a-z]{3,}\s+[a-z]{2,}/i.test(r) && !/^(Exif|MM|II|http:\/\/ns\.adobe\.com|adobe:ns|x:xmpmeta|rdf:|xmlns)/i.test(r));
}

export async function shutdownOcr() {
  if (!workerPromise) return;
  try {
    const w = await workerPromise;
    await w.terminate();
  } catch {
    /* already gone */
  }
  workerPromise = null;
}

// The faint-text search stops after this long; an image it could not finish is held for review.
const FAINT_BUDGET_MS = 12_000;

export async function extractImage(bytes: Uint8Array, name?: string): Promise<Extraction> {
  const b = new SegmentBuilder("i", "external");
  const warnings: string[] = [];
  const notes: string[] = [];
  const started = Date.now();
  let partial = false;
  const buf = Buffer.from(bytes);
  const meta = await sharp(buf).metadata();
  const W = meta.width || 0, H = meta.height || 0;
  notes.push(`${(meta.format || "image").toUpperCase()} ${W}×${H}.`);

  // Text hidden in the file itself.
  for (const c of pngTextChunks(buf)) {
    if (c.text.trim().length >= 8 && !/^(Software|Creation Time|Source|dpi|XML:com\.adobe\.xmp)$/i.test(c.key)) {
      b.add(c.text, `Image metadata: ${c.key}`, { visibility: "hidden", reason: "metadata", detail: `a "${c.key}" text field inside the image file`, role: "metadata" });
    }
  }
  for (const run of [...printableRuns(meta.exif), ...printableRuns(meta.xmp ? Buffer.from(meta.xmp as any) : undefined)]) {
    b.add(run.replace(/<[^>]+>/g, " ").trim(), "Image metadata (EXIF/XMP)", { visibility: "hidden", reason: "metadata", detail: "text stored in the image's EXIF or XMP data", role: "metadata" });
  }

  // OCR at a sensible size.
  let base = sharp(buf).rotate();
  if (Math.max(W, H) > 2200) base = base.resize({ width: W >= H ? 2200 : undefined, height: H > W ? 2200 : undefined });
  const png = await base.flatten({ background: "#ffffff" }).png().toBuffer();
  let visible: { text: string; lines: OcrLine[] };
  try {
    visible = await ocrLines(png);
  } catch (e) {
    warnings.push(`OCR could not run (${(e as Error).message}), so the image was not read and is held for review.`);
    return { segments: b.segments, warnings, notes, partial: true };
  }
  const imgH = (await sharp(png).metadata()).height || H || 1;
  const heights = visible.lines.map((l) => l.height).filter((h) => h > 0).sort((a, b2) => a - b2);
  const medianH = heights.length ? heights[Math.floor(heights.length / 2)] : 0;
  const tinyLimit = medianH ? Math.max(8, medianH * 0.45) : Math.max(8, imgH * 0.011);
  const normal = visible.lines.filter((l) => l.height >= tinyLimit);
  const tiny = visible.lines.filter((l) => l.height < tinyLimit && l.text.length > 8);
  if (normal.length) b.add(fixOcrText(normal.map((l) => l.text).join("\n")), "Text in the image", { role: "body", ocr: true });
  if (tiny.length) b.add(fixOcrText(tiny.map((l) => l.text).join("\n")), "Very small text in the image", { visibility: "hidden", reason: "tiny_text", detail: `text under ${Math.round(tinyLimit)} pixels tall, too small to read at normal size` });

  // Faint or tiny text: find every band of "ink" (pixels that differ from the background,
  // however faintly) that the normal read did not cover, enlarge just that band and read it.
  try {
    const ink = await inkMap(png);
    const seen = words(visible.text);
    const covered = (a: number, b2: number) => visible.lines.some((l) => Math.min(b2, l.y1) - Math.max(a, l.y0) > (b2 - a) * 0.5);
    const faint: string[] = [];
    const small: string[] = [];
    // A band taller than a text line could ever be is a photo or a texture, not hidden text.
    const bands = inkBands(ink).filter(([a, b2]) => b2 - a <= 200 && !covered(a, b2)).slice(0, 24);
    const gray = await sharp(png).grayscale().raw().toBuffer({ resolveWithObject: true });
    for (const [a, b2] of bands) {
      if (Date.now() - started > FAINT_BUDGET_MS) {
        partial = true;
        warnings.push(`Stopped looking for faint text after ${FAINT_BUDGET_MS / 1000} seconds; part of the image was not checked, so it is held for review.`);
        break;
      }
      const h = b2 - a;
      const top = Math.max(0, a - 3);
      const height = Math.min(ink.height - top, h + 6);
      // Contrast of the band in the original: faint text barely differs from the background.
      let mn = 255, mx = 0;
      for (let y = top; y < top + height; y++) {
        for (let x = 0; x < gray.info.width; x++) {
          const v = gray.data[y * gray.info.width + x];
          if (v < mn) mn = v;
          if (v > mx) mx = v;
        }
      }
      const lowContrast = mx - mn < 60;
      const scale = Math.max(2, Math.min(7, 48 / Math.max(1, h)));
      const crop = await sharp(png)
        .extract({ left: 0, top, width: ink.width, height })
        .grayscale()
        .normalise()
        .resize({ width: Math.round(ink.width * scale), kernel: "lanczos3" })
        .extend({ top: 24, bottom: 24, left: 24, right: 24, background: "#ffffff" })
        .png()
        .toBuffer();
      const r = await ocrLines(crop);
      const text = r.lines.map((l) => l.text).join(" ").trim();
      const w = [...words(text)];
      if (w.length < 3 || w.filter((x) => !seen.has(x)).length / w.length < 0.6) continue;
      if (lowContrast) faint.push(text);
      else if (h < tinyLimit) small.push(text);
      else faint.push(text);
    }
    if (faint.length) b.add(fixOcrText(faint.join("\n")), "Faint text in the image", { visibility: "hidden", reason: "faint_ink", detail: "drawn in a colour almost identical to the background, invisible to a person", ocr: true });
    if (small.length) b.add(fixOcrText(small.join("\n")), "Very small text in the image", { visibility: "hidden", reason: "tiny_text", detail: `text under ${Math.round(tinyLimit)} pixels tall, too small to read at normal size`, ocr: true });
  } catch (e) {
    partial = true;
    warnings.push(`The hidden-text pass failed (${(e as Error).message}), so the image is held for review.`);
  }
  if (!b.segments.length) notes.push(`No text found in ${name || "the image"}.`);
  return { segments: b.segments, warnings, notes, partial };
}
