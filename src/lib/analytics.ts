// Google Analytics 4 tracking utilities

declare global {
  interface Window {
    gtag?: (...args: any[]) => void;
    dataLayer?: any[];
  }
}

/**
 * Get device, geographic, and referrer context (lightweight helper for all events)
 */
const getDeviceGeoContext = () => {
  if (typeof window === 'undefined') return {};

  const userAgent = window.navigator.userAgent.toLowerCase();
  const locale = window.navigator.language || '';

  // Get referrer information (where the user came from)
  const referrer = typeof document !== 'undefined' ? document.referrer : '';
  const referrerDomain = referrer ? (() => {
    try {
      return new URL(referrer).hostname;
    } catch {
      return undefined;
    }
  })() : undefined;

  return {
    device_type: userAgent.includes('mobile') || userAgent.includes('iphone') ? 'mobile' :
                 userAgent.includes('ipad') || userAgent.includes('tablet') ? 'tablet' : 'desktop',
    country: locale.split('-')[1] || undefined,
    referrer: referrer || undefined,
    referrer_domain: referrerDomain,
  };
};

/**
 * Base function to track events to Google Analytics
 */
export const trackEvent = (eventName: string, parameters: Record<string, any> = {}) => {
  if (typeof window !== 'undefined' && window.gtag) {
    // Add device and geo context to all events (lightweight)
    const context = getDeviceGeoContext();
    const enrichedParams = { ...parameters, ...context };

    // Debug: Log event to console in development
    if (process.env.NODE_ENV === 'development') {
      console.log('📊 Analytics Event:', eventName, enrichedParams);
    }
    window.gtag('event', eventName, enrichedParams);
  } else if (typeof window !== 'undefined') {
    // GA not loaded yet
    console.warn('⚠️ Google Analytics not loaded. Event:', eventName);
  }
};

// ============================================================================
// SEARCH TRACKING
// ============================================================================

/**
 * Track completed search sessions (triggered after 5s pause, click, or filter)
 */
export const trackSearchComplete = (params: {
  finalQuery: string;
  resultCount: number;
  searchLatencyMs: number;
  keystrokeCount?: number;
  backspaceCount?: number;
  refinementCount?: number;
}) => {
  trackEvent('search_session_complete', {
    final_query: params.finalQuery,
    query_length: params.finalQuery.length,
    result_count: params.resultCount,
    search_latency_ms: params.searchLatencyMs,
    keystroke_count: params.keystrokeCount || 0,
    backspace_count: params.backspaceCount || 0,
    refinement_count: params.refinementCount || 0,
    search_mode: 'client', // Using client-side vector search
  });
};

/**
 * Track search refinement (user pauses, then continues typing)
 */
export const trackSearchRefinement = (params: {
  fromQuery: string;
  toQuery: string;
  resultsBefore: number;
  resultsAfter: number;
  timeSpentViewingMs: number;
}) => {
  trackEvent('search_refinement', {
    from_query: params.fromQuery,
    to_query: params.toQuery,
    results_before: params.resultsBefore,
    results_after: params.resultsAfter,
    time_spent_viewing_ms: params.timeSpentViewingMs,
  });
};

/**
 * Track searches that return low relevance results
 */
export const trackLowRelevanceSearch = (params: {
  query: string;
  topSimilarityScore: number;
  resultCount: number;
  nextAction?: 'refined_query' | 'clicked_anyway' | 'abandoned';
  clickedResultPosition?: number;
}) => {
  trackEvent('search_low_relevance', {
    query: params.query,
    top_similarity_score: params.topSimilarityScore,
    result_count: params.resultCount,
    next_action: params.nextAction,
    clicked_result_position: params.clickedResultPosition,
  });
};

/**
 * Track abandoned search journeys
 */
export const trackSearchAbandoned = (params: {
  queriesAttempted: number;
  finalQuery: string;
  timeOnPageMs: number;
  maxResultsSeen: number;
}) => {
  trackEvent('search_journey_abandoned', {
    queries_attempted: params.queriesAttempted,
    final_query: params.finalQuery,
    time_on_page_ms: params.timeOnPageMs,
    max_results_seen: params.maxResultsSeen,
  });
};

/**
 * Track filter application
 */
export const trackFilterApplied = (params: {
  filterType: 'system' | 'source' | 'lineage' | 'organ';
  filterValue: string;
  filterAction: 'add' | 'remove';
  resultsBefore: number;
  resultsAfter: number;
  appliedInSequence: string[];
  timeSinceSearchMs: number;
}) => {
  trackEvent('search_filter_applied', {
    filter_type: params.filterType,
    filter_value: params.filterValue,
    filter_action: params.filterAction,
    results_before: params.resultsBefore,
    results_after: params.resultsAfter,
    applied_in_sequence: params.appliedInSequence,
    time_since_search_ms: params.timeSinceSearchMs,
  });
};

/**
 * Track time from search completion to first result click
 */
export const trackSearchToResultTime = (params: {
  query: string;
  timeToFirstClickMs: number;
  resultPositionClicked: number;
  scrollDepth: number;
}) => {
  trackEvent('search_to_result_time', {
    query: params.query,
    time_to_first_click_ms: params.timeToFirstClickMs,
    result_position_clicked: params.resultPositionClicked,
    scroll_depth: params.scrollDepth,
  });
};

// ============================================================================
// CLICK & ENGAGEMENT TRACKING
// ============================================================================

/**
 * Track result clicks
 */
export const trackResultClick = (params: {
  resultId: string;
  resultPosition: number;
  diagnosis: string;
  organ?: string;
  system?: string;
  source?: string;
  similarityScore?: number;
  query: string;
  isFirstClickInSession: boolean;
  timeSinceSearchMs: number;
  totalResultsAvailable: number;
  filtersActive: string[];
}) => {
  trackEvent('result_click', {
    result_id: params.resultId,
    result_position: params.resultPosition,
    diagnosis: params.diagnosis,
    organ: params.organ,
    system: params.system,
    source: params.source,
    similarity_score: params.similarityScore,
    query: params.query,
    is_first_click_in_session: params.isFirstClickInSession,
    time_since_search_ms: params.timeSinceSearchMs,
    total_results_available: params.totalResultsAvailable,
    filters_active: params.filtersActive,
  });
};

/**
 * Track click patterns within a search session
 */
export const trackClickPattern = (params: {
  searchSessionId: string;
  totalClicks: number;
  clickPositions: number[];
  timeBetweenClicksMs: number[];
  uniqueOrgansClicked: number;
  uniqueSystemsClicked: number;
  clickDepthMax: number;
}) => {
  trackEvent('click_pattern', {
    search_session_id: params.searchSessionId,
    total_clicks: params.totalClicks,
    click_positions: params.clickPositions,
    time_between_clicks_ms: params.timeBetweenClicksMs,
    unique_organs_clicked: params.uniqueOrgansClicked,
    unique_systems_clicked: params.uniqueSystemsClicked,
    click_depth_max: params.clickDepthMax,
  });
};

/**
 * Track scroll behavior
 */
export const trackScrollBehavior = (params: {
  maxResultPositionViewed: number;
  scrollSpeed: 'fast' | 'medium' | 'slow';
  totalScrollTimeMs: number;
  scrollBackCount: number;
}) => {
  trackEvent('scroll_behavior', {
    max_result_position_viewed: params.maxResultPositionViewed,
    scroll_speed: params.scrollSpeed,
    total_scroll_time_ms: params.totalScrollTimeMs,
    scroll_back_count: params.scrollBackCount,
  });
};

/**
 * Track favorite actions
 */
export const trackFavoriteAction = (params: {
  action: 'add' | 'remove';
  caseId: string;
  fromPage: 'search' | 'dashboard';
  queryThatFoundIt?: string;
  resultPosition?: number;
  isFirstFavorite: boolean;
  totalFavoritesNow: number;
}) => {
  trackEvent('favorite_action', {
    action: params.action,
    case_id: params.caseId,
    from_page: params.fromPage,
    query_that_found_it: params.queryThatFoundIt,
    result_position: params.resultPosition,
    is_first_favorite: params.isFirstFavorite,
    total_favorites_now: params.totalFavoritesNow,
  });
};

/**
 * Track diagnosis reveal
 */
export const trackDiagnosisReveal = (params: {
  resultId: string;
  resultPosition: number;
  timeSinceSearchMs: number;
  revealedBeforeOrAfterClick: 'before' | 'after';
}) => {
  trackEvent('diagnosis_reveal', {
    result_id: params.resultId,
    result_position: params.resultPosition,
    time_since_search_ms: params.timeSinceSearchMs,
    revealed_before_or_after_click: params.revealedBeforeOrAfterClick,
  });
};

/**
 * Track view toggle changes
 */
export const trackViewToggle = (params: {
  toggleType: 'show_clinical' | 'hide_diagnosis';
  newState: boolean;
  triggeredByQuery: string;
  resultCountWhenToggled: number;
  sessionToggleCount: number;
}) => {
  trackEvent('view_toggle', {
    toggle_type: params.toggleType,
    new_state: params.newState,
    triggered_by_query: params.triggeredByQuery,
    result_count_when_toggled: params.resultCountWhenToggled,
    session_toggle_count: params.sessionToggleCount,
  });
};

// ============================================================================
// SESSION & TIME TRACKING
// ============================================================================

/**
 * Detect traffic source from referrer
 */
const detectTrafficSource = (referrer: string): 'organic' | 'direct' | 'social' | 'referral' | 'email' | 'paid' => {
  if (!referrer) return 'direct';

  const domain = referrer.toLowerCase();

  // Organic search
  if (domain.includes('google') || domain.includes('bing') || domain.includes('yahoo') || domain.includes('duckduckgo')) {
    return 'organic';
  }

  // Social media
  if (domain.includes('facebook') || domain.includes('twitter') || domain.includes('linkedin') || domain.includes('reddit') || domain.includes('instagram')) {
    return 'social';
  }

  // Email
  if (domain.includes('mail') || domain.includes('outlook') || domain.includes('gmail')) {
    return 'email';
  }

  // Check for UTM parameters indicating paid traffic
  if (referrer.includes('utm_medium=cpc') || referrer.includes('utm_medium=ppc')) {
    return 'paid';
  }

  return 'referral';
};

/**
 * Detect browser from user agent
 */
const detectBrowser = (): string => {
  if (typeof window === 'undefined' || !window.navigator) return 'unknown';

  const userAgent = window.navigator.userAgent.toLowerCase();

  if (userAgent.includes('edg/')) return 'Edge';
  if (userAgent.includes('chrome') && !userAgent.includes('edg')) return 'Chrome';
  if (userAgent.includes('safari') && !userAgent.includes('chrome')) return 'Safari';
  if (userAgent.includes('firefox')) return 'Firefox';
  if (userAgent.includes('opera') || userAgent.includes('opr/')) return 'Opera';
  if (userAgent.includes('msie') || userAgent.includes('trident/')) return 'Internet Explorer';

  return 'Other';
};

/**
 * Detect device type (mobile/tablet/desktop)
 */
const detectDeviceType = (): 'mobile' | 'tablet' | 'desktop' => {
  if (typeof window === 'undefined' || !window.navigator) return 'desktop';

  const userAgent = window.navigator.userAgent.toLowerCase();

  // Check for tablet
  if (userAgent.includes('ipad') ||
      (userAgent.includes('android') && !userAgent.includes('mobile')) ||
      userAgent.includes('tablet')) {
    return 'tablet';
  }

  // Check for mobile
  if (userAgent.includes('mobile') ||
      userAgent.includes('iphone') ||
      userAgent.includes('ipod') ||
      userAgent.includes('android')) {
    return 'mobile';
  }

  return 'desktop';
};

/**
 * Get country/region from browser locale and timezone
 */
const getCountryInfo = (): { country?: string; timezone?: string; language?: string } => {
  if (typeof window === 'undefined' || !window.navigator) {
    return {};
  }

  try {
    // Get language (e.g., "en-US" -> "US")
    const locale = window.navigator.language || '';
    const countryFromLocale = locale.split('-')[1] || undefined;

    // Get timezone (e.g., "America/New_York")
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;

    // Get language code (e.g., "en")
    const language = locale.split('-')[0] || undefined;

    return {
      country: countryFromLocale,
      timezone,
      language,
    };
  } catch (error) {
    return {};
  }
};

/**
 * Track session start with referrer and traffic source data
 */
export const trackSessionStart = (params: {
  isAuthenticated: boolean;
  theme: 'light' | 'dark' | 'sepia';
  landingPage: string;
}) => {
  // Get referrer information
  const referrer = typeof document !== 'undefined' ? document.referrer : '';
  const referrerDomain = referrer ? new URL(referrer).hostname : '';

  // Parse UTM parameters
  const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const utmSource = urlParams.get('utm_source') || undefined;
  const utmMedium = urlParams.get('utm_medium') || undefined;
  const utmCampaign = urlParams.get('utm_campaign') || undefined;
  const utmContent = urlParams.get('utm_content') || undefined;

  // Detect if first visit (using localStorage)
  let isFirstVisit = false;
  let isReturningUser = false;
  let daysSinceLastVisit: number | undefined;

  if (typeof window !== 'undefined' && window.localStorage) {
    const lastVisit = localStorage.getItem('last_visit');
    isFirstVisit = !lastVisit;
    isReturningUser = !!lastVisit;

    if (lastVisit) {
      const daysSince = Math.floor((Date.now() - parseInt(lastVisit)) / (1000 * 60 * 60 * 24));
      daysSinceLastVisit = daysSince;
    }

    // Update last visit timestamp
    localStorage.setItem('last_visit', Date.now().toString());
  }

  // Get device and location information
  const browser = detectBrowser();
  const deviceType = detectDeviceType();
  const countryInfo = getCountryInfo();

  trackEvent('session_start', {
    is_authenticated: params.isAuthenticated,
    theme: params.theme,
    referrer: referrer,
    referrer_domain: referrerDomain,
    traffic_source: detectTrafficSource(referrer),
    utm_source: utmSource,
    utm_medium: utmMedium,
    utm_campaign: utmCampaign,
    utm_content: utmContent,
    landing_page: params.landingPage,
    is_first_visit: isFirstVisit,
    is_returning_user: isReturningUser,
    days_since_last_visit: daysSinceLastVisit,
    // Device & Browser Information
    browser: browser,
    device_type: deviceType,
    // Geographic Information
    country: countryInfo.country,
    timezone: countryInfo.timezone,
    language: countryInfo.language,
  });
};

/**
 * Track idle detection
 */
export const trackUserIdle = (params: {
  idleDurationMs: number;
  lastAction: string;
  searchResultsVisible: boolean;
  sessionSearchesSoFar: number;
}) => {
  trackEvent('user_idle_detected', {
    idle_duration_ms: params.idleDurationMs,
    last_action: params.lastAction,
    search_results_visible: params.searchResultsVisible,
    session_searches_so_far: params.sessionSearchesSoFar,
  });
};

/**
 * Track return from idle
 */
export const trackReturnFromIdle = (params: {
  idleDurationMs: number;
  firstActionOnReturn: 'new_search' | 'continued_search' | 'clicked_result' | 'left';
  searchQueryAfterIdle?: string;
  timeBetweenIdleAndSearchMs?: number;
}) => {
  trackEvent('user_returns_from_idle', {
    idle_duration_ms: params.idleDurationMs,
    first_action_on_return: params.firstActionOnReturn,
    search_query_after_idle: params.searchQueryAfterIdle,
    time_between_idle_and_search_ms: params.timeBetweenIdleAndSearchMs,
  });
};

/**
 * Track session time milestones
 */
export const trackSessionMilestone = (params: {
  milestone: '1min' | '5min' | '10min' | '30min';
  searchesSoFar: number;
  clicksSoFar: number;
  favoritesAdded: number;
  pagesVisited: string[];
  activeTimeMs: number;
}) => {
  trackEvent('session_time_milestone', {
    milestone: params.milestone,
    searches_so_far: params.searchesSoFar,
    clicks_so_far: params.clicksSoFar,
    favorites_added: params.favoritesAdded,
    pages_visited: params.pagesVisited,
    active_time_ms: params.activeTimeMs,
  });
};

/**
 * Track searches per visit (on session end)
 */
export const trackSearchesPerVisit = (params: {
  totalSearches: number;
  uniqueSearches: number;
  averageTimeBetweenSearchesMs: number;
  sessionDurationMs: number;
  activeDurationMs: number;
  idleTimeMs: number;
  idlePeriodsCount: number;
  returnedFromIdleCount: number;
}) => {
  trackEvent('searches_per_visit', {
    total_searches: params.totalSearches,
    unique_searches: params.uniqueSearches,
    average_time_between_searches_ms: params.averageTimeBetweenSearchesMs,
    session_duration_ms: params.sessionDurationMs,
    active_duration_ms: params.activeDurationMs,
    idle_time_ms: params.idleTimeMs,
    idle_periods_count: params.idlePeriodsCount,
    returned_from_idle_count: params.returnedFromIdleCount,
  });
};

/**
 * Track total time on site (on session end)
 */
export const trackTotalTimeOnSite = (params: {
  sessionDurationMs: number;
  activeDurationMs: number;
  idleDurationMs: number;
  tabHiddenDurationMs: number;
  engagementRate: number;
  pagesVisited: number;
  pageDurations: Record<string, number>;
}) => {
  trackEvent('total_time_on_site', {
    session_duration_ms: params.sessionDurationMs,
    active_duration_ms: params.activeDurationMs,
    idle_duration_ms: params.idleDurationMs,
    tab_hidden_duration_ms: params.tabHiddenDurationMs,
    engagement_rate: params.engagementRate,
    pages_visited: params.pagesVisited,
    page_durations: params.pageDurations,
  });
};

/**
 * Track external link clicks
 */
export const trackExternalLinkClick = (params: {
  destinationDomain: string;
  searchQuery: string;
  resultPosition: number;
  timeOnSiteBeforeExitMs: number;
}) => {
  trackEvent('external_link_click', {
    destination_domain: params.destinationDomain,
    search_query: params.searchQuery,
    result_position: params.resultPosition,
    time_on_site_before_exit_ms: params.timeOnSiteBeforeExitMs,
  });
};

// ============================================================================
// PERFORMANCE TRACKING
// ============================================================================

/**
 * Track database load completion
 */
export const trackDatabaseLoad = (params: {
  loadTimeMs: number;
  dbSizeEntries: number;
}) => {
  trackEvent('database_load_complete', {
    load_time_ms: params.loadTimeMs,
    db_size_entries: params.dbSizeEntries,
  });
};

/**
 * Track time to first search (from page load to first search, inclusive of DB load)
 */
export const trackTimeToFirstSearch = (params: {
  timeFromPageLoadMs: number;
  timeFromDbReadyMs: number;
  firstQuery: string;
  queryLength: number;
  wasDbReadyBeforeSearch: boolean;
}) => {
  trackEvent('time_to_first_search', {
    time_from_page_load_ms: params.timeFromPageLoadMs,
    time_from_db_ready_ms: params.timeFromDbReadyMs,
    first_query: params.firstQuery,
    query_length: params.queryLength,
    was_db_ready_before_search: params.wasDbReadyBeforeSearch,
  });
};

/**
 * Track vector search performance
 */
export const trackVectorSearchPerformance = (params: {
  embeddingTimeMs: number;
  searchTimeMs: number;
  totalLatencyMs: number;
  dbSizeEntries: number;
  browser: string;
  deviceMemoryGb?: number;
}) => {
  trackEvent('vector_search_performance', {
    embedding_time_ms: params.embeddingTimeMs,
    search_time_ms: params.searchTimeMs,
    total_latency_ms: params.totalLatencyMs,
    db_size_entries: params.dbSizeEntries,
    browser: params.browser,
    device_memory_gb: params.deviceMemoryGb,
  });
};

// ============================================================================
// USER & CONVERSION TRACKING
// ============================================================================

/**
 * Track user registration
 */
export const trackUserRegistration = (method: 'google' | 'credentials') => {
  trackEvent('user_registration', {
    method,
  });
};

/**
 * Track first search after registration
 */
export const trackFirstSearch = (timeSinceRegistrationMins: number) => {
  trackEvent('first_search', {
    time_since_registration_mins: timeSinceRegistrationMins,
  });
};

/**
 * Track user return
 */
export const trackUserReturn = (daysSinceLastVisit: number) => {
  trackEvent('user_return', {
    days_since_last_visit: daysSinceLastVisit,
  });
};

// ============================================================================
// SESSION CLASSIFICATION
// ============================================================================

/**
 * Classify and track session type on session end
 */
export const trackSessionClassification = (params: {
  sessionType: 'engaged' | 'explorer' | 'bounced' | 'power_user';
  totalSearches: number;
  totalClicks: number;
  favoritesAdded: number;
  timeOnSiteMs: number;
  pagesVisited: number;
  featureUsage: string[];
}) => {
  trackEvent('session_classification', {
    session_type: params.sessionType,
    total_searches: params.totalSearches,
    total_clicks: params.totalClicks,
    favorites_added: params.favoritesAdded,
    time_on_site_ms: params.timeOnSiteMs,
    pages_visited: params.pagesVisited,
    feature_usage: params.featureUsage,
  });
};

/**
 * Track feature discovery (first time user uses a feature)
 */
export const trackFeatureDiscovery = (params: {
  feature: 'filters' | 'favorites' | 'clinical_view' | 'hide_diagnosis' | 'dashboard' | 'random_slide';
  timeSinceRegistrationMs: number;
  searchesBeforeDiscovery: number;
}) => {
  trackEvent('feature_discovery', {
    feature: params.feature,
    time_since_registration_ms: params.timeSinceRegistrationMs,
    searches_before_discovery: params.searchesBeforeDiscovery,
  });
};

// ============================================================================
// PHASE 2: BEHAVIORAL TRACKING
// ============================================================================

/**
 * Track result hover behavior (user hovers over result for 2+ seconds)
 */
export const trackResultHover = (params: {
  resultId: string;
  resultPosition: number;
  hoverDurationMs: number;
  clickedAfterHover: boolean;
  diagnosis: string;
  similarityScore?: number;
}) => {
  trackEvent('result_hover', {
    result_id: params.resultId,
    result_position: params.resultPosition,
    hover_duration_ms: params.hoverDurationMs,
    clicked_after_hover: params.clickedAfterHover,
    diagnosis: params.diagnosis,
    similarity_score: params.similarityScore,
  });
};

/**
 * Track bounce back behavior (user clicks result, returns quickly)
 */
export const trackResultBounceBack = (params: {
  resultId: string;
  timeOnExternalPageMs: number;
  nextAction: 'clicked_different_result' | 'refined_search' | 'left';
  resultPosition: number;
  diagnosis: string;
}) => {
  trackEvent('result_bounce_back', {
    result_id: params.resultId,
    time_on_external_page_ms: params.timeOnExternalPageMs,
    next_action: params.nextAction,
    result_position: params.resultPosition,
    diagnosis: params.diagnosis,
  });
};

/**
 * Track theme changes
 */
export const trackThemeChange = (params: {
  fromTheme: 'light' | 'dark' | 'sepia';
  toTheme: 'light' | 'dark' | 'sepia';
  timeOnSiteBeforeChangeMs: number;
  timeOfDay: number; // Hour 0-23
}) => {
  trackEvent('theme_change', {
    from_theme: params.fromTheme,
    to_theme: params.toTheme,
    time_on_site_before_change_ms: params.timeOnSiteBeforeChangeMs,
    time_of_day: params.timeOfDay,
  });
};

/**
 * Track rapid search pattern (5+ searches within 2 minutes)
 */
export const trackRapidSearchPattern = (params: {
  searchCount: number;
  timeWindowMs: number;
  querySimilarity: number; // 0-1, how similar are searches
  resultQualityTrend: 'improving' | 'declining' | 'stable';
  clickingBehavior: 'exploring' | 'frustrated' | 'comparing';
  finalQuery: string;
}) => {
  trackEvent('rapid_search_pattern', {
    search_count: params.searchCount,
    time_window_ms: params.timeWindowMs,
    query_similarity: params.querySimilarity,
    result_quality_trend: params.resultQualityTrend,
    clicking_behavior: params.clickingBehavior,
    final_query: params.finalQuery,
  });
};

/**
 * Track comparison behavior (multiple results clicked quickly)
 */
export const trackComparisonBehavior = (params: {
  resultIds: string[];
  query: string;
  timeSpanMs: number;
  returnedToSameResult: boolean;
  diagnosesCompared: string[];
}) => {
  trackEvent('comparison_behavior', {
    result_ids: params.resultIds,
    query: params.query,
    time_span_ms: params.timeSpanMs,
    returned_to_same_result: params.returnedToSameResult,
    diagnoses_compared: params.diagnosesCompared,
  });
};

// ============================================================================
// DASHBOARD ANALYTICS
// ============================================================================

/**
 * Track dashboard filter usage
 */
export const trackDashboardFilterUsage = (params: {
  tab: 'history' | 'favorites';
  filterCombinations: string[];
  itemsBeforeFilter: number;
  itemsAfterFilter: number;
  filterCleared: boolean;
}) => {
  trackEvent('dashboard_filter_usage', {
    tab: params.tab,
    filter_combinations: params.filterCombinations,
    items_before_filter: params.itemsBeforeFilter,
    items_after_filter: params.itemsAfterFilter,
    filter_cleared: params.filterCleared,
  });
};

/**
 * Track random slide feature usage
 */
export const trackRandomSlideShown = (params: {
  fromTab: 'history' | 'favorites';
  totalItemsAvailable: number;
  diagnosisRevealedImmediately: boolean;
  timeToRevealMs?: number;
  actionTaken: 'viewed_slide' | 'closed' | 'none';
  diagnosis: string;
}) => {
  trackEvent('random_slide_shown', {
    from_tab: params.fromTab,
    total_items_available: params.totalItemsAvailable,
    diagnosis_revealed_immediately: params.diagnosisRevealedImmediately,
    time_to_reveal_ms: params.timeToRevealMs,
    action_taken: params.actionTaken,
    diagnosis: params.diagnosis,
  });
};

/**
 * Track dashboard search usage
 */
export const trackDashboardSearch = (params: {
  tab: 'history' | 'favorites';
  query: string;
  resultsCount: number;
  totalItemsInTab: number;
}) => {
  trackEvent('dashboard_search_used', {
    tab: params.tab,
    query: params.query,
    results_count: params.resultsCount,
    total_items_in_tab: params.totalItemsInTab,
  });
};
