// Benchmark the v2 artifacts exactly as the browser worker would use them.
import fs from 'fs';
import path from 'path';

const D = path.join(process.cwd(), 'public', 'v2-data');
const bin = fs.readFileSync(path.join(D, 'vectors.i8'));
const cards = JSON.parse(fs.readFileSync(path.join(D, 'cards.json'), 'utf8'));

const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
const N = dv.getInt32(4, true), DIM = dv.getInt32(8, true), scale = dv.getFloat32(12, true);
const q = new Int8Array(bin.buffer, bin.byteOffset + 16, N * DIM);
const t0 = performance.now();
const vectors = new Float32Array(N * DIM);
const inv = 1 / scale;
for (let k = 0; k < q.length; k++) vectors[k] = q[k] * inv;
console.log(`N=${N} DIM=${DIM}  dequantize: ${(performance.now() - t0).toFixed(1)}ms`);

// ---- keyword search (runs on every keystroke) ----
function keyword(query, limit = 72) {
  const toks = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const phrase = query.toLowerCase().trim();
  const hits = [];
  for (let i = 0; i < N; i++) {
    const c = cards[i]; const k = c.k; const dx = c.dx ? c.dx.toLowerCase() : '';
    let score = 0, matched = 0;
    for (const t of toks) { if (dx.includes(t)) { score += 3; matched++; } else if (k.includes(t)) { score += 1; matched++; } }
    if (!matched) continue;
    if (matched === toks.length) score += 2;
    if (dx.includes(phrase)) score += 6;
    hits.push({ i, score });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}

// ---- semantic scan only (embedding is separate/debounced) ----
function scan(qv, limit = 72) {
  const scores = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const base = i * DIM; let dot = 0;
    for (let j = 0; j < DIM; j++) dot += qv[j] * vectors[base + j];
    scores[i] = dot;
  }
  const idx = Array.from({ length: N }, (_, i) => i);
  idx.sort((a, b) => scores[b] - scores[a]);
  return idx.slice(0, limit).map((i) => ({ i, score: scores[i] }));
}

function timeit(fn, runs = 30) {
  fn(); // warm
  const t = performance.now();
  for (let r = 0; r < runs; r++) fn();
  return (performance.now() - t) / runs;
}

const queries = ['melanoma', 'clear cell', 'spindle cell', 'papillary thyroid carcinoma', 'granuloma'];
console.log('\n--- KEYWORD search (per keystroke) ---');
for (const query of queries) {
  const ms = timeit(() => keyword(query));
  const top = keyword(query).slice(0, 3).map((h) => cards[h.i].dx);
  console.log(`  "${query}"  ${ms.toFixed(2)}ms   →  ${top.join(' | ')}`);
}

console.log('\n--- SEMANTIC dot-product scan (128-dim over all cases) ---');
const rq = new Float32Array(DIM);
for (let j = 0; j < DIM; j++) rq[j] = Math.random() - 0.5;
console.log(`  scan+topK: ${timeit(() => scan(rq)).toFixed(2)}ms  (embedding runs once, debounced, model-bound ~30-80ms)`);
