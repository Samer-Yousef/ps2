// searchWorker.js
// Loads /pathology_vectordb.json once, converts vectors to a typed Float32Array matrix,
// and performs cosine-similarity searches on request.
// Uses Transformers.js for real embeddings in the browser

let entries = null;
let vectors = null;
let numEntries = 0;
let dim = 0;
let initialized = false;
let extractor = null;
let pcaModel = null; // PCA transformation model

// Import Transformers.js dynamically
let TransformersModule = null;

async function initTransformers() {
  if (!TransformersModule) {
    // Use dynamic import instead of importScripts
    const module = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2');
    TransformersModule = module;
    // Disable local model loading, use CDN
    TransformersModule.env.allowLocalModels = false;
  }
  return TransformersModule;
}

async function loadDB() {
  return fetch('/pathology_vectordb_compressed.json')
    .then(res => res.json())
    .then(data => {
      entries = data.map(e => ({ 
        id: e.id, 
        text: e.text, 
        diagnosis: e.diagnosis,
        organ: e.organ,
        system: e.system,
        site: e.site,
        metadata: e.metadata 
      }));
      if (data.length === 0) {
        numEntries = 0;
        dim = 0;
        vectors = new Float32Array(0);
        return;
      }
      numEntries = data.length;
      dim = data[0].vector.length;
      vectors = new Float32Array(numEntries * dim);
      for (let i = 0; i < numEntries; i++) {
        const vec = data[i].vector;
        for (let j = 0; j < dim; j++) {
          vectors[i * dim + j] = vec[j];
        }
      }
    });
}

async function loadPCA() {
  return fetch('/pca_model.json')
    .then(res => res.json())
    .then(data => {
      pcaModel = {
        components: data.components,
        mean: data.mean,
        n_components: data.n_components
      };
    });
}

async function initEmbedder() {
  if (!extractor) {
    const transformers = await initTransformers();
    extractor = await transformers.pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  }
}

async function textToVector(text) {
  if (!extractor) {
    await initEmbedder();
  }
  
  // Get 384-dim embedding from model
  const output = await extractor(text, { pooling: 'mean', normalize: true });
  const fullVector = Array.from(output.data);
  
  // Apply PCA to reduce to 128 dimensions
  if (!pcaModel) {
    throw new Error('PCA model not loaded');
  }
  
  // Center the vector (subtract mean)
  const centered = fullVector.map((val, i) => val - pcaModel.mean[i]);
  
  // Project onto PCA components (matrix multiplication)
  const reduced = new Array(pcaModel.n_components);
  for (let i = 0; i < pcaModel.n_components; i++) {
    let sum = 0;
    for (let j = 0; j < centered.length; j++) {
      sum += centered[j] * pcaModel.components[i][j];
    }
    reduced[i] = sum;
  }
  
  return reduced;
}

function cosineSimilarityFlat(queryVec, vectorsFlat, idx, dim) {
  let dot = 0;
  let magA = 0;
  let base = idx * dim;
  for (let i = 0; i < dim; i++) {
    const v = vectorsFlat[base + i];
    dot += queryVec[i] * v;
    magA += v * v;
  }
  magA = Math.sqrt(magA) || 1;
  return dot / magA;
}

async function search(query, limit = 10) {
  if (!query || query.trim().length === 0) return { results: [] };

  const qv = await textToVector(query);
  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);

  const scores = new Array(numEntries);
  for (let i = 0; i < numEntries; i++) {
    const sim = cosineSimilarityFlat(qv, vectors, i, dim);
    const entry = entries[i];
    const m = entry.metadata || {};

    // Weighted keyword boosting across multiple fields
    let boost = 0;

    // Helper to check for word matches
    const checkField = (fieldValue, weight) => {
      if (!fieldValue) return 0;
      const fieldLower = String(fieldValue).toLowerCase();
      let matchBoost = 0;
      for (const word of queryWords) {
        if (fieldLower.includes(word)) {
          matchBoost += weight;
        }
      }
      return matchBoost;
    };

    // Check primary diagnosis fields (highest weight)
    boost += checkField(m.extracted_diagnosis, 0.20);
    boost += checkField(m.essential_diagnosis, 0.18);

    // Check other important fields
    boost += checkField(m.variant, 0.12);
    boost += checkField(m.lineage, 0.10);
    boost += checkField(m.organ, 0.08);
    boost += checkField(m.microscopic, 0.06);

    // Fallback to top-level fields if metadata missing
    boost += checkField(entry.diagnosis, 0.15);
    boost += checkField(entry.organ, 0.05);
    boost += checkField(entry.system, 0.05);

    // Cap total boost at 0.35 (35%)
    boost = Math.min(boost, 0.35);

    const boostedSim = Math.min(sim + boost, 1.0);
    scores[i] = { idx: i, similarity: boostedSim };
  }
  
  scores.sort((a, b) => b.similarity - a.similarity);
  const top = scores.slice(0, limit).map(s => {
    const entry = entries[s.idx];
    return {
      id: entry.id,
      text: entry.text,
      diagnosis: entry.diagnosis,
      organ: entry.organ,
      system: entry.system,
      site: entry.site,
      similarity: s.similarity,
      metadata: entry.metadata,
    };
  });
  return { results: top };
}

self.addEventListener('message', async (ev) => {
  const msg = ev.data || {};
  if (msg.type === 'init') {
    if (!initialized) {
      try {
        self.postMessage({ type: 'status', message: 'Loading database...' });
        await loadDB();
        self.postMessage({ type: 'status', message: 'Loading PCA model...' });
        await loadPCA();
        self.postMessage({ type: 'status', message: 'Loading embedding model...' });
        await initEmbedder();
        initialized = true;
        self.postMessage({ type: 'inited', status: 'ok', numEntries });
      } catch (err) {
        self.postMessage({ type: 'inited', status: 'error', error: String(err) });
      }
    } else {
      self.postMessage({ type: 'inited', status: 'ok', numEntries });
    }
    return;
  }

  if (msg.type === 'search') {
    if (!initialized) {
      self.postMessage({ type: 'status', message: 'Initializing...' });
      await loadDB();
      await loadPCA();
      await initEmbedder();
      initialized = true;
    }
    const q = msg.query || '';
    const limit = msg.limit || 10;
    try {
      const res = await search(q, limit);
      self.postMessage({ type: 'results', query: q, results: res.results });
    } catch (err) {
      self.postMessage({ type: 'results', error: String(err) });
    }
  }
});
