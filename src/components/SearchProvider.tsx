'use client';

import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { PerformanceMetrics } from '@/types/search';
import { trackDatabaseLoad, getVisitorId } from '@/lib/analytics';

interface SearchResult {
  id: number;
  text: string;
  diagnosis: string;
  organ: string;
  system: string;
  site: string;
  similarity: number;
  metadata: any;
}

interface SearchResponse {
  results: SearchResult[];
  performance: PerformanceMetrics;
}

interface SearchContextType {
  worker: Worker | null;
  workerReady: boolean;
  initStatus: string;
  search: (query: string, limit?: number) => Promise<SearchResponse>;
  dbLoadTimeMs: number | null;
}

const SearchContext = createContext<SearchContextType | undefined>(undefined);

export function SearchProvider({ children }: { children: ReactNode }) {
  const workerRef = useRef<Worker | null>(null);
  const [workerReady, setWorkerReady] = useState(false);
  const [initStatus, setInitStatus] = useState('Initializing...');
  const [dbLoadTimeMs, setDbLoadTimeMs] = useState<number | null>(null);
  const searchCallbacksRef = useRef<Map<number, { resolve: (response: SearchResponse) => void; reject: (error: Error) => void }>>(new Map());
  const searchIdRef = useRef(0);
  const dbLoadStartTimeRef = useRef<number | null>(null);

  useEffect(() => {
    // Only create worker once
    if (workerRef.current) return;

    // Since the 2026-08-03 cutover the root interface ships its own optimized worker +
    // dataset (/v2-data). The legacy 83MB worker is only needed by the pages that still
    // use useSearch(): /old (the previous interface) and /test.
    if (typeof window !== 'undefined' && !/^\/(old|test)\b/.test(window.location.pathname)) {
      setInitStatus('Skipped: this route does not use the legacy database');
      return;
    }

    try {
      const w = new Worker('/searchWorker.js');
      workerRef.current = w;

      // Track when database loading starts
      dbLoadStartTimeRef.current = performance.now();

      // Log DB download start to local file
      fetch('/api/log-db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'DB_START', detail: 'Database download started', visitorId: getVisitorId() }),
      }).catch(() => {});

      // Log each second of loading
      let dbLoadSeconds = 0;
      const dbLoadInterval = setInterval(() => {
        dbLoadSeconds++;
        fetch('/api/log-db', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event: 'DB_LOADING', detail: `${dbLoadSeconds}s elapsed`, visitorId: getVisitorId() }),
        }).catch(() => {});
      }, 1000);

      w.postMessage({ type: 'init' });

      w.onmessage = (ev) => {
        const msg = ev.data || {};

        if (msg.type === 'status') {
          setInitStatus(msg.message);
        }

        if (msg.type === 'inited') {
          if (msg.status === 'ok') {
            // Stop loading interval
            clearInterval(dbLoadInterval);

            // Calculate database load time
            const loadTime = dbLoadStartTimeRef.current ? performance.now() - dbLoadStartTimeRef.current : 0;
            setDbLoadTimeMs(loadTime);

            // Track database load completion
            trackDatabaseLoad({
              loadTimeMs: loadTime,
              dbSizeEntries: msg.numEntries || 0,
            });

            setWorkerReady(true);
            setInitStatus(`Ready • ${msg.numEntries.toLocaleString()} cases loaded`);
          } else {
            clearInterval(dbLoadInterval);
            setInitStatus('Error loading database');
          }
        }

        if (msg.type === 'results') {
          const searchId = msg.searchId;
          const callback = searchCallbacksRef.current.get(searchId);

          if (callback) {
            searchCallbacksRef.current.delete(searchId);

            if (msg.error) {
              callback.reject(new Error(msg.error));
            } else {
              // Return both results and performance metrics
              callback.resolve({
                results: msg.results || [],
                performance: msg.performance
              });
            }
          }
        }
      };

      w.onerror = () => {
        setInitStatus('Worker failed');
      };
    } catch (err) {
      setInitStatus('Worker unavailable');
    }

    // Don't terminate worker on unmount - we want it to persist!
    return () => {
      // Worker stays alive for the entire session
    };
  }, []);

  const search = async (query: string, limit: number = 24000): Promise<SearchResponse> => {
    if (!workerRef.current || !workerReady) {
      throw new Error('Worker not ready');
    }

    return new Promise((resolve, reject) => {
      const searchId = searchIdRef.current++;
      searchCallbacksRef.current.set(searchId, { resolve, reject });

      workerRef.current!.postMessage({
        type: 'search',
        query,
        limit,
        searchId
      });

      // Timeout after 30 seconds
      setTimeout(() => {
        if (searchCallbacksRef.current.has(searchId)) {
          searchCallbacksRef.current.delete(searchId);
          reject(new Error('Search timeout'));
        }
      }, 30000);
    });
  };

  return (
    <SearchContext.Provider value={{
      worker: workerRef.current,
      workerReady,
      initStatus,
      search,
      dbLoadTimeMs
    }}>
      {children}
    </SearchContext.Provider>
  );
}

export function useSearch() {
  const context = useContext(SearchContext);
  if (context === undefined) {
    throw new Error('useSearch must be used within a SearchProvider');
  }
  return context;
}
