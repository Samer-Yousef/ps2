import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

/**
 * /api/searchv2/semantic?q=…&k=120
 * Brute-force cosine search over data-searchv2/vectors.i8 (int8 MiniLM vectors of every catalogue
 * case, built by scripts/searchv2/build-vectors.mjs). Vectors live in memory after the first call;
 * the query is embedded with the local model (no network). Returns [[caseId, score], …].
 */

interface Store { n: number; dim: number; scale: number; data: Int8Array; ids: number[] }
let store: Store | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let embedder: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let loading: Promise<any> | null = null;

function loadStore(): Store {
  if (store) return store;
  const dir = path.join(process.cwd(), 'data-searchv2');
  const buf = fs.readFileSync(path.join(dir, 'vectors.i8'));
  if (buf.toString('ascii', 0, 4) !== 'PSV1') throw new Error('bad vectors.i8 header');
  const n = buf.readInt32LE(4), dim = buf.readInt32LE(8), scale = buf.readFloatLE(12);
  const data = new Int8Array(buf.buffer, buf.byteOffset + 16, n * dim);
  const ids = JSON.parse(fs.readFileSync(path.join(dir, 'vectors-ids.json'), 'utf8')) as number[];
  if (ids.length !== n) throw new Error('vectors-ids.json does not match vectors.i8');
  store = { n, dim, scale, data, ids };
  return store;
}

async function getEmbedder() {
  if (embedder) return embedder;
  if (!loading) {
    loading = (async () => {
      const { pipeline, env } = await import('@xenova/transformers');
      env.allowRemoteModels = false;
      embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
      return embedder;
    })();
  }
  return loading;
}

export async function GET(request: NextRequest) {
  const t0 = performance.now();
  const q = (request.nextUrl.searchParams.get('q') || '').trim();
  const k = Math.max(1, Math.min(300, parseInt(request.nextUrl.searchParams.get('k') || '120', 10) || 120));
  if (!q) return NextResponse.json({ error: 'q required' }, { status: 400 });
  try {
    const s = loadStore();
    const emb = await getEmbedder();
    const out = await emb(q, { pooling: 'mean', normalize: true });
    const qv = Float32Array.from(out.data as Float32Array);
    const tEmb = performance.now();

    const { n, dim, data, scale } = s;
    // top-k by insertion into a small sorted buffer
    const topId = new Int32Array(k), topS = new Float32Array(k);
    let filled = 0;
    for (let i = 0; i < n; i++) {
      const off = i * dim;
      let dot = 0;
      for (let j = 0; j < dim; j++) dot += qv[j] * data[off + j];
      if (filled === k && dot <= topS[k - 1]) continue;
      // insert sorted desc
      let p = filled < k ? filled : k - 1;
      while (p > 0 && topS[p - 1] < dot) { topS[p] = topS[p - 1]; topId[p] = topId[p - 1]; p--; }
      topS[p] = dot; topId[p] = i;
      if (filled < k) filled++;
    }
    const hits: [number, number][] = [];
    for (let i = 0; i < filled; i++) hits.push([s.ids[topId[i]], Math.round((topS[i] / scale) * 1000) / 1000]);
    return NextResponse.json({
      q, hits,
      ms: Math.round(performance.now() - t0), embedMs: Math.round(tEmb - t0),
    }, { headers: { 'Cache-Control': 'public, max-age=3600' } });
  } catch (e) {
    console.error('searchv2/semantic', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
