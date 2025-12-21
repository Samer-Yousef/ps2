export interface SearchResult {
  id: number;
  text: string;
  diagnosis: string;
  organ: string;
  system: string;
  site: string;
  similarity: number;
  metadata: Record<string, any>;
}

export interface PerformanceMetrics {
  mode: 'client' | 'api';
  searchTime: number;      // Core search execution time (ms)
  embeddingTime?: number;  // Text-to-vector time (ms)
  totalTime: number;       // End-to-end time (ms)
  resultCount: number;
}

export interface SearchResponse {
  results: SearchResult[];
  performance: PerformanceMetrics;
  query: string;
}
