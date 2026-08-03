'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface Card {
  i: number;          // id
  ci?: string;        // case_id (shared with the main site's history/favorites)
  dx: string;         // diagnosis
  o?: string;         // organ
  s?: string;         // system
  xd?: string;        // extracted diagnosis
  st?: string;        // site
  v?: string;         // variant
  l?: string;         // lineage
  mic?: string;       // microscopic
  ch?: string;        // clinical history
  stn?: string;       // stain
  ti?: string;        // tissue
  src?: string;       // source
  u?: string;         // url
  sx?: string;        // sex
  ag?: number;        // age
  k: string;          // keyword blob
  _score?: number;
}

export type SearchMode = 'keyword' | 'semantic';

interface Meta {
  status: 'booting' | 'loading' | 'ready';
  count: number;
  semantic: boolean;      // semantic model finished loading
  loadMs: number | null;
  searchMs: number | null;
  mode: SearchMode | null;
  progress: number;       // 0-100, real download/parse/index progress
  phase: string;          // human label for the current loading phase
  step: number;           // 1..3
}

const SEMANTIC_DEBOUNCE_MS = 130;

export function useV2Search() {
  const workerRef = useRef<Worker | null>(null);
  const [meta, setMeta] = useState<Meta>({
    status: 'booting', count: 0, semantic: false, loadMs: null, searchMs: null, mode: null,
    progress: 0, phase: 'Connecting…', step: 1,
  });
  const [results, setResults] = useState<Card[]>([]);
  const [statusText, setStatusText] = useState('Starting…');

  const searchIdRef = useRef(0);
  const currentQueryRef = useRef('');
  // facet constraints, applied INSIDE the worker before its top-K cut — filtering the 72
  // returned rows client-side instead can leave 0 visible results for broad queries
  const filtersRef = useRef<{ sys?: string[]; srcEx?: string[] }>({});
  const semanticTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const semanticReadyRef = useRef(false);

  useEffect(() => {
    if (workerRef.current) return;
    const w = new Worker('/v2-data/searchWorker.js');
    workerRef.current = w;

    w.onmessage = (ev) => {
      const msg = ev.data || {};
      switch (msg.type) {
        case 'status':
          setStatusText(msg.message);
          setMeta((m) => ({ ...m, status: 'loading' }));
          break;
        case 'progress':
          setMeta((m) => (m.status === 'ready' ? m : {
            ...m, progress: msg.pct, phase: msg.phase || m.phase, step: msg.step || m.step,
          }));
          break;
        case 'dataReady':
          setMeta((m) => ({ ...m, status: 'ready', count: msg.count, loadMs: msg.ms, progress: 100 }));
          setStatusText(`${msg.count.toLocaleString()} cases ready`);
          break;
        case 'semanticReady':
          semanticReadyRef.current = true;
          setMeta((m) => ({ ...m, semantic: true }));
          // upgrade the current query to semantic ranking now that the model is warm
          if (currentQueryRef.current.trim()) runSemantic(currentQueryRef.current);
          break;
        case 'semanticError':
          // stay on keyword mode silently; it still works great
          break;
        case 'results': {
          // ignore stale responses for queries the user has moved on from
          if (msg.error) return;
          if (msg.query !== undefined && msg.query !== currentQueryRef.current) return;
          if (msg._q !== undefined && msg._q !== currentQueryRef.current) return;
          setResults(msg.results || []);
          setMeta((m) => ({ ...m, searchMs: msg.ms ?? m.searchMs, mode: msg.mode ?? m.mode }));
          break;
        }
      }
    };

    w.postMessage({ type: 'init' });
    return () => { /* keep worker alive for the session */ };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const post = useCallback((query: string, mode: SearchMode) => {
    const w = workerRef.current;
    if (!w) return;
    const searchId = ++searchIdRef.current;
    w.postMessage({ type: 'search', query, mode, limit: 72, searchId, _q: query, filters: filtersRef.current });
  }, []);

  const setFilters = useCallback((f: { sys?: string[]; srcEx?: string[] }) => {
    filtersRef.current = f;
  }, []);

  const runSemantic = useCallback((query: string) => {
    if (!semanticReadyRef.current) return;
    post(query, 'semantic');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const search = useCallback((raw: string) => {
    const query = raw;
    currentQueryRef.current = query;
    if (semanticTimerRef.current) clearTimeout(semanticTimerRef.current);

    if (!query.trim()) {
      setResults([]);
      setMeta((m) => ({ ...m, searchMs: null, mode: null }));
      return;
    }

    // 1) instant keyword pass on every keystroke — feels immediate
    post(query, 'keyword');

    // 2) debounced semantic upgrade for ranking quality (once model is ready)
    if (semanticReadyRef.current) {
      semanticTimerRef.current = setTimeout(() => {
        if (currentQueryRef.current === query) post(query, 'semantic');
      }, SEMANTIC_DEBOUNCE_MS);
    }
  }, [post]);

  return { meta, results, statusText, search, setFilters };
}
