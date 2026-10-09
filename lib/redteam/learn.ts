// The learning step, shared by the red-team page and the matrix test so both measure the same thing.
// Every miss is learned in two forms (plain words, and as the attacker wrote it), weighted so the
// misses and the safe replay count equally; the safe replay keeps false alarms from creeping in.

import type { LinearClassifier } from "../warden/classifier";
import type { Attempt } from "./mutators";
import { SAFE_TEXTS } from "./benign";

export function learnFromMisses(clf: LinearClassifier, misses: Attempt[], seed = 7): number {
  const positives = misses.flatMap((a) => [
    { text: a.payload, label: 1 as const, type: a.seed.type },
    ...(a.disguised && a.disguised !== a.payload ? [{ text: a.disguised, label: 1 as const, type: a.seed.type }] : []),
  ]);
  if (!positives.length) return 0;
  const replay = SAFE_TEXTS.concat(SAFE_TEXTS).map((t) => ({ text: t, label: 0 as const }));
  const weight = Math.max(2, replay.length / positives.length);
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  clf.learn([...positives.map((p) => ({ ...p, weight })), ...replay], { epochs: 8, lr: 0.5, seed });
  return Math.max(1, Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0));
}
