'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ThemeSelector } from '@/components/ThemeSelector';
import { trackDashboardFilterUsage, trackRandomSlideShown, trackDashboardSearch } from '@/lib/analytics';

interface HistoryItem {
  id: string;
  caseId: string;
  viewedAt: string;
  metadata: any;
}

interface FavoriteItem {
  id: string;
  caseId: string;
  addedAt: string;
  notes: string | null;
  metadata: any;
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

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
  const [favoriteCaseIds, setFavoriteCaseIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'history' | 'favorites'>('favorites');
  const [revealedDiagnoses, setRevealedDiagnoses] = useState<Set<string>>(new Set());
  const [showClinical, setShowClinical] = useState(false);
  const [hideDiagnosis, setHideDiagnosis] = useState(true);
  const [modalItem, setModalItem] = useState<(HistoryItem | FavoriteItem) | null>(null);
  const [modalDiagnosisRevealed, setModalDiagnosisRevealed] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSources, setSelectedSources] = useState<Set<string>>(new Set(SOURCES));
  const [selectedSystems, setSelectedSystems] = useState<Set<string>>(new Set());
  const [selectedLineages, setSelectedLineages] = useState<Set<string>>(new Set());
  const [selectedOrgans, setSelectedOrgans] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
      return;
    }

    if (status === 'authenticated') {
      // Fetch history and favorites
      Promise.all([
        fetch('/api/history').then(res => res.json()),
        fetch('/api/favorites').then(res => res.json())
      ])
        .then(([historyData, favoritesData]) => {
          setHistory(historyData.history || []);
          setFavorites(favoritesData.favorites || []);
          setFavoriteCaseIds(new Set((favoritesData.favorites || []).map((f: FavoriteItem) => f.caseId)));
        })
        .catch(error => {
          console.error('Failed to load dashboard data:', error);
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [status, router]);

  // Toggle filter functions
  const toggleSource = (source: string) => {
    const newSelected = new Set(selectedSources);
    if (newSelected.has(source)) {
      newSelected.delete(source);
    } else {
      newSelected.add(source);
    }
    setSelectedSources(newSelected);
  };

  const toggleSystem = (system: string) => {
    const newSelected = new Set(selectedSystems);
    if (newSelected.has(system)) {
      newSelected.delete(system);
    } else {
      newSelected.add(system);
    }
    setSelectedSystems(newSelected);
  };

  const toggleLineage = (lineage: string) => {
    const newSelected = new Set(selectedLineages);
    if (newSelected.has(lineage)) {
      newSelected.delete(lineage);
    } else {
      newSelected.add(lineage);
    }
    setSelectedLineages(newSelected);
  };

  const toggleOrgan = (organ: string) => {
    const newSelected = new Set(selectedOrgans);
    if (newSelected.has(organ)) {
      newSelected.delete(organ);
    } else {
      newSelected.add(organ);
    }
    setSelectedOrgans(newSelected);
  };

  const removeFavorite = async (caseId: string) => {
    try {
      const response = await fetch(`/api/favorites?caseId=${encodeURIComponent(caseId)}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        setFavorites(favorites.filter(f => f.caseId !== caseId));
        setFavoriteCaseIds(prev => {
          const newSet = new Set(prev);
          newSet.delete(caseId);
          return newSet;
        });
      }
    } catch (error) {
      console.error('Failed to remove favorite:', error);
    }
  };

  const toggleFavorite = async (item: HistoryItem | FavoriteItem, e: React.MouseEvent) => {
    e.stopPropagation();
    const metadata = parseMetadata(item.metadata);
    const isFavorited = favoriteCaseIds.has(item.caseId);

    try {
      if (isFavorited) {
        // Remove from favorites
        const response = await fetch(`/api/favorites?caseId=${encodeURIComponent(item.caseId)}`, {
          method: 'DELETE',
        });

        if (response.ok) {
          setFavoriteCaseIds(prev => {
            const newSet = new Set(prev);
            newSet.delete(item.caseId);
            return newSet;
          });
          setFavorites(favorites.filter(f => f.caseId !== item.caseId));
        }
      } else {
        // Add to favorites
        const response = await fetch('/api/favorites', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            caseId: item.caseId,
            metadata: JSON.stringify(metadata)
          })
        });

        if (response.ok) {
          setFavoriteCaseIds(prev => new Set(prev).add(item.caseId));
          // Refresh favorites list
          const favData = await fetch('/api/favorites').then(res => res.json());
          setFavorites(favData.favorites || []);
        }
      }
    } catch (error) {
      console.error('Failed to toggle favorite:', error);
    }
  };

  const parseMetadata = (metadataString: string | any) => {
    if (typeof metadataString === 'string') {
      try {
        return JSON.parse(metadataString);
      } catch {
        return {};
      }
    }
    return metadataString || {};
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const showRandomSlide = (items: (HistoryItem | FavoriteItem)[]) => {
    if (items.length === 0) return;
    const randomIndex = Math.floor(Math.random() * items.length);
    const randomItem = items[randomIndex];

    // Track random slide usage
    const metadata = parseMetadata(randomItem.metadata);
    trackRandomSlideShown({
      fromTab: activeTab,
      totalItemsAvailable: items.length,
      diagnosisRevealedImmediately: !hideDiagnosis,
      actionTaken: 'viewed_slide',
      diagnosis: metadata.diagnosis || '',
    });

    // Open modal with the random item
    setModalItem(randomItem);
    setModalDiagnosisRevealed(false);
  };

  const closeModal = () => {
    setModalItem(null);
    setModalDiagnosisRevealed(false);
  };

  const handleItemClick = (item: HistoryItem | FavoriteItem) => {
    const metadata = parseMetadata(item.metadata);
    if (metadata.url) {
      window.open(metadata.url, '_blank', 'noopener,noreferrer');
    }
  };

  // Get current items based on active tab
  const currentItems = activeTab === 'history' ? history : favorites;

  // Filter by source
  const sourceFiltered = useMemo(() => {
    if (selectedSources.size === 0) return currentItems;
    return currentItems.filter(item => {
      const metadata = parseMetadata(item.metadata);
      return selectedSources.has(metadata.source || '');
    });
  }, [currentItems, selectedSources]);

  // Filter by system
  const systemFiltered = useMemo(() => {
    if (selectedSystems.size === 0) return sourceFiltered;
    return sourceFiltered.filter(item => {
      const metadata = parseMetadata(item.metadata);
      return selectedSystems.has(metadata.system || '');
    });
  }, [sourceFiltered, selectedSystems]);

  // Calculate lineage and organ frequencies
  const lineageFrequencies = useMemo(() => {
    const counts = new Map<string, number>();
    systemFiltered.forEach(item => {
      const metadata = parseMetadata(item.metadata);
      const lineage = metadata.lineage;
      if (lineage && lineage.trim()) {
        counts.set(lineage, (counts.get(lineage) || 0) + 1);
      }
    });
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([lineage]) => lineage);
  }, [systemFiltered]);

  const organFrequencies = useMemo(() => {
    const counts = new Map<string, number>();
    systemFiltered.forEach(item => {
      const metadata = parseMetadata(item.metadata);
      const organ = metadata.organ;
      if (organ && organ.trim()) {
        counts.set(organ, (counts.get(organ) || 0) + 1);
      }
    });
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([organ]) => organ);
  }, [systemFiltered]);

  // Filter by lineage and organ
  const lineageOrganFiltered = useMemo(() => {
    let filtered = systemFiltered;

    if (selectedLineages.size > 0) {
      filtered = filtered.filter(item => {
        const metadata = parseMetadata(item.metadata);
        return selectedLineages.has(metadata.lineage || '');
      });
    }

    if (selectedOrgans.size > 0) {
      filtered = filtered.filter(item => {
        const metadata = parseMetadata(item.metadata);
        return selectedOrgans.has(metadata.organ || '');
      });
    }

    return filtered;
  }, [systemFiltered, selectedLineages, selectedOrgans]);

  // Filter by search query
  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return lineageOrganFiltered;

    const query = searchQuery.toLowerCase();
    return lineageOrganFiltered.filter(item => {
      const metadata = parseMetadata(item.metadata);
      const diagnosis = metadata.diagnosis || '';
      const organ = metadata.organ || '';
      const system = metadata.system || '';
      const source = metadata.source || '';

      return diagnosis.toLowerCase().includes(query) ||
             organ.toLowerCase().includes(query) ||
             system.toLowerCase().includes(query) ||
             source.toLowerCase().includes(query) ||
             item.caseId.toLowerCase().includes(query);
    });
  }, [lineageOrganFiltered, searchQuery]);

  // Track filter changes
  const previousFiltersRef = useRef<{
    sources: Set<string>;
    systems: Set<string>;
    lineages: Set<string>;
    organs: Set<string>;
  }>({
    sources: new Set(SOURCES),
    systems: new Set(),
    lineages: new Set(),
    organs: new Set(),
  });

  useEffect(() => {
    // Track filter usage when filters change
    const prev = previousFiltersRef.current;
    const hasFilterChanged =
      prev.sources.size !== selectedSources.size ||
      prev.systems.size !== selectedSystems.size ||
      prev.lineages.size !== selectedLineages.size ||
      prev.organs.size !== selectedOrgans.size;

    if (hasFilterChanged && currentItems.length > 0) {
      const filterCombinations = [
        ...Array.from(selectedSources),
        ...Array.from(selectedSystems),
        ...Array.from(selectedLineages),
        ...Array.from(selectedOrgans),
      ];

      const itemsBeforeFilter = currentItems.length;
      const itemsAfterFilter = filteredItems.length;

      trackDashboardFilterUsage({
        tab: activeTab,
        filterCombinations,
        itemsBeforeFilter,
        itemsAfterFilter,
        filterCleared: filterCombinations.length === 0,
      });

      previousFiltersRef.current = {
        sources: new Set(selectedSources),
        systems: new Set(selectedSystems),
        lineages: new Set(selectedLineages),
        organs: new Set(selectedOrgans),
      };
    }
  }, [selectedSources, selectedSystems, selectedLineages, selectedOrgans, currentItems.length, filteredItems.length, activeTab]);

  // Track dashboard search usage
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (searchQuery.trim() && filteredItems.length >= 0) {
      // Debounce search tracking
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }

      searchTimeoutRef.current = setTimeout(() => {
        trackDashboardSearch({
          tab: activeTab,
          query: searchQuery,
          resultsCount: filteredItems.length,
          totalItemsInTab: currentItems.length,
        });
      }, 1000); // Track after user stops typing for 1 second
    }

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery, filteredItems.length, currentItems.length, activeTab]);

  // Reset filters when tab changes
  useEffect(() => {
    setSearchQuery('');
    setSelectedSources(new Set(SOURCES));
    setSelectedSystems(new Set());
    setSelectedLineages(new Set());
    setSelectedOrgans(new Set());
  }, [activeTab]);

  if (status === 'loading' || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-white dark:bg-gray-900 sepia:bg-[#f5f1e8] p-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-0 mb-4 sm:mb-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white sepia:text-gray-900">Dashboard</h1>
            <p className="text-sm text-gray-600 dark:text-gray-400 sepia:text-gray-700 mt-1">
              Welcome back, {session?.user?.name || session?.user?.email}
            </p>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <ThemeSelector />
            <Link
              href="/"
              className="flex-1 sm:flex-initial px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-center min-h-[44px] flex items-center justify-center"
            >
              Back to Search
            </Link>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-4 border-b border-gray-200 dark:border-gray-700 sepia:border-[#d9d0c0]">
          <button
            onClick={() => setActiveTab('history')}
            className={`px-4 py-2 font-medium transition-colors border-b-2 ${
              activeTab === 'history'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400 sepia:text-blue-600'
                : 'border-transparent text-gray-600 dark:text-gray-400 sepia:text-gray-700 hover:text-gray-900 dark:hover:text-gray-200 sepia:hover:text-gray-900'
            }`}
          >
            History ({history.length})
          </button>
          <button
            onClick={() => setActiveTab('favorites')}
            className={`px-4 py-2 font-medium transition-colors border-b-2 ${
              activeTab === 'favorites'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400 sepia:text-blue-600'
                : 'border-transparent text-gray-600 dark:text-gray-400 sepia:text-gray-700 hover:text-gray-900 dark:hover:text-gray-200 sepia:hover:text-gray-900'
            }`}
          >
            Favorites ({favorites.length})
          </button>
        </div>

        {/* Search and Controls */}
        <div className="mb-3">
          <div className="mb-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={`Search ${activeTab}...`}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 sepia:border-[#d9d0c0] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800 sepia:bg-[#faf8f3] text-gray-900 dark:text-gray-100 sepia:text-gray-900 placeholder:text-gray-500 dark:placeholder:text-gray-400 sepia:placeholder:text-gray-600 min-h-[44px]"
            />
          </div>

          <div className="flex flex-col sm:flex-row gap-2 mb-3">
            <button
              onClick={() => setShowClinical(!showClinical)}
              className={`flex-1 sm:flex-initial px-3 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap min-h-[44px] ${
                showClinical
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'bg-white dark:bg-gray-700 sepia:bg-[#e8dfc8] text-gray-900 dark:text-gray-300 sepia:text-gray-800 border border-gray-900 dark:border-gray-600 sepia:border-[#d9d0c0] hover:bg-gray-50 dark:hover:bg-gray-600 sepia:hover:bg-[#ddd0b8]'
              }`}
            >
              {showClinical ? 'Hide Clinical' : 'Show Clinical'}
            </button>
            <button
              onClick={() => {
                setHideDiagnosis(!hideDiagnosis);
                setRevealedDiagnoses(new Set());
              }}
              className={`flex-1 sm:flex-initial px-3 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap min-h-[44px] ${
                hideDiagnosis
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'bg-white dark:bg-gray-700 sepia:bg-[#e8dfc8] text-gray-900 dark:text-gray-300 sepia:text-gray-800 border border-gray-900 dark:border-gray-600 sepia:border-[#d9d0c0] hover:bg-gray-50 dark:hover:bg-gray-600 sepia:hover:bg-[#ddd0b8]'
              }`}
            >
              {hideDiagnosis ? 'Show Diagnoses' : 'Hide Diagnoses'}
            </button>
            {currentItems.length > 0 && (
              <button
                onClick={() => showRandomSlide(filteredItems)}
                className="flex-1 sm:flex-initial px-3 py-2 rounded-lg text-sm font-medium bg-purple-600 text-white hover:bg-purple-700 transition-colors whitespace-nowrap min-h-[44px]"
              >
                Show Random
              </button>
            )}
          </div>

          {/* Result count */}
          <p className="text-sm text-gray-600 dark:text-gray-400 sepia:text-gray-700 mb-2">
            {filteredItems.length} {activeTab === 'history' ? 'history items' : 'favorites'}
            {searchQuery && ` for "${searchQuery}"`}
          </p>

          {/* System Filters */}
          <div className="mb-2 flex flex-wrap gap-1.5">
            {SYSTEMS.map((system) => (
              <button
                key={system}
                onClick={() => toggleSystem(system)}
                className={`px-2 py-0.5 text-xs rounded transition-colors ${
                  selectedSystems.has(system)
                    ? 'bg-blue-600 text-white'
                    : 'bg-white dark:bg-gray-700 sepia:bg-[#faf8f3] text-gray-700 dark:text-gray-300 sepia:text-gray-800 border border-gray-300 dark:border-gray-600 sepia:border-[#d9d0c0] hover:bg-gray-50 dark:hover:bg-gray-600 sepia:hover:bg-[#f0ebe0]'
                }`}
              >
                {system}
              </button>
            ))}
          </div>

          {/* Source Filters */}
          <div className="mb-2 flex flex-wrap gap-1.5">
            {SOURCES.map((source) => (
              <button
                key={source}
                onClick={() => toggleSource(source)}
                className={`px-2 py-0.5 text-xs rounded transition-colors ${
                  selectedSources.has(source)
                    ? 'bg-green-600 text-white'
                    : 'bg-white dark:bg-gray-700 sepia:bg-[#faf8f3] text-gray-700 dark:text-gray-300 sepia:text-gray-800 border border-gray-300 dark:border-gray-600 sepia:border-[#d9d0c0] hover:bg-gray-50 dark:hover:bg-gray-600 sepia:hover:bg-[#f0ebe0]'
                }`}
              >
                {source}
              </button>
            ))}
          </div>

          {/* Lineage Filters */}
          {lineageFrequencies.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {lineageFrequencies.slice(0, 10).map((lineage) => (
                <button
                  key={lineage}
                  onClick={() => toggleLineage(lineage)}
                  className={`px-2 py-0.5 text-xs rounded transition-colors ${
                    selectedLineages.has(lineage)
                      ? 'bg-orange-600 text-white'
                      : 'bg-white dark:bg-gray-700 sepia:bg-[#faf8f3] text-gray-700 dark:text-gray-300 sepia:text-gray-800 border border-gray-300 dark:border-gray-600 sepia:border-[#d9d0c0] hover:bg-gray-50 dark:hover:bg-gray-600 sepia:hover:bg-[#f0ebe0]'
                  }`}
                >
                  {lineage}
                </button>
              ))}
            </div>
          )}

          {/* Organ Filters */}
          {organFrequencies.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {organFrequencies.slice(0, 10).map((organ) => (
                <button
                  key={organ}
                  onClick={() => toggleOrgan(organ)}
                  className={`px-2 py-0.5 text-xs rounded transition-colors ${
                    selectedOrgans.has(organ)
                      ? 'bg-purple-600 text-white'
                      : 'bg-white dark:bg-gray-700 sepia:bg-[#faf8f3] text-gray-700 dark:text-gray-300 sepia:text-gray-800 border border-gray-300 dark:border-gray-600 sepia:border-[#d9d0c0] hover:bg-gray-50 dark:hover:bg-gray-600 sepia:hover:bg-[#f0ebe0]'
                  }`}
                >
                  {organ}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Items List */}
        <div className="space-y-2">
          {filteredItems.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-500 dark:text-gray-400 sepia:text-gray-600">
                {currentItems.length === 0
                  ? `No ${activeTab} yet`
                  : 'No results match your filters'}
              </p>
              {currentItems.length === 0 && (
                <Link
                  href="/"
                  className="text-blue-600 dark:text-blue-400 sepia:text-blue-600 hover:underline mt-2 inline-block"
                >
                  Start searching for cases
                </Link>
              )}
            </div>
          ) : (
            filteredItems.map((item) => {
                const metadata = parseMetadata(item.metadata);
                const isDiagnosisRevealed = revealedDiagnoses.has(item.id);
                const showDiagnosisContent = !hideDiagnosis || isDiagnosisRevealed;
                const capitalize = (str: string) => str ? str.charAt(0).toUpperCase() + str.slice(1).toLowerCase() : '';

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

                const site = getWithFallback(metadata.site, metadata.site_ai);
                const sex = getWithFallback(metadata.sex, metadata.sex_ai);
                const age = getWithFallback(metadata.age, metadata.age_ai);
                const clinicalHistory = getWithFallback(metadata.clinical_history, metadata.clinical_history_ai);
                const macroscopic = getWithFallback(metadata.macroscopic, metadata.macroscopic_ai);

                const isFavorited = favoriteCaseIds.has(item.caseId);
                const timestamp = 'viewedAt' in item ? item.viewedAt : item.addedAt;

                return (
                  <div key={item.id} className="flex items-start gap-2">
                    {/* Main card */}
                    <div
                      className={`flex-1 border border-gray-200 dark:border-gray-700 sepia:border-[#d9d0c0] rounded transition-all bg-white dark:bg-gray-800 sepia:bg-[#faf8f3] ${
                        showClinical ? 'p-4' : 'px-3 py-1.5'
                      }`}
                    >
                      <div className={showClinical ? 'space-y-3' : ''}>
                        {/* Clickable content */}
                        <div
                          onClick={() => handleItemClick(item)}
                          className={`${metadata.url ? 'cursor-pointer hover:opacity-80' : ''} ${showClinical ? '' : 'flex flex-col sm:flex-row items-start gap-2 sm:gap-3'}`}
                        >
                          {/* Left: Organ and source */}
                          <div className={showClinical ? 'mb-2' : 'w-full sm:w-28 lg:w-32 shrink-0 sm:text-right'}>
                            {showClinical && metadata.system && (
                              <div className="font-medium text-gray-900 dark:text-gray-100 sepia:text-gray-900 text-base">
                                {metadata.system}
                              </div>
                            )}
                            {metadata.organ && (
                              <div className={`text-gray-600 dark:text-gray-400 sepia:text-gray-700 ${showClinical ? 'text-sm' : 'text-xs leading-tight break-words'}`}>
                                {capitalize(metadata.organ)}
                              </div>
                            )}
                            {metadata.source && (
                              <div className={`text-gray-500 dark:text-gray-500 sepia:text-gray-600 ${showClinical ? 'text-xs mt-0.5' : 'text-[0.625rem] leading-none mt-0.5'}`}>
                                {metadata.source}
                              </div>
                            )}
                          </div>

                          {/* Center: Diagnosis */}
                          <div className="flex-1 min-w-0">
                            {showDiagnosisContent ? (
                              <div className="flex items-start gap-2 flex-wrap">
                                <h3 className={`font-medium text-blue-600 dark:text-blue-400 sepia:text-blue-700 ${showClinical ? 'text-lg' : 'text-base leading-tight'}`}>
                                  {metadata.diagnosis || 'Unknown diagnosis'}
                                </h3>
                                {metadata.variant && (
                                  <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 sepia:bg-amber-100 text-amber-700 dark:text-amber-300 sepia:text-amber-800 whitespace-nowrap">
                                    {metadata.variant}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setRevealedDiagnoses(new Set(revealedDiagnoses).add(item.id));
                                }}
                                className="px-3 py-1 text-sm bg-blue-100 dark:bg-blue-900/30 sepia:bg-blue-100 text-blue-700 dark:text-blue-300 sepia:text-blue-800 rounded hover:bg-blue-200 dark:hover:bg-blue-900/50 sepia:hover:bg-blue-200"
                              >
                                Show Diagnosis
                              </button>
                            )}
                            {showClinical && (
                              <p className="text-xs text-gray-500 dark:text-gray-500 sepia:text-gray-600 mt-1">
                                {formatDate(timestamp)}
                              </p>
                            )}
                          </div>
                        </div>

                    {/* Clinical section (only when showClinical is true) */}
                    {showClinical && (
                      <div className="border-t border-gray-200 dark:border-gray-700 sepia:border-[#d9d0c0] mt-3 pt-3 space-y-2">
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
                        {metadata.microscopic && showDiagnosisContent && (
                          <div className="text-sm">
                            <span className="font-medium text-gray-700 dark:text-gray-300 sepia:text-gray-800">Microscopic: </span>
                            <span className="text-gray-600 dark:text-gray-400 sepia:text-gray-700">{metadata.microscopic}</span>
                          </div>
                        )}

                        {/* Case metadata */}
                        <div className="flex gap-4 text-xs text-gray-500 dark:text-gray-500 sepia:text-gray-600 pt-2">
                          {item.caseId && <span>Case: {item.caseId}</span>}
                          {metadata.source && <span>Source: {metadata.source}</span>}
                          {metadata.stain && <span>Stain: {metadata.stain}</span>}
                        </div>
                      </div>
                    )}
                      </div>
                    </div>

                    {/* Favorite/Remove button */}
                    {activeTab === 'history' ? (
                      <button
                        onClick={(e) => toggleFavorite(item, e)}
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
                    ) : (
                      <div className="flex-shrink-0 flex flex-col items-end gap-1">
                        {!showClinical && (
                          <p className="text-xs text-gray-500 dark:text-gray-500 sepia:text-gray-600 whitespace-nowrap">
                            {formatDate(timestamp)}
                          </p>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeFavorite(item.caseId);
                          }}
                          className="text-xs text-red-600 dark:text-red-400 sepia:text-red-700 hover:underline"
                        >
                          Remove
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
        </div>
      </div>

      {/* Random Slide Modal */}
      {modalItem && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-3 sm:p-4 z-50" onClick={closeModal}>
          <div className="bg-white dark:bg-gray-800 sepia:bg-[#faf8f3] rounded-lg shadow-xl max-w-2xl w-full p-4 sm:p-6 border border-gray-200 dark:border-gray-700 sepia:border-[#d9d0c0] max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            {/* Close button */}
            <div className="flex justify-between items-start mb-4">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white sepia:text-gray-900">Random Slide</h2>
              <button
                onClick={closeModal}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 sepia:text-gray-600 sepia:hover:text-gray-800"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Slide content */}
            <div className="space-y-4">
              {(() => {
                const metadata = parseMetadata(modalItem.metadata);
                const capitalize = (str: string) => str ? str.charAt(0).toUpperCase() + str.slice(1).toLowerCase() : '';

                return (
                  <>
                    {/* System */}
                    {metadata.system && (
                      <div>
                        <span className="text-sm text-gray-500 dark:text-gray-400 sepia:text-gray-600">System:</span>
                        <p className="text-lg font-medium text-gray-900 dark:text-gray-100 sepia:text-gray-900">{metadata.system}</p>
                      </div>
                    )}

                    {/* Organ */}
                    {metadata.organ && (
                      <div>
                        <span className="text-sm text-gray-500 dark:text-gray-400 sepia:text-gray-600">Organ:</span>
                        <p className="text-lg font-medium text-gray-900 dark:text-gray-100 sepia:text-gray-900">{capitalize(metadata.organ)}</p>
                      </div>
                    )}

                    {/* Source */}
                    {metadata.source && (
                      <div>
                        <span className="text-sm text-gray-500 dark:text-gray-400 sepia:text-gray-600">Source:</span>
                        <p className="text-base text-gray-700 dark:text-gray-300 sepia:text-gray-800">{metadata.source}</p>
                      </div>
                    )}

                    {/* Case ID */}
                    <div>
                      <span className="text-sm text-gray-500 dark:text-gray-400 sepia:text-gray-600">Case ID:</span>
                      <p className="text-base text-gray-700 dark:text-gray-300 sepia:text-gray-800">{modalItem.caseId}</p>
                    </div>

                    {/* Diagnosis - hidden by default */}
                    <div className="border-t border-gray-200 dark:border-gray-700 sepia:border-[#d9d0c0] pt-4">
                      {modalDiagnosisRevealed ? (
                        <div>
                          <span className="text-sm text-gray-500 dark:text-gray-400 sepia:text-gray-600">Diagnosis:</span>
                          <p className="text-xl font-bold text-blue-600 dark:text-blue-400 sepia:text-blue-700 mt-1">
                            {metadata.diagnosis || 'Unknown diagnosis'}
                          </p>
                        </div>
                      ) : (
                        <button
                          onClick={() => setModalDiagnosisRevealed(true)}
                          className="w-full px-4 py-3 bg-blue-100 dark:bg-blue-900/30 sepia:bg-blue-100 text-blue-700 dark:text-blue-300 sepia:text-blue-800 rounded-lg hover:bg-blue-200 dark:hover:bg-blue-900/50 sepia:hover:bg-blue-200 font-medium transition-colors"
                        >
                          Show Diagnosis
                        </button>
                      )}
                    </div>

                    {/* Action buttons */}
                    <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 pt-4">
                      {metadata.url ? (
                        <button
                          onClick={() => {
                            window.open(metadata.url, '_blank', 'noopener,noreferrer');
                            closeModal();
                          }}
                          className="flex-1 px-4 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 font-medium transition-colors min-h-[44px]"
                        >
                          View Slide
                        </button>
                      ) : (
                        <button
                          disabled
                          className="flex-1 px-4 py-3 bg-gray-300 dark:bg-gray-700 sepia:bg-gray-300 text-gray-500 dark:text-gray-500 sepia:text-gray-600 rounded-lg font-medium cursor-not-allowed min-h-[44px]"
                          title="URL not available"
                        >
                          URL Not Available
                        </button>
                      )}
                      <button
                        onClick={closeModal}
                        className="sm:flex-initial px-4 py-3 bg-gray-200 dark:bg-gray-700 sepia:bg-[#e8dfc8] text-gray-700 dark:text-gray-300 sepia:text-gray-900 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 sepia:hover:bg-[#ddd0b8] font-medium transition-colors min-h-[44px]"
                      >
                        Close
                      </button>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
