// GET /api/health: which layers are switched on.
import { classifier, judge } from "@/lib/server/engine";
import { connection } from "next/server";

export async function GET() {
  await connection();
  return Response.json({
    ok: true,
    layers: {
      readers: "on",
      decoders: "on",
      patterns: "on",
      taskBinding: "on",
      classifier: classifier ? "on" : "off",
      ocr: "on",
      llmJudge: judge.available ? "on" : "off",
    },
    judgeModel: judge.available ? judge.name : null,
    classifier: classifier?.name ?? null,
  });
}
