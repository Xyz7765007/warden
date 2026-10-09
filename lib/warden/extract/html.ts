// HTML: separates what a person sees on the rendered page from what an AI reads in the
// source (CSS-hidden blocks, white-on-white text, comments, alt and title text, meta tags).

import { parseDocument } from "htmlparser2";
import type { Provenance } from "../types";
import { SegmentBuilder, parseColor, nearlySame, hexOf, luminance, decodeEntities, type Extraction } from "./util";

type RGB = [number, number, number];

interface StyleRule {
  sel: { tag?: string; cls: string[]; id?: string; attr?: string };
  decl: Record<string, string>;
}

const BLOCK = new Set(["p", "div", "section", "article", "header", "footer", "main", "aside", "nav", "li", "ul", "ol", "table", "tr", "td", "th", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "br", "hr", "form", "figure", "figcaption", "dd", "dt", "dl", "address", "summary", "details", "body", "html", "tbody", "thead"]);
const SKIP = new Set(["script", "style", "svg", "math", "head", "iframe", "object", "canvas"]);

function parseDecls(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of s.split(";")) {
    const i = part.indexOf(":");
    if (i < 0) continue;
    const k = part.slice(0, i).trim().toLowerCase();
    const v = part.slice(i + 1).replace(/!important/i, "").trim().toLowerCase();
    if (k) out[k] = v;
  }
  return out;
}

function parseStyleSheets(css: string): StyleRule[] {
  const rules: StyleRule[] = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@media[^{]*\{([\s\S]*?\})\s*\}/g, "$1");
  for (const m of clean.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
    const decl = parseDecls(m[2]);
    for (const raw of m[1].split(",")) {
      const last = raw.trim().split(/[\s>+~]+/).pop() || "";
      const sm = last.match(/^([a-z][a-z0-9]*)?((?:\.[\w-]+)*)(#[\w-]+)?((?:\.[\w-]+)*)(\[[^\]]+\])?$/i);
      if (!sm) continue;
      const cls = (sm[2] + (sm[4] || "")).split(".").filter(Boolean);
      rules.push({ sel: { tag: sm[1]?.toLowerCase(), cls, id: sm[3]?.slice(1), attr: sm[5]?.slice(1, -1) }, decl });
    }
  }
  return rules;
}

function matches(rule: StyleRule, el: any): boolean {
  const s = rule.sel;
  if (s.tag && s.tag !== el.name) return false;
  if (s.id && el.attribs?.id !== s.id) return false;
  const classes: string[] = (el.attribs?.class || "").split(/\s+/);
  if (s.cls.some((c) => !classes.includes(c))) return false;
  if (s.attr) {
    const [k, v] = s.attr.split("=");
    if (!(k.trim() in (el.attribs || {}))) return false;
    if (v && el.attribs[k.trim()] !== v.replace(/["']/g, "").trim()) return false;
  }
  return !!(s.tag || s.id || s.cls.length || s.attr);
}

interface Hide {
  reason: "css_hidden" | "white_text" | "tiny_text";
  detail: string;
}

function hidingOf(d: Record<string, string>): Hide | null {
  if (d.display === "none") return { reason: "css_hidden", detail: "set to display:none" };
  if (d.visibility === "hidden" || d.visibility === "collapse") return { reason: "css_hidden", detail: "set to visibility:hidden" };
  if (d.opacity !== undefined && parseFloat(d.opacity) < 0.05) return { reason: "css_hidden", detail: "fully transparent (opacity:0)" };
  const fs = d["font-size"];
  if (fs) {
    const px = fs.endsWith("px") ? parseFloat(fs) : fs.endsWith("pt") ? parseFloat(fs) * 1.33 : fs.endsWith("em") || fs.endsWith("rem") ? parseFloat(fs) * 16 : fs === "0" ? 0 : NaN;
    if (!isNaN(px) && px <= 2.5) return { reason: "tiny_text", detail: `font size ${fs}` };
  }
  const left = parseFloat(d.left || d["margin-left"] || "0");
  const top = parseFloat(d.top || d["margin-top"] || "0");
  if ((d.position === "absolute" || d.position === "fixed") && (left <= -999 || top <= -999)) return { reason: "css_hidden", detail: "moved off the screen" };
  if (d["text-indent"] && parseFloat(d["text-indent"]) <= -999) return { reason: "css_hidden", detail: "pushed off the screen with text-indent" };
  if (/rect\(\s*0(px)?[ ,]+0(px)?[ ,]+0(px)?[ ,]+0(px)?\s*\)/.test(d.clip || "") || /inset\(\s*50%|circle\(\s*0/.test(d["clip-path"] || "")) return { reason: "css_hidden", detail: "clipped to nothing" };
  if ((d.height === "0" || d.height === "0px" || d["max-height"] === "0" || d["max-height"] === "0px" || d.width === "0" || d.width === "0px") && /hidden|clip/.test(d.overflow || "")) return { reason: "css_hidden", detail: "squeezed to zero size" };
  if (/scale\(\s*0(\.0+)?\s*\)/.test(d.transform || "")) return { reason: "css_hidden", detail: "scaled to zero" };
  return null;
}

interface Run {
  text: string;
  hide: Hide | { reason: "html_comment" | "alt_text" | "attribute" | "metadata"; detail: string } | null;
  block: number;
  where: string;
}

// A value with no spaces and URL or percent-encoding shape: an address, not a sentence.
const LOOKS_LIKE_ADDRESS = /^(?:(?:https?:)?\/\/|www\.)\S+$|^\S*(?:%[0-9a-f]{2}|\+)\S*$|^[\w.-]+\.[a-z]{2,}(?:\/\S*)?$/i;

export function extractHtml(html: string, opts: { provenance?: Provenance; prefix?: string; whereLabel?: string } = {}): Extraction {
  const b = new SegmentBuilder(opts.prefix ?? "h", opts.provenance ?? "external");
  const warnings: string[] = [];
  const notes: string[] = [];
  const label = opts.whereLabel ?? "Page";
  const doc = parseDocument(html, { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true });

  const sheets: StyleRule[] = [];
  const collectStyles = (node: any) => {
    if (node.type === "style" || node.name === "style") {
      sheets.push(...parseStyleSheets((node.children || []).map((c: any) => c.data || "").join("")));
    }
    for (const c of node.children || []) collectStyles(c);
  };
  collectStyles(doc);

  const runs: Run[] = [];
  let block = 0;
  const pageBg: RGB = [255, 255, 255];

  const describe = (el: any) => {
    const id = el.attribs?.id ? `#${el.attribs.id}` : "";
    const cls = el.attribs?.class ? `.${String(el.attribs.class).trim().split(/\s+/)[0]}` : "";
    return `<${el.name}${id}${cls}>`;
  };

  const walk = (node: any, hidden: Run["hide"], color: RGB | null, bg: RGB, path: string) => {
    if (node.type === "comment") {
      const t = (node.data || "").trim();
      if (t) runs.push({ text: t, hide: { reason: "html_comment", detail: "an HTML comment, never shown on the page" }, block: ++block, where: `${label}: HTML comment` });
      return;
    }
    if (node.type === "text") {
      const t = decodeEntities(node.data || "");
      if (t.trim()) runs.push({ text: t, hide: hidden, block, where: hidden ? `${label}: hidden ${path}` : label });
      return;
    }
    if (node.type !== "tag" && node.type !== "root" && node.type !== "script" && node.type !== "style" && node.type !== "directive") {
      for (const c of node.children || []) walk(c, hidden, color, bg, path);
      return;
    }
    const name: string = node.name || "";
    if (node.type === "script" || node.type === "style" || SKIP.has(name)) {
      if (name === "head") {
        for (const c of node.children || []) {
          if (c.name === "title") {
            const t = (c.children || []).map((x: any) => x.data || "").join("").trim();
            if (t) runs.push({ text: t, hide: null, block: ++block, where: `${label}: title` });
          }
          if (c.name === "meta") {
            const nm = (c.attribs?.name || c.attribs?.property || "").toLowerCase();
            const content = c.attribs?.content;
            if (content && /description|keywords|summary|abstract|og:|twitter:|author|subject/.test(nm)) {
              runs.push({ text: decodeEntities(content), hide: { reason: "metadata", detail: `a <meta ${nm}> tag, not shown on the page` }, block: ++block, where: `${label}: meta ${nm}` });
            }
          }
        }
      }
      return;
    }
    const attrs = node.attribs || {};
    let style: Record<string, string> = {};
    for (const r of sheets) if (matches(r, node)) style = { ...style, ...r.decl };
    if (attrs.style) style = { ...style, ...parseDecls(attrs.style) };

    let nextHidden = hidden;
    if (!nextHidden) {
      const h = hidingOf(style);
      if (h) nextHidden = h;
      else if ("hidden" in attrs) nextHidden = { reason: "css_hidden", detail: "marked hidden" };
      else if (name === "template") nextHidden = { reason: "css_hidden", detail: "inside a <template>, never shown" };
      else if (name === "noscript") nextHidden = { reason: "css_hidden", detail: "inside <noscript>, shown only when scripts are off" };
      else if (name === "input" && (attrs.type || "").toLowerCase() === "hidden") nextHidden = { reason: "css_hidden", detail: "a hidden form field" };
    }
    const bgDecl = parseColor(style["background-color"] || (style.background && /^(#|rgb|[a-z]+$)/.test(style.background) ? style.background.split(/\s+/)[0] : undefined));
    const nextBg = bgDecl ?? bg;
    const ownColor = parseColor(style.color);
    const nextColor = ownColor ?? color;
    if (!nextHidden && ownColor && nearlySame(ownColor, nextBg)) {
      nextHidden = { reason: "white_text", detail: `${hexOf(ownColor)} text on a ${hexOf(nextBg)} background` };
    }
    if (!nextHidden && ownColor && !bgDecl && luminance(ownColor) > 0.93 && bg === pageBg) {
      nextHidden = { reason: "white_text", detail: `${hexOf(ownColor)} text on a white page` };
    }

    // Text carried in attributes the reader never sees.
    if (name === "img" && attrs.alt && attrs.alt.trim().length > 12) {
      runs.push({ text: decodeEntities(attrs.alt), hide: { reason: "alt_text", detail: "image alt text, not shown on the page" }, block: ++block, where: `${label}: image alt text` });
    }
    for (const a of ["title", "aria-label", "aria-description", "data-instructions", "data-note", "data-prompt", "placeholder", "summary"]) {
      // Tooltips that are just a web address or an encoded string (citation links carry hundreds) are not language.
      if (attrs[a] && attrs[a].trim().length > 24 && !LOOKS_LIKE_ADDRESS.test(attrs[a].trim())) {
        runs.push({ text: decodeEntities(attrs[a]), hide: { reason: "attribute", detail: `the ${a} attribute of ${describe(node)}` }, block: ++block, where: `${label}: ${a} attribute` });
      }
    }
    if (name === "input" && attrs.value && attrs.value.trim().length > 16 && (attrs.type || "").toLowerCase() === "hidden") {
      runs.push({ text: decodeEntities(attrs.value), hide: { reason: "css_hidden", detail: "a hidden form field" }, block: ++block, where: `${label}: hidden form field` });
    }

    const isBlock = BLOCK.has(name);
    if (isBlock) block++;
    const nextPath = nextHidden && !hidden ? describe(node) : path;
    for (const c of node.children || []) walk(c, nextHidden, nextColor, nextBg, nextPath);
    if (isBlock) block++;
  };
  walk(doc, null, null, pageBg, "");

  // Merge neighbouring runs that share visibility into readable segments.
  let cur: Run | null = null;
  const flush = () => {
    if (!cur) return;
    const h = cur.hide;
    b.add(cur.text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim(), cur.where, h ? { visibility: "hidden", reason: h.reason, detail: h.detail, role: h.reason === "metadata" ? "metadata" : "body" } : {});
    cur = null;
  };
  for (const r of runs) {
    const sameKind = cur && ((cur.hide === null && r.hide === null) || (cur.hide && r.hide && cur.hide.reason === r.hide.reason && cur.hide.detail === r.hide.detail && cur.where === r.where));
    if (cur && sameKind) {
      cur.text += (r.block !== cur.block ? "\n" : "") + r.text;
      cur.block = r.block;
    } else {
      flush();
      cur = { ...r };
    }
  }
  flush();
  if (!b.segments.length) notes.push("The HTML had no readable text.");
  return { segments: b.segments, warnings, notes };
}
