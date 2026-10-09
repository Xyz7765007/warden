// POST /api/guard: check what an agent is about to say or do, before it leaves.
// JSON body: { output?, call?: { tool, args }, task?, flagged?: string[], clean?: string[],
//              canaries?: string[], allowedDomains?: string[] }
// Returns { decision: "allow" | "redact" | "block", headline, findings, output } where output is
// the reply with leaks removed.
import { guardEgress, type EgressInput } from "@/lib/warden/egress";

const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 200) : undefined);

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send JSON with an output, a call, or both." }, { status: 400 });
  }
  const call = body.call && typeof body.call === "object" ? (body.call as { tool?: unknown; args?: unknown }) : undefined;
  const input: EgressInput = {
    output: typeof body.output === "string" ? body.output.slice(0, 200_000) : undefined,
    call: call && typeof call.tool === "string" ? { tool: call.tool, args: call.args && typeof call.args === "object" ? (call.args as Record<string, unknown>) : {} } : undefined,
    task: typeof body.task === "string" ? body.task : undefined,
    flagged: strs(body.flagged),
    clean: strs(body.clean),
    canaries: strs(body.canaries),
    allowedDomains: strs(body.allowedDomains),
  };
  if (input.output === undefined && !input.call) return Response.json({ error: "Nothing to check: send an output, a call, or both." }, { status: 400 });
  return Response.json(guardEgress(input));
}
