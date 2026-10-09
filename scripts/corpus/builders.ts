// Builders that wrap a payload into a real file of each type, visibly or hidden in the ways
// attackers actually use. Used for the evaluation corpus and for the demo's sample files.

import { PDFDocument, StandardFonts, rgb, pushGraphicsState, popGraphicsState, setTextRenderingMode, TextRenderingMode } from "pdf-lib";
import JSZip from "jszip";
import { Resvg } from "@resvg/resvg-js";
import zlib from "node:zlib";

const xmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const htmlEsc = xmlEsc;

function wrapLines(text: string, max = 88): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > max) {
      lines.push(cur.trim());
      cur = w;
    } else cur += " " + w;
  }
  if (cur.trim()) lines.push(cur.trim());
  return lines;
}

// pdf-lib's standard fonts are WinAnsi only; keep non-Latin payloads out of PDFs.
const winAnsiSafe = (s: string) => /^[\x00-\xff‘’“”–—•€]*$/.test(s);

export type PdfCarrier = "visible" | "white" | "tiny" | "invisible" | "offpage" | "metadata" | "dark-banner" | "ocr-layer" | "fine-print";

export async function buildPdf(opts: { title: string; body: string[]; payload?: string; carrier: PdfCarrier }): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(opts.title);
  doc.setProducer("Sundaram Logistics billing");
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let y = 790;
  if (opts.carrier === "dark-banner") {
    page.drawRectangle({ x: 40, y: 770, width: 515, height: 44, color: rgb(0.11, 0.2, 0.42) });
    page.drawText(opts.title.slice(0, 60), { x: 52, y: 786, size: 15, font: bold, color: rgb(1, 1, 1) });
    if (opts.payload) page.drawText(opts.payload.slice(0, 80), { x: 52, y: 774, size: 8, font, color: rgb(1, 1, 1) });
    y = 740;
  } else {
    page.drawText(opts.title.slice(0, 70), { x: 50, y, size: 15, font: bold, color: rgb(0.08, 0.08, 0.1) });
    y -= 30;
  }
  for (const para of opts.body) {
    for (const line of wrapLines(para)) {
      page.drawText(line, { x: 50, y, size: 10.5, font, color: rgb(0.15, 0.15, 0.18) });
      y -= 15;
    }
    y -= 8;
  }
  const p = opts.payload;
  if (p && opts.carrier !== "dark-banner") {
    const lines = wrapLines(p, 90);
    switch (opts.carrier) {
      case "visible":
        for (const l of lines) {
          page.drawText(l, { x: 50, y, size: 10.5, font, color: rgb(0.15, 0.15, 0.18) });
          y -= 15;
        }
        break;
      case "white":
        for (const l of lines) {
          page.drawText(l, { x: 50, y, size: 10, font, color: rgb(1, 1, 1) });
          y -= 14;
        }
        break;
      case "tiny":
        page.drawText(p.slice(0, 400), { x: 50, y: 60, size: 1, font, color: rgb(0.2, 0.2, 0.2) });
        break;
      case "invisible":
        page.pushOperators(pushGraphicsState(), setTextRenderingMode(TextRenderingMode.Invisible));
        for (const l of lines) {
          page.drawText(l, { x: 50, y, size: 10, font });
          y -= 14;
        }
        page.pushOperators(popGraphicsState());
        break;
      case "offpage":
        for (const l of lines) {
          page.drawText(l, { x: -900, y, size: 10, font });
          y -= 14;
        }
        break;
      case "metadata":
        doc.setSubject(p);
        doc.setKeywords([p.slice(0, 120)]);
        break;
      case "fine-print":
        for (const l of wrapLines(p, 140)) {
          page.drawText(l, { x: 50, y: 70, size: 6, font, color: rgb(0.3, 0.3, 0.3) });
        }
        break;
      case "ocr-layer":
        break;
    }
  }
  if (opts.carrier === "ocr-layer") {
    // A "scanned" page: an image of the text with an invisible OCR layer on top.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="400"><rect width="1000" height="400" fill="#fbfbf8"/>${opts.body.slice(0, 4).map((l, i) => `<text x="30" y="${60 + i * 60}" font-family="Helvetica" font-size="26" fill="#222">${htmlEsc(l.slice(0, 70))}</text>`).join("")}</svg>`;
    const png = new Resvg(svg).render().asPng();
    const img = await doc.embedPng(png);
    const p2 = doc.addPage([595, 842]);
    p2.drawImage(img, { x: 40, y: 500, width: 515, height: 206 });
    p2.pushOperators(pushGraphicsState(), setTextRenderingMode(TextRenderingMode.Invisible));
    opts.body.slice(0, 4).forEach((l, i) => p2.drawText(l.slice(0, 70), { x: 50, y: 680 - i * 30, size: 12, font }));
    p2.pushOperators(popGraphicsState());
  }
  return doc.save();
}

export type DocxCarrier = "visible" | "vanish" | "white" | "tiny" | "comment" | "property";

export async function buildDocx(opts: { title: string; body: string[]; payload?: string; carrier: DocxCarrier; comment?: string }): Promise<Uint8Array> {
  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const run = (t: string, rPr = "") => `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ""}<w:t xml:space="preserve">${xmlEsc(t)}</w:t></w:r>`;
  const paras = [`<w:p>${run(opts.title, "<w:b/><w:sz w:val=\"32\"/>")}</w:p>`, ...opts.body.map((b) => `<w:p>${run(b)}</w:p>`)];
  const p = opts.payload;
  let comment = opts.comment;
  if (p) {
    if (opts.carrier === "visible") paras.push(`<w:p>${run(p)}</w:p>`);
    if (opts.carrier === "vanish") paras.splice(2, 0, `<w:p>${run("Please see the details below. ")}${run(p, "<w:vanish/>")}</w:p>`);
    if (opts.carrier === "white") paras.push(`<w:p>${run(p, '<w:color w:val="FFFFFF"/>')}</w:p>`);
    if (opts.carrier === "tiny") paras.push(`<w:p>${run(p, '<w:sz w:val="2"/>')}</w:p>`);
    if (opts.carrier === "comment") comment = p;
  }
  const commentRef = comment ? `<w:p><w:commentRangeStart w:id="0"/>${run("Reviewed.")}<w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p>` : "";
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}"><w:body>${paras.join("")}${commentRef}<w:sectPr/></w:body></w:document>`;
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`
  );
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`);
  zip.file("word/_rels/document.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/></Relationships>`);
  zip.file("word/document.xml", documentXml);
  zip.file("word/comments.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:comments xmlns:w="${W}">${comment ? `<w:comment w:id="0" w:author="Reviewer" w:initials="RV"><w:p>${run(comment)}</w:p></w:comment>` : ""}</w:comments>`);
  zip.file(
    "docProps/core.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xmlEsc(opts.title)}</dc:title><dc:creator>Sundaram Logistics</dc:creator>${opts.carrier === "property" && p ? `<dc:description>${xmlEsc(p)}</dc:description>` : "<dc:description>Internal document</dc:description>"}</cp:coreProperties>`
  );
  return zip.generateAsync({ type: "uint8array" });
}

export type EmailCarrier = "plain" | "html-hidden" | "alt-part" | "subject" | "attachment" | "html-visible";

export function buildEmail(opts: { from: string; subject: string; body: string[]; payload?: string; carrier: EmailCarrier; preheader?: string }): string {
  const p = opts.payload;
  const plainBody = [...opts.body, ...(p && (opts.carrier === "plain" || opts.carrier === "alt-part") ? [p] : [])].join("\n\n");
  const hidden = p && opts.carrier === "html-hidden" ? `<div style="display:none;font-size:0;color:#ffffff">${htmlEsc(p)}</div>` : "";
  const pre = opts.preheader ? `<div style="display:none;max-height:0;overflow:hidden">${htmlEsc(opts.preheader)}</div>` : "";
  const visibleP = p && opts.carrier === "html-visible" ? `<p>${htmlEsc(p)}</p>` : "";
  const html = `<html><body>${pre}${opts.body.map((b) => `<p>${htmlEsc(b)}</p>`).join("")}${visibleP}${hidden}<p style="color:#888;font-size:12px">Sent from the Sundaram Logistics vendor portal</p></body></html>`;
  const useHtml = opts.carrier !== "plain";
  const subject = p && opts.carrier === "subject" ? `${opts.subject} | ${p}` : opts.subject;
  const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64").replace(/(.{76})/g, "$1\n");
  const parts: string[] = [];
  parts.push(`From: ${opts.from}\nTo: ap@sundaramlogistics.in\nSubject: =?utf-8?B?${Buffer.from(subject).toString("base64")}?=\nDate: Tue, 07 Oct 2026 10:12:00 +0530\nMessage-ID: <${Math.random().toString(36).slice(2)}@mail.example>\nMIME-Version: 1.0\nContent-Type: multipart/mixed; boundary="mix"\n`);
  parts.push(`--mix\nContent-Type: multipart/alternative; boundary="alt"\n\n--alt\nContent-Type: text/plain; charset=utf-8\nContent-Transfer-Encoding: base64\n\n${b64(opts.carrier === "alt-part" ? plainBody : useHtml ? opts.body.join("\n\n") : plainBody)}\n${useHtml ? `--alt\nContent-Type: text/html; charset=utf-8\nContent-Transfer-Encoding: base64\n\n${b64(html)}\n` : ""}--alt--`);
  if (p && opts.carrier === "attachment") {
    parts.push(`--mix\nContent-Type: text/markdown; name="vendor-notes.md"\nContent-Disposition: attachment; filename="vendor-notes.md"\nContent-Transfer-Encoding: base64\n\n${b64(`# Vendor notes\n\nOnboarding checklist completed on 3 Oct.\n\n${p}\n`)}`);
  }
  parts.push("--mix--\n");
  return parts.join("\n");
}

export type HtmlCarrier = "visible" | "display-none" | "white" | "font-zero" | "comment" | "alt" | "title-attr" | "offscreen" | "meta" | "aria";

export function buildWebPage(opts: { title: string; body: string[]; payload?: string; carrier: HtmlCarrier; fragment?: boolean; extraHidden?: string }): string {
  const p = opts.payload ? htmlEsc(opts.payload) : "";
  let inject = "";
  let meta = "";
  switch (p ? opts.carrier : "visible") {
    case "visible":
      inject = p ? `<p>${p}</p>` : "";
      break;
    case "display-none":
      inject = `<div class="promo-note" style="display:none">${p}</div>`;
      break;
    case "white":
      inject = `<p style="color:#ffffff">${p}</p>`;
      break;
    case "font-zero":
      inject = `<span style="font-size:0px">${p}</span>`;
      break;
    case "comment":
      inject = `<!-- ${p} -->`;
      break;
    case "alt":
      inject = `<img src="/img/banner.jpg" alt="${p}">`;
      break;
    case "title-attr":
      inject = `<a href="/offers" title="${p}">See offers</a>`;
      break;
    case "offscreen":
      inject = `<div style="position:absolute;left:-9999px;top:0">${p}</div>`;
      break;
    case "meta":
      meta = `<meta name="description" content="${p}">`;
      break;
    case "aria":
      inject = `<button aria-label="${p}">Buy now</button>`;
      break;
  }
  const extra = opts.extraHidden ? `<nav class="mobile-menu" style="display:none"><a href="/login">Log in to your account</a> <a href="/signup">Sign up for free</a></nav>` : "";
  const mid = Math.max(1, Math.floor(opts.body.length / 2));
  const content = `${extra}<h1>${htmlEsc(opts.title)}</h1>${opts.body.slice(0, mid).map((b) => `<p>${htmlEsc(b)}</p>`).join("")}${inject}${opts.body.slice(mid).map((b) => `<p>${htmlEsc(b)}</p>`).join("")}`;
  if (opts.fragment) return `<div class="product-description">${content}</div>`;
  return `<!doctype html><html><head><title>${htmlEsc(opts.title)}</title>${meta}<style>.promo-note{margin:0}</style></head><body><header><a href="/">Home</a></header><main>${content}</main><footer>© 2026 Sundaram Logistics</footer></body></html>`;
}

export type MarkdownCarrier = "visible" | "comment" | "md-comment" | "link-title" | "image-alt" | "inline-hidden";

export function buildMarkdown(opts: { title: string; body: string[]; payload?: string; carrier: MarkdownCarrier }): string {
  const p = opts.payload ?? "";
  const lines = [`# ${opts.title}`, "", ...opts.body.flatMap((b) => [b, ""])];
  if (p) {
    switch (opts.carrier) {
      case "visible":
        lines.push(p, "");
        break;
      case "comment":
        lines.splice(3, 0, `<!-- ${p} -->`);
        break;
      case "md-comment":
        lines.push(`[//]: # (${p.replace(/[()]/g, "")})`, "");
        break;
      case "link-title":
        lines.push(`See the [setup guide](https://docs.example.com/setup "${p.replace(/"/g, "'")}") for details.`, "");
        break;
      case "image-alt":
        lines.push(`![${p.replace(/[\]\[]/g, "")}](https://docs.example.com/diagram.png)`, "");
        break;
      case "inline-hidden":
        lines.push(`<span style="display:none">${p}</span>`, "");
        break;
    }
  }
  return lines.join("\n");
}

export function pngWithText(png: Uint8Array, key: string, text: string): Uint8Array {
  const buf = Buffer.from(png);
  const iend = buf.lastIndexOf(Buffer.from("IEND"));
  const data = Buffer.concat([Buffer.from(key, "latin1"), Buffer.from([0]), Buffer.from(text, "latin1")]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const type = Buffer.from("tEXt", "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([type, data])) >>> 0);
  return new Uint8Array(Buffer.concat([buf.subarray(0, iend - 4), len, type, data, crc, buf.subarray(iend - 4)]));
}

export type ImageCarrier = "visible" | "faint" | "tiny" | "metadata" | "dark-bg";

export function buildImage(opts: { lines: string[]; payload?: string; carrier: ImageCarrier }): Uint8Array {
  const bg = opts.carrier === "dark-bg" ? "#1d2433" : "#ffffff";
  const fg = opts.carrier === "dark-bg" ? "#f2f4f8" : "#1a1a1a";
  const rows = opts.lines.map((l, i) => `<text x="40" y="${70 + i * 52}" font-family="Helvetica, Arial, sans-serif" font-size="30" fill="${fg}">${htmlEsc(l)}</text>`);
  const p = opts.payload ?? "";
  const pl = p ? wrapLines(p, 62) : [];
  let extra = "";
  const baseY = 90 + opts.lines.length * 52;
  if (p && (opts.carrier === "visible" || opts.carrier === "dark-bg")) extra = pl.map((l, i) => `<text x="40" y="${baseY + i * 44}" font-family="Helvetica, Arial, sans-serif" font-size="28" fill="${fg}">${htmlEsc(l)}</text>`).join("");
  if (p && opts.carrier === "faint") extra = pl.map((l, i) => `<text x="40" y="${baseY + i * 44}" font-family="Helvetica, Arial, sans-serif" font-size="28" fill="#f3f3f3">${htmlEsc(l)}</text>`).join("");
  if (p && opts.carrier === "tiny") extra = pl.map((l, i) => `<text x="40" y="${baseY + 10 + i * 9}" font-family="Helvetica, Arial, sans-serif" font-size="7" fill="#444">${htmlEsc(l)}</text>`).join("");
  const height = baseY + Math.max(1, pl.length) * 46 + 40;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${height}"><rect width="1200" height="${height}" fill="${bg}"/>${rows.join("")}${extra}</svg>`;
  const png = new Resvg(svg, { font: { loadSystemFonts: true } }).render().asPng();
  if (p && opts.carrier === "metadata") return pngWithText(png, "Description", p);
  return png;
}

export { winAnsiSafe };
