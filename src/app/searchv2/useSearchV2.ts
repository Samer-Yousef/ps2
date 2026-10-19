'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// One catalogue case as returned by public/searchv2-data/worker.js
export interface SvCase {
  i: number;        // catalogue case id
  d: string;        // clean diagnosis label (group key)
  t?: string;       // source's own title, when it differs from the label
  o?: string;       // organ
  s?: string;       // system
  sd?: string;      // site detail
  q?: string;       // qualifiers
  src?: string;     // source collection
  u?: string;       // url
  n?: number;       // slides
  h?: number;       // H&E slides
  ag?: string;
  sx?: string;
  c?: string;       // category
  _score?: number;
}
export interface SvGroup { d: string; score: number; total: number; cases: SvCase[]; sem?: boolean }

export interface SvMeta {
  status: 'booting' | 'loading' | 'ready';
  count: number;
  loadMs: number | null;
  searchMs: number | null;
  mode: 'lexical' | 'semantic' | null;
  progress: number;
  phase: string;
  step: number;
  systems: string[];
  sources: string[];
}
export interface SvFilters { sys?: string[]; srcEx?: string[] }

const SEMANTIC_DEBOUNCE_MS = 260;

export function useSearchV2() {
  const workerRef = useRef<Worker | null>(null);
  const [meta, setMeta] = useState<SvMeta>({
    status: 'booting', count: 0, loadMs: null, searchMs: null, mode: null,
    progress: 0, phase: 'Connecting…', step: 1, systems: [], sources: [],
  });
  const [groups, setGroups] = useState<SvGroup[]>([]);
  const searchIdRef = useRef(0);
  const queryRef = useRef('');
  const filtersRef = useRef<SvFilters>({});
  const semTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (workerRef.current) return;
    const w = new Worker('/searchv2-data/worker.js');
    workerRef.current = w;
    w.onmessage = (ev) => {
      const msg = ev.data || {};
      switch (msg.type) {
        case 'status':
          setMeta((m) => ({ ...m, status: m.status === 'ready' ? m.status : 'loading', phase: msg.message || m.phase }));
          break;
        case 'progress':
          setMeta((m) => (m.status === 'ready' ? m : { ...m, status: 'loading', progress: msg.pct, phase: msg.phase || m.phase, step: msg.step || m.step }));
          break;
        case 'dataReady':
          setMeta((m) => ({ ...m, status: 'ready', count: msg.count, loadMs: msg.ms, progress: 100, systems: msg.systems || [], sources: msg.sources || [] }));
          if (queryRef.current.trim() || filtersRef.current.sys?.length) post(queryRef.current, false);
          break;
        case 'results':
          if (msg.query !== undefined && msg.query !== queryRef.current) return;   // stale
          setGroups(msg.groups || []);
          setMeta((m) => ({ ...m, searchMs: msg.ms ?? m.searchMs, mode: msg.mode ?? m.mode }));
          break;
      }
    };
    w.postMessage({ type: 'init' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const post = useCallback((query: string, semantic: boolean) => {
    const w = workerRef.current;
    if (!w) return;
    const searchId = ++searchIdRef.current;
    w.postMessage({ type: 'search', query, filters: filtersRef.current, searchId, semantic });
  }, []);

  const setFilters = useCallback((f: SvFilters) => { filtersRef.current = f; }, []);

  // lexical pass on every keystroke; after a short pause the same query is re-run with the
  // server-side semantic upgrade, which appends related diagnoses below the lexical hits
  const search = useCallback((raw: string) => {
    queryRef.current = raw;
    if (semTimer.current) clearTimeout(semTimer.current);
    if (!raw.trim() && !filtersRef.current.sys?.length) {
      setGroups([]);
      setMeta((m) => ({ ...m, searchMs: null, mode: null }));
      return;
    }
    post(raw, false);
    if (raw.trim()) {
      semTimer.current = setTimeout(() => { if (queryRef.current === raw) post(raw, true); }, SEMANTIC_DEBOUNCE_MS);
    }
  }, [post]);

  return { meta, groups, search, setFilters };
}
