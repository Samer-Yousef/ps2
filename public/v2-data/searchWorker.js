// v2 search worker
// Loads int8-quantized unit vectors (vectors.i8) + compact cards (cards.json).
// Two search modes:
//   - keyword:  instant lexical match over precomputed lowercase blobs (<5ms), no model needed
//   - semantic: transformer embedding + dot-product ranking (model loads lazily in background)
//
// Because vectors are stored as L2-normalized unit vectors, cosine similarity == dot product.

let cards = null;          // array of compact records
let vectors = null;        // Float32Array(N*DIM), dequantized unit vectors
let N = 0, DIM = 0;

// Parallel lowercased field arrays for fast weighted keyword boosting (built once at load,
// kept off the card objects so postMessage results stay small).
let L_xd, L_dx, L_v, L_l, L_o, L_mic, L_s, L_st;
let LF = null;   // the same arrays in FIELD_W order, for the scoring loop
let LEN = null;  // per-field length-normalization factor, parallel to LF
let dataReady = false;
let extractor = null;
let pcaModel = null;
let semanticReady = false;
let Transformers = null;
let vectorsLoading = null;   // promise; resolves once `vectors` is populated (semantic gate)

// ---------- corpus cache (IndexedDB) ----------
// Repeat visits skip the ~3MB download and the 20MB JSON parse entirely: the parsed cards
// array and the raw vectors.i8 buffer are stored client-side, keyed on manifest.version.
// Regenerating the data on the server changes the version, which invalidates every client.
// All cache ops are best-effort — private browsing or quota errors fall through to network.
const DB_NAME = 'psv2', DB_STORE = 'corpus';

function idb() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
async function cacheGet() {
  try {
    const db = await idb();
    return await new Promise((res) => {
      const rq = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get('v2');
      rq.onsuccess = () => { db.close(); res(rq.result || null); };
      rq.onerror = () => { db.close(); res(null); };
    });
  } catch { return null; }
}
function cachePut(entry) {
  idb().then((db) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(entry, 'v2');
    tx.oncomplete = tx.onerror = () => db.close();   // don't hold the db open — it blocks deletes
  }).catch(() => {});
}

// ---------- loading ----------
function buildLexArrays() {
  N = cards.length;
  // precompute lowercased fields once (avoids re-lowercasing 23k cards on every keystroke)
  const lc = (s) => (s ? String(s).toLowerCase() : '');
  L_xd = new Array(N); L_dx = new Array(N); L_v = new Array(N);
  L_l = new Array(N); L_mic = new Array(N);
  L_o = new Array(N); L_s = new Array(N); L_st = new Array(N);
  for (let i = 0; i < N; i++) {
    const c = cards[i];
    L_xd[i] = lc(c.xd); L_dx[i] = lc(c.dx); L_v[i] = lc(c.v); L_l[i] = lc(c.l);
    L_o[i] = lc(c.o); L_mic[i] = lc(c.mic); L_s[i] = lc(c.s); L_st[i] = lc(c.st);
  }

  // FIELD_W order: xd, dx, v, l, o, mic, s, st
  LF = [L_xd, L_dx, L_v, L_l, L_o, L_mic, L_s, L_st];
  // Shorter fields are stronger evidence: a hit in a 3-word diagnosis outweighs the same
  // hit inside a 400-word microscopic description.
  LEN = LF.map((arr) => {
    const a = new Float32Array(arr.length);
    for (let i = 0; i < arr.length; i++) a[i] = arr[i] ? 1 / (1 + Math.log(1 + arr[i].length / 40)) : 0;
    return a;
  });
}

function installVectors(binBuf) {
  const dv = new DataView(binBuf);
  // header: "PSV1"(4) int32 N, int32 DIM, float32 scale
  const count = dv.getInt32(4, true);
  DIM = dv.getInt32(8, true);
  const scale = dv.getFloat32(12, true);
  const q = new Int8Array(binBuf, 16, count * DIM);
  vectors = new Float32Array(count * DIM);
  const inv = 1 / scale;
  for (let k = 0; k < q.length; k++) vectors[k] = q[k] * inv;
}

// throttled progress reporting for the loading screen: phases are
// 1 download (0-84) -> 2 parse (85-94) -> 3 index (95-100)
let lastPct = -1;
function postProgress(pct, phase, step) {
  const p = Math.min(100, Math.round(pct));
  if (p <= lastPct) return;
  lastPct = p;
  self.postMessage({ type: 'progress', pct: p, phase, step });
}

async function loadData() {
  const t0 = performance.now();

  // tiny and always revalidated — everything else can come from the local cache
  let version = null, cardsBytes = 0;
  try {
    const res = await fetch('/v2-data/manifest.json', { cache: 'no-cache' });
    const m = await res.json();
    version = m.version || null;
    cardsBytes = m.bytes || 0;
  } catch { /* offline or pre-version manifest: fall through */ }

  const cached = await cacheGet();
  if (cached && cached.cards && cached.vecBuf && (version === null || cached.version === version)) {
    cards = cached.cards;
    buildLexArrays();
    dataReady = true;
    vectorsLoading = Promise.resolve().then(() => installVectors(cached.vecBuf));
    return { cached: true, ms: performance.now() - t0 };
  }

  // network path. Keyword search only needs the cards, so readiness is gated on the
  // smaller file; the vectors download + dequantize continues in the background and
  // only the semantic upgrade waits for it.
  const vecLoaded = fetch('/v2-data/vectors.i8')
    .then((r) => r.arrayBuffer())
    .then((buf) => { installVectors(buf); return buf; });
  vectorsLoading = vecLoaded.then(() => {});

  postProgress(2, 'Downloading case database…', 1);
  const cardsRes = await fetch('/v2-data/cards.json');
  if (cardsRes.body && cardsRes.body.getReader) {
    // stream so we can report real byte progress (bytes are post-decompression,
    // so the total to compare against is the raw size from the manifest)
    const total = cardsBytes || 11e6;
    const reader = cardsRes.body.getReader();
    const chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); got += value.length;
      postProgress(2 + 82 * Math.min(1, got / total), 'Downloading case database…', 1);
    }
    const buf = new Uint8Array(got);
    let off = 0;
    for (const c of chunks) { buf.set(c, off); off += c.length; }
    postProgress(86, 'Parsing cases…', 2);
    cards = JSON.parse(new TextDecoder().decode(buf));
  } else {
    // no streaming (e.g. the node eval sandbox) — plain json()
    cards = await cardsRes.json();
  }
  postProgress(95, 'Building search index…', 3);
  buildLexArrays();
  dataReady = true;
  postProgress(100, 'Ready', 3);

  if (version) vecLoaded.then((buf) => cachePut({ version, cards, vecBuf: buf })).catch(() => {});

  return { cached: false, ms: performance.now() - t0 };
}

async function loadPCA() {
  // v2-owned copy — deliberately NOT the homepage's /pca_model.json, so v2 search
  // changes can never affect the live homepage engine.
  const res = await fetch('/v2-data/pca_model.json');
  const data = await res.json();
  pcaModel = { components: data.components, mean: data.mean, n_components: data.n_components };
}

async function initEmbedder() {
  if (extractor) return;
  if (!Transformers) {
    const mod = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2');
    Transformers = mod;
    Transformers.env.allowLocalModels = false;
  }
  if (!pcaModel) await loadPCA();
  extractor = await Transformers.pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
}

async function textToVector(text) {
  const output = await extractor(text, { pooling: 'mean', normalize: true });
  const full = output.data; // Float32Array(384)
  const { mean, components, n_components } = pcaModel;
  const reduced = new Float32Array(n_components);
  for (let i = 0; i < n_components; i++) {
    const comp = components[i];
    let sum = 0;
    for (let j = 0; j < full.length; j++) sum += (full[j] - mean[j]) * comp[j];
    reduced[i] = sum;
  }
  return reduced;
}

// ---------- ranking helpers ----------
function tokenize(q) {
  return q.toLowerCase().trim().split(/\s+/).filter(Boolean);
}

// bounded top-K by score (descending). scores: Float32Array over N. returns array of idx.
function topK(scores, K, minScore) {
  const best = []; // {i, s} kept sorted ascending by s, length <= K
  let worst = -Infinity;
  for (let i = 0; i < N; i++) {
    const s = scores[i];
    if (s <= minScore) continue;
    if (best.length < K) {
      best.push({ i, s });
      if (best.length === K) { best.sort((a, b) => a.s - b.s); worst = best[0].s; }
    } else if (s > worst) {
      // replace smallest
      best[0] = { i, s };
      // re-sink smallest to front (small K, linear is fine)
      let p = 0;
      while (p + 1 < K && best[p].s > best[p + 1].s) { const t = best[p]; best[p] = best[p + 1]; best[p + 1] = t; p++; }
      worst = best[0].s;
    }
  }
  best.sort((a, b) => b.s - a.s);
  return best;
}

function hydrate(hits) {
  return hits.map(h => {
    const c = cards[h.iIdx];
    return { ...c, _score: h.s };
  });
}

// ---------- lexical scoring ----------
// The previous scorer summed flat per-field weights and clamped the total at 0.35. That cap
// was the main ranking defect: on a query like "kikuchi" every one of the 38 matching cards
// hit the ceiling, so the lexical signal vanished and ordering fell to a cosine that had no
// idea what the word meant. This scorer keeps a small FLOOR for any match (recall, what the
// cap accidentally provided) and grades the rest by how good the match actually is:
//   * IDF          — a rare term counts far more than a common one
//   * field weight — a hit in the diagnosis beats a hit in a long microscopic description
//   * length norm  — a hit in a 3-word field beats the same hit buried in 400 words
//   * match kind   — whole word > start-of-word (prefix, for search-as-you-type) > substring
//   * coverage     — matching 1 of 3 query terms is punished relative to matching all 3
// Tuned by replaying ~11k real clicks from search-logs.txt (see scripts/eval-v2-search.mjs).
// weights in LF order: xd, dx, v, l, o, mic, s, st
const FW = [1.00, 0.95, 0.55, 0.45, 0.35, 0.20, 0.22, 0.25];
const P = {
  wordBonus: 1.6,    // token is a whole word in the field
  prefixBonus: 1.25, // token starts a word ("kiku" -> "kikuchi")
  coverPow: 2.0,     // penalty curve for matching only some query terms
  phraseBonus: 1.2,  // whole query appears verbatim in a diagnosis field
  exactBonus: 2.5,   // a diagnosis field IS the query
  B: 0.35,           // total lexical influence added on top of cosine
  floor: 0.7,        // share of B granted for any match at all (recall vs precision dial)
  maxTokens: 8,
};

// 0 = absent, 1 = substring, 2 = starts a word, 3 = whole word
function hitKind(s, t) {
  let idx = s.indexOf(t);
  if (idx < 0) return 0;
  let best = 1;
  while (idx >= 0) {
    const atStart = idx === 0 || s.charCodeAt(idx - 1) === 32;
    const end = idx + t.length;
    if (atStart && (end === s.length || s.charCodeAt(end) === 32)) return 3;
    if (atStart) best = 2;
    idx = s.indexOf(t, idx + 1);
  }
  return best;
}

// Per-token scan over the whole corpus, memoized. While the user types "squamous cell
// carcinoma" only the final token changes on each keystroke, so the earlier tokens are cache
// hits and a keystroke costs about the same as a single-token query.
const tokCache = new Map();   // token -> { c: Float32Array(N), df }
const TOK_CACHE_MAX = 32;

function tokenContrib(tok) {
  const hit = tokCache.get(tok);
  if (hit) { tokCache.delete(tok); tokCache.set(tok, hit); return hit; }   // LRU touch
  const c = new Float32Array(N);
  const nF = LF.length;
  let df = 0;
  for (let i = 0; i < N; i++) {
    let best = 0;
    for (let f = 0; f < nF; f++) {
      const s = LF[f][i];
      if (!s) continue;
      const k = hitKind(s, tok);
      if (!k) continue;
      const val = FW[f] * (k === 3 ? P.wordBonus : k === 2 ? P.prefixBonus : 1) * LEN[f][i];
      if (val > best) best = val;
    }
    if (best > 0) { c[i] = best; df++; }
  }
  const e = { c, df };
  tokCache.set(tok, e);
  if (tokCache.size > TOK_CACHE_MAX) tokCache.delete(tokCache.keys().next().value);
  return e;
}

// Returns { lex, cov, maxLex } over all N cards. lex is unnormalized; cov > 0 marks a match.
function lexicalPass(query) {
  const toks = tokenize(query).slice(0, P.maxTokens);
  const T = toks.length;
  const phrase = query.toLowerCase().trim();
  const lex = new Float32Array(N), cov = new Float32Array(N);
  if (T === 0) return { lex, cov, maxLex: 0, T };

  const cols = new Array(T);
  const idf = new Float32Array(T);
  let idfSum = 0;
  for (let t = 0; t < T; t++) {
    const e = tokenContrib(toks[t]);
    cols[t] = e.c;
    idf[t] = e.df ? Math.log(1 + N / e.df) : 0;
    idfSum += idf[t];
  }
  if (idfSum === 0) idfSum = 1;

  let maxLex = 0;
  const usePhrase = phrase.length > 3;
  for (let i = 0; i < N; i++) {
    let s = 0, m = 0;
    for (let t = 0; t < T; t++) { const c = cols[t][i]; if (c > 0) { s += idf[t] * c; m++; } }
    if (m === 0) continue;
    const cv = T === 1 ? 1 : Math.pow(m / T, P.coverPow);
    s = (s / idfSum) * cv;
    if (usePhrase && (L_dx[i].includes(phrase) || L_xd[i].includes(phrase))) s *= P.phraseBonus;
    if (L_dx[i] === phrase || L_xd[i] === phrase) s *= P.exactBonus;
    lex[i] = s; cov[i] = cv;
    if (s > maxLex) maxLex = s;
  }
  return { lex, cov, maxLex, T };
}

// ---------- facet mask ----------
// Filters must be applied BEFORE the top-K cut. Otherwise a narrow facet (e.g. Breast) can
// return 0 rows for a broad prefix like "sc": the unfiltered top-72 fills with stronger
// matches from other systems and the client-side filter then removes every one of them.
function buildMask(filters) {
  const sysArr = filters && filters.sys;
  const exArr = filters && filters.srcEx;
  if ((!sysArr || !sysArr.length) && (!exArr || !exArr.length)) return null;
  const sys = sysArr && sysArr.length ? new Set(sysArr) : null;
  const ex = exArr && exArr.length ? new Set(exArr) : null;
  const mask = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const c = cards[i];
    mask[i] = (!sys || (c.s && sys.has(c.s))) && (!ex || !c.src || !ex.has(c.src)) ? 1 : 0;
  }
  return mask;
}

// ---------- keyword search (instant, no model) ----------
function keywordSearch(query, limit, filters) {
  const { lex, T } = lexicalPass(query);
  if (T === 0) return [];
  const mask = buildMask(filters);
  if (mask) for (let i = 0; i < N; i++) if (!mask[i]) lex[i] = 0;
  const hits = topK(lex, limit, 0).map(h => ({ iIdx: h.i, s: h.s }));
  return hydrate(hits);
}

// ---------- semantic search (cosine base + graded lexical boost) ----------
async function semanticSearch(query, limit, filters) {
  const qv = await textToVector(query);
  const { lex, cov, maxLex, T } = lexicalPass(query);
  const invMax = maxLex > 0 ? 1 / maxLex : 0;
  const gradedW = P.B * (1 - P.floor), floorW = P.B * P.floor;
  const mask = buildMask(filters);
  const scores = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    if (mask && !mask[i]) { scores[i] = -2; continue; }   // excluded: below topK's floor
    const base = i * DIM;
    let dot = 0;
    for (let j = 0; j < DIM; j++) dot += qv[j] * vectors[base + j];
    if (T > 0 && cov[i] > 0) dot += floorW * cov[i] + gradedW * lex[i] * invMax;
    scores[i] = dot;
  }
  const hits = topK(scores, limit, -2).map(h => ({ iIdx: h.i, s: h.s }));
  return hydrate(hits);
}

// ---------- message handling ----------
self.onmessage = async (ev) => {
  const msg = ev.data || {};
  try {
    if (msg.type === 'init') {
      self.postMessage({ type: 'status', message: 'Loading pathology database…' });
      const info = await loadData();
      self.postMessage({ type: 'dataReady', count: cards.length, ms: info.ms, cached: info.cached });
      // semantic needs the vectors AND the model — both load in the background while
      // keyword search is already live
      Promise.all([vectorsLoading, initEmbedder()])
        .then(() => { semanticReady = true; self.postMessage({ type: 'semanticReady' }); })
        .catch(err => self.postMessage({ type: 'semanticError', error: String(err) }));
      return;
    }

    if (msg.type === 'search') {
      const { query, mode, limit = 60, searchId, filters } = msg;
      if (!dataReady) { self.postMessage({ type: 'results', searchId, results: [], mode, notReady: true, _q: query }); return; }
      const t0 = performance.now();
      let results, usedMode = mode;
      if (mode === 'semantic' && semanticReady) {
        results = await semanticSearch(query, limit, filters);
      } else {
        results = keywordSearch(query, limit, filters);
        usedMode = 'keyword';
      }
      self.postMessage({ type: 'results', searchId, results, mode: usedMode, ms: performance.now() - t0, _q: query });
      return;
    }
  } catch (err) {
    self.postMessage({ type: 'results', searchId: msg.searchId, error: String(err), results: [] });
  }
};
