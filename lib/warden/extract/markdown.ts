// Markdown: what renders is the text; what an AI reads is the source, including HTML
// comments, "[//]: #" comment lines, link titles and image alt text, none of which render.

import type { Provenance } from "../types";
import { extractHtml } from "./html";
import { SegmentBuilder, type Extraction } from "./util";

export function extractMarkdown(md: string, opts: { provenance?: Provenance; prefix?: string; whereLabel?: string } = {}): Extraction {
  const b = new SegmentBuilder(opts.prefix ?? "m", opts.provenance ?? "external");
  const label = opts.whereLabel ?? "Document";
  const warnings: string[] = [];
  const notes: string[] = [];
  let visible = md;

  // HTML comments.
  visible = visible.replace(/<!--([\s\S]*?)-->/g, (_, inner: string) => {
    b.add(inner.trim(), `${label}: HTML comment`, { visibility: "hidden", reason: "html_comment", detail: "an HTML comment inside the Markdown, never rendered" });
    return "";
  });
  // "[//]: # (comment)" and reference definitions with titles.
  visible = visible.replace(/^\s*\[(?:\/\/|comment|#|_)\]:\s*(?:#|<>|\S+)\s*[("'](.+?)[)"']\s*$/gim, (_, inner: string) => {
    b.add(inner, `${label}: hidden comment line`, { visibility: "hidden", reason: "html_comment", detail: 'a "[//]: #" comment line, never rendered' });
    return "";
  });
  visible = visible.replace(/^\s*\[([^\]]+)\]:\s*(\S+)\s+["'(](.+?)["')]\s*$/gm, (_, id: string, url: string, title: string) => {
    b.add(title, `${label}: link reference "${id}"`, { visibility: "hidden", reason: "link_title", detail: "a link title, shown only on hover" });
    return `[${id}]: ${url}`;
  });
  // Image alt text and link titles inline.
  visible = visible.replace(/!\[([^\]]{12,})\]\(([^)\s]+)(?:\s+["']([^"']+)["'])?\)/g, (_, alt: string, url: string, title?: string) => {
    b.add(alt, `${label}: image alt text`, { visibility: "hidden", reason: "alt_text", detail: "image alt text, not shown when the image loads" });
    if (title) b.add(title, `${label}: image title`, { visibility: "hidden", reason: "link_title", detail: "an image title, shown only on hover" });
    return `![image](${url})`;
  });
  visible = visible.replace(/\[([^\]]+)\]\(([^)\s]+)\s+["']([^"']{8,})["']\)/g, (_, text: string, url: string, title: string) => {
    b.add(title, `${label}: link title on "${text.slice(0, 30)}"`, { visibility: "hidden", reason: "link_title", detail: "a link title, shown only on hover" });
    return `[${text}](${url})`;
  });

  // Inline HTML blocks: run them through the HTML inspector for CSS-hidden content.
  const htmlBlocks: string[] = [];
  visible = visible.replace(/<(div|span|p|details|section|font|small|sub|sup)\b[^>]*>[\s\S]*?<\/\1>/gi, (block) => {
    if (/style\s*=|hidden|class\s*=/.test(block)) {
      htmlBlocks.push(block);
      return "\u0000";
    }
    return block;
  });
  b.add(visible.replace(/\u0000/g, "").replace(/\n{3,}/g, "\n\n").trim(), label, {});
  for (const block of htmlBlocks) {
    const sub = extractHtml(block, { provenance: opts.provenance ?? "external", prefix: `${opts.prefix ?? "m"}h`, whereLabel: `${label}: inline HTML` });
    for (const s of sub.segments) b.segments.push({ ...s, id: `${opts.prefix ?? "m"}x${b.segments.length + 1}` });
  }
  return { segments: b.segments, warnings, notes };
}
