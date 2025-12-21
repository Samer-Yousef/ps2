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
  searchTime: number;         // Core search execution time (ms)
  embeddingTime?: number;     // Text-to-vector time (ms)
  totalTime: number;          // Server-side or worker total time (ms)
  resultCount: number;
  // Client-side telemetry (for API mode)
  networkTime?: number;       // Network round-trip time (ms)
  clientTotalTime?: number;   // Complete end-to-end time including network (ms)
}

export interface SearchResponse {
  results: SearchResult[];
  performance: PerformanceMetrics;
  query: string;
}
