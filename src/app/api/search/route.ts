import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

interface VectorEntry {
  id: number;
  text: string;
  vector: number[];
  category: string;
  timestamp: string;
  metadata: {
    source: string;
    author: string;
    views: number;
    rating: number;
  };
}

// Simple text to vector (mock embedding - in production use a real model)
function textToVector(text: string, dimensions = 384): number[] {
  const vector: number[] = [];
  const seed = text.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  
  for (let i = 0; i < dimensions; i++) {
    // Simple pseudo-random based on text
    const value = Math.sin(seed * (i + 1) * 0.1) * Math.cos(seed * (i + 2) * 0.05);
    vector.push(value);
  }
  
  // Normalize
  const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
  return vector.map((v: number) => v / magnitude);
}

// Cosine similarity
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  let dotProduct = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;
  
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    magnitudeA += vecA[i] * vecA[i];
    magnitudeB += vecB[i] * vecB[i];
  }
  
  magnitudeA = Math.sqrt(magnitudeA);
  magnitudeB = Math.sqrt(magnitudeB);
  
  if (magnitudeA === 0 || magnitudeB === 0) return 0;
  return dotProduct / (magnitudeA * magnitudeB);
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get('q');
    const limit = parseInt(searchParams.get('limit') || '10', 10);
    
    if (!query) {
      return NextResponse.json({ error: 'Query parameter "q" is required' }, { status: 400 });
    }
    
    // Load vector database
    const dbPath = path.join(process.cwd(), 'public', 'dummy_vectordb.json');
    const dbData = JSON.parse(fs.readFileSync(dbPath, 'utf-8')) as VectorEntry[];
    
    // Convert query to vector
    const queryVector = textToVector(query);
    
    // Calculate similarities
    const results = dbData.map((entry: VectorEntry) => ({
      ...entry,
      similarity: cosineSimilarity(queryVector, entry.vector),
      // Don't send full vector back to client
      vector: undefined
    }));
    
    // Sort by similarity and limit results
    results.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
    const topResults = results.slice(0, limit);
    
    return NextResponse.json({
      query,
      results: topResults,
      total: dbData.length
    });
    
  } catch (error) {
    console.error('Search error:', error);
    return NextResponse.json(
      { error: 'Failed to perform search' },
      { status: 500 }
    );
  }
}
