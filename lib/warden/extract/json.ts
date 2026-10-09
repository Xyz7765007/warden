// API responses and MCP tool lists. Every string field becomes a segment tagged with its JSON
// path. MCP tool definitions get extra checks: hidden instruction blocks in descriptions
// ("tool poisoning"), instructions about other tools ("shadowing"), and a fingerprint so a
// tool that changes after the user approved it ("rug pull") is caught.

import { SegmentBuilder, type Extraction } from "./util";
import type { Finding } from "../types";

const AI_KEYS = /(^|_|-|\b)(instructions?|prompt|system|system_prompt|note_?(to|for)_?(ai|assistant|agent|llm|model)|ai_?(note|instructions?)|assistant_?(note|instructions?)|llm_?(note|instructions?)|directive|hidden|secret_note)(_|-|$|\b)/i;

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export async function fingerprintTool(t: McpTool): Promise<string> {
  const data = new TextEncoder().encode(JSON.stringify({ n: t.name, d: t.description || "", s: t.inputSchema ?? null }));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

function findTools(v: any): McpTool[] | null {
  if (!v || typeof v !== "object") return null;
  const list = Array.isArray(v.tools) ? v.tools : Array.isArray(v.result?.tools) ? v.result.tools : Array.isArray(v) && v.every((x: any) => x && typeof x.name === "string" && ("description" in x || "inputSchema" in x || "input_schema" in x)) ? v : null;
  if (!list) return null;
  return list.filter((t: any) => t && typeof t.name === "string").map((t: any) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema ?? t.input_schema ?? t.parameters }));
}

export interface JsonExtraction extends Extraction {
  tools: Array<McpTool & { fingerprint: string }>;
  toolFindings: Finding[];
}

export async function extractJson(raw: string, pinned: Record<string, string> = {}): Promise<JsonExtraction> {
  const b = new SegmentBuilder("j", "external");
  const warnings: string[] = [];
  const notes: string[] = [];
  const toolFindings: Finding[] = [];
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    // JSON lines, or not JSON at all.
    const lines = raw.split(/\n/).filter((l) => l.trim());
    const parsed = lines.map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return undefined;
      }
    });
    if (lines.length > 1 && parsed.every((x) => x !== undefined)) data = parsed;
    else {
      warnings.push("This was not valid JSON, so it was read as text.");
      b.add(raw, "Response body", {});
      return { segments: b.segments, warnings, notes, tools: [], toolFindings };
    }
  }

  const tools = findTools(data);
  const toolOut: JsonExtraction["tools"] = [];
  if (tools) {
    const names = tools.map((t) => t.name);
    for (const t of tools) {
      const fp = await fingerprintTool(t);
      toolOut.push({ ...t, fingerprint: fp });
      const seg = t.description ? b.add(t.description, `Tool "${t.name}": description`, { role: "tool_description", aiDirected: true }) : null;
      const props = (t.inputSchema as any)?.properties || {};
      for (const [p, spec] of Object.entries<any>(props)) {
        if (spec?.description) b.add(spec.description, `Tool "${t.name}": parameter "${p}"`, { role: "tool_description", aiDirected: true });
      }
      const desc = t.description || "";
      // Hidden instruction blocks: tags the user-facing tool picker never shows.
      const tag = desc.match(/<\s*(important|system|instructions?|secret|hidden|admin|note)\s*>[\s\S]*?<\s*\/\s*\1\s*>/i);
      if (tag && seg) {
        toolFindings.push({
          id: `t${toolFindings.length + 1}`,
          type: "tool_abuse",
          also: ["indirect_injection"],
          segmentId: seg.id,
          start: tag.index!,
          end: tag.index! + tag[0].length,
          quote: tag[0].slice(0, 300),
          confidence: 0.72,
          severity: 0.9,
          layer: "tool_registry",
          rule: "mcp.hidden-block",
          why: `Tool "${t.name}" hides an instruction block inside its description. The person approving tools never sees it; the AI always does.`,
        });
      }
      // Shadowing: one tool's description gives orders about another tool.
      for (const other of names) {
        if (other === t.name || !seg) continue;
        const re = new RegExp(`\\b${other.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
        const m = desc.match(re);
        const near = m ? desc.slice(Math.max(0, m.index! - 160), m.index! + 200) : "";
        if (m && /\b(bcc|cc|redirect|instead of|replace the (?:recipient|address|account)|change the (?:recipient|address|to|account|amount)|also (?:send|copy|forward|email|include)|send (?:a )?cop(?:y|ies)|forward (?:a )?cop(?:y|ies)|without telling|do not tell|silently)\b/i.test(near)) {
          toolFindings.push({
            id: `t${toolFindings.length + 1}`,
            type: "tool_abuse",
            also: ["indirect_injection"],
            segmentId: seg.id,
            start: m.index!,
            end: m.index! + m[0].length,
            quote: desc.slice(Math.max(0, m.index! - 60), m.index! + 80),
            confidence: 0.68,
            severity: 0.85,
            layer: "tool_registry",
            rule: "mcp.shadowing",
            why: `Tool "${t.name}" gives orders about a different tool ("${other}"). That is how one bad server hijacks a trusted one.`,
          });
        }
      }
      // Rug pull: the definition changed after the user approved it.
      const pin = pinned[t.name];
      if (pin && pin !== fp && seg) {
        toolFindings.push({
          id: `t${toolFindings.length + 1}`,
          type: "tool_abuse",
          also: ["indirect_injection"],
          segmentId: seg.id,
          start: 0,
          end: Math.min(desc.length, 200),
          quote: desc.slice(0, 200),
          confidence: 0.86,
          severity: 0.9,
          layer: "tool_registry",
          rule: "mcp.rug-pull",
          why: `Tool "${t.name}" changed after it was approved (fingerprint ${pin} became ${fp}). Its new definition must be approved again before the agent may use it.`,
        });
      }
    }
    notes.push(`Found ${tools.length} tool definition${tools.length === 1 ? "" : "s"}; each was fingerprinted.`);
  }

  // Every other string value.
  const walk = (v: any, path: string, depth: number) => {
    if (depth > 12) return;
    if (typeof v === "string") {
      if (v.trim().length < 3) return;
      const key = path.split(/[.[\]]/).filter(Boolean).pop() || "";
      if (tools && /^\$\.(result\.)?tools\[\d+\]\.(description|name)$/.test(path)) return;
      if (tools && /inputSchema|input_schema|parameters/.test(path) && /description$/.test(path)) return;
      b.add(v, `Field ${path}`, { role: "json_value", aiDirected: AI_KEYS.test(key) || undefined });
      return;
    }
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`, depth + 1));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`, depth + 1);
  };
  walk(data, "$", 0);
  if (!b.segments.length) notes.push("The response had no text fields.");
  return { segments: b.segments, warnings, notes, tools: toolOut, toolFindings };
}
