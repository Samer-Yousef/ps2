'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSession, signOut } from 'next-auth/react';
import Link from 'next/link';
import { ThemeSelector } from '@/components/ThemeSelector';
import { BottomDrawer } from '@/components/BottomDrawer';
import { DatabaseLoadingIndicator } from '@/components/DatabaseLoadingIndicator';
import { useSearch } from '@/components/SearchProvider';
import { PerformanceMetrics } from '@/types/search';
import { useSearchTracking, useSessionTracking, useTimeTracking, useScrollTracking, useHoverTracking, useClickPatternTracking, useRapidSearchTracking } from '@/hooks/useAnalytics';
import { trackResultClick, trackFavoriteAction, trackViewToggle, trackFilterApplied, trackDatabaseLoad, trackLowRelevanceSearch } from '@/lib/analytics';

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

const EXAMPLE_QUERIES = [
  "ovary malignant",
  "ovary serous carcinoma",
  "lymph node benign",
  "kikuchi",
  "serous borderline with carcinoma",
  "melanoma lymph node",
  "breast benign neoplasm",
  "thyroid anaplastic",
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
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const lineageDropdownRef = useRef<HTMLDivElement>(null);
  const organDropdownRef = useRef<HTMLDivElement>(null);

  // Analytics hooks - Phase 1
  const { trackKeystroke, trackSearchResults, trackResultClicked, searchStartTime } = useSearchTracking();
  useSessionTracking(); // Tracks session start automatically
  const { incrementSearchCount, incrementClickCount, incrementFavoritesAdded } = useTimeTracking();
  const clickCountRef = useRef<number>(0);

  // Analytics hooks - Phase 2 (Behavioral tracking)
  const { trackScroll } = useScrollTracking();
  const { startHover, endHover } = useHoverTracking();
  const { trackClick: trackClickPattern } = useClickPatternTracking();
  const { trackSearch: trackRapidSearch } = useRapidSearchTracking();
  const [clickedResultId, setClickedResultId] = useState<number | null>(null); // Track clicked result for animation
  const [placeholderText, setPlaceholderText] = useState('');
  const [isUserTyping, setIsUserTyping] = useState(false);

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
  const handleResultClick = async (result: SearchResult, position: number) => {
    // Trigger click animation
    setClickedResultId(result.id);

    // Track analytics for click
    incrementClickCount();
    clickCountRef.current++;
    trackResultClicked(); // Triggers search completion tracking

    // Track detailed result click
    const timeSinceSearch = searchStartTime ? Date.now() - searchStartTime : 0;
    trackResultClick({
      resultId: result.metadata.case_id || result.id.toString(),
      resultPosition: position + 1, // 1-indexed for analytics
      diagnosis: result.metadata.extracted_diagnosis || result.metadata.essential_diagnosis || result.diagnosis,
      organ: result.metadata.organ,
      system: result.metadata.system,
      source: result.metadata.source,
      similarityScore: result.similarity,
      query: query || secretSearchQuery,
      isFirstClickInSession: clickCountRef.current === 1,
      timeSinceSearchMs: timeSinceSearch,
      totalResultsAvailable: filteredResults.length,
      filtersActive: Array.from(selectedSources).concat(
        Array.from(selectedSystems),
        Array.from(selectedLineages),
        Array.from(selectedOrgans)
      ),
    });

    // Phase 2: Track click pattern for comparison behavior
    trackClickPattern(
      result.metadata.case_id || result.id.toString(),
      position + 1,
      result.metadata.extracted_diagnosis || result.metadata.essential_diagnosis || result.diagnosis,
      result.metadata.organ,
      result.metadata.system
    );

    // Phase 2: End hover tracking (clicked after hover)
    endHover(true);

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

          // Track analytics
          trackFavoriteAction({
            action: 'remove',
            caseId,
            fromPage: 'search',
            isFirstFavorite: false,
            totalFavoritesNow: favorites.size - 1,
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

          // Track analytics
          incrementFavoritesAdded();
          const position = filteredResults.findIndex(r => r.metadata.case_id === caseId);
          trackFavoriteAction({
            action: 'add',
            caseId,
            fromPage: 'search',
            queryThatFoundIt: query || secretSearchQuery,
            resultPosition: position >= 0 ? position + 1 : undefined,
            isFirstFavorite: favorites.size === 0,
            totalFavoritesNow: favorites.size + 1,
          });
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

  // Typing animation for placeholder text
  useEffect(() => {
    if (!workerReady || isUserTyping || query.trim().length > 0) {
      setPlaceholderText('');
      return;
    }

    // Start at random position, then cycle through in order
    let exampleIndex = Math.floor(Math.random() * EXAMPLE_QUERIES.length);
    let currentText = '';
    let isTyping = true;
    let timeoutId: NodeJS.Timeout;

    const typeText = async () => {
      const targetText = EXAMPLE_QUERIES[exampleIndex];
      currentText = '';
      isTyping = true;

      // Type each character
      for (let i = 0; i < targetText.length; i++) {
        if (!isTyping) return;
        currentText = targetText.slice(0, i + 1);
        setPlaceholderText(currentText);
        await new Promise(resolve => { timeoutId = setTimeout(resolve, 60); });
      }

      // Wait at the end
      await new Promise(resolve => { timeoutId = setTimeout(resolve, 2000); });

      // Backspace quickly
      const backspaceDelay = 200 / currentText.length; // Total 200ms for all backspaces
      for (let i = currentText.length; i >= 0; i--) {
        if (!isTyping) return;
        currentText = targetText.slice(0, i);
        setPlaceholderText(currentText);
        await new Promise(resolve => { timeoutId = setTimeout(resolve, backspaceDelay); });
      }

      // Move to next example (cycle around)
      exampleIndex = (exampleIndex + 1) % EXAMPLE_QUERIES.length;

      // Start next example
      typeText();
    };

    typeText();

    return () => {
      isTyping = false;
      clearTimeout(timeoutId);
    };
  }, [workerReady, isUserTyping, query]);

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

    // Increment search count for analytics
    incrementSearchCount();

    try {
      const startTime = performance.now();

      if (searchMode === 'client') {
        // Client mode: use SearchProvider's worker
        if (workerReady) {
          const response = await searchWorker(searchQuery, 24000);
          const searchLatency = performance.now() - startTime;

          setResults(response.results);
          setPerformanceMetrics(response.performance);

          // Track search results for analytics
          trackSearchResults(searchQuery, response.results.length, searchLatency);

          // Phase 2: Track rapid search patterns
          trackRapidSearch(
            searchQuery,
            response.results.length,
            response.results.length > 0 ? response.results[0].similarity : 0
          );

          // Track low relevance if top result has similarity < 0.5
          if (response.results.length > 0 && response.results[0].similarity < 0.5) {
            trackLowRelevanceSearch({
              query: searchQuery,
              topSimilarityScore: response.results[0].similarity,
              resultCount: response.results.length,
            });
          }

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
          const searchLatency = performance.now() - startTime;

          setResults(data.results);

          // Enhance performance metrics with client-side telemetry
          const clientTotalTime = performance.now() - clientStartTime;
          setPerformanceMetrics({
            ...data.performance,
            networkTime: networkTime,
            clientTotalTime: clientTotalTime
          });

          // Track search results for analytics
          trackSearchResults(searchQuery, data.results.length, searchLatency);

          // Phase 2: Track rapid search patterns
          trackRapidSearch(
            searchQuery,
            data.results.length,
            data.results.length > 0 ? data.results[0].similarity : 0
          );

          // Track low relevance if top result has similarity < 0.5
          if (data.results.length > 0 && data.results[0].similarity < 0.5) {
            trackLowRelevanceSearch({
              query: searchQuery,
              topSimilarityScore: data.results[0].similarity,
              resultCount: data.results.length,
            });
          }
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
  const handleQueryChange = (newQuery: string, isBackspace: boolean = false) => {
    // Track keystroke for analytics
    trackKeystroke(newQuery, isBackspace);

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
      <div className="flex-1 flex flex-col items-center p-3 sm:p-4 pt-4 sm:pt-8 lg:pt-8">
        <div className="w-full max-w-5xl">
          {/* User Navigation */}
          <div className="flex justify-end items-center mb-3 sm:mb-4">
            <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap justify-end">
              <ThemeSelector />
              {status === 'loading' ? (
                <span className="text-sm text-gray-500">Loading...</span>
              ) : session ? (
                <>
                  <Link
                    href="/dashboard"
                    className="text-sm text-blue-600 dark:text-blue-400 sepia:text-blue-600 hover:underline"
                  >
                    Favorites
                  </Link>
                  <span className="text-gray-400 dark:text-gray-600">•</span>
                  <button
                    onClick={() => signOut()}
                    className="text-sm text-gray-600 dark:text-gray-400 sepia:text-gray-700 hover:text-gray-900 dark:hover:text-gray-200 sepia:hover:text-gray-900 hover:underline"
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
          <h1 className="text-center text-3xl sm:text-4xl lg:text-6xl font-light tracking-wide mb-4 sm:mb-6 px-2">
            Pathology <span style={{ color: '#0069ff' }}>Search</span>
          </h1>

        <div className="mb-4">
          <form onSubmit={(e) => e.preventDefault()}>
            <input
              type="text"
              value={query}
              onChange={(e) => {
                handleQueryChange(e.target.value);
                setIsUserTyping(true);
              }}
              onFocus={() => setIsUserTyping(true)}
              onBlur={() => {
                if (query.trim().length === 0) {
                  setIsUserTyping(false);
                }
              }}
              placeholder={
                !workerReady
                  ? "Loading search database..."
                  : placeholderText
              }
              className="w-full px-5 py-3 border-2 border-gray-300 dark:border-gray-600 sepia:border-[#d9d0c0] rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-800 sepia:bg-[#faf8f3] text-gray-900 dark:text-gray-100 sepia:text-gray-900 placeholder:text-gray-500 dark:placeholder:text-gray-400 sepia:placeholder:text-gray-600 shadow-md hover:shadow-lg transition-shadow"
            />
          </form>
        </div>

        {/* Show filters and results with left sidebar */}
        {(searched || !query.trim()) && (
          <div className="flex gap-3">
            {/* Left Sidebar - All Filters (Desktop Only) */}
            <div className="hidden lg:block w-fit shrink-0 space-y-2">
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

            {/* Mobile Filters Button - Floating (Mobile Only) */}
            {(searched || !query.trim()) && (
              <div className="lg:hidden fixed bottom-6 right-6 z-30">
                <button
                  onClick={() => setMobileFiltersOpen(true)}
                  className="flex items-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-full shadow-lg hover:bg-blue-700 transition-colors min-h-[56px] min-w-[56px]"
                  aria-label="Open filters"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                  </svg>
                  <span className="font-medium">Filters</span>
                </button>
              </div>
            )}

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
                  {filteredResults.slice(0, 100).map((result, index) => {
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
                        onMouseEnter={() => startHover(
                          result.metadata.case_id || result.id.toString(),
                          index + 1,
                          diagnosis,
                          result.similarity
                        )}
                        onMouseLeave={() => endHover(false)}
                        className={`flex-1 border border-gray-200 dark:border-gray-700 sepia:border-[#d9d0c0] rounded transition-all duration-200 bg-white dark:bg-gray-800 sepia:bg-[#faf8f3] hover:bg-blue-50 dark:hover:bg-gray-700 sepia:hover:bg-[#e8dfc8] hover:border-blue-300 dark:hover:border-blue-600 sepia:hover:border-blue-400 hover:shadow-lg ${
                          showClinical ? 'p-4' : 'px-3 py-1.5'
                        } ${isClicked ? 'animate-result-click' : ''}`}
                        style={isClicked ? { animation: 'result-click 0.4s ease-out' } : {}}
                      >
                        <div className={showClinical ? 'space-y-3' : ''}>
                          {/* Top row: Organ (compact) or System + Organ (clinical), Diagnosis */}
                          <div
                            onClick={() => handleResultClick(result, index)}
                            className={`${m.url ? 'cursor-pointer hover:opacity-80' : ''} ${showClinical ? '' : 'flex flex-col sm:flex-row items-start gap-2 sm:gap-3'}`}
                            title={m.url ? 'Click to view case' : ''}
                          >
                          {/* Organ only in compact, System + Organ in clinical */}
                          <div className={showClinical ? 'mb-2' : 'w-full sm:w-20 shrink-0 sm:text-right'}>
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
                          className={`flex-shrink-0 w-11 h-11 rounded-full flex items-center justify-center transition-colors min-w-[44px] min-h-[44px] ${
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

        {/* Mobile Filters Drawer */}
        <BottomDrawer
          isOpen={mobileFiltersOpen}
          onClose={() => setMobileFiltersOpen(false)}
          title="Filters"
        >
          <div className="space-y-4">
            {/* Action Buttons at Top */}
            {searched && results.length > 0 && (
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => setShowClinical(!showClinical)}
                  className={`w-full px-4 py-3 rounded-lg text-sm font-medium transition-colors min-h-[44px] ${
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
                  className={`w-full px-4 py-3 rounded-lg text-sm font-medium transition-colors min-h-[44px] ${
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
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 sepia:text-gray-800 mb-2">Systems</h3>
              <div className="flex flex-col gap-2">
                {SYSTEMS.map((system) => (
                  <button
                    key={system}
                    onClick={() => toggleSystem(system)}
                    className={`w-full px-4 py-3 text-sm rounded-lg transition-colors text-left min-h-[44px] ${
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
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 sepia:text-gray-800 mb-2">Lineage</h3>
                <div className="space-y-2">
                  {lineageFrequencies.map((lineage) => (
                    <label
                      key={lineage}
                      className="flex items-center gap-3 px-4 py-3 bg-white dark:bg-gray-700 sepia:bg-[#faf8f3] border border-gray-300 dark:border-gray-600 sepia:border-[#d9d0c0] rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 sepia:hover:bg-[#f0ebe0] cursor-pointer min-h-[44px]"
                    >
                      <input
                        type="checkbox"
                        checked={selectedLineages.has(lineage)}
                        onChange={() => toggleLineage(lineage)}
                        className="w-5 h-5 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-sm text-gray-900 dark:text-gray-100 sepia:text-gray-900 flex-1">
                        {lineage}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Organ Dropdown */}
            {searched && organFrequencies.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 sepia:text-gray-800 mb-2">Organ</h3>
                <div className="space-y-2">
                  {organFrequencies.map((organ) => (
                    <label
                      key={organ}
                      className="flex items-center gap-3 px-4 py-3 bg-white dark:bg-gray-700 sepia:bg-[#faf8f3] border border-gray-300 dark:border-gray-600 sepia:border-[#d9d0c0] rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 sepia:hover:bg-[#f0ebe0] cursor-pointer min-h-[44px]"
                    >
                      <input
                        type="checkbox"
                        checked={selectedOrgans.has(organ)}
                        onChange={() => toggleOrgan(organ)}
                        className="w-5 h-5 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-sm text-gray-900 dark:text-gray-100 sepia:text-gray-900 flex-1">
                        {organ}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Source Filters */}
            <div>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 sepia:text-gray-800 mb-2">Sources</h3>
              <div className="flex flex-col gap-2">
                {SOURCES.map((source) => (
                  <button
                    key={source}
                    onClick={() => toggleSource(source)}
                    className={`w-full px-4 py-3 text-sm rounded-lg transition-colors text-left min-h-[44px] ${
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
        </BottomDrawer>
        </div>
      </div>
    </main>
  );
}
