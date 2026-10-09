// Picks the right reader for whatever was pasted or dropped, and works out the source type
// when the caller does not say. Heavy readers (PDF, Word, email, images) load on demand and
// only on the server; text readers live in ./text so the browser can use them too.

import type { SourceKind } from "../types";
import { SegmentBuilder, bytesToText } from "./util";
import { extractText, sniffBytes, sniffText, type ExtractResult } from "./text";

export type { ExtractResult } from "./text";
export { sniffBytes, sniffText } from "./text";

export async function extract(opts: {
  source?: SourceKind | "auto";
  text?: string;
  file?: { name?: string; mime?: string; bytes: Uint8Array };
  pinnedTools?: Record<string, string>;
}): Promise<ExtractResult> {
  let source = opts.source && opts.source !== "auto" ? opts.source : null;
  let guessed = false;
  let text = opts.text;
  const file = opts.file;

  if (!source) {
    guessed = true;
    if (file) source = sniffBytes(file.bytes, file.name, file.mime) ?? sniffText(bytesToText(file.bytes));
    else source = sniffText(text || "");
  }
  if (file && !["pdf", "docx", "image", "email"].includes(source)) text = text ?? bytesToText(file.bytes);
  if (file && source === "email") text = bytesToText(file.bytes);

  const needsBytes = source === "pdf" || source === "docx" || source === "image";
  if (needsBytes && !file) {
    const b = new SegmentBuilder("t", "external");
    b.add(text || "", "Pasted text", {});
    return { segments: b.segments, warnings: [`A ${source} has to be uploaded as a file; the pasted text was read as plain text.`], notes: [], source: "user_message", guessed };
  }

  switch (source) {
    case "user_message":
    case "ocr_text":
    case "web_page":
    case "html":
    case "markdown":
    case "api_response":
    case "source_code":
      return extractText({ source, text: text || "", name: file?.name, pinnedTools: opts.pinnedTools, guessed });
    case "email": {
      const { extractEmail } = await import("./email");
      const r = await extractEmail(text || "", async (bytes, name, mime, prefix) => {
        const kind = sniffBytes(bytes, name, mime) ?? sniffText(bytesToText(bytes));
        const sub = await extract({ source: kind, file: { name, mime, bytes }, pinnedTools: opts.pinnedTools });
        // An attachment is outside content whatever its format, never the user talking.
        sub.segments.forEach((s) => {
          s.id = `${prefix}${s.id}`;
          s.provenance = "external";
        });
        return sub;
      });
      return { ...r, source, guessed };
    }
    case "pdf": {
      const { extractPdf } = await import("./pdf");
      const r = await extractPdf(file!.bytes);
      return { ...r, source, guessed };
    }
    case "docx": {
      const { extractDocx } = await import("./docx");
      const r = await extractDocx(file!.bytes);
      return { ...r, source, guessed };
    }
    case "image": {
      const { extractImage } = await import("./image");
      const r = await extractImage(file!.bytes, file?.name);
      return { ...r, source, guessed };
    }
  }
}
