'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import '../v2/v2.css';
import './searchv2.css';
import { useTheme } from '@/components/ThemeProvider';
import { useSession, signOut } from 'next-auth/react';
import { getVisitorId } from '@/lib/analytics';
import { useSearchV2, type SvCase, type SvGroup } from './useSearchV2';

/*
 * /searchv2 — search over the catalogue case set (35k cases / 58k slides) using the new worker in
 * public/searchv2-data/worker.js. Same visual language as the home page (v2.css); results are
 * grouped by diagnosis so a term with 200 cases is one block, not 200 rows.
 */

const EXAMPLE_QUERIES = [
  'ovary serous carcinoma', 'kikuchi', 'nodular fasciitis', 'dcis', 'granuloma annulare',
  'pilomatrixoma', 'wilms', 'ipmn', 'thyroid anaplastic', 'lobular capillary',
];

// scroll-dock geometry (px) — identical to the home page so the bar feels the same
const REST_FONT = 21, DOCK = 92, BAR_H = 60, GAP = 16;
const HERO_TITLE_TOP = 66, HERO_SEARCH_TOP = 150, HERO_SEARCH_H = 58, DOCK_SEARCH_H = 40, ACT_RESERVE = 190;
const VISIBLE_PER_GROUP = 4;

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const p: Record<string, React.ReactNode> = {
    x: <path d="M18 6 6 18M6 6l12 12" />,
    chev: <path d="m9 6 6 6-6 6" />,
    down: <path d="m6 9 6 6 6-6" />,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.4 1.4M17.6 17.6 19 19M19 5l-1.4 1.4M6.4 17.6 5 19" /></>,
    moon: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />,
    user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      {p[name]}
    </svg>
  );
}

export default function SearchV2App() {
  const { meta, groups, search, setFilters } = useSearchV2();
  const { theme, setTheme } = useTheme();
  const { data: session, status } = useSession();

  const [query, setQuery] = useState('');
  const [sysSelected, setSysSelected] = useState<Set<string>>(new Set());
  const [srcExcluded, setSrcExcluded] = useState<Set<string>>(new Set());
  const [placeholder, setPlaceholder] = useState('');
  const [focused, setFocused] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [srcOpen, setSrcOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const rootRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const searchBoxRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  const srcRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const restRectRef = useRef<DOMRect | null>(null);
  const rafRef = useRef(0);
  const dockedRef = useRef(false);
  const loggedIn = !!session?.user;

  /* ---------- scroll-dock (same motion as the home page, without the toggle stack) ---------- */
  const applyScroll = useCallback(() => {
    const root = rootRef.current, title = titleRef.current, box = searchBoxRef.current, rr = restRectRef.current;
    if (!root || !title || !box || !rr) return;
    const vw = window.innerWidth;
    const raw = Math.min(1, Math.max(0, window.scrollY / DOCK));
    const p = 1 - Math.pow(1 - raw, 3);
    root.style.setProperty('--p', String(p));
    const docked = p > 0.5;
    if (docked !== dockedRef.current) { dockedRef.current = docked; root.classList.toggle('docked', docked); }
    root.classList.toggle('pinned', p >= 1);
    const mobile = vw <= 820;
    const baseW = rr.width;
    const heroFont = Math.min(54, vw * 0.115);
    const curFont = REST_FONT + (heroFont - REST_FONT) * (1 - p);
    const searchDockTop = (mobile ? BAR_H : 0) + (BAR_H - DOCK_SEARCH_H) / 2;
    const searchTop = HERO_SEARCH_TOP + (searchDockTop - HERO_SEARCH_TOP) * p;
    const searchH = HERO_SEARCH_H + (DOCK_SEARCH_H - HERO_SEARCH_H) * p;
    const heroSearchW = Math.min(640, vw - 48);
    const searchHeroLeft = (vw - heroSearchW) / 2;
    const titleHeroLeft = (vw - baseW * (heroFont / REST_FONT)) / 2;
    let searchDockLeft: number, titleDockLeft: number, dockSearchW: number;
    const titleDockTop = (BAR_H - curFont * 1.15) / 2;
    if (mobile) {
      searchDockLeft = 12; dockSearchW = Math.max(160, vw - 24); titleDockLeft = 12;
    } else {
      const avail = vw - 20 - ACT_RESERVE;
      dockSearchW = Math.min(520, Math.max(260, avail - baseW - GAP));
      const groupW = baseW + GAP + dockSearchW;
      const groupLeft = Math.max(20, 20 + (avail - groupW) / 2);
      titleDockLeft = groupLeft; searchDockLeft = groupLeft + baseW + GAP;
    }
    const lerp = (a: number, b: number) => a + (b - a) * p;
    title.style.fontSize = `${curFont.toFixed(2)}px`;
    title.style.left = `${lerp(titleHeroLeft, titleDockLeft).toFixed(1)}px`;
    title.style.top = `${lerp(HERO_TITLE_TOP, titleDockTop).toFixed(1)}px`;
    box.style.width = `${lerp(heroSearchW, dockSearchW).toFixed(1)}px`;
    box.style.left = `${lerp(searchHeroLeft, searchDockLeft).toFixed(1)}px`;
    box.style.top = `${searchTop.toFixed(1)}px`;
    box.style.height = `${searchH.toFixed(1)}px`;
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

  /* ---------- ghost-text typewriter ---------- */
  useEffect(() => {
    if (meta.status !== 'ready' || query.trim() || focused) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let idx = Math.floor(Math.random() * EXAMPLE_QUERIES.length);
    const type = (text: string, n: number) => {
      if (cancelled) return;
      if (n <= text.length) { setPlaceholder(text.slice(0, n)); timer = setTimeout(() => type(text, n + 1), 55); }
      else timer = setTimeout(() => erase(text, text.length), 1900);
    };
    const erase = (text: string, n: number) => {
      if (cancelled) return;
      if (n >= 0) { setPlaceholder(text.slice(0, n)); timer = setTimeout(() => erase(text, n - 1), 180 / Math.max(text.length, 1)); }
      else { idx = (idx + 1) % EXAMPLE_QUERIES.length; type(EXAMPLE_QUERIES[idx], 0); }
    };
    type(EXAMPLE_QUERIES[idx], 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [meta.status, query, focused]);

  /* ---------- keyboard + outside tap ---------- */
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
  const onChange = (v: string) => { setQuery(v); setExpanded(new Set()); search(v); };
  const onSystem = (sys: string) => setSysSelected((cur) => { const n = new Set(cur); if (n.has(sys)) n.delete(sys); else n.add(sys); return n; });
  const onSource = (src: string) => setSrcExcluded((cur) => { const n = new Set(cur); if (n.has(src)) n.delete(src); else n.add(src); return n; });

  // facets are applied inside the worker (before its cut); re-run the query under the new constraint
  const facetsReady = useRef(false);
  useEffect(() => {
    setFilters({ sys: [...sysSelected], srcEx: [...srcExcluded] });
    if (!facetsReady.current) { facetsReady.current = true; return; }
    search(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sysSelected, srcExcluded]);

  // click log — same endpoint and row shape as the home page, tagged page=searchv2
  const logClick = useCallback((c: SvCase, position: number, total: number) => {
    fetch('/api/log-search', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: query.trim() || (sysSelected.size ? [...sysSelected].join(' ') : ''),
        diagnosis: c.d, resultPosition: position + 1,
        organ: c.o, system: c.s, source: c.src, similarityScore: c._score,
        totalResultsAvailable: total,
        userEmail: session?.user?.email, userName: session?.user?.name,
        visitorId: getVisitorId(), page: 'searchv2',
      }),
    }).catch(() => {});
  }, [query, sysSelected, session]);

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
  const totalCases = useMemo(() => groups.reduce((a, g) => a + g.total, 0), [groups]);
  // facet counts from the current result set (cases, cross-filtered)
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of groups) for (const c of g.cases) { if (c.s && (!c.src || !srcExcluded.has(c.src))) m.set(c.s, (m.get(c.s) || 0) + 1); }
    return m;
  }, [groups, srcExcluded]);
  const srcCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of groups) for (const c of g.cases) { if (c.src && (!sysSelected.size || (c.s && sysSelected.has(c.s)))) m.set(c.src, (m.get(c.src) || 0) + 1); }
    return m;
  }, [groups, sysSelected]);
  const phText = loading ? 'Loading cases…' : (focused ? '' : placeholder);
  let position = 0;

  return (
    <div className="psv2 psv2--sv" ref={rootRef}>
      <header className="psv2-bar">
        <h1 className="psv2-title" ref={titleRef}>Pathology Search</h1>

        <div className="psv2-searchbox" ref={searchBoxRef}>
          <div className="psv2-filter" data-active={sysSelected.size ? '1' : '0'} data-open={filterOpen ? '1' : '0'} ref={filterRef}>
            <button className="psv2-filter-cap" onClick={() => setFilterOpen((o) => !o)} aria-expanded={filterOpen} aria-label="Filter by organ system">System</button>
            <div className="psv2-filter-grid" role="listbox" aria-label="Organ system">
              {meta.systems.map((s) => {
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
            placeholder={phText} spellCheck={false} aria-label="Search pathology cases" autoComplete="off"
          />
          {query && (
            <button className="psv2-clear" onClick={() => onChange('')} aria-label="Clear"><Icon name="x" size={17} /></button>
          )}
          <div className="psv2-filter psv2-filter--src" data-active={srcExcluded.size ? '1' : '0'} data-open={srcOpen ? '1' : '0'} ref={srcRef}>
            <button className="psv2-filter-cap" onClick={() => setSrcOpen((o) => !o)} aria-expanded={srcOpen} aria-label="Filter by source collection">Source</button>
            <div className="psv2-filter-grid" role="listbox" aria-label="Source collection">
              {meta.sources.map((s) => {
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

        <div className="psv2-actions">
          {status !== 'loading' && (loggedIn ? (
            <>
              <a className="psv2-link" href="/dashboard">Favorites</a>
              <button className="psv2-link" onClick={() => signOut()}>Sign out</button>
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

      <div className="psv2-herospace" />

      <main className="psv2-results">
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
            {(sysSelected.size > 0 || srcExcluded.size > 0) && (
              <div className="psv2-toolbar">
                {[...sysSelected].map((s) => (
                  <button key={`sys-${s}`} className="psv2-clearfilter" onClick={() => onSystem(s)}>
                    <span className="cap">{s}</span><Icon name="x" size={13} />
                  </button>
                ))}
                {[...srcExcluded].map((s) => (
                  <button key={`src-${s}`} className="psv2-clearfilter psv2-clearfilter--ex" onClick={() => onSource(s)}>
                    <span className="cap">Excluding {s}</span><Icon name="x" size={13} />
                  </button>
                ))}
              </div>
            )}

            {groups.length === 0 ? (
              <div className="psv2-empty">No cases match{hasQuery ? ` “${query}”` : ''}. Try a broader term.</div>
            ) : (
              <div className="psv2-list">
                {groups.map((g, gi) => {
                  const prevSem = gi > 0 && groups[gi - 1].sem;
                  const divider = g.sem && !prevSem;
                  const start = position; position += g.cases.length;
                  return (
                    <GroupBlock
                      key={g.d} g={g} start={start} divider={!!divider}
                      open={expanded.has(g.d)}
                      onToggle={() => setExpanded((s) => { const n = new Set(s); if (n.has(g.d)) n.delete(g.d); else n.add(g.d); return n; })}
                      onView={(c, i) => logClick(c, i, totalCases)}
                    />
                  );
                })}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function caseBits(c: SvCase, withSystem: boolean) {
  const bits: string[] = [];
  if (withSystem && c.s) bits.push(c.s);
  if (c.o) bits.push(c.o);
  if (c.sd && c.sd.toLowerCase() !== (c.o || '').toLowerCase()) bits.push(c.sd);
  return bits;
}

function CaseMeta({ c, withSystem }: { c: SvCase; withSystem: boolean }) {
  const bits = caseBits(c, withSystem);
  const extra = [c.t, c.q].filter(Boolean) as string[];
  return (
    <div className="psv2-meta">
      {bits.map((b, i) => <span key={i}>{i > 0 && <span className="d">·</span>}<span className="cap">{b}</span></span>)}
      {extra.map((b, i) => <span key={`x${i}`}>{(bits.length > 0 || i > 0) && <span className="d">·</span>}<span className="dx2">{b}</span></span>)}
    </div>
  );
}

function Slides({ c }: { c: SvCase }) {
  if (!c.n || c.n <= 1) return null;
  return <span className="psv2-slides">{c.n} slides</span>;
}

function GroupBlock({ g, start, divider, open, onToggle, onView }: {
  g: SvGroup; start: number; divider: boolean; open: boolean; onToggle: () => void;
  onView: (c: SvCase, i: number) => void;
}) {
  if (g.cases.length === 1 && g.total === 1) {
    const c = g.cases[0];
    return (
      <>
        {divider && <div className="psv2-sem-divider">Related</div>}
        <a className="psv2-row" href={c.u || undefined} target="_blank" rel="noopener noreferrer" onClick={() => onView(c, start)} onAuxClick={() => onView(c, start)}>
          <div className="psv2-main">
            <div className="psv2-dxline"><span className="psv2-dx">{g.d}</span></div>
            <CaseMeta c={c} withSystem />
          </div>
          <div className="psv2-act">
            <Slides c={c} />
            {c.src && <span className="psv2-pill">{c.src}</span>}
            <span className="psv2-chev"><Icon name="chev" size={17} /></span>
          </div>
        </a>
      </>
    );
  }
  const shown = open ? g.cases : g.cases.slice(0, VISIBLE_PER_GROUP);
  const hidden = g.total - shown.length;
  const systems = new Set(g.cases.map((c) => c.s));
  return (
    <>
      {divider && <div className="psv2-sem-divider">Related</div>}
      <div className="psv2-group">
        <div className="psv2-group-head">
          <span className="psv2-dx">{g.d}</span>
          <span className="psv2-group-n">{g.total} cases{systems.size === 1 ? ` · ${[...systems][0]}` : ''}</span>
        </div>
        {shown.map((c, i) => (
          <a key={c.i} className="psv2-row psv2-row--sub" href={c.u || undefined} target="_blank" rel="noopener noreferrer" onClick={() => onView(c, start + i)} onAuxClick={() => onView(c, start + i)}>
            <div className="psv2-main">
              <CaseMeta c={c} withSystem={systems.size > 1} />
            </div>
            <div className="psv2-act">
              <Slides c={c} />
              {c.src && <span className="psv2-pill">{c.src}</span>}
              <span className="psv2-chev"><Icon name="chev" size={17} /></span>
            </div>
          </a>
        ))}
        {(hidden > 0 || open) && g.cases.length > VISIBLE_PER_GROUP && (
          <button className="psv2-group-more" onClick={onToggle}>
            {open ? 'Show fewer' : `Show ${Math.min(hidden, g.cases.length - shown.length)} more${g.cases.length < g.total ? ` of ${hidden}` : ''}`}
            <Icon name={open ? 'chev' : 'down'} size={14} />
          </button>
        )}
      </div>
    </>
  );
}
