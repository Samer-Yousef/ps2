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
let lastRows = null;         // [[ci, score]] of the last lexical pass, for flat (ungrouped) results
const FLAT_MAX = 300;
const LEX_W = 1.0, SEM_W = 0.5, SEM_MIN_COS = 0.35;
const LABEL_W = 0.6;         // cases whose diagnosis label itself carries every typed word form the top tier
   // rerank: keyword evidence dominates, cosine orders within and fills after
let recs = null;              // differential families (recs.json) for "Also consider"
let catOf = null, organOf = null;
let organLex = null, systemLex = null;   // phrase -> [organ names] / [system names]
const SEM_MIN_GROUPS = 6;     // the server-side semantic pass only runs when keywords found fewer groups than this
const STOP = new Set(['tumour', 'tumours', 'tumor', 'tumors', 'neoplasm', 'neoplasms', 'lesion', 'lesions', 'case', 'cases', 'slide', 'slides', 'of', 'the', 'and', 'in', 'with', 'a', 'an', 'pathology', 'histology', 'histopathology']);
// behaviour words → case category (assigned per case in the catalogue, never inferred from the diagnosis name)
const CAT_LEX = {
  benign: ['benign_neoplasm'], malignant: ['malignant_neoplasm'], cancer: ['malignant_neoplasm'], cancers: ['malignant_neoplasm'],
  borderline: ['borderline_or_low_malignant_potential'], 'low malignant potential': ['borderline_or_low_malignant_potential'],
  inflammatory: ['inflammatory'], inflammation: ['inflammatory'], inflammatory_non: ['inflammatory'],
  infection: ['infectious'], infections: ['infectious'], infectious: ['infectious'], infective: ['infectious'],
  normal: ['normal'], reactive: ['reactive_or_iatrogenic'], iatrogenic: ['reactive_or_iatrogenic'],
  dysplasia: ['precursor_or_dysplasia'], dysplastic: ['precursor_or_dysplasia'], precursor: ['precursor_or_dysplasia'], premalignant: ['precursor_or_dysplasia'],
  congenital: ['developmental_or_congenital'], developmental: ['developmental_or_congenital'],
  degenerative: ['degenerative_or_metabolic'], metabolic: ['degenerative_or_metabolic'],
  'non neoplastic': ['inflammatory', 'other_non_neoplastic', 'infectious', 'reactive_or_iatrogenic', 'degenerative_or_metabolic', 'developmental_or_congenital', 'vascular_or_ischaemic'],
  neoplastic: ['benign_neoplasm', 'malignant_neoplasm', 'borderline_or_low_malignant_potential', 'precursor_or_dysplasia'],
};
const CAT_LABEL = { benign_neoplasm: 'Benign', malignant_neoplasm: 'Malignant', borderline_or_low_malignant_potential: 'Borderline', inflammatory: 'Inflammatory', infectious: 'Infectious', normal: 'Normal', reactive_or_iatrogenic: 'Reactive', precursor_or_dysplasia: 'Precursor / dysplasia', developmental_or_congenital: 'Developmental', degenerative_or_metabolic: 'Degenerative / metabolic', other_non_neoplastic: 'Non-neoplastic', vascular_or_ischaemic: 'Vascular' };
// adjectives and short forms → organ names as used in the catalogue (built on top of the organ names themselves)
const ORGAN_ADJ = {
  ovarian: ['Ovary'], ovaries: ['Ovary'], cutaneous: ['Skin'], dermal: ['Skin'], derm: ['Skin'], mammary: ['Breast'],
  esophageal: ['Oesophagus'], esophagus: ['Oesophagus'], goj: ['Oesophagus'], gej: ['Oesophagus'], 'gastroesophageal junction': ['Oesophagus'],
  hepatic: ['Liver'], renal: ['Kidney'], prostatic: ['Prostate and seminal vesicles'], prostate: ['Prostate and seminal vesicles'],
  vulval: ['Vulva and vagina'], vulvar: ['Vulva and vagina'], vaginal: ['Vulva and vagina'], vulva: ['Vulva and vagina'], vagina: ['Vulva and vagina'],
  nodal: ['Lymph node'], 'lymph nodes': ['Lymph node'], node: ['Lymph node'], nodes: ['Lymph node'],
  pulmonary: ['Lung'], lungs: ['Lung'], cardiac: ['Heart'], cerebral: ['Brain and spinal cord'], brain: ['Brain and spinal cord'], intracranial: ['Brain and spinal cord'], 'spinal cord': ['Brain and spinal cord'],
  ocular: ['Eye and orbit'], eye: ['Eye and orbit'], orbit: ['Eye and orbit'], orbital: ['Eye and orbit'], conjunctiva: ['Eye and orbit'], eyelid: ['Eye and orbit'],
  gastric: ['Stomach'], biliary: ['Gallbladder and bile ducts'], gallbladder: ['Gallbladder and bile ducts'], 'bile duct': ['Gallbladder and bile ducts'], 'bile ducts': ['Gallbladder and bile ducts'],
  bladder: ['Bladder and urinary tract'], vesical: ['Bladder and urinary tract'], urothelial: ['Bladder and urinary tract'], urinary: ['Bladder and urinary tract'], ureter: ['Bladder and urinary tract'], urethra: ['Bladder and urinary tract'],
  testicular: ['Testis and paratestis'], testis: ['Testis and paratestis'], testes: ['Testis and paratestis'], paratestis: ['Testis and paratestis'], epididymis: ['Testis and paratestis'],
  cervical: ['Cervix'], splenic: ['Spleen'], osseous: ['Bone and joints'], bone: ['Bone and joints'], bones: ['Bone and joints'], joint: ['Bone and joints'], joints: ['Bone and joints'], synovium: ['Bone and joints'],
  salivary: ['Salivary glands'], parotid: ['Salivary glands'], submandibular: ['Salivary glands'], pleural: ['Pleura'],
  duodenal: ['Small intestine and ampulla'], duodenum: ['Small intestine and ampulla'], jejunum: ['Small intestine and ampulla'], ileum: ['Small intestine and ampulla'], ileal: ['Small intestine and ampulla'], 'small bowel': ['Small intestine and ampulla'], 'small intestine': ['Small intestine and ampulla'], ampulla: ['Small intestine and ampulla'], ampullary: ['Small intestine and ampulla'],
  pancreatic: ['Pancreas'], penile: ['Penis and scrotum'], penis: ['Penis and scrotum'], scrotal: ['Penis and scrotum'], scrotum: ['Penis and scrotum'],
  uterine: ['Uterus'], endometrial: ['Uterus'], endometrium: ['Uterus'], myometrium: ['Uterus'], myometrial: ['Uterus'],
  marrow: ['Bone marrow'], sinonasal: ['Nasal cavity, sinuses and nasopharynx'], nasal: ['Nasal cavity, sinuses and nasopharynx'], nasopharynx: ['Nasal cavity, sinuses and nasopharynx'], nasopharyngeal: ['Nasal cavity, sinuses and nasopharynx'], sinus: ['Nasal cavity, sinuses and nasopharynx'],
  thymic: ['Mediastinum and thymus'], thymus: ['Mediastinum and thymus'], mediastinal: ['Mediastinum and thymus'], mediastinum: ['Mediastinum and thymus'],
  appendiceal: ['Appendix'], laryngeal: ['Larynx, hypopharynx and trachea'], larynx: ['Larynx, hypopharynx and trachea'], trachea: ['Larynx, hypopharynx and trachea'], tracheal: ['Larynx, hypopharynx and trachea'],
  colonic: ['Colon and rectum'], colon: ['Colon and rectum'], rectal: ['Colon and rectum'], rectum: ['Colon and rectum'], colorectal: ['Colon and rectum'], bowel: ['Colon and rectum', 'Small intestine and ampulla'], 'large bowel': ['Colon and rectum'], intestinal: ['Colon and rectum', 'Small intestine and ampulla'],
  anal: ['Anus'], anus: ['Anus'], tubal: ['Fallopian tube and broad ligament'], fallopian: ['Fallopian tube and broad ligament'], 'fallopian tube': ['Fallopian tube and broad ligament'],
  jaw: ['Jaw and odontogenic'], mandible: ['Jaw and odontogenic'], mandibular: ['Jaw and odontogenic'], maxilla: ['Jaw and odontogenic'], maxillary: ['Jaw and odontogenic'], odontogenic: ['Jaw and odontogenic'], gnathic: ['Jaw and odontogenic'],
  placental: ['Placenta and gestational'], placenta: ['Placenta and gestational'], gestational: ['Placenta and gestational'],
  peritoneal: ['Peritoneum, mesentery and retroperitoneum'], peritoneum: ['Peritoneum, mesentery and retroperitoneum'], mesenteric: ['Peritoneum, mesentery and retroperitoneum'], mesentery: ['Peritoneum, mesentery and retroperitoneum'], retroperitoneal: ['Peritoneum, mesentery and retroperitoneum'], retroperitoneum: ['Peritoneum, mesentery and retroperitoneum'], omentum: ['Peritoneum, mesentery and retroperitoneum'],
  'soft tissue': ['Soft tissue'], 'oral cavity': ['Oral cavity and oropharynx'], oral: ['Oral cavity and oropharynx'], tongue: ['Oral cavity and oropharynx'], mouth: ['Oral cavity and oropharynx'], oropharynx: ['Oral cavity and oropharynx'], tonsil: ['Oral cavity and oropharynx'], tonsillar: ['Oral cavity and oropharynx'],
  pituitary: ['Pituitary'], adrenal: ['Adrenal'], parathyroid: ['Parathyroid'], paraganglia: ['Paraganglia'], ear: ['Ear and temporal bone'], 'temporal bone': ['Ear and temporal bone'],
  thyroid: ['Thyroid'], skin: ['Skin'], breast: ['Breast'], liver: ['Liver'], kidney: ['Kidney'], kidneys: ['Kidney'], lung: ['Lung'], heart: ['Heart'], stomach: ['Stomach'], cervix: ['Cervix'], spleen: ['Spleen'], pleura: ['Pleura'], pancreas: ['Pancreas'], uterus: ['Uterus'], appendix: ['Appendix'], ovary: ['Ovary'], 'lymph node': ['Lymph node'], 'bone marrow': ['Bone marrow'], 'skeletal muscle': ['Skeletal muscle'], 'peripheral nerve': ['Peripheral nerve'], 'blood vessels': ['Blood vessels'], 'peripheral blood': ['Peripheral blood'],
};
const SYSTEM_ADJ = {
  git: ['Gastrointestinal tract'], gi: ['Gastrointestinal tract'], gastrointestinal: ['Gastrointestinal tract'], gut: ['Gastrointestinal tract'], 'gi tract': ['Gastrointestinal tract'],
  gyn: ['Female genital tract'], gynae: ['Female genital tract'], gynaecological: ['Female genital tract'], gynecologic: ['Female genital tract'], gynecological: ['Female genital tract'], 'female genital': ['Female genital tract'],
  heme: ['Haematolymphoid'], haem: ['Haematolymphoid'], hematolymphoid: ['Haematolymphoid'], hematolymphoid_: ['Haematolymphoid'], lymphoid: ['Haematolymphoid'], hematopathology: ['Haematolymphoid'], hemepath: ['Haematolymphoid'],
  'head and neck': ['Head and neck'], 'head neck': ['Head and neck'], ent: ['Head and neck'], endocrine: ['Endocrine'], thoracic: ['Thoracic'], cardiovascular: ['Cardiovascular'], vascular: [],
  neuro: ['Nervous system'], neuropathology: ['Nervous system'], cns: ['Nervous system'], 'nervous system': ['Nervous system'],
  genitourinary: ['Kidney and urinary tract', 'Male genital tract'], gu: ['Kidney and urinary tract', 'Male genital tract'], 'male genital': ['Male genital tract'],
  musculoskeletal: ['Bone and soft tissue'], msk: ['Bone and soft tissue'], 'bone and soft tissue': ['Bone and soft tissue'], hepatobiliary: ['Liver, biliary tract and pancreas'], hpb: ['Liver, biliary tract and pancreas'], dermatopathology: ['Skin'], dermpath: ['Skin'],
};

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
  buildLexicons();
  try { recs = await (await fetch(BASE + 'recs.json', { cache: 'no-cache' })).json(); } catch { recs = null; }
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
  catOf = new Array(N); organOf = new Array(N);
  const pmax = Math.log1p(manifest.pmax || 1);
  for (let ci = 0; ci < N; ci++) {
    const c = cases[ci];
    normD[ci] = norm(c.d); sysOf[ci] = c.s; srcOf[ci] = c.src; catOf[ci] = c.c || ''; organOf[ci] = c.o || '';
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

/* ---------------- query intent: organ / system / behaviour words taken from the case's own metadata ---------------- */
function buildLexicons() {
  organLex = new Map(); systemLex = new Map();
  const addL = (lex, phrase, names) => { const k = norm(phrase); if (!k) return; const cur = lex.get(k) || []; for (const n of names) if (!cur.includes(n)) cur.push(n); lex.set(k, cur); };
  const organs = new Set(), systems = new Set();
  for (let ci = 0; ci < N; ci++) { if (organOf[ci]) organs.add(organOf[ci]); if (sysOf[ci]) systems.add(sysOf[ci]); }
  for (const o of organs) {
    addL(organLex, o, [o]);
    // "Prostate and seminal vesicles" → prostate / seminal vesicles; "(other)" and generic parts are skipped
    for (const part of o.replace(/\(.*?\)/g, '').split(/,| and /)) {
      const k = norm(part);
      if (!k || ['other', 'multiple', 'unspecified sites', 'tract', 'nerve', 'muscle', 'blood', 'vessels', 'broad ligament', 'tissue', 'sinuses', 'hypopharynx', 'temporal bone', 'seminal vesicles'].includes(k)) continue;
      addL(organLex, k, [o]);
    }
  }
  for (const [k, v] of Object.entries(ORGAN_ADJ)) if (v.every((n) => organs.has(n))) addL(organLex, k, v);
  for (const sName of systems) addL(systemLex, sName, [sName]);
  for (const [k, v] of Object.entries(SYSTEM_ADJ)) if (v.length && v.every((n) => systems.has(n))) addL(systemLex, k, v);
}
// returns { text, organs:Set|null, systems:Set|null, cats:Set|null, chips:[{kind,label,word}] }
function parseIntent(qn) {
  const toks = qn ? qn.split(' ') : [];
  const used = new Uint8Array(toks.length);
  const organs = new Set(), systems = new Set(), cats = new Set(), chips = [];
  for (let i = 0; i < toks.length; i++) {
    if (used[i]) continue;
    for (let len = 3; len >= 1; len--) {
      if (i + len > toks.length) continue;
      let busy = false; for (let j = i; j < i + len; j++) if (used[j]) busy = true;
      if (busy) continue;
      const phrase = toks.slice(i, i + len).join(' ');
      let hit = null;
      if (organLex.has(phrase)) { hit = 'organ'; for (const o of organLex.get(phrase)) organs.add(o); chips.push({ kind: 'organ', label: organLex.get(phrase).join(' / '), word: phrase }); }
      else if (systemLex.has(phrase)) { hit = 'system'; for (const s of systemLex.get(phrase)) systems.add(s); chips.push({ kind: 'system', label: systemLex.get(phrase).join(' / '), word: phrase }); }
      else if (CAT_LEX[phrase]) { hit = 'category'; for (const c of CAT_LEX[phrase]) cats.add(c); chips.push({ kind: 'category', label: CAT_LEX[phrase].length === 1 ? CAT_LABEL[CAT_LEX[phrase][0]] : phrase, word: phrase }); }
      if (hit) { for (let j = i; j < i + len; j++) used[j] = 1; break; }
    }
  }
  const rest = toks.filter((t, i) => !used[i]);
  // generic nouns carry no information once something else remains ("papillary tumours" → "papillary")
  const content = rest.filter((t) => !STOP.has(t));
  const text = (content.length ? content : rest.filter((t) => !['of', 'the', 'and', 'in', 'with', 'a', 'an'].includes(t))).join(' ');
  return { text, organs: organs.size ? organs : null, systems: systems.size ? systems : null, cats: cats.size ? cats : null, chips };
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
function search(query, filters, intentOut) {
  const qfull = norm(query);
  const intent = parseIntent(qfull);
  if (intentOut) intentOut.intent = intent;
  const qn = intent.text;
  const sysSet = filters && filters.sys && filters.sys.length ? new Set(filters.sys) : null;
  const srcEx = filters && filters.srcEx && filters.srcEx.length ? new Set(filters.srcEx) : null;
  const { organs, systems, cats } = intent;
  const allowed = (ci) => (!sysSet || sysSet.has(sysOf[ci])) && (!srcEx || !srcEx.has(srcOf[ci]))
    && (!organs || organs.has(organOf[ci])) && (!systems || systems.has(sysOf[ci])) && (!cats || cats.has(catOf[ci]));

  const scores = new Float32Array(N);
  const touched = [];
  if (!qn) {
    // browse mode: only facets ("benign ovary", a system filter) → every matching case, biggest diagnoses first
    if (!sysSet && !organs && !systems && !cats) return [];
    const cnt = new Map();
    for (let ci = 0; ci < N; ci++) if (allowed(ci)) { touched.push(ci); cnt.set(normD[ci], (cnt.get(normD[ci]) || 0) + 1); }
    let cmax = 1; for (const v of cnt.values()) if (v > cmax) cmax = v;
    for (const ci of touched) scores[ci] = 0.2 + 0.8 * Math.log1p(cnt.get(normD[ci])) / Math.log1p(cmax) + 0.3 * popN[ci];
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
  // keyword tier: the diagnosis label itself contains every typed word (last one may be a prefix) → strong preference
  // over cases that only mention the words in a title, qualifier or attached synonym ("Leiomyoblastoma" titled GIST)
  if (T) {
    const labelHas = (lab, tok, last) => {
      let i = lab.indexOf(tok);
      while (i >= 0) {
        const atStart = i === 0 || lab.charCodeAt(i - 1) === 32, e = i + tok.length;
        if (atStart && (last || e === lab.length || lab.charCodeAt(e) === 32)) return true;
        i = lab.indexOf(tok, i + 1);
      }
      return false;
    };
    // an abbreviation counts when the label spells it out ("dcis" → "ductal carcinoma in situ")
    const alts = toks.map((t) => (vocab.abbr[t] || []).map((full) => full.split(' ')));
    const tokHit = (lab, k) => labelHas(lab, toks[k], k === T - 1) || alts[k].some((ws) => ws.every((w) => labelHas(lab, w, false)));
    for (const ci of touched) {
      const lab = normD[ci]; let ok = true;
      for (let k = 0; k < T && ok; k++) if (toks[k] && !tokHit(lab, k)) ok = false;
      if (ok) scores[ci] *= 1 + LABEL_W;
    }
  }
  return rank(scores, touched, qn, allowed);
}

function rank(scores, touched, qn, allowed) {
  let max = 0;
  for (const ci of touched) if (scores[ci] > max) max = scores[ci];
  lastRows = [];
  if (!max) return [];
  const rows = [];
  for (const ci of touched) {
    if (allowed && !allowed(ci)) continue;
    const s = scores[ci] / max;
    if (s < 0.08) continue;
    rows.push([ci, s + POP_W * popN[ci] * s]);
  }
  rows.sort((a, b) => b[1] - a[1] || (cases[b[0]].n || 0) - (cases[a[0]].n || 0));
  lastRows = rows;
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
async function semantic(query, filters, searchId, lexical, rec, intent) {
  if (semAbort) semAbort.abort();
  const ac = new AbortController(); semAbort = ac;
  let data;
  try {
    const r = await fetch('/api/searchv2/semantic?q=' + encodeURIComponent(intent.text || query) + '&k=120', { signal: ac.signal });
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
    if (intent.organs && !intent.organs.has(organOf[ci])) continue;
    if (intent.systems && !intent.systems.has(sysOf[ci])) continue;
    if (intent.cats && !intent.cats.has(catOf[ci])) continue;
    const key = normD[ci];
    if (seen.has(key)) continue;
    let g = extra.get(key);
    if (!g) { if (order.length >= 24) continue; g = { d: cases[ci].d, score: sc, cases: [], total: 0, sem: true }; extra.set(key, g); order.push(g); }
    g.total++; if (g.cases.length < 6) g.cases.push(card(ci, sc));
  }
  if (!order.length) return;
  post({ type: 'results', searchId, query, groups: lexical.concat(order), mode: 'semantic', ms: data.ms, intent: { text: intent.text, chips: intent.chips }, recs: rec });
}
/* ---------------- flat (ungrouped) results: one row per case, like the home page ---------------- */
function flatLexical(rows, browse) {
  if (!browse) return rows.slice(0, FLAT_MAX).map(([ci, s]) => card(ci, s));
  // browse (facets only): no keyword to rank on, so interleave diagnoses round-robin instead of 40 teratomas first
  const byLabel = new Map(); const order = [];
  for (const [ci, s] of rows) { let l = byLabel.get(normD[ci]); if (!l) { l = []; byLabel.set(normD[ci], l); order.push(l); } l.push([ci, s]); }
  const out = [];
  for (let i = 0; out.length < FLAT_MAX && order.some((l) => i < l.length); i++) for (const l of order) if (i < l.length && out.length < FLAT_MAX) out.push(card(l[i][0], l[i][1]));
  return out;
}

// Vector search + keyword rerank. Every case gets lexical evidence (exact word > prefix > fuzzy, from the keyword
// pass) and cosine similarity (server MiniLM vectors). Keyword evidence is weighted so that any case carrying the
// typed words outranks cases that are merely about something similar ("mesothelioma" beats "mesothelium" and
// "mesoappendix"); cosine orders cases within the same keyword tier and fills the tail with semantic neighbours.
async function semanticFlat(query, filters, searchId, rows, rec, intent) {
  if (semAbort) semAbort.abort();
  const ac = new AbortController(); semAbort = ac;
  let data;
  try {
    const r = await fetch('/api/searchv2/semantic?q=' + encodeURIComponent(intent.text || query) + '&k=300', { signal: ac.signal });
    if (!r.ok) return;
    data = await r.json();
  } catch { return; }
  if (ac.signal.aborted) return;
  const sysSet = filters && filters.sys && filters.sys.length ? new Set(filters.sys) : null;
  const srcEx = filters && filters.srcEx && filters.srcEx.length ? new Set(filters.srcEx) : null;
  const allowed = (ci) => (!sysSet || sysSet.has(sysOf[ci])) && (!srcEx || !srcEx.has(srcOf[ci]))
    && (!intent.organs || intent.organs.has(organOf[ci])) && (!intent.systems || intent.systems.has(sysOf[ci])) && (!intent.cats || intent.cats.has(catOf[ci]));
  const idToIdx = idIndex();
  const cos = new Map();
  for (const [id, sc] of data.hits || []) { const ci = idToIdx.get(id); if (ci !== undefined && sc >= SEM_MIN_COS && allowed(ci)) cos.set(ci, sc); }
  const lex = new Map();
  let lmax = 0; for (const [, s] of rows) if (s > lmax) lmax = s;
  for (const [ci, s] of rows) lex.set(ci, lmax ? s / lmax : 0);
  const fused = [];
  for (const [ci, l] of lex) fused.push([ci, LEX_W * l + SEM_W * (cos.get(ci) || 0)]);
  for (const [ci, c] of cos) if (!lex.has(ci)) fused.push([ci, SEM_W * c]);
  fused.sort((a, b) => b[1] - a[1] || (cases[b[0]].n || 0) - (cases[a[0]].n || 0));
  const out = fused.slice(0, FLAT_MAX).map(([ci, s]) => { const c = card(ci, s); if (!lex.has(ci)) c.sem = true; return c; });
  post({ type: 'results', searchId, query, cases: out, mode: 'semantic', ms: data.ms, intent: { text: intent.text, chips: intent.chips }, recs: rec });
}
let _idIndex = null;
function idIndex() { if (!_idIndex) { _idIndex = new Map(); for (let ci = 0; ci < N; ci++) _idIndex.set(cases[ci].i, ci); } return _idIndex; }

/* ---------------- recommendations: other members of the differential family the top result belongs to ---------------- */
function recommend(groups, intent, qfull) {
  if (!recs || !recs.families.length) return null;
  // seeds: the top result's diagnosis, then the typed text. Browse-only queries ("benign ovary") get no recommendations.
  if (!intent.text) return null;
  const seeds = [];
  if (groups.length) seeds.push(norm(groups[0].d));
  seeds.push(intent.text);
  if (qfull !== intent.text) seeds.push(qfull);
  const memberHit = (m, k) => k === m.key || k.startsWith(m.key + ' ');
  // one family: the one whose matched member sits earliest in its curated list (core WHO entities come first,
  // Pathology Outlines differentials last), then the longer match; anchors (popular queries) break remaining ties
  let best = null;
  for (const f of recs.families) {
    for (let i = 0; i < f.members.length; i++) {
      const m = f.members[i];
      for (const k of seeds) {
        if (!memberHit(m, k)) continue;
        const cand = { f, seed: m, idx: i, len: m.key.length, anchored: f.anchors.includes(intent.text) || f.anchors.includes(qfull) };
        if (!best || cand.idx < best.idx || (cand.idx === best.idx && cand.len > best.len)) best = cand;
      }
    }
  }
  if (!best) {
    const f = recs.families.find((x) => x.anchors.includes(intent.text) || x.anchors.includes(qfull));
    if (!f) return null;
    best = { f, seed: null };
  }
  const shown = new Set(groups.slice(0, 3).map((g) => norm(g.d)));
  const items = [];
  for (const m of best.f.members) {
    if (best.seed && m.key === best.seed.key) continue;
    if (shown.has(m.key)) continue;
    items.push({ name: m.name, key: m.key, n: m.n, family: best.f.name });
    if (items.length >= 12) break;
  }
  if (!items.length) return null;
  return { family: best.f.name, seed: best.seed ? best.seed.name : null, items };
}

self.onmessage = async (ev) => {
  const m = ev.data || {};
  if (m.type === 'init') { try { await init(); } catch (e) { post({ type: 'status', message: 'Failed to load: ' + (e && e.message) }); } return; }
  if (m.type === 'search') {
    if (!ready) return;
    const t0 = performance.now();
    const io = {};
    const groups = search(m.query || '', m.filters, io);
    const intent = io.intent || { text: norm(m.query || ''), chips: [] };
    const rec = recommend(groups, intent, norm(m.query || ''));
    if (m.flat) {
      const rows = lastRows || [];
      post({ type: 'results', searchId: m.searchId, query: m.query, cases: flatLexical(rows, !intent.text), mode: 'lexical',
        ms: Math.round((performance.now() - t0) * 10) / 10, intent: { text: intent.text, chips: intent.chips }, recs: rec });
      if (m.semantic && intent.text) semanticFlat(m.query, m.filters, m.searchId, rows, rec, intent);
      return;
    }
    post({ type: 'results', searchId: m.searchId, query: m.query, groups, mode: 'lexical', ms: Math.round((performance.now() - t0) * 10) / 10,
      intent: { text: intent.text, chips: intent.chips }, recs: rec });
    if (m.semantic && intent.text && groups.length < SEM_MIN_GROUPS) semantic(m.query, m.filters, m.searchId, groups, rec, intent);
  }
};
