'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import './v2.css';
import { useTheme } from '@/components/ThemeProvider';
import { useSession, signOut } from 'next-auth/react';
import { SignupVariant, type ModalVariant } from './SignupModals';
import { FeedbackModal } from './FeedbackModal';
import { getVisitorId } from '@/lib/analytics';
import { useV2Search, type Card } from './useV2Search';

// Ghost-text phrases — same rotating examples as the original homepage.
const EXAMPLE_QUERIES = [
  'ovary malignant', 'ovary serous carcinoma', 'lymph node benign', 'kikuchi',
  'serous borderline with carcinoma', 'melanoma lymph node', 'breast benign neoplasm', 'thyroid anaplastic',
];
const LOGIN_PROMPT = 'Login to save slides to your Favorites and view your slide history';

// Organ systems (all 16), ordered by frequency in the dataset — these replace the old suggestion chips.
const SYSTEMS = [
  'Skin', 'Genitourinary & Reproductive', 'Haematolymphoid', 'Gastrointestinal', 'Head & Neck',
  'Breast', 'Musculoskeletal & Soft Tissue', 'Hepatopancreatobiliary & Peritoneal', 'Central Nervous System',
  'Thoracic', 'Endocrine', 'Paediatric Pathology', 'Cardiovascular & Vascular', 'Systemic Disease',
  'Autopsy & Multiorgan Pathology', 'Syndromic & Genetic Disorders',
];

// The five collections the cases come from, ordered by share of usage in the click logs.
const SOURCES = ['Path Presenter', 'Leeds', 'Recut Club', 'RCPA', 'Toronto'];

// scroll-dock geometry (px)
const REST_FONT = 21;         // docked title font-size, matches CSS
const DOCK = 92;              // scroll distance to fully dock — short, so it snaps rather than drifts
const BAR_H = 60;             // sticky bar height
const GAP = 16;               // gap between docked title and search bar
const HERO_TITLE_TOP = 66;    // viewport-y of the big title box (clears the top action row)
const HERO_SEARCH_TOP = 150;  // viewport-y of the hero search box
const HERO_SEARCH_H = 58;
const DOCK_SEARCH_H = 40;
const ACT_RESERVE = 190;      // room kept on the right for the header actions (desktop)
const TOG_W = 108;            // the Clinical / Diagnoses toggle stack, inline right of the bar
const TOG_W_M = 84;
const TOG_GAP = 10;

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const p: Record<string, React.ReactNode> = {
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" /></>,
    x: <path d="M18 6 6 18M6 6l12 12" />,
    chev: <path d="m9 6 6 6-6 6" />,
    tick: <path d="M5 12l5 5 9-11" />,
    filter: <path d="M3 5h18l-7 8.2V19l-4 2v-7.8L3 5Z" />,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.4 1.4M17.6 17.6 19 19M19 5l-1.4 1.4M6.4 17.6 5 19" /></>,
    moon: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />,
    heart: <path d="M12 20.3 4.6 12.9a4.6 4.6 0 0 1 6.5-6.5l.9.9.9-.9a4.6 4.6 0 0 1 6.5 6.5Z" />,
    user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      {p[name]}
    </svg>
  );
}

// Map a compact v2 card to the metadata blob the main site stores for history/favorites.
function metaForCard(c: Card) {
  return {
    diagnosis: c.xd || c.dx, organ: c.o, system: c.s, source: c.src, url: c.u,
    site: c.st, variant: c.v, lineage: c.l, stain: c.stn, microscopic: c.mic,
    clinical_history_ai: c.ch, sex_ai: c.sx, age_ai: c.ag,
  };
}

export default function SearchApp() {
  const { meta, results, search, setFilters } = useV2Search();
  const { theme, setTheme } = useTheme();
  const { data: session, status } = useSession();

  const [query, setQuery] = useState('');
  // multi-select: any number of systems can be lit at once; empty set = no filter
  const [sysSelected, setSysSelected] = useState<Set<string>>(new Set());
  // every source is included by default; clicking one EXCLUDES it (grey + "excluded" subtext)
  const [srcExcluded, setSrcExcluded] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<Map<string, number>>(new Map());
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [placeholder, setPlaceholder] = useState('');
  const [focused, setFocused] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [srcOpen, setSrcOpen] = useState(false);
  const [showClinical, setShowClinical] = useState(false);
  const [hideDiagnosis, setHideDiagnosis] = useState(false);
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  // signup prompt for anonymous users: 5th slide click arms it, shown 4s later, then every +10.
  // Variant is assigned per visitor (stable A/B/C split); ?modal=a|b|c previews one instantly.
  const [showSignupModal, setShowSignupModal] = useState(false);
  const [modalVariant, setModalVariant] = useState<ModalVariant>('a');
  const [modalPreview, setModalPreview] = useState(false);
  const [sessionTitles, setSessionTitles] = useState<string[]>([]);
  const slideClickCount = useRef(0);
  const nextModalThreshold = useRef(5);
  // returning-user pulse survey: needs pre-session history, 2 clicks this session, shown once ever
  const [showFeedback, setShowFeedback] = useState(false);
  const priorHistoryRef = useRef(false);
  const sessionClicksRef = useRef(0);
  const signupOpenRef = useRef(false);
  // stats bar (logged-in): slides 24h / lifetime / favorites, same API as the home page
  const [userStats, setUserStats] = useState<{
    slides: { lifetime: number; today: number };
    favorites: number;
    rank: { lifetime: number };
  } | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const searchBoxRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  const srcRef = useRef<HTMLDivElement>(null);
  const togglesRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const restRectRef = useRef<DOMRect | null>(null);
  const rafRef = useRef(0);
  const dockedRef = useRef(false);

  const loggedIn = !!session?.user;

  /* ---------- scroll-dock: title + filter + search bar all glide up into the bar ---------- */
  const applyScroll = useCallback(() => {
    const root = rootRef.current, title = titleRef.current, box = searchBoxRef.current, rr = restRectRef.current;
    if (!root || !title || !box || !rr) return;
    const vw = window.innerWidth;
    // Ease the raw scroll fraction so most of the movement happens in the first few pixels and
    // then settles — a linear map over a long distance is what made this feel sluggish.
    const raw = Math.min(1, Math.max(0, window.scrollY / DOCK));
    const p = 1 - Math.pow(1 - raw, 3);          // easeOutCubic
    root.style.setProperty('--p', String(p));
    const docked = p > 0.5;
    if (docked !== dockedRef.current) { dockedRef.current = docked; root.classList.toggle('docked', docked); }
    root.classList.toggle('pinned', p >= 1);

    const mobile = vw < 820;
    const baseW = rr.width;                                  // title width at REST_FONT
    const heroFont = Math.min(54, vw * 0.115);
    const curFont = REST_FONT + (heroFont - REST_FONT) * (1 - p);

    // ---- search box top/height (same in every layout) ----
    const searchTop = HERO_SEARCH_TOP + ((BAR_H - DOCK_SEARCH_H) / 2 - HERO_SEARCH_TOP) * p;
    const searchH = HERO_SEARCH_H + (DOCK_SEARCH_H - HERO_SEARCH_H) * p;

    // Space for the toggle stack is reserved ALWAYS, not only while results are showing —
    // otherwise the search bar would resize the moment you typed.
    const togW = mobile ? TOG_W_M : TOG_W;
    const togSpace = togW + TOG_GAP;

    // ---- hero layout: the search box (filter now lives INSIDE it) centred under the title ----
    const heroSearchW = Math.min(640, vw - 48 - togSpace);
    const searchHeroLeft = (vw - heroSearchW) / 2;
    const titleHeroLeft = (vw - baseW * (heroFont / REST_FONT)) / 2;

    // ---- docked layout: [title][search][toggles] ----
    let searchDockLeft: number, titleDockLeft: number, dockSearchW: number;
    const titleDockTop = (BAR_H - curFont * 1.15) / 2;
    if (mobile) {
      // title hidden on mobile
      searchDockLeft = 12;
      dockSearchW = Math.max(160, vw - 12 - 96 - togSpace);
      titleDockLeft = 12;
    } else {
      const avail = vw - 20 - ACT_RESERVE;                  // usable band between left margin and the actions
      // the bar is wider docked than before because the System control consumes ~110px of it
      dockSearchW = Math.min(480, Math.max(260, avail - baseW - GAP - togSpace));
      const groupW = baseW + GAP + dockSearchW + togSpace;
      const groupLeft = Math.max(20, 20 + (avail - groupW) / 2);
      titleDockLeft = groupLeft;
      searchDockLeft = groupLeft + baseW + GAP;
    }

    // ---- interpolate ----
    const lerp = (a: number, b: number) => a + (b - a) * p;
    const searchLeft = lerp(searchHeroLeft, searchDockLeft);
    const searchW = lerp(heroSearchW, dockSearchW);

    title.style.fontSize = `${curFont.toFixed(2)}px`;
    title.style.left = `${lerp(titleHeroLeft, titleDockLeft).toFixed(1)}px`;
    title.style.top = `${lerp(HERO_TITLE_TOP, titleDockTop).toFixed(1)}px`;

    box.style.width = `${searchW.toFixed(1)}px`;
    box.style.left = `${searchLeft.toFixed(1)}px`;
    box.style.top = `${searchTop.toFixed(1)}px`;
    box.style.height = `${searchH.toFixed(1)}px`;
    // the filters live inside the box and need no positioning of their own

    // toggle stack: inline to the right of the bar, exactly the bar's height
    const tog = togglesRef.current;
    if (tog) {
      tog.style.left = `${(searchLeft + searchW + TOG_GAP).toFixed(1)}px`;
      tog.style.top = `${searchTop.toFixed(1)}px`;
      tog.style.width = `${togW}px`;
      tog.style.height = `${searchH.toFixed(1)}px`;
    }
  }, []);

  const measure = useCallback(() => {
    const title = titleRef.current;
    if (!title) return;
    const pf = title.style.fontSize, pl = title.style.left, pt = title.style.top;
    title.style.fontSize = `${REST_FONT}px`; title.style.left = '0px'; title.style.top = '0px';
    restRectRef.current = title.getBoundingClientRect();
    title.style.fontSize = pf; title.style.left = pl; title.style.top = pt;
    applyScroll();
    rootRef.current?.classList.add('ready');
  }, [applyScroll]);

  useLayoutEffect(() => {
    measure();
    const onScroll = () => { if (rafRef.current) return; rafRef.current = requestAnimationFrame(() => { rafRef.current = 0; applyScroll(); }); };
    const onResize = () => measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    (document as Document & { fonts?: FontFaceSet }).fonts?.ready.then(measure).catch(() => {});
    return () => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onResize); };
  }, [measure, applyScroll]);

  /* ---------- load viewed history + favorites (shared with the main site) ---------- */
  useEffect(() => {
    if (loggedIn) {
      fetch('/api/history').then((r) => r.json()).then((d) => {
        const m = new Map<string, number>();
        for (const h of d.history || []) {
          const t = new Date(h.viewedAt).getTime();
          if (!m.has(h.caseId) || t > (m.get(h.caseId) as number)) m.set(h.caseId, t);
        }
        if (m.size) priorHistoryRef.current = true;   // they used the site before this session
        setHistory(m);
      }).catch(() => {});
      fetch('/api/favorites').then((r) => r.json()).then((d) => {
        setFavorites(new Set<string>((d.favorites || []).map((f: { caseId: string }) => f.caseId)));
      }).catch(() => {});
    } else {
      const m = new Map<string, number>();
      try {
        const cv = document.cookie.split('; ').find((r) => r.startsWith('slideHistory='))?.split('=')[1];
        if (cv) for (const [k, v] of Object.entries(JSON.parse(decodeURIComponent(cv)))) m.set(k, Number(v));
      } catch { /* ignore */ }
      if (m.size) priorHistoryRef.current = true;   // returning anonymous visitor
      setHistory(m);
      setFavorites(new Set());
    }
  }, [loggedIn]);

  /* ---------- modal preview: ?modal=a|b|c shows a signup variant, ?modal=feedback the survey ---------- */
  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get('modal');
    if (v === 'a' || v === 'b' || v === 'c') {
      setModalVariant(v);
      setModalPreview(true);
      setShowSignupModal(true);
    } else if (v === 'feedback') {
      setShowFeedback(true);
    }
  }, []);

  // the survey defers to the signup prompt, so track whether that is on screen
  useEffect(() => { signupOpenRef.current = showSignupModal; }, [showSignupModal]);

  /* ---------- user stats bar (logged-in only) ---------- */
  useEffect(() => {
    if (!loggedIn) { setUserStats(null); return; }
    fetch('/api/user-stats').then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (d && d.slides) setUserStats(d);
    }).catch(() => {});
  }, [loggedIn]);

  /* ---------- ghost-text typewriter (only when idle + empty) ---------- */
  useEffect(() => {
    if (meta.status !== 'ready' || query.trim() || focused) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const phrases = loggedIn ? EXAMPLE_QUERIES : [LOGIN_PROMPT, ...EXAMPLE_QUERIES];
    let idx = loggedIn ? Math.floor(Math.random() * phrases.length) : 0;
    const type = (text: string, n: number) => {
      if (cancelled) return;
      if (n <= text.length) { setPlaceholder(text.slice(0, n)); timer = setTimeout(() => type(text, n + 1), 55); }
      else timer = setTimeout(() => erase(text, text.length), 1900);
    };
    const erase = (text: string, n: number) => {
      if (cancelled) return;
      if (n >= 0) { setPlaceholder(text.slice(0, n)); timer = setTimeout(() => erase(text, n - 1), 180 / Math.max(text.length, 1)); }
      else { idx = (idx + 1) % phrases.length; type(phrases[idx], 0); }
    };
    type(phrases[idx], 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [meta.status, query, focused, loggedIn]);

  /* ---------- keyboard: "/" focuses, Esc clears/closes ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement !== inputRef.current) { e.preventDefault(); inputRef.current?.focus(); }
      if (e.key === 'Escape') {
        if (filterOpen || srcOpen) { setFilterOpen(false); setSrcOpen(false); }
        else if (query) { setQuery(''); search(''); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [query, search, filterOpen, srcOpen]);

  /* ---------- close the filter panels on outside tap (needed on touch — no hover) ---------- */
  useEffect(() => {
    if (!filterOpen && !srcOpen) return;
    const onDown = (e: MouseEvent) => {
      if (filterOpen && !filterRef.current?.contains(e.target as Node)) setFilterOpen(false);
      if (srcOpen && !srcRef.current?.contains(e.target as Node)) setSrcOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [filterOpen, srcOpen]);

  /* ---------- actions ---------- */
  // Clearing the box while systems are selected drops back to browsing those systems
  // rather than emptying the page.
  const onChange = (v: string) => {
    setQuery(v);
    if (!v.trim() && sysSelected.size) search([...sysSelected].join(' '));
    else search(v);
  };

  // Toggle membership; the menu stays open so several systems can be picked in one visit.
  const onSystem = (sys: string) => {
    setSysSelected((cur) => {
      const next = new Set(cur);
      if (next.has(sys)) next.delete(sys); else next.add(sys);
      return next;
    });
  };

  // Source is a refinement only — `src` is not indexed as searchable text in the worker, so it
  // narrows whatever the query/system already returned rather than browsing on its own.
  // Menu stays open on toggle so several sources can be excluded/restored in one visit.
  const onSource = (src: string) => {
    setSrcExcluded((cur) => {
      const next = new Set(cur);
      if (next.has(src)) next.delete(src); else next.add(src);
      return next;
    });
  };

  // Any facet change is pushed into the worker (it filters BEFORE its top-K cut) and the
  // active query — or the system-browse — is re-run under the new constraints.
  const facetsReady = useRef(false);
  useEffect(() => {
    setFilters({ sys: [...sysSelected], srcEx: [...srcExcluded] });
    if (!facetsReady.current) { facetsReady.current = true; return; }   // skip mount
    const trimmed = query.trim();
    if (trimmed) search(query);
    else search(sysSelected.size ? [...sysSelected].join(' ') : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sysSelected, srcExcluded]);

  // Click log — same endpoint, same TSV row shape as the home page, so search-logs.txt
  // (and everything built on it: /insights, the ranking eval set) keeps collecting from /v2.
  const logClick = useCallback((c: Card, position: number, total: number) => {
    fetch('/api/log-search', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: query.trim() || (sysSelected.size ? [...sysSelected].join(' ') : ''),
        diagnosis: c.xd || c.dx,
        resultPosition: position + 1,          // 1-indexed, like the home page
        organ: c.o, system: c.s, source: c.src,
        similarityScore: c._score,
        totalResultsAvailable: total,
        userEmail: session?.user?.email, userName: session?.user?.name,
        visitorId: getVisitorId(),
        page: 'v2',              // cohort marker: lets /insights split home vs v2
      }),
    }).catch(() => {});
  }, [query, sysSelected, session]);

  const recordView = useCallback((c: Card) => {
    // returning-user survey: 2nd click of the session, if they knew the site before the
    // redesign, never answered/dismissed it, and the signup prompt isn't on screen
    sessionClicksRef.current++;
    if (sessionClicksRef.current >= 2 && priorHistoryRef.current) {
      let done = '1';
      try { done = localStorage.getItem('psv2_feedback_done') || ''; } catch { /* ignore */ }
      if (!done) {
        try { localStorage.setItem('psv2_feedback_done', '1'); } catch { /* ignore */ }
        setTimeout(() => { if (!signupOpenRef.current) setShowFeedback(true); }, 2500);
      }
    }
    // signup prompt cadence for anonymous users (mirrors the home page: 5th click, then +10)
    if (!loggedIn) {
      setSessionTitles((prev) => [...prev.slice(-9), c.xd || c.dx]);   // fuel for variant A
      slideClickCount.current++;
      if (slideClickCount.current >= nextModalThreshold.current) {
        nextModalThreshold.current = slideClickCount.current + 10;
        // variants rotate a -> b -> c per showing (persisted, so the loop continues across visits)
        let seq = 0;
        try { seq = parseInt(localStorage.getItem('psv2_modal_seq') || '0', 10) || 0; } catch { /* ignore */ }
        setModalVariant((['a', 'b', 'c'] as ModalVariant[])[seq % 3]);
        try { localStorage.setItem('psv2_modal_seq', String(seq + 1)); } catch { /* ignore */ }
        setTimeout(() => setShowSignupModal(true), 4000);
      }
    }
    const ci = c.ci;
    if (!ci) return;
    setHistory((prev) => { const m = new Map(prev); m.set(ci, Date.now()); return m; });
    if (loggedIn) {
      fetch('/api/history', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseId: ci, metadata: JSON.stringify(metaForCard(c)) }),
      }).catch(() => {});
    } else {
      try {
        const cv = document.cookie.split('; ').find((r) => r.startsWith('slideHistory='))?.split('=')[1];
        const existing: Record<string, number> = cv ? JSON.parse(decodeURIComponent(cv)) : {};
        existing[ci] = Date.now();
        let out: Record<string, number> = existing;
        const entries = Object.entries(existing);
        if (entries.length > 100) { entries.sort((a, b) => b[1] - a[1]); out = Object.fromEntries(entries.slice(0, 100)); }
        document.cookie = `slideHistory=${encodeURIComponent(JSON.stringify(out))};path=/;max-age=31536000`;
      } catch { /* ignore */ }
    }
  }, [loggedIn]);

  const toggleFavorite = useCallback((c: Card, e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (!loggedIn) { window.location.href = '/login'; return; }
    const ci = c.ci;
    if (!ci) return;
    if (favorites.has(ci)) {
      setFavorites((prev) => { const s = new Set(prev); s.delete(ci); return s; });
      fetch(`/api/favorites?caseId=${encodeURIComponent(ci)}`, { method: 'DELETE' }).catch(() => {});
    } else {
      setFavorites((prev) => new Set(prev).add(ci));
      fetch('/api/favorites', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseId: ci, metadata: JSON.stringify(metaForCard(c)) }),
      }).catch(() => {});
    }
  }, [loggedIn, favorites]);

  const toggleTheme = (e: React.MouseEvent) => {
    const isDark = document.documentElement.classList.contains('dark');
    const run = () => setTheme(isDark ? 'light' : 'dark');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const startVT = (document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } }).startViewTransition;
    if (reduce || !startVT) { run(); return; }
    const x = e.clientX, y = e.clientY;
    const end = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    startVT.call(document, run).ready.then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${end}px at ${x}px ${y}px)`] },
        { duration: 480, easing: 'cubic-bezier(.4,0,.2,1)', pseudoElement: '::view-transition-new(root)' },
      );
    }).catch(() => {});
  };

  /* ---------- derived ---------- */
  const hasQuery = query.trim().length > 0;
  const active = hasQuery || sysSelected.size > 0;
  const loading = meta.status !== 'ready';
  const isDark = theme === 'dark';
  const filtered = results.filter((r) =>
    (!sysSelected.size || (r.s && sysSelected.has(r.s))) && (!r.src || !srcExcluded.has(r.src)));
  // Facet counts are cross-filtered: each list counts against the OTHER facet's selection, so
  // the numbers show what you would actually get by picking that option.
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of results) {
      if (r.src && srcExcluded.has(r.src)) continue;
      if (r.s) m.set(r.s, (m.get(r.s) || 0) + 1);
    }
    return m;
  }, [results, srcExcluded]);
  const srcCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of results) {
      if (sysSelected.size && (!r.s || !sysSelected.has(r.s))) continue;
      if (r.src) m.set(r.src, (m.get(r.src) || 0) + 1);
    }
    return m;
  }, [results, sysSelected]);
  const phText = loading ? 'Loading cases…' : (focused ? '' : placeholder);
  const showToggles = active && !loading && filtered.length > 0;

  return (
    <div className="psv2" ref={rootRef}>
      {/* sticky bar — the title and search bar both dock here, ending side-by-side */}
      <header className="psv2-bar">
        <h1 className="psv2-title" ref={titleRef}>Pathology Search</h1>

        <div className="psv2-searchbox" ref={searchBoxRef}>
          {/* system filter — integrated as the search bar's leading control. The tiny 2-column
              glyph next to "System" IS the menu: on hover/tap it morphs down out of the bar
              into the full panel. */}
          <div className="psv2-filter" data-active={sysSelected.size ? '1' : '0'} data-open={filterOpen ? '1' : '0'} ref={filterRef}>
            <button className="psv2-filter-cap" onClick={() => setFilterOpen((o) => !o)} aria-expanded={filterOpen} aria-label="Filter by organ system">System</button>
            <div className="psv2-filter-grid" role="listbox" aria-label="Organ system">
              {SYSTEMS.map((s) => {
                const c = counts.get(s);
                return (
                  <button key={s} className={`cell${sysSelected.has(s) ? ' on' : ''}`} aria-pressed={sysSelected.has(s)} tabIndex={filterOpen ? 0 : -1} onClick={() => onSystem(s)}>
                    <span className="nm">{s}</span>
                    {hasQuery && c ? <span className="c">{c}</span> : null}
                  </button>
                );
              })}
            </div>
          </div>
          <input
            ref={inputRef} value={query} onChange={(e) => onChange(e.target.value)}
            onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
            placeholder={phText} spellCheck={false} aria-label="Search pathology cases"
          />
          {query && (
            <button className="psv2-clear" onClick={() => onChange('')} aria-label="Clear"><Icon name="x" size={17} /></button>
          )}

          {/* source filter — the same control, anchored to the far RIGHT end of the bar */}
          <div className="psv2-filter psv2-filter--src" data-active={srcExcluded.size ? '1' : '0'} data-open={srcOpen ? '1' : '0'} ref={srcRef}>
            <button className="psv2-filter-cap" onClick={() => setSrcOpen((o) => !o)} aria-expanded={srcOpen} aria-label="Filter by source collection">Source</button>
            <div className="psv2-filter-grid" role="listbox" aria-label="Source collection">
              {SOURCES.map((s) => {
                const c = srcCounts.get(s);
                const off = srcExcluded.has(s);
                return (
                  <button key={s} className={`cell src${off ? ' off' : ' on'}`} aria-pressed={!off} tabIndex={srcOpen ? 0 : -1} onClick={() => onSource(s)}>
                    <span className="nm"><span className="t">{s}</span><span className="sub">Excluded</span></span>
                    {hasQuery && c && !off ? <span className="c">{c}</span> : null}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* study toggles — appear with the results, stacked to fit the bar's height exactly */}
        <div className={`psv2-toggles${showToggles ? ' on' : ''}`} ref={togglesRef} aria-hidden={!showToggles}>
          <button
            className={`psv2-tog${showClinical ? ' on' : ''}`}
            onClick={() => setShowClinical((v) => !v)}
            tabIndex={showToggles ? 0 : -1}
            aria-pressed={showClinical}
          >
            {showClinical ? 'Hide clinical' : 'Show clinical'}
          </button>
          <button
            className={`psv2-tog${hideDiagnosis ? ' on' : ''}`}
            onClick={() => { setHideDiagnosis((v) => !v); setRevealed(new Set()); }}
            tabIndex={showToggles ? 0 : -1}
            aria-pressed={hideDiagnosis}
          >
            {hideDiagnosis ? 'Show diagnoses' : 'Hide diagnoses'}
          </button>
        </div>

        {/* user stats — top-left, mirrors the home page's block (desktop only) */}
        {loggedIn && userStats && (
          <div className="psv2-stats" aria-label="Your slide statistics">
            <div>Slides 24h: <b>{userStats.slides.today}</b></div>
            <div>
              Slides lifetime: <b>{userStats.slides.lifetime}</b>
              {(userStats.rank.lifetime <= 10 || session?.user?.email === 'fleshbits@gmail.com') && (
                <span className="rank"> (Global Rank #{userStats.rank.lifetime})</span>
              )}
            </div>
            <div>Favorites: <b>{userStats.favorites}</b></div>
          </div>
        )}

        <div className="psv2-actions">
          {status !== 'loading' && (loggedIn ? (
            <>
              <a className="psv2-link" href="/dashboard">Favorites</a>
              <button className="psv2-link auth-full" onClick={() => signOut()}>Sign out</button>
            </>
          ) : (
            <>
              <a className="psv2-link auth-full" href="/login">Sign in</a>
              <a className="psv2-cta-sm" href="/register">Sign up</a>
              <a className="psv2-iconlink auth-compact" href="/login" aria-label="Sign in"><Icon name="user" size={18} /></a>
            </>
          ))}
          <button className="psv2-toggle" onClick={toggleTheme} aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'} title="Toggle theme">
            <Icon name={isDark ? 'sun' : 'moon'} size={18} />
          </button>
        </div>
      </header>

      {/* reserves the vertical room the hero title + search occupy while undocked */}
      <div className="psv2-herospace" />

      {/* results */}
      <main className="psv2-results">
        {/* loading screen while the database streams in — mirrors the home page's panel
            (spinner / status / progress / step) in v2's own visual language. The panel
            fades in after a short delay so warm (IndexedDB) loads never flash it. */}
        {loading && (
          <div className="psv2-loadpanel" role="status" aria-live="polite">
            <svg className="psv2-loadspin" viewBox="0 0 24 24" aria-hidden="true">
              <circle className="tr" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" />
              <path className="ld" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <div className="psv2-loadstatus">{meta.phase}</div>
            <div className="psv2-loadbar"><div className="psv2-loadfill" style={{ width: `${meta.progress}%` }} /></div>
            <div className="psv2-loadmeta">
              <span className="pct">{meta.progress}%</span>
              <span className="dot">·</span>
              <span>Step {meta.step} of 3</span>
            </div>
            <div className="psv2-loaddesc">Preparing the pathology case database for searching…</div>
          </div>
        )}

        {active && !loading && (
          <>
            {/* no result count — it was a whole row of dead space. The only thing worth showing
                here is the active filters, and only when there are any. */}
            {(sysSelected.size > 0 || srcExcluded.size > 0) && (
              <div className="psv2-toolbar">
                {/* one bubble per active filter, each dismissible on its own */}
                {[...sysSelected].map((s) => (
                  <button key={`sys-${s}`} className="psv2-clearfilter" onClick={() => onSystem(s)}>
                    <span className="cap">{s}</span>
                    <Icon name="x" size={13} />
                  </button>
                ))}
                {[...srcExcluded].map((s) => (
                  <button key={`src-${s}`} className="psv2-clearfilter psv2-clearfilter--ex" onClick={() => onSource(s)}>
                    <span className="cap">Excluding {s}</span>
                    <Icon name="x" size={13} />
                  </button>
                ))}
              </div>
            )}

            {filtered.length === 0 ? (
              <div className="psv2-empty">No cases match{hasQuery ? ` “${query}”` : ''}. Try a broader term.</div>
            ) : (
              <div className="psv2-list">
                {filtered.map((r, idx) => (
                  <ResultRow
                    key={r.i} r={r}
                    viewedAt={r.ci ? history.get(r.ci) : undefined}
                    fav={!!r.ci && favorites.has(r.ci)}
                    onView={() => { logClick(r, idx, filtered.length); recordView(r); }}
                    onFav={(e) => toggleFavorite(r, e)}
                    showClinical={showClinical}
                    masked={hideDiagnosis && !revealed.has(r.i)}
                    onReveal={(e) => { e.preventDefault(); e.stopPropagation(); setRevealed((s) => new Set(s).add(r.i)); }}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </main>

      {/* signup prompt for anonymous users — A/B/C variants, each logging its key into
          the MODAL rows so per-variant conversion is measurable. Preview mode renders
          even when signed in and logs as preview-* to keep the live numbers clean. */}
      {showSignupModal && (!loggedIn || modalPreview) && (
        <SignupVariant
          variant={modalVariant}
          preview={modalPreview}
          viewedTitles={sessionTitles}
          sessionCount={Math.max(slideClickCount.current, sessionTitles.length)}
          onClose={() => setShowSignupModal(false)}
        />
      )}

      {/* returning-user pulse survey (once ever; corner card; preview with ?modal=feedback) */}
      {showFeedback && !showSignupModal && (
        <FeedbackModal onClose={() => setShowFeedback(false)} />
      )}
    </div>
  );
}

function ResultRow({ r, viewedAt, fav, onView, onFav, showClinical, masked, onReveal }: {
  r: Card; viewedAt?: number; fav: boolean; onView: () => void; onFav: (e: React.MouseEvent) => void;
  showClinical: boolean; masked: boolean; onReveal: (e: React.MouseEvent) => void;
}) {
  // The source's own case name (extracted_diagnosis) is the title, matching the main site —
  // it is what people actually search for ("Kikuchi"), whereas essential_diagnosis is the
  // formal wording ("histiocytic necrotizing lymphadenitis"). Show the formal one alongside
  // the other metadata so nothing is lost, but only when it really adds something.
  const title = r.xd || r.dx || 'Untitled case';
  const tl = title.trim().toLowerCase(), dl = (r.dx || '').trim().toLowerCase();
  const formal = dl && dl !== tl && !tl.includes(dl) && !dl.includes(tl) ? r.dx : null;
  // the variant is a diagnostic descriptor ("Matrix producing carcinoma, grade 3"), so it has
  // to be masked too — otherwise "Hide diagnoses" gives the answer away in the meta line
  const bits = [r.s, r.o, r.st && r.st !== r.o ? r.st : null, masked ? null : r.v].filter(Boolean) as string[];
  const seen = viewedAt != null;
  const seenDate = seen ? new Date(viewedAt as number) : null;
  return (
    <a
      className={`psv2-row${seen ? ' seen' : ''}`} href={r.u || undefined}
      target="_blank" rel="noopener noreferrer"
      onClick={onView} onAuxClick={onView}
    >
      <div className="psv2-main">
        <div className="psv2-dxline">
          {masked ? (
            <button className="psv2-reveal" onClick={onReveal}>Show diagnosis</button>
          ) : (
            <span className="psv2-dx">{title}</span>
          )}
          {seenDate && (
            <span className="psv2-seen" title={`Viewed ${seenDate.toLocaleString()}`}>
              Viewed {seenDate.toLocaleDateString()}
            </span>
          )}
        </div>
        <div className="psv2-meta">
          {bits.map((b, i) => <span key={i}>{i > 0 && <span className="d">·</span>}<span className="cap">{b}</span></span>)}
          {formal && !masked && <span>{bits.length > 0 && <span className="d">·</span>}<span className="dx2">{formal}</span></span>}
        </div>

        {showClinical && (
          <div className="psv2-clin">
            {r.st && <p><b>Site</b> <span className="dx2">{r.st}</span></p>}
            {(r.sx || r.ag != null) && (
              <p><b>Demographics</b> <span className="cap">{[r.sx, r.ag != null ? `${r.ag} years` : null].filter(Boolean).join(', ')}</span></p>
            )}
            {r.ch && <p><b>Clinical history</b> <span className="dx2">{r.ch}</span></p>}
            {r.stn && <p><b>Stain</b> <span className="dx2">{r.stn}</span></p>}
            {/* microscopic describes the diagnosis, so it stays hidden while masked */}
            {r.mic && !masked && <p><b>Microscopic</b> <span className="dx2">{r.mic}</span></p>}
          </div>
        )}
      </div>
      <div className="psv2-act">
        {r.src && <span className="psv2-pill">{r.src}</span>}
        <button className={`psv2-fav${fav ? ' on' : ''}`} onClick={onFav} aria-label={fav ? 'Remove from favorites' : 'Add to favorites'} title={fav ? 'Remove from favorites' : 'Add to favorites'}>
          <Icon name="heart" size={16} />
        </button>
        <span className="psv2-chev"><Icon name="chev" size={17} /></span>
      </div>
    </a>
  );
}
