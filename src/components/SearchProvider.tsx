'use client';

import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';

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

interface SearchContextType {
  worker: Worker | null;
  workerReady: boolean;
  initStatus: string;
  search: (query: string, limit?: number) => Promise<SearchResult[]>;
}

const SearchContext = createContext<SearchContextType | undefined>(undefined);

export function SearchProvider({ children }: { children: ReactNode }) {
  const workerRef = useRef<Worker | null>(null);
  const [workerReady, setWorkerReady] = useState(false);
  const [initStatus, setInitStatus] = useState('Initializing...');
  const searchCallbacksRef = useRef<Map<number, { resolve: (results: SearchResult[]) => void; reject: (error: Error) => void }>>(new Map());
  const searchIdRef = useRef(0);

  useEffect(() => {
    // Only create worker once
    if (workerRef.current) return;

    try {
      const w = new Worker('/searchWorker.js');
      workerRef.current = w;
      w.postMessage({ type: 'init' });

      w.onmessage = (ev) => {
        const msg = ev.data || {};

        if (msg.type === 'status') {
          setInitStatus(msg.message);
        }

        if (msg.type === 'inited') {
          if (msg.status === 'ok') {
            setWorkerReady(true);
            setInitStatus(`Ready • ${msg.numEntries.toLocaleString()} cases loaded`);
          } else {
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
              callback.resolve(msg.results || []);
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

  const search = async (query: string, limit: number = 24000): Promise<SearchResult[]> => {
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
      search
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
