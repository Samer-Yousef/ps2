'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import './v3.css';
import { useTheme } from '@/components/ThemeProvider';
import { useSession, signOut } from 'next-auth/react';
import { useV2Search, type Card } from '../v2/useV2Search';

// Ghost-text phrases — same rotating examples as the original homepage.
const EXAMPLE_QUERIES = [
  'ovary malignant', 'ovary serous carcinoma', 'lymph node benign', 'kikuchi',
  'serous borderline with carcinoma', 'melanoma lymph node', 'breast benign neoplasm', 'thyroid anaplastic',
];
const LOGIN_PROMPT = 'Login to save slides to your Favorites and view your slide history';

// The highest-volume queries in search-logs.txt — shown on the idle page as shortcuts.
const QUICK = [
  'nodular fasciitis', 'meningioma', 'squamous cell carcinoma', 'dermatofibroma',
  'synovial sarcoma', 'pecoma', 'chordoma', 'osteosarcoma',
];

// Long system names repeat on every row and crowd out the useful detail.
const SHORT_SYS: Record<string, string> = {
  'Musculoskeletal & Soft Tissue': 'Musculoskeletal',
  'Hepatopancreatobiliary & Peritoneal': 'Hepatobiliary',
  'Genitourinary & Reproductive': 'Genitourinary',
  'Cardiovascular & Vascular': 'Cardiovascular',
  'Autopsy & Multiorgan Pathology': 'Autopsy',
  'Syndromic & Genetic Disorders': 'Syndromic',
  'Central Nervous System': 'CNS',
};

// Organ systems (all 16), ordered by frequency in the dataset — these replace the old suggestion chips.
const SYSTEMS = [
  'Skin', 'Genitourinary & Reproductive', 'Haematolymphoid', 'Gastrointestinal', 'Head & Neck',
  'Breast', 'Musculoskeletal & Soft Tissue', 'Hepatopancreatobiliary & Peritoneal', 'Central Nervous System',
  'Thoracic', 'Endocrine', 'Paediatric Pathology', 'Cardiovascular & Vascular', 'Systemic Disease',
  'Autopsy & Multiorgan Pathology', 'Syndromic & Genetic Disorders',
];

// scroll-dock geometry (px)
const REST_FONT = 21;         // docked title font-size, matches CSS
const DOCK = 92;              // scroll distance to fully dock — short, so it snaps rather than drifts
const BAR_H = 60;             // sticky bar height
const GAP = 16;               // gap between docked title and search bar
const HERO_TITLE_TOP = 66;    // viewport-y of the big title box (clears the top action row)
const HERO_SEARCH_TOP = 150;  // viewport-y of the hero search box
const HERO_SEARCH_H = 58;
const DOCK_SEARCH_H = 40;
const FILTER_W = 52;          // collapsed filter footprint (the tiny scaled-down grid + "System")
const FILTER_W_M = 46;        // collapsed filter footprint on mobile
const FGAP = 12;              // gap between the filter and the search bar
const ACT_RESERVE = 190;      // room kept on the right for the header actions (desktop)

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
  const { meta, results, search } = useV2Search();
  const { theme, setTheme } = useTheme();
  const { data: session, status } = useSession();

  const [query, setQuery] = useState('');
  const [sysFilter, setSysFilter] = useState<string | null>(null);
  const [history, setHistory] = useState<Map<string, number>>(new Map());
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [placeholder, setPlaceholder] = useState('');
  const [focused, setFocused] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const searchBoxRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const restRectRef = useRef<DOMRect | null>(null);
  const rafRef = useRef(0);
  const dockedRef = useRef(false);

  const loggedIn = !!session?.user;

  /* ---------- scroll-dock: title + filter + search bar all glide up into the bar ---------- */
  const applyScroll = useCallback(() => {
    const root = rootRef.current, title = titleRef.current, box = searchBoxRef.current, filter = filterRef.current, rr = restRectRef.current;
    if (!root || !title || !box || !filter || !rr) return;
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
    const fw = mobile ? FILTER_W_M : FILTER_W;
    const lead = fw + FGAP;                                  // horizontal room the filter takes left of the search

    // ---- search box top/height (same in every layout) ----
    const searchTop = HERO_SEARCH_TOP + ((BAR_H - DOCK_SEARCH_H) / 2 - HERO_SEARCH_TOP) * p;
    const searchH = HERO_SEARCH_H + (DOCK_SEARCH_H - HERO_SEARCH_H) * p;

    // ---- hero layout: [filter][search] centred as a group; title big above ----
    const heroSearchW = Math.min(600, vw - 40 - lead);
    const heroGroupLeft = (vw - (lead + heroSearchW)) / 2;
    const searchHeroLeft = heroGroupLeft + lead;
    const titleHeroLeft = (vw - baseW * (heroFont / REST_FONT)) / 2;

    // ---- docked layout: [title][filter][search] ----
    let searchDockLeft: number, titleDockLeft: number, dockSearchW: number;
    const titleDockTop = (BAR_H - curFont * 1.15) / 2;
    if (mobile) {
      // title hidden on mobile — left-align [filter][search]
      searchDockLeft = 12 + lead;
      dockSearchW = Math.max(140, vw - searchDockLeft - 96);
      titleDockLeft = 12;
    } else {
      const avail = vw - 20 - ACT_RESERVE;                  // usable band between left margin and the actions
      dockSearchW = Math.min(400, Math.max(220, avail - baseW - GAP - lead));
      const groupW = baseW + GAP + lead + dockSearchW;
      const groupLeft = Math.max(20, 20 + (avail - groupW) / 2);
      titleDockLeft = groupLeft;
      searchDockLeft = groupLeft + baseW + GAP + lead;
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

    // filter sits immediately left of the search bar, vertically centred against it
    filter.style.left = `${(searchLeft - lead).toFixed(1)}px`;
    filter.style.top = `${(searchTop + searchH / 2).toFixed(1)}px`;
    filter.style.width = `${fw}px`;
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
      setHistory(m);
      setFavorites(new Set());
    }
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
      if (e.key === 'Escape') { if (filterOpen) setFilterOpen(false); else if (query) { setQuery(''); search(''); } }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [query, search, filterOpen]);

  /* ---------- close the filter panel on outside tap (needed on touch — no hover) ---------- */
  useEffect(() => {
    if (!filterOpen) return;
    const onDown = (e: MouseEvent) => { if (!filterRef.current?.contains(e.target as Node)) setFilterOpen(false); };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [filterOpen]);

  /* ---------- actions ---------- */
  const onChange = (v: string) => { setQuery(v); search(v); };

  const onSystem = (sys: string) => {
    setFilterOpen(false);
    if (sysFilter === sys) { setSysFilter(null); if (!query.trim()) search(''); return; }
    setSysFilter(sys);
    if (!query.trim()) search(sys);            // browse a whole system when the box is empty
  };

  const recordView = useCallback((c: Card) => {
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
  const active = hasQuery || !!sysFilter;
  const loading = meta.status !== 'ready';
  const isDark = theme === 'dark';
  const filtered = sysFilter ? results.filter((r) => r.s === sysFilter) : results;
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of results) if (r.s) m.set(r.s, (m.get(r.s) || 0) + 1);
    return m;
  }, [results]);
  const phText = loading ? 'Loading cases…' : (focused ? '' : placeholder);

  return (
    <div className="psv3" ref={rootRef}>
      {/* sticky bar — the title and search bar both dock here, ending side-by-side */}
      <header className="psv3-bar">
        <h1 className="psv3-title" ref={titleRef}>Pathology Search</h1>

        <div className="psv3-searchbox" ref={searchBoxRef}>
          <span className="lead"><Icon name="search" size={18} /></span>
          <input
            ref={inputRef} value={query} onChange={(e) => onChange(e.target.value)}
            onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
            placeholder={phText} spellCheck={false} aria-label="Search pathology cases"
          />
          {query
            ? <button className="psv3-clear" onClick={() => onChange('')} aria-label="Clear"><Icon name="x" size={17} /></button>
            : <span className="psv3-kbd">/</span>}
        </div>

        {/* system filter — one 4×4 grid; shown tiny (a scaled-down copy) until the cursor approaches, then it grows and becomes interactive */}
        <div className="psv3-filter" data-active={sysFilter ? '1' : '0'} data-open={filterOpen ? '1' : '0'} ref={filterRef}>
          <button className="psv3-filter-cap" onClick={() => setFilterOpen((o) => !o)} aria-expanded={filterOpen} aria-label="Filter by organ system">System</button>
          <div className="psv3-filter-grid" role="listbox" aria-label="Organ system">
            {SYSTEMS.map((s) => {
              const c = counts.get(s);
              return (
                <button key={s} className={`cell${sysFilter === s ? ' on' : ''}`} aria-pressed={sysFilter === s} tabIndex={filterOpen ? 0 : -1} onClick={() => onSystem(s)}>
                  <span className="nm">{s}</span>
                  {hasQuery && c ? <span className="c">{c}</span> : null}
                </button>
              );
            })}
          </div>
        </div>

        <div className="psv3-actions">
          {status !== 'loading' && (loggedIn ? (
            <>
              <a className="psv3-link" href="/dashboard">Favorites</a>
              <button className="psv3-link auth-full" onClick={() => signOut()}>Sign out</button>
            </>
          ) : (
            <>
              <a className="psv3-link auth-full" href="/login">Sign in</a>
              <a className="psv3-cta-sm" href="/register">Sign up</a>
              <a className="psv3-iconlink auth-compact" href="/login" aria-label="Sign in"><Icon name="user" size={18} /></a>
            </>
          ))}
          <button className="psv3-toggle" onClick={toggleTheme} aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'} title="Toggle theme">
            <Icon name={isDark ? 'sun' : 'moon'} size={18} />
          </button>
        </div>
      </header>

      {/* reserves the vertical room the hero title + search occupy while undocked */}
      <div className="psv3-herospace" />

      {/* results */}
      <main className="psv3-results">
        {/* the idle page was a full screen of nothing — these are the highest-volume real
            queries from the search logs, so they are a genuine shortcut, not filler */}
        {!active && !loading && (
          <div className="psv3-quick">
            <div className="psv3-quickHead">Most searched</div>
            <div className="psv3-quickRow">
              {QUICK.map((q, i) => (
                <button key={q} className="psv3-qchip" style={{ animationDelay: `${i * 30}ms` }}
                        onClick={() => { setQuery(q); search(q); inputRef.current?.focus(); }}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {active && loading && (
          <div className="psv3-list">{Array.from({ length: 7 }).map((_, i) => <div key={i} className="psv3-skel" />)}</div>
        )}

        {active && !loading && (
          <>
            <div className="psv3-toolbar">
              <span className="psv3-count"><b>{filtered.length}</b> result{filtered.length === 1 ? '' : 's'}
                {sysFilter && <> in <span className="cap">{sysFilter}</span></>}
              </span>
              {sysFilter && <button className="psv3-clearfilter" onClick={() => { setSysFilter(null); if (!hasQuery) search(''); }}>Clear filter</button>}
            </div>

            {filtered.length === 0 ? (
              <div className="psv3-empty">No cases match{hasQuery ? ` “${query}”` : ''}. Try a broader term.</div>
            ) : (
              <div className="psv3-list">
                {filtered.map((r) => (
                  <ResultRow
                    key={r.i} r={r}
                    viewedAt={r.ci ? history.get(r.ci) : undefined}
                    fav={!!r.ci && favorites.has(r.ci)}
                    onView={() => recordView(r)}
                    onFav={(e) => toggleFavorite(r, e)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function ResultRow({ r, viewedAt, fav, onView, onFav }: {
  r: Card; viewedAt?: number; fav: boolean; onView: () => void; onFav: (e: React.MouseEvent) => void;
}) {
  // The source's own case name (extracted_diagnosis) is the title, matching the main site —
  // it is what people actually search for ("Kikuchi"), whereas essential_diagnosis is the
  // formal wording ("histiocytic necrotizing lymphadenitis"). Show the formal one alongside
  // the other metadata so nothing is lost, but only when it really adds something.
  const title = r.xd || r.dx || 'Untitled case';
  const tl = title.trim().toLowerCase(), dl = (r.dx || '').trim().toLowerCase();
  const formal = dl && dl !== tl && !tl.includes(dl) && !dl.includes(tl) ? r.dx : null;
  // Short labels (system, organ) read well title-cased; free-text fields like site and variant
  // are whole phrases and must stay sentence case — `capitalize` turned them into
  // "Chest Wall, Immediately In Front Of Costochondral Junction".
  // organ often repeats the system verbatim ("Skin · Skin") — drop the duplicate
  const sysLabel = r.s ? (SHORT_SYS[r.s] || r.s) : null;
  const organLabel = r.o && r.o.trim().toLowerCase() !== (r.s || '').trim().toLowerCase() ? r.o : null;
  const labels = [sysLabel, organLabel].filter(Boolean) as string[];
  const phrases = [r.st && r.st !== r.o ? r.st : null, r.v, formal].filter(Boolean) as string[];
  const seen = viewedAt != null;
  const seenDate = seen ? new Date(viewedAt as number) : null;
  return (
    <a
      className={`psv3-row${seen ? ' seen' : ''}`} href={r.u || undefined}
      target="_blank" rel="noopener noreferrer"
      onClick={onView} onAuxClick={onView}
    >
      <div className="psv3-main">
        <div className="psv3-dxline">
          <span className="psv3-dx">{title}</span>
          {seenDate && (
            <span className="psv3-seen" title={`Viewed ${seenDate.toLocaleString()}`}>
              Viewed {seenDate.toLocaleDateString()}
            </span>
          )}
        </div>
        <div className="psv3-meta">
          {labels.map((b, i) => <span key={`l${i}`}>{i > 0 && <span className="d">·</span>}<span className="cap">{b}</span></span>)}
          {phrases.map((b, i) => (
            <span key={`p${i}`}>{(labels.length > 0 || i > 0) && <span className="d">·</span>}<span className="dx2">{b}</span></span>
          ))}
        </div>
      </div>
      <div className="psv3-act">
        {r.src && <span className="psv3-pill">{r.src}</span>}
        <button className={`psv3-fav${fav ? ' on' : ''}`} onClick={onFav} aria-label={fav ? 'Remove from favorites' : 'Add to favorites'} title={fav ? 'Remove from favorites' : 'Add to favorites'}>
          <Icon name="heart" size={16} />
        </button>
        <span className="psv3-chev"><Icon name="chev" size={17} /></span>
      </div>
    </a>
  );
}
