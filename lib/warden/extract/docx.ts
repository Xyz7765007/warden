// Word documents: reads every run of text with its formatting, so text marked hidden,
// coloured white, or set at a 1-point size is separated from what a reader sees. Also reads
// comments, headers, footers and document properties.

import JSZip from "jszip";
import { parseDocument } from "htmlparser2";
import { SegmentBuilder, type Extraction } from "./util";
import type { HiddenReason } from "../types";

function attr(el: any, name: string): string | undefined {
  return el?.attribs?.[name];
}

function child(el: any, name: string): any {
  return (el?.children || []).find((c: any) => c.name === name);
}

function textOf(el: any): string {
  if (!el) return "";
  if (el.type === "text") return el.data || "";
  if (el.name === "w:tab") return "\t";
  if (el.name === "w:br" || el.name === "w:cr") return "\n";
  return (el.children || []).map(textOf).join("");
}

interface RunStyle {
  hidden?: { reason: HiddenReason; detail: string };
}

function runStyle(rPr: any): RunStyle {
  if (!rPr) return {};
  if (child(rPr, "w:vanish") && attr(child(rPr, "w:vanish"), "w:val") !== "0" && attr(child(rPr, "w:vanish"), "w:val") !== "false") {
    return { hidden: { reason: "word_hidden", detail: "formatted as hidden text in Word" } };
  }
  if (child(rPr, "w:webHidden")) return { hidden: { reason: "word_hidden", detail: "formatted as web-hidden text" } };
  const color = attr(child(rPr, "w:color"), "w:val");
  const shade = attr(child(rPr, "w:shd"), "w:fill");
  if (color && /^[0-9a-f]{6}$/i.test(color)) {
    const v = parseInt(color, 16);
    const r = v >> 16, g = (v >> 8) & 255, b = v & 255;
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    const bgWhite = !shade || shade === "auto" || /^f[0-9a-f]f[0-9a-f]f[0-9a-f]$/i.test(shade);
    if (lum > 0.93 && bgWhite) return { hidden: { reason: "white_text", detail: `white text (#${color.toUpperCase()}) on a white page` } };
    if (shade && shade.toLowerCase() === color.toLowerCase()) return { hidden: { reason: "white_text", detail: `text coloured the same as its background (#${color.toUpperCase()})` } };
  }
  const sz = attr(child(rPr, "w:sz"), "w:val");
  if (sz && parseInt(sz, 10) <= 4) return { hidden: { reason: "tiny_text", detail: `${parseInt(sz, 10) / 2}-point text, too small to read` } };
  return {};
}

function paragraphs(xml: string): Array<Array<{ text: string; style: RunStyle }>> {
  const doc = parseDocument(xml, { xmlMode: true });
  const out: Array<Array<{ text: string; style: RunStyle }>> = [];
  const visit = (node: any) => {
    if (node.name === "w:p") {
      const runs: Array<{ text: string; style: RunStyle }> = [];
      const pRpr = child(child(node, "w:pPr"), "w:rPr");
      const collect = (n: any) => {
        if (n.name === "w:r") {
          const style = runStyle(child(n, "w:rPr")) ;
          const pStyle = runStyle(pRpr);
          runs.push({ text: textOf(n).replace(/ /g, " "), style: style.hidden ? style : pStyle });
          return;
        }
        for (const c of n.children || []) collect(c);
      };
      for (const c of node.children || []) collect(c);
      out.push(runs);
      return;
    }
    for (const c of node.children || []) visit(c);
  };
  visit(doc);
  return out;
}

export async function extractDocx(bytes: Uint8Array): Promise<Extraction> {
  const b = new SegmentBuilder("d", "external");
  const warnings: string[] = [];
  const notes: string[] = [];
  const zip = await JSZip.loadAsync(bytes);
  const read = async (p: string) => (zip.file(p) ? await zip.file(p)!.async("string") : null);

  const main = await read("word/document.xml");
  if (!main) throw new Error("not a Word document (word/document.xml missing)");

  let visible: string[] = [];
  let pIndex = 0;
  const flushVisible = () => {
    if (visible.length) b.add(visible.join("\n"), pIndex <= 1 ? "Document text" : `Document text, from paragraph ${pIndex - visible.length + 1}`, {});
    visible = [];
  };
  for (const runs of paragraphs(main)) {
    pIndex++;
    let line = "";
    for (const r of runs) {
      if (r.style.hidden) {
        if (line.trim()) {
          visible.push(line);
          line = "";
        }
        flushVisible();
        b.add(r.text, `Paragraph ${pIndex}`, { visibility: "hidden", reason: r.style.hidden.reason, detail: r.style.hidden.detail });
      } else line += r.text;
    }
    if (line.trim()) visible.push(line);
  }
  flushVisible();

  for (const file of Object.keys(zip.files).filter((f) => /^word\/(header|footer)\d*\.xml$/.test(f))) {
    const xml = await read(file);
    if (!xml) continue;
    const text = paragraphs(xml).map((runs) => runs.map((r) => r.text).join("")).join("\n").trim();
    if (text) b.add(text, file.includes("header") ? "Page header" : "Page footer", { role: "header" });
  }
  for (const file of ["word/footnotes.xml", "word/endnotes.xml"]) {
    const xml = await read(file);
    if (!xml) continue;
    const text = paragraphs(xml).map((runs) => runs.map((r) => r.text).join("")).join("\n").trim();
    if (text) b.add(text, file.includes("foot") ? "Footnotes" : "Endnotes", {});
  }
  const comments = await read("word/comments.xml");
  if (comments) {
    const doc = parseDocument(comments, { xmlMode: true });
    const visit = (n: any) => {
      if (n.name === "w:comment") {
        const author = attr(n, "w:author") || "someone";
        b.add(textOf(n).trim(), `Comment by ${author}`, { visibility: "hidden", reason: "doc_comment", detail: "a review comment, hidden unless the comments pane is open", role: "comment" });
        return;
      }
      for (const c of n.children || []) visit(c);
    };
    visit(doc);
  }
  for (const file of ["docProps/core.xml", "docProps/app.xml", "docProps/custom.xml"]) {
    const xml = await read(file);
    if (!xml) continue;
    const doc = parseDocument(xml, { xmlMode: true });
    const visit = (n: any) => {
      if (n.type === "tag" && (n.children || []).every((c: any) => c.type === "text")) {
        const t = textOf(n).trim();
        const field = n.name.replace(/^.*:/, "");
        if (t.length >= 12 && /title|subject|description|keywords|comments|category|company|manager|lpwstr|text/i.test(field)) {
          b.add(t, `Document property: ${field}`, { visibility: "hidden", reason: "metadata", detail: `the document's "${field}" property, not shown on the page`, role: "metadata" });
        }
        return;
      }
      for (const c of n.children || []) visit(c);
    };
    visit(doc);
  }
  if (!b.segments.length) notes.push("The Word document had no readable text.");
  return { segments: b.segments, warnings, notes };
}
