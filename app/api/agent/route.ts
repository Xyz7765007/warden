// POST /api/agent { scenario, mode: "reference" | "live" }
// Runs the same agent on the same task twice: without Warden, and behind Warden.
// scenario "custom" runs your own content on the live agent: JSON { scenario: "custom", mode: "live",
// text, source?, task? } or form-data with a "file" field plus the same fields.
import { runScenario } from "@/lib/agent/reference";
import { runLive } from "@/lib/agent/live";
import { SCENARIOS, customScenario, type Scenario } from "@/lib/agent/scenarios";
import { judgeBudget } from "@/lib/server/budget";
import { SOURCE_KINDS, type SourceKind } from "@/lib/warden/types";

export const maxDuration = 120;

// Live runs cost money: a few per visitor per hour, and a daily ceiling per instance.
const hits = new Map<string, number[]>();
let dayCount = 0;
let day = new Date().toDateString();

const DEFAULT_TASK = "Summarise this for me.";

async function readBody(request: Request): Promise<{ scenario: string; mode: "reference" | "live"; own?: Scenario; error?: string }> {
  const form = (request.headers.get("content-type") || "").includes("multipart/form-data");
  const body: Record<string, unknown> = {};
  let upload: { name: string; bytes: Uint8Array } | undefined;
  if (form) {
    const fd = await request.formData();
    for (const [k, v] of fd.entries()) {
      if (typeof v === "string") body[k] = v;
      else if (k === "file") {
        if (v.size > 4 * 1024 * 1024) return { scenario: "", mode: "live", error: "That file is over 4 MB." };
        upload = { name: v.name || "upload", bytes: new Uint8Array(await v.arrayBuffer()) };
      }
    }
  } else Object.assign(body, await request.json().catch(() => ({})));
  const scenario = typeof body.scenario === "string" ? body.scenario : "";
  const mode = body.mode === "live" ? "live" : "reference";
  if (scenario !== "custom") return { scenario, mode };
  const text = typeof body.text === "string" ? body.text.slice(0, 50_000) : undefined;
  if (!upload && !text?.trim()) return { scenario, mode, error: "Paste some content or attach a file for the agent to read." };
  const task = (typeof body.task === "string" && body.task.trim() ? body.task.trim() : DEFAULT_TASK).slice(0, 300);
  const source = (SOURCE_KINDS as readonly string[]).includes(body.source as string) ? (body.source as SourceKind) : "auto";
  return { scenario, mode, own: customScenario({ task, source, text: upload ? undefined : text, upload }) };
}

export async function POST(request: Request) {
  const { scenario, mode, own, error } = await readBody(request);
  if (error) return Response.json({ error }, { status: 400 });
  if (!own && !SCENARIOS.some((s) => s.id === scenario)) return Response.json({ error: "Pick a scenario." }, { status: 400 });
  if (own && mode !== "live") return Response.json({ error: "Your own content runs on the live Claude agent; the reference agent only knows the built-in scenarios." }, { status: 400 });
  try {
    if (mode === "live") {
      if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: "Live mode is off: the server has no ANTHROPIC_API_KEY. The reference agent shows the same comparison." }, { status: 400 });
      const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
      const now = Date.now();
      const list = (hits.get(ip) || []).filter((t) => now - t < 3600_000);
      if (new Date().toDateString() !== day) {
        day = new Date().toDateString();
        dayCount = 0;
      }
      if (list.length >= 6 || dayCount >= 120) return Response.json({ error: "Live runs are rate-limited. Try the reference agent, or come back in an hour." }, { status: 429 });
      list.push(now);
      hits.set(ip, list);
      dayCount++;
      const target = own ?? scenario;
      const [without, withW] = await Promise.all([runLive(target, false), runLive(target, true)]);
      return Response.json({ mode, without, with: withW });
    }
    const [without, withW] = await Promise.all([runScenario(scenario, false), runScenario(scenario, true, judgeBudget(request))]);
    return Response.json({ mode, without, with: withW });
  } catch (e) {
    return Response.json({ error: `The run failed: ${(e as Error).message}` }, { status: 500 });
  }
}
