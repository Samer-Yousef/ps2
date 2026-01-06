// Custom hooks for analytics tracking with debouncing and session management

import { useEffect, useRef, useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useTheme } from '@/components/ThemeProvider';
import {
  trackSessionStart,
  trackSearchComplete,
  trackSearchRefinement,
  trackSearchToResultTime,
  trackUserIdle,
  trackReturnFromIdle,
  trackSessionMilestone,
  trackSearchesPerVisit,
  trackTotalTimeOnSite,
  trackSessionClassification,
} from '@/lib/analytics';

/**
 * Hook for tracking search behavior with 5-second pause detection
 */
export function useSearchTracking() {
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSearchTimeRef = useRef<number>(0);
  const lastQueryRef = useRef<string>('');
  const keystrokeCountRef = useRef<number>(0);
  const backspaceCountRef = useRef<number>(0);
  const refinementCountRef = useRef<number>(0);
  const searchStartTimeRef = useRef<number>(0);
  const pauseStartTimeRef = useRef<number>(0);

  /**
   * Call this on every keystroke in the search box
   */
  const trackKeystroke = useCallback((query: string, isBackspace: boolean = false) => {
    if (isBackspace) {
      backspaceCountRef.current++;
    } else {
      keystrokeCountRef.current++;
    }

    // Check if this is a refinement (user paused, now continuing)
    if (pauseStartTimeRef.current && Date.now() - pauseStartTimeRef.current > 5000) {
      if (lastQueryRef.current && lastQueryRef.current !== query) {
        refinementCountRef.current++;
      }
    }

    pauseStartTimeRef.current = 0; // Reset pause
  }, []);

  /**
   * Call this when search results are returned
   */
  const trackSearchResults = useCallback((
    query: string,
    resultCount: number,
    searchLatencyMs: number
  ) => {
    lastQueryRef.current = query;
    searchStartTimeRef.current = Date.now();
    lastSearchTimeRef.current = Date.now();

    // Clear any existing timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    // Set a 5-second timeout to track search completion
    searchTimeoutRef.current = setTimeout(() => {
      // User stopped typing for 5+ seconds - track as completed search
      trackSearchComplete({
        finalQuery: query,
        resultCount,
        searchLatencyMs,
        keystrokeCount: keystrokeCountRef.current,
        backspaceCount: backspaceCountRef.current,
        refinementCount: refinementCountRef.current,
      });

      // Reset counters
      keystrokeCountRef.current = 0;
      backspaceCountRef.current = 0;
      refinementCountRef.current = 0;
      pauseStartTimeRef.current = Date.now();
    }, 5000);
  }, []);

  /**
   * Call this when a result is clicked
   */
  const trackResultClicked = useCallback(() => {
    // User clicked a result - clear the timeout and track completion immediately
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
      searchTimeoutRef.current = null;
    }

    if (lastQueryRef.current) {
      const timeSinceSearch = Date.now() - searchStartTimeRef.current;

      trackSearchComplete({
        finalQuery: lastQueryRef.current,
        resultCount: 0, // Will be filled by the component
        searchLatencyMs: timeSinceSearch,
        keystrokeCount: keystrokeCountRef.current,
        backspaceCount: backspaceCountRef.current,
        refinementCount: refinementCountRef.current,
      });

      // Reset counters
      keystrokeCountRef.current = 0;
      backspaceCountRef.current = 0;
      refinementCountRef.current = 0;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, []);

  return {
    trackKeystroke,
    trackSearchResults,
    trackResultClicked,
    lastQuery: lastQueryRef.current,
    searchStartTime: searchStartTimeRef.current,
  };
}

/**
 * Hook for tracking session start and user activity
 */
export function useSessionTracking() {
  const { data: session } = useSession();
  const { theme } = useTheme();
  const [sessionStarted, setSessionStarted] = useState(false);

  useEffect(() => {
    if (!sessionStarted) {
      // Track session start
      trackSessionStart({
        isAuthenticated: !!session,
        theme: theme as 'light' | 'dark' | 'sepia',
        landingPage: typeof window !== 'undefined' ? window.location.pathname : '/',
      });
      setSessionStarted(true);
    }
  }, [session, theme, sessionStarted]);
}

/**
 * Hook for tracking time on site and session milestones
 */
export function useTimeTracking() {
  const sessionStartRef = useRef<number>(Date.now());
  const lastActiveRef = useRef<number>(Date.now());
  const activeTimeRef = useRef<number>(0);
  const idleTimeRef = useRef<number>(0);
  const tabHiddenTimeRef = useRef<number>(0);
  const tabHiddenStartRef = useRef<number | null>(null);
  const searchCountRef = useRef<number>(0);
  const clickCountRef = useRef<number>(0);
  const favoritesAddedRef = useRef<number>(0);
  const pagesVisitedRef = useRef<Set<string>>(new Set(['/']));
  const milestonesReachedRef = useRef<Set<string>>(new Set());
  const lastIdleCheckRef = useRef<number>(Date.now());
  const idleTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isIdleRef = useRef<boolean>(false);
  const idleStartRef = useRef<number | null>(null);

  // Track activity (mousemove, click, keypress, scroll)
  useEffect(() => {
    const handleActivity = () => {
      const now = Date.now();

      // If was idle, track return from idle
      if (isIdleRef.current && idleStartRef.current) {
        const idleDuration = now - idleStartRef.current;
        trackReturnFromIdle({
          idleDurationMs: idleDuration,
          firstActionOnReturn: 'continued_search', // Will be updated by specific actions
        });
        isIdleRef.current = false;
        idleStartRef.current = null;
      }

      // Update active time
      const timeSinceLastCheck = now - lastIdleCheckRef.current;
      if (timeSinceLastCheck < 3 * 60 * 1000) {
        // Less than 3 minutes = active
        activeTimeRef.current += timeSinceLastCheck;
      } else {
        // More than 3 minutes = was idle
        idleTimeRef.current += timeSinceLastCheck;
      }

      lastActiveRef.current = now;
      lastIdleCheckRef.current = now;

      // Reset idle timeout
      if (idleTimeoutRef.current) {
        clearTimeout(idleTimeoutRef.current);
      }

      // Set 3-minute idle timeout
      idleTimeoutRef.current = setTimeout(() => {
        if (!isIdleRef.current) {
          isIdleRef.current = true;
          idleStartRef.current = Date.now();
          trackUserIdle({
            idleDurationMs: 3 * 60 * 1000,
            lastAction: 'unknown',
            searchResultsVisible: true,
            sessionSearchesSoFar: searchCountRef.current,
          });
        }
      }, 3 * 60 * 1000); // 3 minutes
    };

    // Add event listeners
    window.addEventListener('mousemove', handleActivity);
    window.addEventListener('mousedown', handleActivity);
    window.addEventListener('keypress', handleActivity);
    window.addEventListener('scroll', handleActivity);
    window.addEventListener('touchstart', handleActivity);

    return () => {
      window.removeEventListener('mousemove', handleActivity);
      window.removeEventListener('mousedown', handleActivity);
      window.removeEventListener('keypress', handleActivity);
      window.removeEventListener('scroll', handleActivity);
      window.removeEventListener('touchstart', handleActivity);

      if (idleTimeoutRef.current) {
        clearTimeout(idleTimeoutRef.current);
      }
    };
  }, []);

  // Track visibility changes (tab hidden/shown)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        tabHiddenStartRef.current = Date.now();
      } else if (tabHiddenStartRef.current) {
        tabHiddenTimeRef.current += Date.now() - tabHiddenStartRef.current;
        tabHiddenStartRef.current = null;
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // Check for time milestones
  useEffect(() => {
    const checkMilestones = () => {
      const timeOnSite = Date.now() - sessionStartRef.current;
      const milestones = [
        { name: '1min', time: 1 * 60 * 1000 },
        { name: '5min', time: 5 * 60 * 1000 },
        { name: '10min', time: 10 * 60 * 1000 },
        { name: '30min', time: 30 * 60 * 1000 },
      ];

      for (const milestone of milestones) {
        if (timeOnSite >= milestone.time && !milestonesReachedRef.current.has(milestone.name)) {
          milestonesReachedRef.current.add(milestone.name);
          trackSessionMilestone({
            milestone: milestone.name as '1min' | '5min' | '10min' | '30min',
            searchesSoFar: searchCountRef.current,
            clicksSoFar: clickCountRef.current,
            favoritesAdded: favoritesAddedRef.current,
            pagesVisited: Array.from(pagesVisitedRef.current),
            activeTimeMs: activeTimeRef.current,
          });
        }
      }
    };

    const interval = setInterval(checkMilestones, 30000); // Check every 30 seconds

    return () => clearInterval(interval);
  }, []);

  // Track on page unload
  useEffect(() => {
    const handleBeforeUnload = () => {
      const sessionDuration = Date.now() - sessionStartRef.current;
      const engagementRate = sessionDuration > 0 ? (activeTimeRef.current / sessionDuration) * 100 : 0;

      trackTotalTimeOnSite({
        sessionDurationMs: sessionDuration,
        activeDurationMs: activeTimeRef.current,
        idleDurationMs: idleTimeRef.current,
        tabHiddenDurationMs: tabHiddenTimeRef.current,
        engagementRate,
        pagesVisited: pagesVisitedRef.current.size,
        pageDurations: {}, // Can be enhanced later
      });

      // Track session classification
      let sessionType: 'engaged' | 'explorer' | 'bounced' | 'power_user';
      if (searchCountRef.current >= 10 && clickCountRef.current >= 5 && favoritesAddedRef.current > 0) {
        sessionType = 'power_user';
      } else if (searchCountRef.current >= 5) {
        sessionType = 'explorer';
      } else if (searchCountRef.current >= 3 && clickCountRef.current >= 2) {
        sessionType = 'engaged';
      } else {
        sessionType = 'bounced';
      }

      trackSessionClassification({
        sessionType,
        totalSearches: searchCountRef.current,
        totalClicks: clickCountRef.current,
        favoritesAdded: favoritesAddedRef.current,
        timeOnSiteMs: sessionDuration,
        pagesVisited: pagesVisitedRef.current.size,
        featureUsage: [], // Will be tracked separately
      });
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  return {
    incrementSearchCount: () => searchCountRef.current++,
    incrementClickCount: () => clickCountRef.current++,
    incrementFavoritesAdded: () => favoritesAddedRef.current++,
    addPageVisited: (page: string) => pagesVisitedRef.current.add(page),
  };
}

/**
 * Hook for tracking scroll behavior on search results
 */
export function useScrollTracking() {
  const scrollStartTimeRef = useRef<number | null>(null);
  const maxScrollPositionRef = useRef<number>(0);
  const scrollDirectionChangesRef = useRef<number>(0);
  const lastScrollPositionRef = useRef<number>(0);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const trackScroll = useCallback((currentScrollPosition: number, maxResultPosition: number) => {
    // Start tracking if this is first scroll
    if (!scrollStartTimeRef.current) {
      scrollStartTimeRef.current = Date.now();
    }

    // Track maximum scroll depth
    if (currentScrollPosition > maxScrollPositionRef.current) {
      maxScrollPositionRef.current = currentScrollPosition;
    }

    // Detect scroll direction changes (scroll back up)
    if (currentScrollPosition < lastScrollPositionRef.current) {
      scrollDirectionChangesRef.current++;
    }

    lastScrollPositionRef.current = currentScrollPosition;

    // Clear existing timeout
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }

    // Track scroll behavior after user stops scrolling for 2 seconds
    scrollTimeoutRef.current = setTimeout(() => {
      if (scrollStartTimeRef.current) {
        const scrollDuration = Date.now() - scrollStartTimeRef.current;
        const scrollSpeed = scrollDuration < 2000 ? 'fast' : scrollDuration < 5000 ? 'medium' : 'slow';

        import('@/lib/analytics').then(({ trackScrollBehavior }) => {
          trackScrollBehavior({
            maxResultPositionViewed: maxResultPosition,
            scrollSpeed,
            totalScrollTimeMs: scrollDuration,
            scrollBackCount: scrollDirectionChangesRef.current,
          });
        });

        // Reset for next scroll session
        scrollStartTimeRef.current = null;
        maxScrollPositionRef.current = 0;
        scrollDirectionChangesRef.current = 0;
      }
    }, 2000);
  }, []);

  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

  return { trackScroll };
}

/**
 * Hook for tracking result hover behavior
 */
export function useHoverTracking() {
  const hoverStartRef = useRef<{ resultId: string; position: number; startTime: number } | null>(null);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const startHover = useCallback((resultId: string, position: number, diagnosis: string, similarityScore?: number) => {
    hoverStartRef.current = {
      resultId,
      position,
      startTime: Date.now(),
    };

    // Track if hover lasts 2+ seconds
    hoverTimeoutRef.current = setTimeout(() => {
      if (hoverStartRef.current) {
        const hoverDuration = Date.now() - hoverStartRef.current.startTime;

        import('@/lib/analytics').then(({ trackResultHover }) => {
          trackResultHover({
            resultId: hoverStartRef.current!.resultId,
            resultPosition: hoverStartRef.current!.position,
            hoverDurationMs: hoverDuration,
            clickedAfterHover: false, // Will be updated if they click
            diagnosis,
            similarityScore,
          });
        });
      }
    }, 2000);
  }, []);

  const endHover = useCallback((clicked: boolean = false) => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }

    // If clicked after hover, track it
    if (clicked && hoverStartRef.current) {
      const hoverDuration = Date.now() - hoverStartRef.current.startTime;
      if (hoverDuration >= 2000) {
        // Already tracked by timeout, will be marked as not clicked
        // We could enhance this to update the event
      }
    }

    hoverStartRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
    };
  }, []);

  return { startHover, endHover };
}

/**
 * Hook for tracking click patterns and comparison behavior
 */
export function useClickPatternTracking() {
  const sessionClicksRef = useRef<Array<{
    resultId: string;
    position: number;
    timestamp: number;
    diagnosis: string;
    organ?: string;
    system?: string;
  }>>([]);

  const trackClick = useCallback((
    resultId: string,
    position: number,
    diagnosis: string,
    organ?: string,
    system?: string
  ) => {
    const now = Date.now();
    sessionClicksRef.current.push({
      resultId,
      position,
      timestamp: now,
      diagnosis,
      organ,
      system,
    });

    // Check for comparison behavior (3+ clicks within 30 seconds)
    const recentClicks = sessionClicksRef.current.filter(
      click => now - click.timestamp < 30000
    );

    if (recentClicks.length >= 3) {
      const timeSpan = now - recentClicks[0].timestamp;
      const resultIds = recentClicks.map(c => c.resultId);
      const diagnoses = [...new Set(recentClicks.map(c => c.diagnosis))];
      const returnedToSame = new Set(resultIds).size < resultIds.length;

      import('@/lib/analytics').then(({ trackComparisonBehavior }) => {
        trackComparisonBehavior({
          resultIds,
          query: '', // Will be filled by caller
          timeSpanMs: timeSpan,
          returnedToSameResult: returnedToSame,
          diagnosesCompared: diagnoses,
        });
      });
    }

    // Analyze click pattern after session
    const totalClicks = sessionClicksRef.current.length;
    if (totalClicks > 0) {
      const positions = sessionClicksRef.current.map(c => c.position);
      const uniqueOrgans = new Set(sessionClicksRef.current.map(c => c.organ).filter(Boolean)).size;
      const uniqueSystems = new Set(sessionClicksRef.current.map(c => c.system).filter(Boolean)).size;
      const clickDepthMax = Math.max(...positions);
      const timeBetweenClicks = sessionClicksRef.current
        .slice(1)
        .map((click, i) => click.timestamp - sessionClicksRef.current[i].timestamp);

      import('@/lib/analytics').then(({ trackClickPattern }) => {
        trackClickPattern({
          searchSessionId: `session_${Date.now()}`,
          totalClicks,
          clickPositions: positions,
          timeBetweenClicksMs: timeBetweenClicks,
          uniqueOrgansClicked: uniqueOrgans,
          uniqueSystemsClicked: uniqueSystems,
          clickDepthMax,
        });
      });
    }
  }, []);

  const resetSession = useCallback(() => {
    sessionClicksRef.current = [];
  }, []);

  return { trackClick, resetSession };
}

/**
 * Hook for tracking rapid search patterns
 */
export function useRapidSearchTracking() {
  const searchHistoryRef = useRef<Array<{
    query: string;
    timestamp: number;
    resultCount: number;
    topSimilarity: number;
  }>>([]);

  const trackSearch = useCallback((
    query: string,
    resultCount: number,
    topSimilarity: number
  ) => {
    const now = Date.now();
    searchHistoryRef.current.push({
      query,
      timestamp: now,
      resultCount,
      topSimilarity,
    });

    // Check for rapid search pattern (5+ searches within 2 minutes)
    const recentSearches = searchHistoryRef.current.filter(
      search => now - search.timestamp < 120000 // 2 minutes
    );

    if (recentSearches.length >= 5) {
      const timeWindow = now - recentSearches[0].timestamp;

      // Calculate query similarity (simple word overlap)
      const calculateSimilarity = (q1: string, q2: string): number => {
        const words1 = q1.toLowerCase().split(/\s+/);
        const words2 = q2.toLowerCase().split(/\s+/);
        const overlap = words1.filter(w => words2.includes(w)).length;
        return overlap / Math.max(words1.length, words2.length);
      };

      const avgSimilarity = recentSearches.slice(1).reduce((sum, search, i) => {
        return sum + calculateSimilarity(search.query, recentSearches[i].query);
      }, 0) / (recentSearches.length - 1);

      // Determine result quality trend
      const similarities = recentSearches.map(s => s.topSimilarity);
      const firstHalf = similarities.slice(0, Math.floor(similarities.length / 2));
      const secondHalf = similarities.slice(Math.floor(similarities.length / 2));
      const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
      const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

      const resultQualityTrend = secondAvg > firstAvg + 0.1 ? 'improving' :
                                 secondAvg < firstAvg - 0.1 ? 'declining' : 'stable';

      // Determine clicking behavior based on result counts
      const avgResults = recentSearches.reduce((sum, s) => sum + s.resultCount, 0) / recentSearches.length;
      const clickingBehavior = avgSimilarity > 0.6 ? 'exploring' :
                              resultQualityTrend === 'declining' ? 'frustrated' : 'comparing';

      import('@/lib/analytics').then(({ trackRapidSearchPattern }) => {
        trackRapidSearchPattern({
          searchCount: recentSearches.length,
          timeWindowMs: timeWindow,
          querySimilarity: avgSimilarity,
          resultQualityTrend,
          clickingBehavior,
          finalQuery: query,
        });
      });
    }

    // Keep only recent searches
    searchHistoryRef.current = searchHistoryRef.current.filter(
      search => now - search.timestamp < 300000 // 5 minutes
    );
  }, []);

  return { trackSearch };
}
