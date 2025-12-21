import fs from 'fs';
import path from 'path';

// Singleton pattern - load database once and cache in memory
let vectorDB: any[] | null = null;
let pcaModel: any = null;
let embedder: any = null;
let initialized = false;
let initPromise: Promise<void> | null = null;

interface VectorEntry {
  id: number;
  text: string;
  diagnosis: string;
  organ: string;
  system: string;
  site: string;
  vector: number[];
  metadata: Record<string, any>;
}

async function initializeVectorDB() {
  if (initialized) return;

  if (initPromise) {
    // If initialization is already in progress, wait for it
    await initPromise;
    return;
  }

  initPromise = (async () => {
    try {
      console.log('[VectorSearch] Initializing vector database...');

      // Load vector database
      const dbPath = path.join(process.cwd(), 'public', 'pathology_vectordb_compressed.json');
      const dbData = fs.readFileSync(dbPath, 'utf-8');
      vectorDB = JSON.parse(dbData);
      console.log(`[VectorSearch] Loaded ${vectorDB?.length} vector entries`);

      // Load PCA model
      const pcaPath = path.join(process.cwd(), 'public', 'pca_model.json');
      const pcaData = fs.readFileSync(pcaPath, 'utf-8');
      pcaModel = JSON.parse(pcaData);
      console.log(`[VectorSearch] Loaded PCA model with ${pcaModel.n_components} components`);

      // Initialize embedding model
      const { pipeline } = await import('@xenova/transformers');
      embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
      console.log('[VectorSearch] Initialized embedding model');

      initialized = true;
    } catch (error) {
      console.error('[VectorSearch] Initialization error:', error);
      throw error;
    }
  })();

  await initPromise;
}

/**
 * Apply PCA transformation to reduce dimensionality from 384 to 128
 * Must match the exact logic from searchWorker.js
 */
function applyPCA(fullVector: number[], model: any): number[] {
  // Center the vector (subtract mean)
  const centered = fullVector.map((val, i) => val - model.mean[i]);

  // Project onto PCA components (matrix multiplication)
  const reduced = new Array(model.n_components);
  for (let i = 0; i < model.n_components; i++) {
    let sum = 0;
    for (let j = 0; j < centered.length; j++) {
      sum += centered[j] * model.components[i][j];
    }
    reduced[i] = sum;
  }

  return reduced;
}

/**
 * Convert text to vector embedding using the same model as client
 * Returns 128-dimensional vector after PCA reduction
 */
async function textToVector(text: string): Promise<number[]> {
  if (!embedder || !pcaModel) {
    throw new Error('Vector search not initialized');
  }

  // Get 384-dim embedding from model
  const output = await embedder(text, { pooling: 'mean', normalize: true });
  const fullVector = Array.from(output.data) as number[];

  // Apply PCA to reduce to 128 dimensions (match client exactly)
  return applyPCA(fullVector, pcaModel);
}

/**
 * Calculate cosine similarity between two vectors
 * Identical implementation to searchWorker.js
 */
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    magA += vecA[i] * vecA[i];
    magB += vecB[i] * vecB[i];
  }

  magA = Math.sqrt(magA) || 1;
  magB = Math.sqrt(magB) || 1;

  return dot / (magA * magB);
}

/**
 * Calculate keyword boost for an entry based on query words
 * Replicates exact boosting logic from searchWorker.js
 */
function calculateKeywordBoost(entry: VectorEntry, queryWords: string[]): number {
  const m = entry.metadata || {};
  let boost = 0;

  // Helper to check for word matches in a field
  const checkField = (fieldValue: any, weight: number): number => {
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
  return Math.min(boost, 0.35);
}

/**
 * Perform vector search with keyword boosting
 * Returns results with timing metrics
 */
export async function performVectorSearch(query: string, limit: number = 10) {
  // Ensure database is initialized
  await initializeVectorDB();

  if (!vectorDB) {
    throw new Error('Vector database not loaded');
  }

  if (!query || query.trim().length === 0) {
    return {
      results: [],
      embeddingTime: 0,
      searchTime: 0
    };
  }

  // Track embedding time
  const embeddingStart = performance.now();
  const queryVector = await textToVector(query);
  const embeddingTime = performance.now() - embeddingStart;

  // Track search time
  const searchStart = performance.now();
  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);

  // Calculate similarity scores with keyword boosting
  const scores = vectorDB.map((entry, idx) => {
    const sim = cosineSimilarity(queryVector, entry.vector);
    const boost = calculateKeywordBoost(entry, queryWords);
    const boostedSim = Math.min(sim + boost, 1.0);

    return { idx, similarity: boostedSim };
  });

  // Sort by similarity and get top results
  scores.sort((a, b) => b.similarity - a.similarity);
  const topScores = scores.slice(0, limit);

  // Build result objects
  const results = topScores.map(s => {
    const entry = vectorDB![s.idx];
    return {
      id: entry.id,
      text: entry.text,
      diagnosis: entry.diagnosis,
      organ: entry.organ,
      system: entry.system,
      site: entry.site,
      similarity: s.similarity,
      metadata: entry.metadata
    };
  });

  const searchTime = performance.now() - searchStart;

  return {
    results,
    embeddingTime,
    searchTime
  };
}
