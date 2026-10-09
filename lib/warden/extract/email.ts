// Email: subject, body and attachments. When an email carries both an HTML body (what the
// mail app shows) and a plain-text body (what many AI tools read), any sentence that exists
// only in the plain-text part is treated as hidden from the person.

import PostalMime from "postal-mime";
import { extractHtml } from "./html";
import { normalize } from "../normalize";
import { SegmentBuilder, bytesToText, type Extraction } from "./util";

export type AttachmentExtractor = (bytes: Uint8Array, name: string, mime: string, prefix: string) => Promise<Extraction>;

function looksLikeMime(raw: string) {
  const head = raw.slice(0, 2000);
  return (head.match(/^(from|to|subject|date|mime-version|content-type|received|return-path|message-id|reply-to|cc):/gim) || []).length >= 2;
}

export async function extractEmail(raw: string, onAttachment?: AttachmentExtractor): Promise<Extraction> {
  const b = new SegmentBuilder("e", "external");
  const warnings: string[] = [];
  const notes: string[] = [];

  if (!looksLikeMime(raw)) {
    // A pasted email without headers: read it as text, pulling out a Subject line if present.
    const subj = raw.match(/^\s*subject:\s*(.+)$/im);
    if (subj) b.add(subj[1], "Email subject", { role: "subject" });
    b.add(subj ? raw.replace(subj[0], "") : raw, "Email body", {});
    return { segments: b.segments, warnings, notes };
  }

  let email: Awaited<ReturnType<typeof PostalMime.parse>>;
  try {
    email = await PostalMime.parse(raw);
  } catch (e) {
    warnings.push(`Could not parse the email structure (${(e as Error).message}); read it as plain text.`);
    b.add(raw, "Email (raw)", {});
    return { segments: b.segments, warnings, notes };
  }

  if (email.subject) b.add(email.subject, "Email subject", { role: "subject" });
  const fromLine = email.from?.address ? `${email.from.name ? email.from.name + " " : ""}<${email.from.address}>` : "";
  const replyTo = (email.replyTo || []).map((a) => a.address).filter(Boolean);
  if (fromLine && replyTo.length && !replyTo.some((r) => r === email.from?.address)) {
    notes.push(`Replies go to ${replyTo.join(", ")}, not the sender ${email.from?.address}.`);
  }

  let visibleHtmlNorm = "";
  if (email.html) {
    const sub = extractHtml(email.html, { provenance: "external", prefix: "eh", whereLabel: "Email body" });
    for (const s of sub.segments) {
      b.segments.push({ ...s, id: `e${b.segments.length + 1}` });
      if (s.visibility === "visible") visibleHtmlNorm += " " + normalize(s.text).norm;
    }
  }
  if (email.text) {
    if (!email.html) {
      b.add(email.text, "Email body", {});
    } else {
      // Sentences that exist only in the plain-text alternative.
      const hiddenParts: string[] = [];
      for (const sentence of email.text.split(/(?<=[.!?])\s+|\n+/)) {
        const t = sentence.trim();
        if (t.length < 20) continue;
        const n = normalize(t).norm.replace(/[^\p{L}\p{N} ]/gu, "").trim();
        const probe = n.slice(0, 60);
        if (probe && !visibleHtmlNorm.replace(/[^\p{L}\p{N} ]/gu, "").includes(probe)) hiddenParts.push(t);
      }
      if (hiddenParts.length) {
        b.add(hiddenParts.join("\n"), "Email plain-text part", {
          visibility: "hidden",
          reason: "alt_mime_part",
          detail: "only in the plain-text copy of the email, which the mail app does not show",
        });
      }
    }
  }

  for (const [i, att] of (email.attachments || []).entries()) {
    const name = att.filename || `attachment-${i + 1}`;
    const mime = att.mimeType || "application/octet-stream";
    const c: unknown = att.content;
    const bytes = c instanceof ArrayBuffer ? new Uint8Array(c) : typeof c === "string" ? new TextEncoder().encode(c) : c instanceof Uint8Array ? c : new Uint8Array(0);
    if (onAttachment) {
      try {
        const sub = await onAttachment(bytes, name, mime, `ea${i}`);
        for (const s of sub.segments) b.segments.push({ ...s, id: `e${b.segments.length + 1}`, where: `Attachment ${name}: ${s.where}`, role: s.role === "body" ? "attachment" : s.role });
        warnings.push(...sub.warnings.map((w) => `${name}: ${w}`));
        notes.push(...sub.notes.map((w) => `${name}: ${w}`));
      } catch (e) {
        warnings.push(`Could not read attachment ${name} (${(e as Error).message}).`);
      }
    } else if (/^text\//.test(mime)) {
      b.add(bytesToText(bytes), `Attachment ${name}`, { role: "attachment" });
    }
  }
  if (!b.segments.length) notes.push("The email had no readable text.");
  return { segments: b.segments, warnings, notes };
}
