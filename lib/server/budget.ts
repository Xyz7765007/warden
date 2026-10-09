// The LLM judge spends the deployer's API credit and the demo is public, so it is capped: a few
// dozen judged scans per visitor per hour and a daily ceiling per server instance. Past the cap,
// scans run on the free layers only, which is the setup every judge-off number was measured on.

// Override with WARDEN_JUDGE_PER_VISITOR_HOUR and WARDEN_JUDGE_PER_DAY.
const PER_VISITOR_PER_HOUR = Number(process.env.WARDEN_JUDGE_PER_VISITOR_HOUR) || 60;
const PER_INSTANCE_PER_DAY = Number(process.env.WARDEN_JUDGE_PER_DAY) || 3000;

const visits = new Map<string, number[]>();
let day = new Date().toDateString();
let dayCount = 0;

/** "auto" while this visitor and this instance are under their caps, "off" after. Counts the call. */
export function judgeBudget(request: Request): "auto" | "off" {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const now = Date.now();
  if (new Date().toDateString() !== day) {
    day = new Date().toDateString();
    dayCount = 0;
  }
  const recent = (visits.get(ip) || []).filter((t) => now - t < 3600_000);
  if (recent.length >= PER_VISITOR_PER_HOUR || dayCount >= PER_INSTANCE_PER_DAY) return "off";
  recent.push(now);
  if (visits.size > 5000) visits.clear();
  visits.set(ip, recent);
  dayCount++;
  return "auto";
}
