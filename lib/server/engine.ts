// Server-side singletons: the trained classifier (bundled with the app) and the LLM judge.
import modelJson from "@/data/model/classifier.json";
import { classifierFromJson, type ClassifierJson } from "@/lib/warden/classifier";
import { createJudge } from "@/lib/warden/judge";

export const classifier = classifierFromJson(modelJson as unknown as ClassifierJson);
export const judge = createJudge();
