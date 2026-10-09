// Browser-safe readers for text inputs (no Node modules). The server entry point adds PDF,
// Word, email and images on top of this.

import type { SourceKind } from "../types";
import { SegmentBuilder, bytesToText, fixOcrText, type Extraction } from "./util";
import { extractHtml } from "./html";
import { extractMarkdown } from "./markdown";
import { extractCode } from "./code";
import { extractJson, type JsonExtraction } from "./json";

export interface ExtractResult extends Extraction {
  source: SourceKind;
  guessed: boolean;
  tools?: JsonExtraction["tools"];
  toolFindings?: JsonExtraction["toolFindings"];
}
const CODE_EXT = /\.(js|jsx|ts|tsx|mjs|cjs|py|java|c|h|cpp|hpp|cs|go|rs|rb|php|swift|kt|scala|sh|bash|zsh|ps1|sql|yml|yaml|toml|dockerfile|r|pl|dart|sol|vue|svelte)$/i;

export function sniffBytes(bytes: Uint8Array, name = "", mime = ""): SourceKind | null {
  const n = name.toLowerCase();
  const head = bytes.slice(0, 8);
  if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) return "pdf";
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return "image";
  if (head[0] === 0xff && head[1] === 0xd8) return "image";
  if (head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46) return "image";
  if (head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 && bytes[8] === 0x57) return "image";
  if (head[0] === 0x50 && head[1] === 0x4b && (n.endsWith(".docx") || mime.includes("wordprocessingml"))) return "docx";
  if (head[0] === 0x50 && head[1] === 0x4b) return "docx";
  if (/\.(png|jpe?g|gif|webp|bmp|tiff?)$/.test(n) || mime.startsWith("image/")) return "image";
  if (/\.pdf$/.test(n) || mime === "application/pdf") return "pdf";
  if (/\.docx$/.test(n)) return "docx";
  if (/\.(eml|msg)$/.test(n) || mime === "message/rfc822") return "email";
  if (/\.(md|markdown|mdx)$/.test(n) || mime === "text/markdown") return "markdown";
  if (/\.(html?|xhtml)$/.test(n) || mime === "text/html") return "html";
  if (/\.(json|jsonl|ndjson)$/.test(n) || mime === "application/json") return "api_response";
  if (CODE_EXT.test(n)) return "source_code";
  if (/\.(txt|text|log|csv)$/.test(n)) return null;
  return null;
}

export function sniffText(text: string): SourceKind {
  const t = text.trimStart();
  const head = text.slice(0, 3000);
  if ((head.match(/^(from|to|subject|date|mime-version|content-type|received|return-path|message-id|reply-to|cc):/gim) || []).length >= 2) return "email";
  if (/^[{[]/.test(t)) {
    try {
      JSON.parse(text);
      return "api_response";
    } catch {
      if (t.split("\n").filter(Boolean).every((l) => /^\s*[{[]/.test(l))) return "api_response";
    }
  }
  if (/<!doctype html|<html[\s>]/i.test(head)) return "web_page";
  if ((head.match(/<\/?(div|p|span|body|a|img|table|br|h[1-6]|ul|li|section|article|style)\b[^>]*>/gi) || []).length >= 2) return "html";
  const md = [/^#{1,6}\s+\S/m, /\*\*[^*\n]+\*\*/, /\[[^\]\n]+\]\([^)\s]+\)/, /^```/m, /^\s*[-*]\s+\S/m, /^>\s/m, /<!--[\s\S]*?-->/].filter((r) => r.test(head)).length;
  const codeLines = head.split("\n").filter((l) => /^\s*(import |from \S+ import |def |class |function |const |let |var |public |private |#include|package |using |fn |func |return |if \(|for \(|while \(|}\s*$|[^:]+;\s*$)/.test(l)).length;
  if (codeLines >= 3 && codeLines >= head.split("\n").length * 0.25) return "source_code";
  if (md >= 2) return "markdown";
  // Prose that talks about an AI in the third person, or reads like a letter or a notice, is
  // content an agent reads, not the user talking to it: read it as a plain document.
  const aboutAI = /\b(?:the|your|any|all|an?|this) (?:ai|assistants?|agents?|bots?|chatbots?|llms?|language models?|copilots?|automated (?:assistants?|systems?|agents?|readers?|accounts?)|automation(?: accounts?)?)\b|\bai[- ](?:agents?|assistants?|systems?)\b/i.test(head);
  const toYou = (head.match(/\byou(?:r|rs|rself)?\b/gi) || []).length;
  const letterLike = /^(?:dear|hi|hello|hey|greetings)\b[^\n,]{0,40},|\n\s*(?:regards|warm regards|best regards|thanks|thank you|best|sincerely|cheers),?\s*(?:\n|$)|^(?:notice|memo|announcement|policy|knowledge base|faq|terms|update)\b/im.test(head);
  if ((aboutAI && toYou < 3) || letterLike) return "markdown";
  return "user_message";
}



export const TEXT_SOURCES: SourceKind[] = ["user_message", "ocr_text", "web_page", "html", "markdown", "api_response", "source_code"];

export async function extractText(opts: { source: SourceKind; text: string; name?: string; pinnedTools?: Record<string, string>; guessed?: boolean }): Promise<ExtractResult> {
  const { source, text } = opts;
  const guessed = !!opts.guessed;
  switch (source) {
    case "ocr_text": {
      const b = new SegmentBuilder("o", "external");
      const fixed = fixOcrText(text);
      b.add(fixed, "OCR text", { ocr: true });
      return { segments: b.segments, warnings: [], notes: fixed !== text ? ["Corrected common OCR misreads (for example 'Al' for 'AI')."] : [], source, guessed };
    }
    case "web_page":
    case "html": {
      const r = extractHtml(text, { provenance: "external", whereLabel: source === "web_page" ? "Page" : "HTML" });
      return { ...r, source, guessed };
    }
    case "markdown":
      return { ...extractMarkdown(text, { provenance: "external" }), source, guessed };
    case "api_response":
      return { ...(await extractJson(text, opts.pinnedTools)), source, guessed };
    case "source_code":
      return { ...extractCode(text, opts.name), source, guessed };
    default: {
      const b = new SegmentBuilder("u", "user");
      b.add(text, "Message", {});
      return { segments: b.segments, warnings: [], notes: [], source: "user_message", guessed };
    }
  }
}
