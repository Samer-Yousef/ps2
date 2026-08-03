// prepare-v2-data.mjs
// Converts v2's OWN copy of the vector DB into compact artifacts:
//   public/v2-data/vectors.i8   — int8-quantized UNIT vectors (header + payload), ~2.9MB
//   public/v2-data/cards.json   — compact display + keyword records, short keys, nulls dropped
//   public/v2-data/pca_model.json — v2's copy of the PCA model
//
// Vectors are L2-normalized so cosine similarity == plain dot product, and quantized to int8
// with a single global scale (stored in the header) for maximum accuracy per byte.
//
// ISOLATION: this script reads data-v2/source-vectordb.json (v2's own snapshot) and writes
// only inside public/v2-data/. It must never read or write the homepage's search assets
// (public/pathology_vectordb*.json, public/pca_model.json, public/searchWorker.js) so that
// v2 search experiments cannot degrade the live homepage.

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import crypto from 'crypto';

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'data-v2', 'source-vectordb.json');
const SRC_PCA = path.join(ROOT, 'data-v2', 'pca_model.json');
const OUT_DIR = path.join(ROOT, 'public', 'v2-data');

fs.mkdirSync(OUT_DIR, { recursive: true });

if (!fs.existsSync(SRC)) {
  console.error(`missing v2 source snapshot: ${SRC}\n` +
    `create it once with:  cp public/pathology_vectordb_compressed.json data-v2/source-vectordb.json`);
  process.exit(1);
}
// keep v2's served PCA copy in sync with v2's own snapshot of it
if (fs.existsSync(SRC_PCA)) fs.copyFileSync(SRC_PCA, path.join(OUT_DIR, 'pca_model.json'));

console.time('read+parse');
const data = JSON.parse(fs.readFileSync(SRC, 'utf8'));
console.timeEnd('read+parse');

const N = data.length;
const DIM = data[0].vector.length;
console.log(`entries=${N} dim=${DIM}`);

// --- Pass 1: normalize to unit vectors, find global absmax for quantization scale ---
const unit = new Float32Array(N * DIM);
let absmax = 0;
for (let i = 0; i < N; i++) {
  const v = data[i].vector;
  let mag = 0;
  for (let j = 0; j < DIM; j++) mag += v[j] * v[j];
  mag = Math.sqrt(mag) || 1;
  const base = i * DIM;
  for (let j = 0; j < DIM; j++) {
    const u = v[j] / mag;
    unit[base + j] = u;
    const a = Math.abs(u);
    if (a > absmax) absmax = a;
  }
}
const scale = 127 / absmax;
console.log(`unit absmax=${absmax.toFixed(4)} scale=${scale.toFixed(3)}`);

// --- Quantize to int8 ---
const q = new Int8Array(N * DIM);
for (let k = 0; k < unit.length; k++) {
  let x = Math.round(unit[k] * scale);
  if (x > 127) x = 127; else if (x < -128) x = -128;
  q[k] = x;
}

// Header: magic "PSV1", int32 N, int32 DIM, float32 scale  => 16 bytes, then int8 payload
const header = Buffer.alloc(16);
header.write('PSV1', 0, 'ascii');
header.writeInt32LE(N, 4);
header.writeInt32LE(DIM, 8);
header.writeFloatLE(scale, 12);
const payload = Buffer.from(q.buffer, q.byteOffset, q.byteLength);
const outBin = Buffer.concat([header, payload]);
fs.writeFileSync(path.join(OUT_DIR, 'vectors.i8'), outBin);
console.log(`vectors.i8 = ${(outBin.length / 1e6).toFixed(2)} MB`);

// --- cards.json: compact records for display + keyword boost ---
// Short keys keep the file small; gzip on the wire does the rest.
const clean = (s) => (s == null ? '' : String(s).trim());
const cards = new Array(N);
for (let i = 0; i < N; i++) {
  const e = data[i];
  const m = e.metadata || {};
  const dx = clean(m.essential_diagnosis) || clean(e.diagnosis);
  const xdx = clean(m.extracted_diagnosis);
  const organ = clean(m.organ) || clean(e.organ);
  const system = clean(m.system) || clean(e.system);
  const site = clean(m.site_ai) || clean(m.site) || clean(e.site);
  const variant = clean(m.variant);
  const lineage = clean(m.lineage);
  const micro = clean(m.microscopic);
  const hist = clean(m.clinical_history_ai) || clean(m.clinical_history);
  const stain = clean(m.stain);
  const tissue = clean(m.tissue);
  const source = clean(m.source);
  const url = clean(m.url);
  const caseId = clean(m.case_id) || clean(e.id);
  const sex = clean(m.sex_ai) || clean(m.sex);
  const age = m.age_ai ?? m.age ?? null;

  // NOTE: no keyword blob (`k`) and no tissue (`ti`) — the worker scores against the
  // individual lowercased fields and the UI never reads either. Dropping them cuts
  // cards.json from ~20MB to ~10.5MB raw (2.4MB -> 1.0MB brotli on the wire).
  const rec = { i: e.id, ci: caseId, dx, o: organ, s: system };
  if (xdx && xdx !== dx) rec.xd = xdx;
  if (site) rec.st = site;
  if (variant) rec.v = variant;
  if (lineage) rec.l = lineage;
  if (micro) rec.mic = micro;
  if (hist) rec.ch = hist;
  if (stain) rec.stn = stain;
  if (source) rec.src = source;
  if (url) rec.u = url;
  if (sex) rec.sx = sex;
  if (age != null) rec.ag = age;
  cards[i] = rec;
}
const cardsJson = JSON.stringify(cards);
fs.writeFileSync(path.join(OUT_DIR, 'cards.json'), cardsJson);
console.log(`cards.json = ${(cardsJson.length / 1e6).toFixed(2)} MB`);

// Content hash over both payloads — the worker keys its IndexedDB corpus cache on this,
// so regenerating the data automatically invalidates every client's cached copy.
const version = crypto.createHash('sha256').update(outBin).update(cardsJson).digest('hex').slice(0, 12);

// A tiny manifest so the client knows counts without parsing the header itself
fs.writeFileSync(
  path.join(OUT_DIR, 'manifest.json'),
  JSON.stringify({ version, count: N, dim: DIM, scale, bytes: cardsJson.length, sources: [...new Set(cards.map(c => c.src).filter(Boolean))], systems: [...new Set(cards.map(c => c.s).filter(Boolean))].sort() })
);
console.log(`manifest version=${version}`);

// Precompressed variants: nginx serves these statically (brotli_static/gzip_static),
// so the single-core VPS never compresses these payloads at request time.
console.time('precompress');
for (const f of ['cards.json', 'vectors.i8', 'pca_model.json']) {
  const p = path.join(OUT_DIR, f);
  const buf = fs.readFileSync(p);
  fs.writeFileSync(p + '.br', zlib.brotliCompressSync(buf, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
      [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length,
    },
  }));
  fs.writeFileSync(p + '.gz', zlib.gzipSync(buf, { level: 9 }));
  const mb = (n) => (n / 1e6).toFixed(2);
  console.log(`  ${f}: ${mb(buf.length)}MB -> br ${mb(fs.statSync(p + '.br').size)}MB / gz ${mb(fs.statSync(p + '.gz').size)}MB`);
}
console.timeEnd('precompress');
console.log('done.');
