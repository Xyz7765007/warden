// POST /api/agent { scenario, mode: "reference" | "live" }
// Runs the same agent on the same task twice: without Warden, and behind Warden.
import { runScenario } from "@/lib/agent/reference";
import { runLive } from "@/lib/agent/live";
import { SCENARIOS } from "@/lib/agent/scenarios";
import { judgeBudget } from "@/lib/server/budget";

export const maxDuration = 120;

// Live runs cost money: a few per visitor per hour, and a daily ceiling per instance.
const hits = new Map<string, number[]>();
let dayCount = 0;
let day = new Date().toDateString();

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const scenario = typeof body.scenario === "string" ? body.scenario : "";
  const mode = body.mode === "live" ? "live" : "reference";
  if (!SCENARIOS.some((s) => s.id === scenario)) return Response.json({ error: "Pick a scenario." }, { status: 400 });
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
      const [without, withW] = await Promise.all([runLive(scenario, false), runLive(scenario, true)]);
      return Response.json({ mode, without, with: withW });
    }
    const [without, withW] = await Promise.all([runScenario(scenario, false), runScenario(scenario, true, judgeBudget(request))]);
    return Response.json({ mode, without, with: withW });
  } catch (e) {
    return Response.json({ error: `The run failed: ${(e as Error).message}` }, { status: 500 });
  }
}
