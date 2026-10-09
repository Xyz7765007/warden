// A small trained classifier: hashed character and word n-grams into two linear heads.
// Head 1 scores "attack or not"; head 2 guesses which of the 9 attack types it is.
// Small enough to ship to the browser, which is how the red-team page retrains it live.

import { normalize } from "./normalize";
import { ATTACK_TYPES, type AttackType } from "./types";

export const DIM = 1 << 16;
export const DIM2 = 1 << 14;

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export type Sparse = Map<number, number>;

export function featurize(text: string, dim = DIM): Sparse {
  const n = normalize(text.slice(0, 4000)).norm.replace(/[^\p{L}\p{N}@./:' ]+/gu, " ").replace(/\s+/g, " ").trim();
  const f: Sparse = new Map();
  const bump = (key: string, w = 1) => {
    const i = fnv1a(key) % dim;
    f.set(i, (f.get(i) ?? 0) + w);
  };
  const padded = ` ${n} `;
  for (let k = 3; k <= 5; k++) for (let i = 0; i + k <= padded.length; i++) bump(`c${k}:${padded.slice(i, i + k)}`);
  const words = n.split(" ").filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    bump(`w:${words[i]}`, 1.5);
    if (i + 1 < words.length) bump(`b:${words[i]} ${words[i + 1]}`, 2);
  }
  let norm = 0;
  for (const v of f.values()) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  for (const [k, v] of f) f.set(k, v / norm);
  return f;
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

export interface ClassifierJson {
  version: 1;
  name: string;
  dim: number;
  dim2: number;
  bias: number;
  w: string;
  wScale: number;
  typeBias: number[];
  W: string;
  WScale: number;
  meta: Record<string, unknown>;
}

function b64ToInt8(s: string): Int8Array {
  const bin = typeof atob === "function" ? atob(s) : Buffer.from(s, "base64").toString("binary");
  const out = new Int8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = (bin.charCodeAt(i) << 24) >> 24;
  return out;
}
function int8ToB64(a: Int8Array): string {
  let s = "";
  const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode(...u.subarray(i, i + 8192));
  return typeof btoa === "function" ? btoa(s) : Buffer.from(s, "binary").toString("base64");
}

export class LinearClassifier {
  name: string;
  w: Float32Array;
  bias: number;
  W: Float32Array;
  typeBias: Float32Array;
  meta: Record<string, unknown>;

  constructor(opts: { name: string; w: Float32Array; bias: number; W: Float32Array; typeBias: Float32Array; meta?: Record<string, unknown> }) {
    this.name = opts.name;
    this.w = opts.w;
    this.bias = opts.bias;
    this.W = opts.W;
    this.typeBias = opts.typeBias;
    this.meta = opts.meta ?? {};
  }

  static empty(name = "warden-linear") {
    return new LinearClassifier({ name, w: new Float32Array(DIM), bias: 0, W: new Float32Array(ATTACK_TYPES.length * DIM2), typeBias: new Float32Array(ATTACK_TYPES.length) });
  }

  static fromJSON(j: ClassifierJson) {
    const wq = b64ToInt8(j.w);
    const Wq = b64ToInt8(j.W);
    const w = new Float32Array(j.dim);
    for (let i = 0; i < j.dim; i++) w[i] = wq[i] * j.wScale;
    const W = new Float32Array(ATTACK_TYPES.length * j.dim2);
    for (let i = 0; i < W.length; i++) W[i] = Wq[i] * j.WScale;
    return new LinearClassifier({ name: j.name, w, bias: j.bias, W, typeBias: Float32Array.from(j.typeBias), meta: j.meta });
  }

  toJSON(): ClassifierJson {
    const q = (a: Float32Array) => {
      let m = 0;
      for (const v of a) m = Math.max(m, Math.abs(v));
      const scale = m / 127 || 1;
      const out = new Int8Array(a.length);
      for (let i = 0; i < a.length; i++) out[i] = Math.max(-127, Math.min(127, Math.round(a[i] / scale)));
      return { s: int8ToB64(out), scale };
    };
    const a = q(this.w), b = q(this.W);
    return { version: 1, name: this.name, dim: DIM, dim2: DIM2, bias: this.bias, w: a.s, wScale: a.scale, typeBias: Array.from(this.typeBias), W: b.s, WScale: b.scale, meta: this.meta };
  }

  rawScore(x: Sparse) {
    let z = this.bias;
    for (const [i, v] of x) z += this.w[i] * v;
    return z;
  }

  typeScores(x: Sparse) {
    const k = ATTACK_TYPES.length;
    const z = Array.from(this.typeBias);
    for (const [i, v] of x) {
      const j = i % DIM2;
      for (let t = 0; t < k; t++) z[t] += this.W[t * DIM2 + j] * v;
    }
    const m = Math.max(...z);
    const e = z.map((v) => Math.exp(v - m));
    const s = e.reduce((a, b) => a + b, 0);
    return e.map((v) => v / s);
  }

  score(text: string): { p: number; type: AttackType | null; typeP: number } {
    const x = featurize(text);
    const p = sigmoid(this.rawScore(x));
    const ts = this.typeScores(x);
    let best = 0;
    for (let t = 1; t < ts.length; t++) if (ts[t] > ts[best]) best = t;
    return { p, type: p >= 0.5 ? ATTACK_TYPES[best] : null, typeP: ts[best] };
  }

  /** Online SGD update; used for training and for live retraining on red-team misses. */
  learn(examples: Array<{ text: string; label: 0 | 1; type?: AttackType | null; weight?: number }>, opts: { epochs?: number; lr?: number; l2?: number; seed?: number } = {}) {
    const epochs = opts.epochs ?? 6;
    const l2 = opts.l2 ?? 1e-6;
    const feats = examples.map((e) => ({ ...e, x: featurize(e.text) }));
    let seed = opts.seed ?? 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const k = ATTACK_TYPES.length;
    for (let ep = 0; ep < epochs; ep++) {
      const lr = (opts.lr ?? 0.6) / (1 + ep * 0.5);
      for (let i = feats.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [feats[i], feats[j]] = [feats[j], feats[i]];
      }
      for (const e of feats) {
        const wt = e.weight ?? 1;
        const p = sigmoid(this.rawScore(e.x));
        const g = (p - e.label) * wt;
        for (const [i, v] of e.x) this.w[i] -= lr * (g * v + l2 * this.w[i]);
        this.bias -= lr * g * 0.1;
        if (e.label === 1 && e.type) {
          const ts = this.typeScores(e.x);
          const target = ATTACK_TYPES.indexOf(e.type);
          for (let t = 0; t < k; t++) {
            const gt = (ts[t] - (t === target ? 1 : 0)) * wt;
            if (Math.abs(gt) < 1e-4) continue;
            for (const [i, v] of e.x) {
              const idx = t * DIM2 + (i % DIM2);
              this.W[idx] -= lr * 0.5 * (gt * v + l2 * this.W[idx]);
            }
            this.typeBias[t] -= lr * 0.05 * gt;
          }
        }
      }
    }
  }
}

export function classifierFromJson(j: ClassifierJson | null | undefined): LinearClassifier | null {
  return j ? LinearClassifier.fromJSON(j) : null;
}
