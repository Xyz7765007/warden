// POST /api/scan: scan anything an agent is about to read.
// JSON body: { text, source?, task?, agent?, tools?, history?, mode?, judge?, simulate? }
// simulate: "classifier" | "judge" | "reader" makes that layer fail on purpose (fault-tolerance demo).
// or multipart form-data with a "file" field plus the same fields as strings.
import { scan } from "@/lib/warden/scan";
import { classifier, judge } from "@/lib/server/engine";
import { judgeBudget } from "@/lib/server/budget";
import { PROFILES } from "@/lib/agent/profiles";
import { OUTAGES, SOURCE_KINDS, type AgentProfile, type Mode, type Outage, type ScanInput, type SourceKind } from "@/lib/warden/types";

export const maxDuration = 60;

const MAX_BYTES = 4 * 1024 * 1024;

// `agent` is a profile name ("finance", "support", "coding", "office"...) or an object with its
// own tools: { "tools": [{ "name": "pay_invoice" }] }. Tools can also be sent at the top level.
function agentFrom(v: unknown, tools: unknown, pinned: unknown): AgentProfile | undefined {
  const base = typeof v === "string" && PROFILES[v] ? PROFILES[v] : undefined;
  const own = v && typeof v === "object" && Array.isArray((v as { tools?: unknown }).tools) ? ((v as { tools: unknown[] }).tools) : [];
  const list: any[] = [...(Array.isArray(tools) ? tools : []), ...own];
  const extra = list.filter((t) => t && typeof t.name === "string").map((t) => ({ name: String(t.name), description: t.description ? String(t.description) : undefined, sideEffects: typeof t.sideEffects === "boolean" ? t.sideEffects : undefined }));
  if (!base && !extra.length && !pinned) return undefined;
  return { ...(base ?? {}), tools: [...(base?.tools ?? []), ...extra], pinnedTools: pinned && typeof pinned === "object" ? (pinned as Record<string, string>) : undefined };
}

export async function POST(request: Request) {
  const started = Date.now();
  try {
    let input: ScanInput;
    const type = request.headers.get("content-type") || "";
    if (type.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      const get = (k: string) => (typeof form.get(k) === "string" ? (form.get(k) as string) : undefined);
      let fileInput: ScanInput["file"];
      if (file && typeof file !== "string") {
        if (file.size > MAX_BYTES) return Response.json({ error: "That file is over 4 MB. Try a smaller one." }, { status: 413 });
        fileInput = { name: file.name, mime: file.type, bytes: new Uint8Array(await file.arrayBuffer()) };
      }
      const parse = (k: string) => {
        const v = get(k);
        try {
          return v ? JSON.parse(v) : undefined;
        } catch {
          return undefined;
        }
      };
      input = {
        source: (SOURCE_KINDS as readonly string[]).includes(get("source") || "") ? (get("source") as SourceKind) : "auto",
        text: get("text"),
        file: fileInput,
        task: get("task") || undefined,
        agent: agentFrom(get("agent"), parse("tools"), parse("pinned")),
        history: parse("history"),
        mode: (get("mode") as Mode) || "balanced",
        judge: (get("judge") as ScanInput["judge"]) || "auto",
        simulate: (OUTAGES as readonly string[]).includes(get("simulate") || "") ? (get("simulate") as Outage) : undefined,
      };
    } else {
      const body = await request.json().catch(() => null);
      if (!body || (typeof body.text !== "string" && !body.file)) return Response.json({ error: "Send { text } as JSON, or a file as form-data." }, { status: 400 });
      if (typeof body.text === "string" && body.text.length > 400_000) return Response.json({ error: "That text is over 400,000 characters." }, { status: 413 });
      input = {
        source: (SOURCE_KINDS as readonly string[]).includes(body.source) ? body.source : "auto",
        text: body.text,
        task: typeof body.task === "string" ? body.task : undefined,
        agent: agentFrom(body.agent, body.tools, body.pinned),
        history: Array.isArray(body.history) ? body.history.filter((h: unknown) => typeof h === "string").slice(-20) : undefined,
        mode: ["strict", "balanced", "permissive"].includes(body.mode) ? body.mode : "balanced",
        judge: ["auto", "off", "force"].includes(body.judge) ? body.judge : "auto",
        simulate: (OUTAGES as readonly string[]).includes(body.simulate) ? body.simulate : undefined,
      };
    }
    if (!input.text && !input.file) return Response.json({ error: "Nothing to scan." }, { status: 400 });
    const limited = input.judge !== "off" && judge.available && judgeBudget(request) === "off";
    if (limited) input.judge = "off";
    const result = await scan(input, { classifier, judge });
    if (limited) result.warnings.push("The LLM judge's hourly limit for this visitor was reached, so this scan used the free layers only.");
    return Response.json(result, { headers: { "x-warden-ms": String(Date.now() - started) } });
  } catch (e) {
    return Response.json({ error: `Scan failed: ${(e as Error).message}` }, { status: 500 });
  }
}
