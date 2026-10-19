/* /searchv2 search worker.
 *
 * Loads cases.json + vocab.json (built by scripts/searchv2/build-index.py), builds an in-memory
 * word index and a sorted vocabulary, and answers every keystroke from memory. Data is cached in
 * IndexedDB keyed on manifest.version so repeat visits never re-download.
 *
 * Messages in:  {type:'init'} | {type:'search', query, filters:{sys:[],srcEx:[]}, searchId, semantic:bool}
 * Messages out: status/progress/dataReady/results — see useSearchV2.ts
 *
 * Ranking (lexical, every keystroke):
 *   per query token: exact word (1.0) > prefix word (0.85) > fuzzy word (0.55), each × field weight × idf
 *   score = Σ token best × coverage²  + vocabulary-term bonus (whole query equals / prefixes a known
 *   diagnosis term, incl. abbreviations and synonyms) + small popularity prior (click log).
 * Results are grouped by diagnosis label; the group's score is its best case.
 *
 * norm() MUST match build-index.py.
 */
'use strict';

const BASE = '/searchv2-data/';
const DB_NAME = 'psv2-search', STORE = 'kv';
const FIELDS = [['d', 1.0], ['t', 0.9], ['q', 0.5], ['sd', 0.45], ['o', 0.4], ['s', 0.3], ['src', 0.3]];
const TERM_FIELD_W = 0.8;                 // words of who/dx/synonym terms attached to a case
const KIND_W = { label: 1, title: 0.8, dx: 0.85, who: 0.8, syn: 0.9 };
const W_EXACT = 1.0, W_PREFIX = 0.85, W_FUZZY = 0.55;
const PREFIX_CAP = 400;                   // most frequent words considered for one prefix
const TERM_CAP = 300;
const TERM_EXACT_BONUS = 2.2, TERM_PREFIX_BONUS = 1.0;
const POP_W = 0.12, GROUP_W = 0.07;
const MAX_GROUPS = 60, MAX_CASES = 400, GROUP_CAP = 40;

let cases = null, vocab = null, manifest = null;
let N = 0;
let words = null;            // sorted unique words
let wordIds = null;          // Map word -> index into postings
let postIds = null, postW = null, postOff = null, df = null, idf = null;
let termNorms = null;        // sorted (vocab.terms is sorted by norm already)
let termIndex = null;        // Map norm -> term idx
let normD = null;            // normalised label per case (group key)
let popN = null;             // popularity prior 0..1 per case
let sysOf = null, srcOf = null;
let labelWords = null;       // words in the label, for the length-fit factor
let ready = false;
const fuzzyCache = new Map();
let semAbort = null;

function norm(s) {
  s = (s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\x00-\x7f]/g, '').toLowerCase();
  s = s.replace(/tumour/g, 'tumor').replace(/oe/g, 'e').replace(/ae/g, 'e');
  s = s.replace(/[^a-z0-9]+/g, ' ').trim();
  return s.replace(/\s+/g, ' ');
}

/* ---------------- loading ---------------- */
function post(o) { self.postMessage(o); }
function progress(pct, phase, step) { post({ type: 'progress', pct: Math.round(pct), phase, step }); }

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbGet(k) {
  try { const d = await idb(); return await new Promise((res) => { const q = d.transaction(STORE).objectStore(STORE).get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(undefined); }); }
  catch { return undefined; }
}
async function idbSet(k, v) {
  try { const d = await idb(); await new Promise((res) => { const t = d.transaction(STORE, 'readwrite'); t.objectStore(STORE).put(v, k); t.oncomplete = res; t.onerror = res; }); }
  catch { /* ignore */ }
}

async function fetchText(name, onPct, pctFrom, pctTo) {
  const r = await fetch(BASE + name, { cache: 'no-cache' });
  if (!r.ok) throw new Error(name + ' ' + r.status);
  const total = Number(r.headers.get('content-length')) || 0;
  if (!r.body || !total) return r.text();
  const reader = r.body.getReader(); const chunks = []; let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); got += value.length;
    onPct(pctFrom + (pctTo - pctFrom) * Math.min(1, got / total));
  }
  const buf = new Uint8Array(got); let o = 0; for (const c of chunks) { buf.set(c, o); o += c.length; }
  return new TextDecoder().decode(buf);
}

async function init() {
  const t0 = performance.now();
  post({ type: 'status', message: 'Loading…' });
  progress(2, 'Checking for updates…', 1);
  manifest = await (await fetch(BASE + 'manifest.json', { cache: 'no-cache' })).json();
  const cached = await idbGet('version');
  let cj, vj;
  if (cached === manifest.version) {
    progress(30, 'Loading cached cases…', 1);
    cj = await idbGet('cases'); vj = await idbGet('vocab');
  }
  if (!cj || !vj) {
    progress(5, 'Downloading cases…', 1);
    cj = await fetchText('cases.json', (p) => progress(p, 'Downloading cases…', 1), 5, 55);
    vj = await fetchText('vocab.json', (p) => progress(p, 'Downloading vocabulary…', 1), 55, 62);
    idbSet('cases', cj); idbSet('vocab', vj); idbSet('version', manifest.version);
  }
  progress(64, 'Parsing…', 2);
  cases = JSON.parse(cj); vocab = JSON.parse(vj); cj = vj = null;
  N = cases.length;
  progress(72, 'Indexing…', 3);
  await new Promise((r) => setTimeout(r, 0));
  buildIndex();
  ready = true;
  progress(100, 'Ready', 3);
  post({ type: 'dataReady', count: N, ms: Math.round(performance.now() - t0), version: manifest.version,
    systems: manifest.systems, sources: manifest.sources });
}

function buildIndex() {
  // word -> Map(caseIdx -> best field weight)
  const acc = new Map();
  const add = (w, ci, fw) => {
    let m = acc.get(w);
    if (!m) { m = new Map(); acc.set(w, m); }
    const cur = m.get(ci);
    if (cur === undefined || fw > cur) m.set(ci, fw);
  };
  normD = new Array(N); popN = new Float32Array(N); sysOf = new Array(N); srcOf = new Array(N); labelWords = new Uint8Array(N);
  const pmax = Math.log1p(manifest.pmax || 1);
  for (let ci = 0; ci < N; ci++) {
    const c = cases[ci];
    normD[ci] = norm(c.d); sysOf[ci] = c.s; srcOf[ci] = c.src;
    labelWords[ci] = Math.min(255, normD[ci] ? normD[ci].split(' ').length : 1);
    popN[ci] = c.p ? Math.log1p(c.p) / pmax : 0;
    for (const [f, fw] of FIELDS) {
      const v = c[f]; if (!v) continue;
      const n = f === 'd' ? normD[ci] : norm(v);
      if (!n) continue;
      for (const w of n.split(' ')) add(w, ci, fw);
    }
  }
  // vocabulary terms: who/dx/syn words become searchable text for their cases
  termNorms = new Array(vocab.terms.length); termIndex = new Map();
  for (let ti = 0; ti < vocab.terms.length; ti++) {
    const t = vocab.terms[ti]; termNorms[ti] = t[0]; termIndex.set(t[0], ti);
    const kind = t[2];
    if (kind === 'label' || kind === 'title') continue;
    const ws = t[0].split(' ');
    for (const ci of t[3]) for (const w of ws) add(w, ci, TERM_FIELD_W);
  }
  words = [...acc.keys()].sort();
  wordIds = new Map(); df = new Int32Array(words.length); idf = new Float32Array(words.length);
  postOff = new Int32Array(words.length + 1);
  let total = 0;
  for (let i = 0; i < words.length; i++) { wordIds.set(words[i], i); const m = acc.get(words[i]); df[i] = m.size; postOff[i] = total; total += m.size; idf[i] = Math.log(1 + N / m.size) / Math.log(1 + N); }
  postOff[words.length] = total;
  postIds = new Int32Array(total); postW = new Float32Array(total);
  for (let i = 0; i < words.length; i++) {
    let o = postOff[i];
    for (const [ci, fw] of acc.get(words[i])) { postIds[o] = ci; postW[o] = fw; o++; }
  }
}

/* ---------------- matching helpers ---------------- */
function lowerBound(arr, s) { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < s) lo = m + 1; else hi = m; } return lo; }
function prefixRange(arr, p) { const a = lowerBound(arr, p); const b = lowerBound(arr, p + '￿'); return [a, b]; }

// bounded Damerau-Levenshtein (transpositions count 1), early exit above max
function editDist(a, b, max) {
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  let prev2 = null, prev = new Int32Array(lb + 1), cur = new Int32Array(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    cur[0] = i; let rowMin = i;
    const ai = a.charCodeAt(i - 1);
    for (let j = 1; j <= lb; j++) {
      const cost = ai === b.charCodeAt(j - 1) ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && ai === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === b.charCodeAt(j - 1)) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v; if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    const spare = prev2 || new Int32Array(lb + 1);
    prev2 = prev; prev = cur; cur = spare;
  }
  return prev[lb];
}
function fuzzyWords(tok) {
  const c = fuzzyCache.get(tok); if (c) return c;
  const max = tok.length >= 8 ? 2 : 1;
  const out = [];
  if (tok.length >= 4) {
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (Math.abs(w.length - tok.length) > max) continue;
      if (w.charCodeAt(0) !== tok.charCodeAt(0) && w.charCodeAt(1) !== tok.charCodeAt(1)) continue;
      const d = editDist(tok, w, max);
      if (d <= max) out.push([i, d]);
    }
    out.sort((x, y) => x[1] - y[1] || df[y[0]] - df[x[0]]);
    if (out.length > 60) out.length = 60;
  }
  if (fuzzyCache.size > 500) fuzzyCache.clear();
  fuzzyCache.set(tok, out);
  return out;
}

// candidate words for one query token: [[wordIdx, weight], …]
function candidates(tok, isLast) {
  const out = [];
  const exact = wordIds.get(tok);
  if (exact !== undefined) out.push([exact, W_EXACT]);
  if (tok.length >= 2) {
    const [a, b] = prefixRange(words, tok);
    let range = [];
    for (let i = a; i < b; i++) if (i !== exact) range.push(i);
    if (range.length > PREFIX_CAP) { range.sort((x, y) => df[y] - df[x]); range.length = PREFIX_CAP; }
    for (const i of range) {
      // longer completions are a little less certain; earlier tokens that are only prefixes count less
      const extra = words[i].length - tok.length;
      out.push([i, (isLast ? W_PREFIX : W_PREFIX * 0.9) * Math.max(0.6, 1 - extra * 0.03)]);
    }
  }
  if (out.length === 0 || (exact === undefined && out.length < 3)) {
    for (const [i, d] of fuzzyWords(tok)) out.push([i, W_FUZZY / d]);
  }
  return out;
}

// vocabulary-term matches for the whole query: [[termIdx, strength], …]
function termMatches(qn) {
  const out = [];
  const ex = termIndex.get(qn);
  if (ex !== undefined) out.push([ex, 1]);
  const [a, b] = prefixRange(termNorms, qn);
  let cnt = 0;
  for (let i = a; i < b && cnt < TERM_CAP; i++) { if (i === ex) continue; out.push([i, 0.6 * Math.pow(qn.length / termNorms[i].length, 0.15)]); cnt++; }
  // word-boundary prefix inside a term ("capillary h" → "lobular capillary hemangioma") only for short queries
  // is handled by word matching; abbreviations expand to their terms
  const ab = vocab.abbr[qn];
  if (ab) for (const full of ab) { const ti = termIndex.get(full); if (ti !== undefined) out.push([ti, 1]); }
  return out;
}

/* ---------------- search ---------------- */
function search(query, filters) {
  const qn = norm(query);
  const sysSet = filters && filters.sys && filters.sys.length ? new Set(filters.sys) : null;
  const srcEx = filters && filters.srcEx && filters.srcEx.length ? new Set(filters.srcEx) : null;
  const allowed = (ci) => (!sysSet || sysSet.has(sysOf[ci])) && (!srcEx || !srcEx.has(srcOf[ci]));

  const scores = new Float32Array(N);
  const touched = [];
  if (!qn) {
    // browse mode: a system filter with no text → everything in it, popular first
    if (!sysSet) return [];
    for (let ci = 0; ci < N; ci++) if (allowed(ci)) { scores[ci] = 0.001 + popN[ci]; touched.push(ci); }
    return rank(scores, touched, qn);
  }

  // abbreviation at token level: "dcis breast" → expand the token
  let toks = qn.length >= 3 ? qn.split(' ') : [];   // 1–2 letters: vocabulary prefix only
  const expanded = [];
  for (const t of toks) {
    const ab = vocab.abbr[t];
    if (ab && t.length <= 6 && wordIds.get(t) === undefined) expanded.push(...ab[0].split(' ')); else expanded.push(t);
  }
  toks = expanded;
  const T = toks.length;
  const mask = new Uint8Array(N);
  const tokBest = new Float32Array(N);
  const touchedTok = [];
  for (let k = 0; k < T; k++) {
    const tok = toks[k];
    if (!tok) continue;
    const cands = candidates(tok, k === T - 1);
    touchedTok.length = 0;
    for (const [wi, ww] of cands) {
      const base = ww * idf[wi];
      for (let o = postOff[wi], e = postOff[wi + 1]; o < e; o++) {
        const ci = postIds[o]; const s = base * postW[o];
        if (tokBest[ci] === 0) touchedTok.push(ci);
        if (s > tokBest[ci]) tokBest[ci] = s;
      }
    }
    for (const ci of touchedTok) {
      if (scores[ci] === 0 && mask[ci] === 0) touched.push(ci);
      scores[ci] += tokBest[ci]; mask[ci] += 1; tokBest[ci] = 0;
    }
  }
  // coverage²: every token should hit; partial matches sink
  if (T) for (const ci of touched) { const cov = mask[ci] / T; scores[ci] *= cov * cov; }

  // whole-query vocabulary bonus (diagnosis names, synonyms, abbreviations): best single term only
  const termBest = new Float32Array(N); const termTouched = [];
  for (const [ti, strength] of termMatches(qn)) {
    const t = vocab.terms[ti];
    const bonus = (strength >= 1 ? TERM_EXACT_BONUS : TERM_PREFIX_BONUS * strength) * (KIND_W[t[2]] || 0.8);
    for (const ci of t[3]) { if (termBest[ci] === 0) termTouched.push(ci); if (bonus > termBest[ci]) termBest[ci] = bonus; }
  }
  for (const ci of termTouched) { if (scores[ci] === 0) touched.push(ci); scores[ci] += termBest[ci]; }
  // length fit: a label much longer than the query is a weaker answer than the plain one
  const qw = Math.max(1, T || 1) + 0.5;   // the last token is usually still being typed
  for (const ci of touched) scores[ci] *= 0.72 + 0.28 * Math.min(1, qw / labelWords[ci]);
  return rank(scores, touched, qn, allowed);
}

function rank(scores, touched, qn, allowed) {
  let max = 0;
  for (const ci of touched) if (scores[ci] > max) max = scores[ci];
  if (!max) return [];
  const rows = [];
  for (const ci of touched) {
    if (allowed && !allowed(ci)) continue;
    const s = scores[ci] / max;
    if (s < 0.08) continue;
    rows.push([ci, s + POP_W * popN[ci] * s]);
  }
  rows.sort((a, b) => b[1] - a[1] || (cases[b[0]].n || 0) - (cases[a[0]].n || 0));
  // group by diagnosis label, keeping first-seen (best) order
  const groups = new Map(); const order = [];
  let ncases = 0;
  for (const [ci, s] of rows) {
    const key = normD[ci];
    let g = groups.get(key);
    if (!g) {
      if (order.length >= MAX_GROUPS) continue;
      g = { d: cases[ci].d, score: s, cases: [], total: 0 }; groups.set(key, g); order.push(g);
    }
    g.total++;
    if (g.cases.length === 0 || (ncases < MAX_CASES && g.cases.length < GROUP_CAP)) { g.cases.push(card(ci, s)); ncases++; }
  }
  // the canonical label is usually the big group: nudge by group size, then re-sort (stable)
  for (const g of order) g.score = g.score * (1 + GROUP_W * Math.log1p(g.total));
  order.sort((a, b) => b.score - a.score);
  return order;
}

function card(ci, s) {
  const c = cases[ci];
  return { i: c.i, d: c.d, t: c.t, o: c.o, s: c.s, sd: c.sd, q: c.q, src: c.src, u: c.u, n: c.n, h: c.h, ag: c.ag, sx: c.sx, c: c.c, _score: Math.round(s * 1000) / 1000 };
}

/* ---------------- semantic upgrade (server) ---------------- */
async function semantic(query, filters, searchId, lexical) {
  if (semAbort) semAbort.abort();
  const ac = new AbortController(); semAbort = ac;
  let data;
  try {
    const r = await fetch('/api/searchv2/semantic?q=' + encodeURIComponent(query) + '&k=120', { signal: ac.signal });
    if (!r.ok) return;
    data = await r.json();
  } catch { return; }
  if (ac.signal.aborted) return;
  const sysSet = filters && filters.sys && filters.sys.length ? new Set(filters.sys) : null;
  const srcEx = filters && filters.srcEx && filters.srcEx.length ? new Set(filters.srcEx) : null;
  const seen = new Set();
  for (const g of lexical) seen.add(norm(g.d));
  const idToIdx = idIndex();
  const extra = new Map(); const order = [];
  for (const [id, sc] of data.hits || []) {
    const ci = idToIdx.get(id); if (ci === undefined) continue;
    if (sysSet && !sysSet.has(sysOf[ci])) continue;
    if (srcEx && srcEx.has(srcOf[ci])) continue;
    const key = normD[ci];
    if (seen.has(key)) continue;
    let g = extra.get(key);
    if (!g) { if (order.length >= 24) continue; g = { d: cases[ci].d, score: sc, cases: [], total: 0, sem: true }; extra.set(key, g); order.push(g); }
    g.total++; if (g.cases.length < 6) g.cases.push(card(ci, sc));
  }
  if (!order.length) return;
  post({ type: 'results', searchId, query, groups: lexical.concat(order), mode: 'semantic', ms: data.ms });
}
let _idIndex = null;
function idIndex() { if (!_idIndex) { _idIndex = new Map(); for (let ci = 0; ci < N; ci++) _idIndex.set(cases[ci].i, ci); } return _idIndex; }

self.onmessage = async (ev) => {
  const m = ev.data || {};
  if (m.type === 'init') { try { await init(); } catch (e) { post({ type: 'status', message: 'Failed to load: ' + (e && e.message) }); } return; }
  if (m.type === 'search') {
    if (!ready) return;
    const t0 = performance.now();
    const groups = search(m.query || '', m.filters);
    post({ type: 'results', searchId: m.searchId, query: m.query, groups, mode: 'lexical', ms: Math.round((performance.now() - t0) * 10) / 10 });
    if (m.semantic && norm(m.query)) semantic(m.query, m.filters, m.searchId, groups);
  }
};
