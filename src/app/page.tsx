'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSession, signOut } from 'next-auth/react';
import Link from 'next/link';
import { ThemeSelector } from '@/components/ThemeSelector';
import { DatabaseLoadingIndicator } from '@/components/DatabaseLoadingIndicator';
import { useSearch } from '@/components/SearchProvider';
import { PerformanceMetrics } from '@/types/search';

interface SearchResult {
  id: number;
  text: string;
  diagnosis: string;
  organ: string;
  system: string;
  site: string;
  similarity: number;
  metadata: {
    system?: string;
    organ?: string;
    tissue?: string;
    essential_diagnosis?: string;
    extracted_diagnosis?: string;
    lineage?: string;
    site?: string | null;
    age?: number | null;
    sex?: string | null;
    clinical_history?: string | null;
    macroscopic?: string | null;
    site_ai?: string;
    age_ai?: number | null;
    sex_ai?: string | null;
    clinical_history_ai?: string | null;
    macroscopic_ai?: string | null;
    microscopic?: string | null;
    variant?: string;
    stain?: string | null;
    case_id?: string;
    source?: string;
    url?: string | null;
    [key: string]: any;
  };
}

const SOURCES = [
  'Path Presenter',
  'Leeds',
  'Toronto',
  'RCPA',
  'Recut Club'
];

const SYSTEMS = [
  'Central Nervous System',
  'Head & Neck',
  'Skin',
  'Breast',
  'Thoracic',
  'Cardiovascular & Vascular',
  'Gastrointestinal',
  'Hepatopancreatobiliary & Peritoneal',
  'Genitourinary & Reproductive',
  'Endocrine',
  'Musculoskeletal & Soft Tissue',
  'Haematolymphoid',
  'Paediatric Pathology'
];

export default function Home() {
  const { data: session, status } = useSession();
  const { workerReady, initStatus, search: searchWorker } = useSearch(); // Use SearchProvider's worker
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [showClinical, setShowClinical] = useState(false);
  const [hideDiagnosis, setHideDiagnosis] = useState(false);
  const [revealedDiagnoses, setRevealedDiagnoses] = useState<Set<number>>(new Set());
  const [selectedSources, setSelectedSources] = useState<Set<string>>(new Set(SOURCES)); // All selected by default
  const [selectedSystems, setSelectedSystems] = useState<Set<string>>(new Set());
  const [selectedLineages, setSelectedLineages] = useState<Set<string>>(new Set());
  const [selectedOrgans, setSelectedOrgans] = useState<Set<string>>(new Set());
  const [secretSearchQuery, setSecretSearchQuery] = useState(''); // For system-only search mode
  const [favorites, setFavorites] = useState<Set<string>>(new Set()); // Track user's favorite case IDs
  const [searchMode, setSearchMode] = useState<'client' | 'api'>('api'); // Toggle between client cache and API - defaults to API until worker loads
  const [performanceMetrics, setPerformanceMetrics] = useState<PerformanceMetrics | null>(null); // Performance tracking
  const [lineageDropdownOpen, setLineageDropdownOpen] = useState(false);
  const [organDropdownOpen, setOrganDropdownOpen] = useState(false);
  const lineageDropdownRef = useRef<HTMLDivElement>(null);
  const organDropdownRef = useRef<HTMLDivElement>(null);
  const [clickedResultId, setClickedResultId] = useState<number | null>(null); // Track clicked result for animation

  // Helper to get value with AI fallback
  const getWithFallback = (primary: any, fallback: any): string => {
    if (primary !== null && primary !== undefined && primary !== '' && primary !== '-') {
      return String(primary);
    }
    if (fallback !== null && fallback !== undefined && fallback !== '' && fallback !== '-') {
      return String(fallback);
    }
    return '';
  };

  // Handle result click to open URL and track history
  const handleResultClick = async (result: SearchResult) => {
    // Trigger click animation
    setClickedResultId(result.id);

    // Save to history if user is authenticated (fire and forget)
    if (session?.user && result.metadata.case_id) {
      fetch('/api/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caseId: result.metadata.case_id,
          metadata: JSON.stringify({
            diagnosis: result.metadata.extracted_diagnosis || result.metadata.essential_diagnosis || result.diagnosis,
            organ: result.metadata.organ,
            system: result.metadata.system,
            source: result.metadata.source,
            url: result.metadata.url,
            site: result.metadata.site,
            site_ai: result.metadata.site_ai,
            age: result.metadata.age,
            age_ai: result.metadata.age_ai,
            sex: result.metadata.sex,
            sex_ai: result.metadata.sex_ai,
            clinical_history: result.metadata.clinical_history,
            clinical_history_ai: result.metadata.clinical_history_ai,
            macroscopic: result.metadata.macroscopic,
            macroscopic_ai: result.metadata.macroscopic_ai,
            microscopic: result.metadata.microscopic,
            stain: result.metadata.stain,
            variant: result.metadata.variant,
          })
        })
      }).catch(() => {
        // Silent fail - history tracking shouldn't block navigation
      });
    }

    // Wait for animation to complete before opening URL
    setTimeout(() => {
      setClickedResultId(null); // Reset animation state
      if (result.metadata.url) {
        window.open(result.metadata.url, '_blank', 'noopener,noreferrer');
      }
    }, 400); // Match animation duration
  };

  // Toggle favorite status
  const toggleFavorite = async (result: SearchResult, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent opening the URL

    if (!session?.user) {
      // Redirect to login if not authenticated
      window.location.href = '/login';
      return;
    }

    if (!result.metadata.case_id) return;

    const caseId = result.metadata.case_id;
    const isFavorited = favorites.has(caseId);

    try {
      if (isFavorited) {
        // Remove from favorites
        const response = await fetch(`/api/favorites?caseId=${encodeURIComponent(caseId)}`, {
          method: 'DELETE',
        });

        if (response.ok) {
          setFavorites(prev => {
            const newSet = new Set(prev);
            newSet.delete(caseId);
            return newSet;
          });
        }
      } else {
        // Add to favorites
        const response = await fetch('/api/favorites', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            caseId: caseId,
            metadata: JSON.stringify({
              diagnosis: result.metadata.extracted_diagnosis || result.metadata.essential_diagnosis || result.diagnosis,
              organ: result.metadata.organ,
              system: result.metadata.system,
              source: result.metadata.source,
              url: result.metadata.url,
              site: result.metadata.site,
              site_ai: result.metadata.site_ai,
              age: result.metadata.age,
              age_ai: result.metadata.age_ai,
              sex: result.metadata.sex,
              sex_ai: result.metadata.sex_ai,
              clinical_history: result.metadata.clinical_history,
              clinical_history_ai: result.metadata.clinical_history_ai,
              macroscopic: result.metadata.macroscopic,
              macroscopic_ai: result.metadata.macroscopic_ai,
              microscopic: result.metadata.microscopic,
              stain: result.metadata.stain,
              variant: result.metadata.variant,
            })
          })
        });

        if (response.ok) {
          setFavorites(prev => new Set(prev).add(caseId));
        }
      }
    } catch (error) {
      console.error('Failed to toggle favorite:', error);
    }
  };

  // Toggle source filter
  const toggleSource = (source: string) => {
    const newSelected = new Set(selectedSources);
    if (newSelected.has(source)) {
      newSelected.delete(source);
    } else {
      newSelected.add(source);
    }
    setSelectedSources(newSelected);
  };

  // Toggle system filter
  const toggleSystem = (system: string) => {
    // If user has typed something, work as a multi-select filter
    if (query.trim()) {
      const newSelected = new Set(selectedSystems);
      if (newSelected.has(system)) {
        newSelected.delete(system);
      } else {
        newSelected.add(system);
      }
      setSelectedSystems(newSelected);
    } else {
      // No user input: single-select mode with secret search
      if (selectedSystems.has(system)) {
        // Deselect - clear everything
        setSelectedSystems(new Set());
        setSecretSearchQuery('');
      } else {
        // Select this system only (clear others)
        setSelectedSystems(new Set([system]));
        setSecretSearchQuery(system);
      }
    }
  };

  // Toggle lineage filter
  const toggleLineage = (lineage: string) => {
    const newSelected = new Set(selectedLineages);
    if (newSelected.has(lineage)) {
      newSelected.delete(lineage);
    } else {
      newSelected.add(lineage);
    }
    setSelectedLineages(newSelected);
  };

  // Toggle organ filter
  const toggleOrgan = (organ: string) => {
    const newSelected = new Set(selectedOrgans);
    if (newSelected.has(organ)) {
      newSelected.delete(organ);
    } else {
      newSelected.add(organ);
    }
    setSelectedOrgans(newSelected);
  };

  // Auto-switch to client mode when worker is ready
  useEffect(() => {
    if (workerReady && searchMode === 'api') {
      setSearchMode('client');
    }
  }, [workerReady, searchMode]);

  // Fetch user's favorites on mount/login
  useEffect(() => {
    if (session?.user) {
      fetch('/api/favorites')
        .then(res => res.json())
        .then(data => {
          if (data.favorites) {
            setFavorites(new Set(data.favorites.map((f: any) => f.caseId)));
          }
        })
        .catch(() => {
          // Silent fail - favorites are not critical
        });
    } else {
      setFavorites(new Set());
    }
  }, [session]);

  // Reset lineage/organ filters when query or system filters change
  useEffect(() => {
    setSelectedLineages(new Set());
    setSelectedOrgans(new Set());
  }, [query, selectedSystems]);

  // Click outside to close dropdowns
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (lineageDropdownRef.current && !lineageDropdownRef.current.contains(event.target as Node)) {
        setLineageDropdownOpen(false);
      }
      if (organDropdownRef.current && !organDropdownRef.current.contains(event.target as Node)) {
        setOrganDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filter results by selected sources (first level)
  const sourceFilteredResults = selectedSources.size === 0
    ? results
    : results.filter(r => selectedSources.has(r.metadata.source || ''));

  // Filter results by selected systems (second level)
  const systemFilteredResults = selectedSystems.size === 0
    ? sourceFilteredResults
    : sourceFilteredResults.filter(r => selectedSystems.has(r.metadata.system || ''));

  // Calculate lineage and organ frequencies from first 100 system-filtered results
  const lineageFrequencies = useMemo(() => {
    const counts = new Map<string, number>();
    const top100 = systemFilteredResults.slice(0, 100);
    top100.forEach(r => {
      const lineage = r.metadata.lineage;
      if (lineage && lineage.trim()) {
        counts.set(lineage, (counts.get(lineage) || 0) + 1);
      }
    });
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([lineage]) => lineage);
  }, [systemFilteredResults]);

  const organFrequencies = useMemo(() => {
    const counts = new Map<string, number>();
    const top100 = systemFilteredResults.slice(0, 100);
    top100.forEach(r => {
      const organ = r.metadata.organ;
      if (organ && organ.trim()) {
        counts.set(organ, (counts.get(organ) || 0) + 1);
      }
    });
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([organ]) => organ);
  }, [systemFilteredResults]);

  // Filter results by lineage and organ (second level)
  const filteredResults = useMemo(() => {
    let filtered = systemFilteredResults;

    if (selectedLineages.size > 0) {
      filtered = filtered.filter(r => selectedLineages.has(r.metadata.lineage || ''));
    }

    if (selectedOrgans.size > 0) {
      filtered = filtered.filter(r => selectedOrgans.has(r.metadata.organ || ''));
    }

    return filtered;
  }, [systemFilteredResults, selectedLineages, selectedOrgans]);

  const performSearch = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim()) {
      setResults([]);
      setSearched(false);
      setPerformanceMetrics(null);
      return;
    }

    setLoading(true);
    setSearched(true);

    try {
      if (searchMode === 'client') {
        // Client mode: use SearchProvider's worker
        if (workerReady) {
          const response = await searchWorker(searchQuery, 24000);
          setResults(response.results);
          setPerformanceMetrics(response.performance);
          setLoading(false);
        } else {
          // Worker not ready - show initialization status
          console.warn('Worker not ready, waiting for initialization');
          setLoading(false);
        }
      } else {
        // API mode: Track complete end-to-end time including network
        const clientStartTime = performance.now();
        const response = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}&limit=20`);
        const networkTime = performance.now() - clientStartTime;

        const data = await response.json();

        if (data.results) {
          setResults(data.results);

          // Enhance performance metrics with client-side telemetry
          const clientTotalTime = performance.now() - clientStartTime;
          setPerformanceMetrics({
            ...data.performance,
            networkTime: networkTime,
            clientTotalTime: clientTotalTime
          });
        }
        setLoading(false);
      }
    } catch (error) {
      console.error('Search error:', error);
      setResults([]);
      setPerformanceMetrics(null);
      setLoading(false);
    }
  }, [searchMode, workerReady, searchWorker]);

  // Handle user typing - clear secret search when user types
  const handleQueryChange = (newQuery: string) => {
    setQuery(newQuery);
    if (newQuery.trim()) {
      // User is typing - clear secret search
      setSecretSearchQuery('');
    }
  };

  // Perform search based on user query or secret query with conditional debouncing
  useEffect(() => {
    const searchQuery = query.trim() || secretSearchQuery;

    // Only debounce for API mode (500ms delay)
    // Client mode searches immediately (no delay)
    const debounceDelay = searchMode === 'api' ? 500 : 0;

    const timeoutId = setTimeout(() => {
      performSearch(searchQuery);
    }, debounceDelay);

    // Cancel previous timeout if user keeps typing
    return () => clearTimeout(timeoutId);
  }, [query, secretSearchQuery, performSearch, searchMode]);

  // Worker is now managed by SearchProvider - no duplicate initialization needed

  return (
    <main className="flex min-h-screen">
      <style jsx>{`
        @keyframes result-click {
          0% {
            transform: scale(1);
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
          }
          25% {
            transform: scale(0.96);
            box-shadow: 0 2px 4px -1px rgba(0, 0, 0, 0.1);
          }
          50% {
            transform: scale(1.04);
            box-shadow: 0 20px 40px -10px rgba(59, 130, 246, 0.5), 0 0 0 3px rgba(59, 130, 246, 0.3);
          }
          75% {
            transform: scale(0.99);
            box-shadow: 0 10px 20px -5px rgba(59, 130, 246, 0.3);
          }
          100% {
            transform: scale(1);
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
          }
        }

      `}</style>
      {/* Main Content */}
      <div className="flex-1 flex flex-col items-center p-4 pt-8">
        <div className="w-full max-w-5xl">
          {/* User Navigation */}
          <div className="flex justify-end items-center mb-4">
            <div className="flex items-center gap-3">
              <ThemeSelector />
              {status === 'loading' ? (
                <span className="text-sm text-gray-500">Loading...</span>
              ) : session ? (
                <>
                  <Link
                    href="/dashboard"
                    className="text-sm text-blue-600 dark:text-blue-400 sepia:text-blue-600 hover:underline"
                  >
                    Dashboard
                  </Link>
                  <span className="text-sm text-gray-600 dark:text-gray-400 sepia:text-gray-700">
                    {session.user?.email}
                  </span>
                  <button
                    onClick={() => signOut()}
                    className="text-sm px-3 py-1 bg-gray-200 dark:bg-gray-700 sepia:bg-[#e8dfc8] hover:bg-gray-300 dark:hover:bg-gray-600 sepia:hover:bg-[#ddd0b8] rounded"
                  >
                    Sign out
                  </button>
                </>
              ) : (
                <>
                  <Link
                    href="/login"
                    className="text-sm text-blue-600 dark:text-blue-400 sepia:text-blue-600 hover:underline"
                  >
                    Sign in
                  </Link>
                  <Link
                    href="/register"
                    className="text-sm px-3 py-1 bg-blue-600 text-white hover:bg-blue-700 rounded"
                  >
                    Sign up
                  </Link>
                </>
              )}
            </div>
          </div>

          {/* Title */}
          <h1 className="text-center text-5xl font-light tracking-wide mb-6">
            Pathology <span style={{ color: '#0069ff' }}>Search</span>
          </h1>

        <div className="mb-4">
          <form onSubmit={(e) => e.preventDefault()}>
            <input
              type="text"
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              placeholder={
                workerReady
                  ? "Search for diagnoses, organs, or systems (e.g., 'ovary carcinoma')..."
                  : "Loading search database..."
              }
              className="w-full px-5 py-3 border-2 border-gray-300 dark:border-gray-600 sepia:border-[#d9d0c0] rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-800 sepia:bg-[#faf8f3] text-gray-900 dark:text-gray-100 sepia:text-gray-900 placeholder:text-gray-500 dark:placeholder:text-gray-400 sepia:placeholder:text-gray-600 shadow-md hover:shadow-lg transition-shadow"
            />
          </form>
        </div>

        {/* Show filters and results with left sidebar */}
        {(searched || !query.trim()) && (
          <div className="flex gap-3">
            {/* Left Sidebar - All Filters */}
            <div className="w-fit shrink-0 space-y-2">
              {/* Action Buttons at Top - Side by Side */}
              {searched && results.length > 0 && (
                <div className="flex gap-1">
                  <button
                    onClick={() => setShowClinical(!showClinical)}
                    className={`px-2 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                      showClinical
                        ? 'bg-blue-600 text-white hover:bg-blue-700'
                        : 'bg-white dark:bg-gray-700 sepia:bg-[#e8dfc8] text-gray-900 dark:text-gray-200 sepia:text-gray-900 border border-gray-300 dark:border-gray-600 sepia:border-[#d9d0c0] hover:bg-gray-50 dark:hover:bg-gray-600 sepia:hover:bg-[#ddd0b8]'
                    }`}
                  >
                    {showClinical ? 'Hide Clinical' : 'Show Clinical'}
                  </button>
                  <button
                    onClick={() => {
                      setHideDiagnosis(!hideDiagnosis);
                      setRevealedDiagnoses(new Set());
                    }}
                    className={`px-2 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                      hideDiagnosis
                        ? 'bg-blue-600 text-white hover:bg-blue-700'
                        : 'bg-white dark:bg-gray-700 sepia:bg-[#e8dfc8] text-gray-900 dark:text-gray-200 sepia:text-gray-900 border border-gray-300 dark:border-gray-600 sepia:border-[#d9d0c0] hover:bg-gray-50 dark:hover:bg-gray-600 sepia:hover:bg-[#ddd0b8]'
                    }`}
                  >
                    {hideDiagnosis ? 'Show Diagnoses' : 'Hide Diagnoses'}
                  </button>
                </div>
              )}

              {/* System Filters */}
              <div>
                <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-300 sepia:text-gray-800 mb-1">Systems</h3>
                <div className="flex flex-col gap-0.5">
                  {SYSTEMS.map((system) => (
                    <button
                      key={system}
                      onClick={() => toggleSystem(system)}
                      className={`px-2 py-1 text-xs rounded transition-colors text-left whitespace-nowrap ${
                        selectedSystems.has(system)
                          ? 'bg-blue-600 text-white'
                          : 'bg-white dark:bg-gray-700 sepia:bg-[#faf8f3] text-gray-700 dark:text-gray-300 sepia:text-gray-800 border border-gray-300 dark:border-gray-600 sepia:border-[#d9d0c0] hover:bg-gray-50 dark:hover:bg-gray-600 sepia:hover:bg-[#f0ebe0]'
                      }`}
                    >
                      {system}
                    </button>
                  ))}
                </div>
              </div>

              {/* Lineage Dropdown */}
              {searched && lineageFrequencies.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-300 sepia:text-gray-800 mb-1">Lineage</h3>
                  <div className="relative" ref={lineageDropdownRef}>
                    <button
                      onClick={() => setLineageDropdownOpen(!lineageDropdownOpen)}
                      className="w-full px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 sepia:border-[#d9d0c0] bg-white dark:bg-gray-700 sepia:bg-[#faf8f3] text-gray-900 dark:text-gray-100 sepia:text-gray-900 hover:bg-gray-50 dark:hover:bg-gray-600 sepia:hover:bg-[#f0ebe0] transition-colors flex items-center justify-between gap-2"
                    >
                      <span>{selectedLineages.size > 0 ? `${selectedLineages.size} selected` : 'Select'}</span>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>

                    {lineageDropdownOpen && (
                      <div className="absolute top-full left-0 mt-1 w-64 max-h-80 overflow-y-auto bg-white dark:bg-gray-800 sepia:bg-[#faf8f3] border border-gray-300 dark:border-gray-600 sepia:border-[#d9d0c0] rounded shadow-lg z-50">
                        <div className="p-2 space-y-1">
                          {lineageFrequencies.map((lineage) => (
                            <label
                              key={lineage}
                              className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 sepia:hover:bg-[#e8dfc8] rounded cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={selectedLineages.has(lineage)}
                                onChange={() => toggleLineage(lineage)}
                                className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                              />
                              <span className="text-sm text-gray-900 dark:text-gray-100 sepia:text-gray-900">
                                {lineage}
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Organ Dropdown */}
              {searched && organFrequencies.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-300 sepia:text-gray-800 mb-1">Organ</h3>
                  <div className="relative" ref={organDropdownRef}>
                    <button
                      onClick={() => setOrganDropdownOpen(!organDropdownOpen)}
                      className="w-full px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 sepia:border-[#d9d0c0] bg-white dark:bg-gray-700 sepia:bg-[#faf8f3] text-gray-900 dark:text-gray-100 sepia:text-gray-900 hover:bg-gray-50 dark:hover:bg-gray-600 sepia:hover:bg-[#f0ebe0] transition-colors flex items-center justify-between gap-2"
                    >
                      <span>{selectedOrgans.size > 0 ? `${selectedOrgans.size} selected` : 'Select'}</span>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>

                    {organDropdownOpen && (
                      <div className="absolute top-full left-0 mt-1 w-64 max-h-80 overflow-y-auto bg-white dark:bg-gray-800 sepia:bg-[#faf8f3] border border-gray-300 dark:border-gray-600 sepia:border-[#d9d0c0] rounded shadow-lg z-50">
                        <div className="p-2 space-y-1">
                          {organFrequencies.map((organ) => (
                            <label
                              key={organ}
                              className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 sepia:hover:bg-[#e8dfc8] rounded cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={selectedOrgans.has(organ)}
                                onChange={() => toggleOrgan(organ)}
                                className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                              />
                              <span className="text-sm text-gray-900 dark:text-gray-100 sepia:text-gray-900">
                                {organ}
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Source Filters */}
              <div>
                <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-300 sepia:text-gray-800 mb-1">Sources</h3>
                <div className="flex flex-col gap-0.5">
                  {SOURCES.map((source) => (
                    <button
                      key={source}
                      onClick={() => toggleSource(source)}
                      className={`px-2 py-1 text-xs rounded transition-colors text-left whitespace-nowrap ${
                        selectedSources.has(source)
                          ? 'bg-teal-700 dark:bg-teal-800 text-white'
                          : 'bg-white dark:bg-gray-700 sepia:bg-[#faf8f3] text-gray-700 dark:text-gray-300 sepia:text-gray-800 border border-gray-300 dark:border-gray-600 sepia:border-[#d9d0c0] hover:bg-gray-50 dark:hover:bg-gray-600 sepia:hover:bg-[#f0ebe0]'
                      }`}
                    >
                      {source}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Right Side - Results Only */}
            <div className="flex-1">

            {/* Show loading indicator while database initializes */}
            {!workerReady ? (
              <DatabaseLoadingIndicator />
            ) : searched && filteredResults.length === 0 ? (
                <p className="text-center text-gray-500">
                  {results.length === 0 ? 'No results found' : 'No results match the selected systems'}
                </p>
              ) : searched ? (
                <>
                  {filteredResults.slice(0, 100).map((result) => {
                  const m = result.metadata;

                  // Get values with AI fallbacks
                  const diagnosis = m.extracted_diagnosis || m.essential_diagnosis || result.diagnosis;
                  const site = getWithFallback(m.site, m.site_ai);
                  const sex = getWithFallback(m.sex, m.sex_ai);
                  const age = getWithFallback(m.age, m.age_ai);
                  const clinicalHistory = getWithFallback(m.clinical_history, m.clinical_history_ai);
                  const macroscopic = getWithFallback(m.macroscopic, m.macroscopic_ai);

                  // Helper to capitalize first letter
                  const capitalize = (str: string) => str ? str.charAt(0).toUpperCase() + str.slice(1).toLowerCase() : '';

                  // Format organ display
                  const organDisplay = m.organ ? capitalize(m.organ) : '';

                  // Check if this diagnosis is revealed (when hideDiagnosis is active)
                  const isDiagnosisRevealed = revealedDiagnoses.has(result.id);
                  const showDiagnosisContent = !hideDiagnosis || isDiagnosisRevealed;
                  const isFavorited = result.metadata.case_id ? favorites.has(result.metadata.case_id) : false;
                  const isClicked = clickedResultId === result.id;

                  return (
                    <div key={result.id} className="flex items-start gap-2">
                      {/* Main result card */}
                      <div
                        className={`flex-1 border border-gray-200 dark:border-gray-700 sepia:border-[#d9d0c0] rounded transition-all duration-200 bg-white dark:bg-gray-800 sepia:bg-[#faf8f3] hover:bg-blue-50 dark:hover:bg-gray-700 sepia:hover:bg-[#e8dfc8] hover:border-blue-300 dark:hover:border-blue-600 sepia:hover:border-blue-400 hover:shadow-lg ${
                          showClinical ? 'p-4' : 'px-3 py-1.5'
                        } ${isClicked ? 'animate-result-click' : ''}`}
                        style={isClicked ? { animation: 'result-click 0.4s ease-out' } : {}}
                      >
                        <div className={showClinical ? 'space-y-3' : ''}>
                          {/* Top row: Organ (compact) or System + Organ (clinical), Diagnosis */}
                          <div
                            onClick={() => handleResultClick(result)}
                            className={`${m.url ? 'cursor-pointer hover:opacity-80' : ''} ${showClinical ? '' : 'flex items-start gap-3'}`}
                            title={m.url ? 'Click to view case' : ''}
                          >
                          {/* Organ only in compact, System + Organ in clinical */}
                          <div className={showClinical ? 'mb-2' : 'w-32 shrink-0'}>
                            {showClinical && m.system && (
                              <div className="font-medium text-gray-900 dark:text-gray-100 sepia:text-gray-900 text-base">
                                {m.system}
                              </div>
                            )}
                            {organDisplay && (
                              <div className={`text-gray-600 dark:text-gray-400 sepia:text-gray-700 ${showClinical ? 'text-sm' : 'text-xs leading-tight break-words'}`}>
                                {organDisplay}
                              </div>
                            )}
                            {m.source && (
                              <div className={`text-gray-500 dark:text-gray-500 sepia:text-gray-600 ${showClinical ? 'text-xs mt-0.5' : 'text-[0.625rem] leading-none mt-0.5'}`}>
                                {m.source}
                              </div>
                            )}
                          </div>

                          {/* Diagnosis section */}
                          <div className="flex-1 min-w-0">
                            {showDiagnosisContent ? (
                              <div className="flex items-start gap-2 flex-wrap">
                                <h3 className={`font-medium text-blue-600 dark:text-blue-400 sepia:text-blue-700 ${showClinical ? 'text-lg' : 'text-base leading-tight'}`}>
                                  {diagnosis}
                                </h3>
                                {/* Variant badges inline to the right */}
                                {m.variant && (
                                  <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 sepia:bg-amber-100 text-amber-700 dark:text-amber-300 sepia:text-amber-800 whitespace-nowrap">
                                    {m.variant}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setRevealedDiagnoses(new Set(revealedDiagnoses).add(result.id));
                                }}
                                className="px-3 py-1 text-sm bg-blue-100 dark:bg-blue-900/30 sepia:bg-blue-100 text-blue-700 dark:text-blue-300 sepia:text-blue-800 rounded hover:bg-blue-200 dark:hover:bg-blue-900/50 sepia:hover:bg-blue-200"
                              >
                                Show Diagnosis
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Clinical section (only when showClinical is true) */}
                        {showClinical && (
                          <div className="border-t border-gray-200 dark:border-gray-700 sepia:border-[#d9d0c0] pt-3 space-y-2">
                            {/* Site (with AI fallback) */}
                            {site && (
                              <div className="text-sm">
                                <span className="font-medium text-gray-700 dark:text-gray-300 sepia:text-gray-800">Site: </span>
                                <span className="text-gray-600 dark:text-gray-400 sepia:text-gray-700">{capitalize(site)}</span>
                              </div>
                            )}

                            {/* Demographics */}
                            {(sex || age) && (
                              <div className="text-sm">
                                <span className="font-medium text-gray-700 dark:text-gray-300 sepia:text-gray-800">Demographics: </span>
                                <span className="text-gray-600 dark:text-gray-400 sepia:text-gray-700">
                                  {[sex, age ? `${age} years` : null].filter(Boolean).join(', ')}
                                </span>
                              </div>
                            )}

                            {/* Clinical History */}
                            {clinicalHistory && (
                              <div className="text-sm">
                                <span className="font-medium text-gray-700 dark:text-gray-300 sepia:text-gray-800">Clinical History: </span>
                                <span className="text-gray-600 dark:text-gray-400 sepia:text-gray-700">{clinicalHistory}</span>
                              </div>
                            )}

                            {/* Macroscopic */}
                            {macroscopic && (
                              <div className="text-sm">
                                <span className="font-medium text-gray-700 dark:text-gray-300 sepia:text-gray-800">Macroscopic: </span>
                                <span className="text-gray-600 dark:text-gray-400 sepia:text-gray-700">{macroscopic}</span>
                              </div>
                            )}

                            {/* Microscopic - Only show if diagnosis is not hidden OR this specific diagnosis is revealed */}
                            {m.microscopic && showDiagnosisContent && (
                              <div className="text-sm">
                                <span className="font-medium text-gray-700 dark:text-gray-300 sepia:text-gray-800">Microscopic: </span>
                                <span className="text-gray-600 dark:text-gray-400 sepia:text-gray-700">{m.microscopic}</span>
                              </div>
                            )}

                            {/* Case metadata */}
                            <div className="flex gap-4 text-xs text-gray-500 dark:text-gray-500 sepia:text-gray-600 pt-2">
                              {m.case_id && <span>Case: {m.case_id}</span>}
                              {m.source && <span>Source: {m.source}</span>}
                              {m.stain && <span>Stain: {m.stain}</span>}
                            </div>
                          </div>
                        )}
                        </div>
                      </div>

                      {/* Favorite button - separate circle to the right */}
                      {result.metadata.case_id && (
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            toggleFavorite(result, e);
                          }}
                          className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
                            isFavorited
                              ? 'bg-red-100 dark:bg-red-900/30 sepia:bg-red-100 text-red-500 hover:bg-red-200 dark:hover:bg-red-900/50 sepia:hover:bg-red-200'
                              : 'bg-gray-100 dark:bg-gray-800 sepia:bg-[#e8dfc8] text-gray-400 dark:text-gray-500 sepia:text-gray-600 hover:bg-gray-200 dark:hover:bg-gray-700 sepia:hover:bg-[#ddd0b8] hover:text-red-500'
                          }`}
                          title={isFavorited ? 'Remove from favorites' : 'Add to favorites'}
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            fill={isFavorited ? 'currentColor' : 'none'}
                            stroke="currentColor"
                            strokeWidth="2"
                            className="w-5 h-5"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z"
                            />
                          </svg>
                        </button>
                      )}
                    </div>
                  );
                })}
                </>
              ) : null}
            </div>
          </div>
        )}
        </div>
      </div>
    </main>
  );
}
