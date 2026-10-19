// Embeds every catalogue case with the local MiniLM model (same model /api/search uses) and writes
// data-searchv2/vectors.i8 (int8 unit vectors, header "PSV1" N DIM scale) + vectors-ids.json (case ids in row order).
// Server-only artefacts, read by /api/searchv2/semantic. Run niced: it takes ~10 min on the 1-core box.
import fs from 'fs';
import path from 'path';
import { createClient } from '@libsql/client';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'data-searchv2');
fs.mkdirSync(OUT, { recursive: true });
const db = createClient({ url: `file:${path.join(ROOT, 'data-catalogue', 'site.sqlite')}` });
const rows = (await db.execute(`
  SELECT c.id, COALESCE(NULLIF(l.clean_label,''), c.title) AS label, c.title, COALESCE(c.qualifiers,'') AS qualifiers,
         o.name AS organ, s.name AS system
  FROM cases c LEFT JOIN case_labels l ON l.case_id=c.id
  JOIN nodes o ON o.id=c.organ_id JOIN nodes s ON s.id=c.system_id ORDER BY c.id`)).rows;
console.log('cases', rows.length);
const { pipeline, env } = await import('@xenova/transformers');
env.allowRemoteModels = false;
const embed = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
const DIM = 384;
const vecs = new Float32Array(rows.length * DIM);
const t0 = performance.now();
const B = 32;
for (let i = 0; i < rows.length; i += B) {
  const batch = rows.slice(i, i + B);
  const texts = batch.map((r) => {
    const parts = [r.label];
    if (r.title && r.title.toLowerCase() !== String(r.label).toLowerCase()) parts.push(r.title);
    if (r.qualifiers) parts.push(r.qualifiers);
    parts.push(`${r.organ}, ${r.system}`);
    return parts.join('. ').slice(0, 400);
  });
  const out = await embed(texts, { pooling: 'mean', normalize: true });
  const data = out.data;
  for (let b = 0; b < batch.length; b++) vecs.set(data.subarray(b * DIM, (b + 1) * DIM), (i + b) * DIM);
  if ((i / B) % 20 === 0) console.log(`${i + batch.length}/${rows.length} ${((performance.now() - t0) / 1000).toFixed(0)}s`);
}
let absmax = 0;
for (let k = 0; k < vecs.length; k++) { const a = Math.abs(vecs[k]); if (a > absmax) absmax = a; }
const scale = 127 / absmax;
const q = new Int8Array(vecs.length);
for (let k = 0; k < vecs.length; k++) q[k] = Math.max(-128, Math.min(127, Math.round(vecs[k] * scale)));
const header = Buffer.alloc(16);
header.write('PSV1', 0, 'ascii'); header.writeInt32LE(rows.length, 4); header.writeInt32LE(DIM, 8); header.writeFloatLE(scale, 12);
fs.writeFileSync(path.join(OUT, 'vectors.i8'), Buffer.concat([header, Buffer.from(q.buffer)]));
fs.writeFileSync(path.join(OUT, 'vectors-ids.json'), JSON.stringify(rows.map((r) => Number(r.id))));
console.log('done', rows.length, 'vectors in', ((performance.now() - t0) / 1000).toFixed(0), 's');
