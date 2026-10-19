'use client';
// /catv2 — the catalogue as two panes. Left: one collapsible tree (system › organ › mode › WHO headings / patterns);
// tap a row to open it in place and the right pane lists that category's cases. Every branch animates to its exact
// height, predicted with Pretext before the rows exist in the DOM; Pretext also fits the one-line child preview.
// Open rows are sticky: as you scroll into a branch its heading freezes at the top, and each deeper open heading
// stacks under the one above, so the frozen stack is the path you are on.
// On a phone the case pane slides in over the tree and a bottom bar brings it back.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { prepare, layout, measureNaturalWidth, type PreparedText } from '@chenglou/pretext';
import type { TNode, TCase } from '@/lib/catv2';

// ---- geometry (keep in sync with catv2.css) ----
const LH = 20, PLH = 16, PAD = 9, CHEV = 22, GAP = 8;
// indent steps shrink past the organ/mode levels so deep WHO entities keep a readable label width
const indentFor = (depth: number, compact: boolean) =>
  compact ? Math.min(depth, 2) * 12 + Math.max(0, depth - 2) * 8 : Math.min(depth, 4) * 16 + Math.max(0, depth - 4) * 10;
const geo = (compact: boolean) => (compact ? { side: 8, count: 44 } : { side: 10, count: 50 });
const fmt = (n: number) => n.toLocaleString('en-GB');
const ease = 'cubic-bezier(.2,.9,.25,1)';
const PAGE = 60;
// one hue per organ, cycling so neighbouring organs never share one; nested branches compound the tint
const HUES = [214, 160, 28, 338, 268, 96];
const isSys = (id: string) => /^s\d+$/.test(id);

type Hit = { id: string; name: string; cases: number; chain: string[]; crumbs: string[] };
interface CaseData { cases: TCase[]; total: number }

// ---- Pretext measurement helpers ----
class Measurer {
  private cache = new Map<string, PreparedText>();
  constructor(public font: string, public smallFont: string) {}
  prep(text: string, small = false) {
    const key = (small ? 's:' : 'l:') + text;
    let p = this.cache.get(key);
    if (!p) { p = prepare(text, small ? this.smallFont : this.font); this.cache.set(key, p); }
    return p;
  }
  lines(text: string, width: number) { return width > 20 ? layout(this.prep(text), width, LH).lineCount : 1; }
  width(text: string, small = false) { return measureNaturalWidth(this.prep(text, small)); }
  private previews = new Map<string, string>();
  /** Fit as many child names as possible on one preview line, then "+N". Cached per (owner, width). */
  preview(key: string, names: string[], width: number): string {
    const k = `${key}|${width}`;
    let v = this.previews.get(k);
    if (v === undefined) { v = this.fit(names, width); this.previews.set(k, v); }
    return v;
  }
  private fit(names: string[], width: number): string {
    if (!names.length || width < 40) return '';
    const sep = this.width(', ', true);
    let out: string[] = []; let used = 0;
    for (let i = 0; i < names.length; i++) {
      const w = this.width(names[i], true) + (out.length ? sep : 0);
      const rest = names.length - i - 1;
      const tail = rest ? sep + this.width(`+${rest}`, true) : 0;
      if (used + w + tail > width) break;
      out.push(names[i]); used += w;
    }
    if (!out.length) return `${names.length} items`;
    const left = names.length - out.length;
    return out.join(', ') + (left ? `, +${left}` : '');
  }
}

export default function Tree({ root, initial, total }: { root: TNode[]; initial: string | null; total: number }) {
  // index of every node we know about (root + loaded organ subtrees)
  const nodes = useRef(new Map<string, TNode>());
  const parent = useRef(new Map<string, string | null>());
  const index = useCallback((list: TNode[], p: string | null) => {
    for (const n of list) { nodes.current.set(n.id, n); parent.current.set(n.id, p); if (n.children) index(n.children, n.id); }
  }, []);
  useMemo(() => index(root, null), [root, index]);

  const [sys, setSys] = useState<string>(() => { const f = initial?.split('.')[0]; return f && isSys(f) && root.some((r) => r.id === f) ? f : root[0]?.id ?? ''; });
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [sel, setSel] = useState<string | null>(null);
  const [paneIn, setPaneIn] = useState(false);
  const [, setLoadedOrgans] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState<Set<string>>(() => new Set());
  const [showEmpty, setShowEmpty] = useState<Set<string>>(() => new Set());
  const [width, setWidth] = useState(0);
  const [mobile, setMobile] = useState(false);
  const [measurer, setMeasurer] = useState<Measurer | null>(null);
  const [pulse, setPulse] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [hitIdx, setHitIdx] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const compact = width > 0 && width < 520;

  const scroller = useRef<HTMLDivElement>(null);
  const rootEl = useRef<HTMLDivElement>(null);
  const rowEls = useRef(new Map<string, HTMLElement>());
  const branchEls = useRef(new Map<string, HTMLElement>());
  const probe = useRef<HTMLSpanElement>(null);
  const probeSmall = useRef<HTMLSpanElement>(null);
  const inputEl = useRef<HTMLInputElement>(null);
  const tabsEl = useRef<HTMLElement>(null);
  const sysEl = useRef<HTMLDivElement>(null);

  // ---- width + font: the only DOM reads, done once and on resize/font load ----
  useLayoutEffect(() => {
    const el = rootEl.current; if (!el) return;
    const ro = new ResizeObserver(() => { setWidth(el.clientWidth); setMobile(window.innerWidth < 900); });
    ro.observe(el); setWidth(el.clientWidth); setMobile(window.innerWidth < 900);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const read = () => {
      const a = probe.current, b = probeSmall.current; if (!a || !b) return;
      const f = (e: Element) => { const s = getComputedStyle(e); return `${s.fontWeight} ${s.fontSize} ${s.fontFamily}`; };
      setMeasurer(new Measurer(f(a), f(b)));
    };
    read();
    if (document.fonts?.ready) document.fonts.ready.then(read);
  }, []);

  // ---- predicted row heights ----
  const labelWidth = useCallback((depth: number) => { const g = geo(compact); return width - g.side * 2 - indentFor(depth, compact) - CHEV - GAP * 2 - g.count; }, [width, compact]);
  const rowHeight = useCallback((n: TNode, depth: number, isOpen: boolean) => {
    const lines = measurer ? measurer.lines(n.name, labelWidth(depth)) : 1;
    const hasPreview = !isOpen && !!n.children?.length;
    return PAD * 2 + lines * LH + (hasPreview ? PLH : 0);
  }, [measurer, labelWidth]);
  const visibleChildren = useCallback((n: TNode): { shown: TNode[]; hidden: TNode[] } => {
    const kids = n.children ?? [];
    if (n.kind !== 'who' && n.kind !== 'mode') return { shown: kids, hidden: [] };
    const hidden = kids.filter((k) => !k.cases && !k.children?.length);
    const shown = hidden.length ? kids.filter((k) => k.cases || k.children?.length) : kids;
    return showEmpty.has(n.id) ? { shown: kids, hidden: [] } : { shown, hidden };
  }, [showEmpty]);
  const branchHeight = useCallback((n: TNode, depth: number): number => {
    const { shown, hidden } = visibleChildren(n);
    let h = shown.reduce((a, k) => a + rowHeight(k, depth + 1, false), 0);
    if (hidden.length) h += 38;
    return h;
  }, [rowHeight, visibleChildren]);

  // ---- data ----
  const inflight = useRef(new Map<string, Promise<void>>());
  const ensureOrgan = useCallback((id: string) => {
    if (!/^o\d+$/.test(id) || nodes.current.get(id)?.children) return Promise.resolve();
    const cur = inflight.current.get(id); if (cur) return cur;
    setLoading((s) => new Set(s).add(id));
    const p = (async () => {
      try {
        const r = await fetch(`/api/catv2/organ/${id.slice(1)}`); const kids: TNode[] = await r.json();
        const n = nodes.current.get(id); if (n) { n.children = kids; index(kids, id); }
        setLoadedOrgans((s) => new Set(s).add(id));
      } finally { inflight.current.delete(id); setLoading((s) => { const t = new Set(s); t.delete(id); return t; }); }
    })();
    inflight.current.set(id, p); return p;
  }, [index]);

  // ---- open / close / select ----
  const chainOf = useCallback((id: string) => { const c: string[] = []; let x: string | null | undefined = id; while (x) { c.unshift(x); x = parent.current.get(x); } return c; }, []);
  const syncUrl = useCallback((chain: string[]) => {
    const url = chain.length ? `/catv2?n=${encodeURIComponent(chain.join('.'))}` : '/catv2';
    history.replaceState(null, '', url);
  }, []);
  /** Height of the open ancestor rows that sit frozen above this row (sum of their heights = its sticky offset). */
  const stackAbove = useCallback((row: HTMLElement) => {
    let h = 0, li = row.parentElement?.parentElement?.closest<HTMLElement>('li.cv2-item') ?? null;
    while (li) { if (li.classList.contains('open')) h += (li.firstElementChild as HTMLElement).offsetHeight; li = li.parentElement?.closest<HTMLElement>('li.cv2-item') ?? null; }
    return h;
  }, []);
  const rowTop = useCallback((id: string) => {
    const sc = scroller.current, el = rowEls.current.get(id); if (!sc || !el) return null;
    return { sc, top: el.getBoundingClientRect().top - sc.getBoundingClientRect().top, bar: stackAbove(el) + 4 };
  }, [stackAbove]);
  // every open row gets its sticky offset from the measured heights of the open rows above it (bold labels may wrap
  // differently from the Pretext prediction, so measure rather than predict)
  const stuck = useRef(new Set<string>());
  useLayoutEffect(() => {
    for (const id of stuck.current) if (!open.has(id)) { const el = rowEls.current.get(id); if (el) el.style.top = ''; stuck.current.delete(id); }
    for (const id of open) { const el = rowEls.current.get(id); if (el) { el.style.top = `${stackAbove(el)}px`; stuck.current.add(id); } }
  });
  const scrollToRow = useCallback((id: string, force = false) => {
    const r = rowTop(id); if (!r) return;
    if (force || r.top > r.sc.clientHeight * 0.45 || r.top < r.bar) r.sc.scrollTo({ top: r.top + r.sc.scrollTop - r.bar, behavior: 'smooth' });
  }, [rowTop]);
  // Switching organ folds the previous one instantly (no 1,800px height animation to paint) and, in the same commit,
  // shifts the scroller so the tapped row does not move on screen. `fold` tells Collapse to skip its close animation.
  const fold = useRef(false);
  const holdAt = useRef<{ id: string; top: number } | null>(null);
  useLayoutEffect(() => {
    const h = holdAt.current; if (!h) return; holdAt.current = null;
    const r = rowTop(h.id); if (!r) return;
    const want = r.sc.scrollTop + r.top - h.top;
    r.sc.scrollTop = Math.max(0, want);
    if (want >= 0) return;
    // not enough content left above the row to hold it: glide the list up into place instead of snapping
    const el = sysEl.current, r2 = rowTop(h.id); if (!el || !r2) return;
    const dy = h.top - r2.top; if (dy < 2) return;
    el.style.transition = 'none'; el.style.transform = `translateY(${dy}px)`;
    requestAnimationFrame(() => requestAnimationFrame(() => { el.style.transition = `transform .5s ${ease}`; el.style.transform = ''; }));
  });
  useEffect(() => { fold.current = false; });
  /** After opening: scroll only if the row sits so low that none of its children would show. */
  const reveal = useCallback((id: string) => {
    const r = rowTop(id); if (!r) return;
    if (r.top > r.sc.clientHeight * 0.72) r.sc.scrollTo({ top: r.top + r.sc.scrollTop - r.sc.clientHeight * 0.25, behavior: 'smooth' });
  }, [rowTop]);
  const organOf = useCallback((id: string) => chainOf(id).find((x) => nodes.current.get(x)?.kind === 'organ'), [chainOf]);
  /** Hue of the organ an id sits under: its position among the system's organs, cycling through HUES. */
  const hueOf = useCallback((id: string | null | undefined): number | null => {
    const o = id ? organOf(id) : null; if (!o) return null;
    const p = parent.current.get(o); const kids = p ? nodes.current.get(p)?.children : null;
    const i = kids ? kids.findIndex((k) => k.id === o) : -1;
    return i < 0 ? null : HUES[i % HUES.length];
  }, [organOf]);
  const close = useCallback((id: string) => {
    setOpen((s) => { const t = new Set(s); for (const x of s) { if (x === id || chainOf(x).includes(id) && x !== id) t.delete(x); } return t; });
  }, [chainOf]);
  const select = useCallback((id: string, slideIn: boolean) => { setSel(id); syncUrl(chainOf(id)); if (slideIn) setPaneIn(true); }, [chainOf, syncUrl]);
  const toggle = useCallback(async (id: string) => {
    const n = nodes.current.get(id); if (!n) return;
    if (n.leaf) { select(id, mobile); return; }                       // a leaf has no branch: it just becomes the selection
    if (open.has(id)) { close(id); select(id, false); return; }
    if (n.lazy) await ensureOrgan(id);
    if (n.kind === 'organ') {
      // one organ at a time: the previous one folds while this row stays put on screen
      if ([...open].some((x) => { const o = organOf(x); return !!o && o !== id; })) {
        const r = rowTop(id); fold.current = true; holdAt.current = r ? { id, top: r.top } : null;
      }
      setOpen((s) => { const t = new Set<string>(); for (const x of s) { const o = organOf(x); if (!o || o === id) t.add(x); } return t.add(id); });
      select(id, false);
      requestAnimationFrame(() => reveal(id));
      return;
    }
    setOpen((s) => new Set(s).add(id));
    select(id, false);
    requestAnimationFrame(() => reveal(id));
  }, [open, close, ensureOrgan, rowTop, reveal, organOf, select, mobile]);
  const jumpTo = useCallback(async (chain: string[]) => {
    for (const id of chain) {
      const n = nodes.current.get(id); if (!n) break;
      if (isSys(id)) { setSys(id); continue; }
      if (n.lazy) await ensureOrgan(id);
      if (!n.leaf) setOpen((s) => new Set(s).add(id));
      // reveal hidden WHO entities if the target is one of them
      const p = parent.current.get(id); const pn = p ? nodes.current.get(p) : null;
      if (pn && !n.cases && !n.children?.length) setShowEmpty((s) => new Set(s).add(pn.id));
      await new Promise((r) => setTimeout(r, 40));
    }
    const last = chain[chain.length - 1];
    if (nodes.current.has(last)) { setSel(last); syncUrl(chain); }
    setTimeout(() => { scrollToRow(last, true); setPulse(last); setTimeout(() => setPulse(null), 1400); }, 120);
  }, [ensureOrgan, syncUrl, scrollToRow]);
  const pickSys = useCallback((id: string) => {
    if (id === sys) return;
    setSys(id); setOpen(new Set()); select(id, false);
    scroller.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [sys, select]);
  useEffect(() => { tabsEl.current?.querySelector<HTMLElement>('.cv2-tab.on')?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }); }, [sys]);

  // deep link
  useEffect(() => { if (initial) jumpTo(initial.split('.')); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // ---- search ----
  useEffect(() => {
    if (q.trim().length < 2) { setHits(null); return; }
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try { const r = await fetch(`/api/catv2/search?q=${encodeURIComponent(q.trim())}`, { signal: ctl.signal }); setHits(await r.json()); setHitIdx(0); } catch { /* aborted */ }
    }, 140);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q]);
  const pickHit = useCallback((h: Hit) => { setQ(''); setHits(null); setSearchOpen(false); jumpTo(h.chain); }, [jumpTo]);
  useEffect(() => { if (searchOpen) scroller.current?.scrollTo({ top: 0, behavior: 'smooth' }); }, [searchOpen]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement !== inputEl.current) { e.preventDefault(); setSearchOpen(true); setTimeout(() => inputEl.current?.focus(), 0); }
      if (e.key === 'Escape') { if (paneIn) setPaneIn(false); setQ(''); setHits(null); setSearchOpen(false); inputEl.current?.blur(); }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [paneIn]);

  // ---- keyboard ----
  const onTreeKey = useCallback((e: React.KeyboardEvent) => {
    const t = e.target as HTMLElement; if (!t.classList.contains('cv2-row') || e.altKey || e.metaKey || e.ctrlKey) return;
    const rows = rootEl.current ? [...rootEl.current.querySelectorAll<HTMLElement>('.cv2-row')] : [];
    const i = rows.indexOf(t); if (i < 0) return;
    let id: string | null = null; for (const [k, el] of rowEls.current) if (el === t) { id = k; break; }
    const n = id ? nodes.current.get(id) : null;
    const go = (el?: HTMLElement) => {
      const sc = scroller.current; if (!el || !sc) return;
      el.focus({ preventScroll: true });
      const r = el.getBoundingClientRect(), s = sc.getBoundingClientRect(), lid = stackAbove(el) + 4;
      if (r.top < s.top + lid) sc.scrollBy({ top: r.top - s.top - lid });
      else if (r.bottom > s.bottom - 24) sc.scrollBy({ top: r.bottom - s.bottom + 24 });
    };
    switch (e.key) {
      case 'ArrowDown': go(rows[i + 1]); break;
      case 'ArrowUp': go(rows[i - 1]); break;
      case 'Home': go(rows[0]); break;
      case 'End': go(rows[rows.length - 1]); break;
      case 'ArrowRight': if (id && n && !n.leaf && !open.has(id)) toggle(id); else go(rows[i + 1]); break;
      case 'ArrowLeft': {
        if (id && open.has(id)) { close(id); select(id, false); break; }
        const p = id ? parent.current.get(id) : null; const pe = p ? rowEls.current.get(p) : null;
        if (pe) go(pe); break;
      }
      default: return;
    }
    e.preventDefault();
  }, [open, toggle, close, select, stackAbove]);

  // ---- render ----
  const refFns = useRef(new Map<string, (el: HTMLElement | null) => void>());
  const refFor = (map: React.RefObject<Map<string, HTMLElement>>, key: string, id: string) => {
    let f = refFns.current.get(key);
    if (!f) { f = (el) => { if (el) map.current.set(id, el); else map.current.delete(id); }; refFns.current.set(key, f); }
    return f;
  };
  const setRowRef = (id: string) => refFor(rowEls, 'r:' + id, id);
  const setBranchRef = (id: string) => refFor(branchEls, 'b:' + id, id);

  const renderList = (list: TNode[], depth: number, owner: TNode | null): React.ReactNode => {
    const { shown, hidden } = owner ? visibleChildren(owner) : { shown: list, hidden: [] as TNode[] };
    const anyOpen = shown.some((k) => open.has(k.id));
    const g = geo(compact);
    const step = depth > 0 ? indentFor(depth, compact) - indentFor(depth - 1, compact) : 0;
    return (
      <ul className={`cv2-list${anyOpen ? ' has-open' : ''}`} style={{ '--step': `${step}px` } as React.CSSProperties}>
        {shown.map((n, i) => {
          const isOpen = open.has(n.id);
          const busy = loading.has(n.id);
          const preview = !isOpen && n.children?.length && measurer ? measurer.preview(n.id, n.children.map((k) => k.name), labelWidth(depth)) : '';
          // a frozen row must be opaque: these are the band/wash tints of its level flattened onto the page surface
          const tint: Record<string, string> = !isOpen ? {} : depth === 0 ? { '--wash': '16%', '--band': '16%' } : { '--wash': `${Math.round((1 - 0.93 ** depth) * 100)}%`, '--band': `${Math.round((1 - 0.93 ** (depth - 1) * 0.83) * 100)}%` };
          return (
            <li key={n.id} className={`cv2-item${isOpen ? ' open' : ''}${sel === n.id ? ' sel' : ''}${selChain.has(n.id) && sel !== n.id ? ' path' : ''}${pulse === n.id ? ' pulse' : ''} k-${n.kind ?? 'x'}${n.mode ? ' m-' + n.mode : ''}`} style={{ '--i': Math.min(i, 8), '--d': depth, ...tint, ...(n.kind === 'organ' ? { '--hue': hueOf(n.id) ?? HUES[i % HUES.length] } : {}) } as React.CSSProperties}>
              <button ref={setRowRef(n.id)} className="cv2-row" style={{ paddingLeft: g.side }} onClick={() => toggle(n.id)} aria-expanded={n.leaf ? undefined : isOpen} aria-current={sel === n.id ? 'true' : undefined}>
                {n.leaf
                  ? <span className="cv2-chev dot" aria-hidden="true" />
                  : <span className={`cv2-chev${busy ? ' busy' : ''}`} aria-hidden="true"><svg viewBox="0 0 24 24" width="14" height="14"><path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg></span>}
                <span className="cv2-label">
                  <span className="cv2-name">{n.name}{n.note && <span className="cv2-note"> {n.note}</span>}</span>
                  {preview && <span className="cv2-preview">{preview}</span>}
                </span>
                <span className={`cv2-count${n.cases ? '' : ' zero'}`}>{n.cases ? fmt(n.cases) : '·'}</span>
              </button>
              {!n.leaf && (
                <Collapse open={isOpen} instant={fold.current} height={isOpen ? branchHeight(n, depth) : 0} refCb={setBranchRef(n.id)} render={() => renderList(n.children ?? [], depth + 1, n)} />
              )}
            </li>
          );
        })}
        {hidden.length > 0 && owner && (
          <li className="cv2-item k-ghost">
            <button className="cv2-row cv2-ghost" style={{ paddingLeft: g.side }} onClick={() => setShowEmpty((s) => new Set(s).add(owner.id))}>
              <span className="cv2-chev" aria-hidden="true"><svg viewBox="0 0 24 24" width="14" height="14"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg></span>
              <span className="cv2-label"><span className="cv2-name">{hidden.length} more WHO {hidden.length === 1 ? 'entity' : 'entities'} without slides</span></span>
            </button>
          </li>
        )}
      </ul>
    );
  };

  const sysNode = nodes.current.get(sys) ?? null;
  const selChain = useMemo(() => new Set(sel ? chainOf(sel) : []), [sel, chainOf]);
  const paneHue = hueOf(sel);
  const selNode = sel ? nodes.current.get(sel) ?? null : null;
  const selCrumbs = sel ? chainOf(sel).slice(0, -1).map((id) => nodes.current.get(id)?.name ?? '').filter((n, i, a) => n && n !== a[i - 1]) : [];
  return (
    <div className={`cv2-shell${paneIn ? ' pane-in' : ''}`}>
      <div className="cv2-left" ref={scroller}>
        <header className={`cv2-top${searchOpen ? ' searching' : ''}`}>
          <a href="/" className="cv2-wordmark">Pathology Search</a>
          <span className="cv2-total">{fmt(total)} cases</span>
          <div className="cv2-search">
            <button className="cv2-search-btn" onClick={() => { setSearchOpen((s) => !s); setTimeout(() => inputEl.current?.focus(), 0); }} aria-label="Jump to">
              <svg viewBox="0 0 24 24" width="16" height="16"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" /><path d="m20 20-3.2-3.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            </button>
            <input ref={inputEl} className="cv2-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Jump to an entity, organ or pattern…" spellCheck={false}
              onKeyDown={(e) => {
                if (!hits?.length) return;
                if (e.key === 'ArrowDown') { e.preventDefault(); setHitIdx((i) => Math.min(hits.length - 1, i + 1)); }
                if (e.key === 'ArrowUp') { e.preventDefault(); setHitIdx((i) => Math.max(0, i - 1)); }
                if (e.key === 'Enter') { e.preventDefault(); pickHit(hits[hitIdx]); }
              }} />
            {hits && (
              <ul className="cv2-hits">
                {hits.length === 0 && <li className="cv2-hit empty">Nothing matches “{q}”</li>}
                {hits.map((h, i) => (
                  <li key={h.id + i} className={`cv2-hit${i === hitIdx ? ' active' : ''}`} onMouseDown={(e) => { e.preventDefault(); pickHit(h); }} onMouseEnter={() => setHitIdx(i)}>
                    <span className="cv2-hit-name">{h.name}</span>
                    <span className="cv2-hit-crumbs">{h.crumbs.join(' › ')}</span>
                    <span className="cv2-hit-count">{h.cases ? fmt(h.cases) : '·'}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </header>
        <nav className="cv2-tabs" ref={tabsEl} aria-label="Organ systems">
          {root.map((s) => (
            <button key={s.id} className={`cv2-tab${s.id === sys ? ' on' : ''}`} onClick={() => pickSys(s.id)} aria-pressed={s.id === sys}>
              <span className="cv2-tab-name">{s.name}</span><span className="cv2-tab-n">{fmt(s.cases)}</span>
            </button>
          ))}
        </nav>
        <div className="cv2-tree" ref={rootEl} data-ready={ready || undefined} onKeyDown={onTreeKey}>
          <span className="cv2-probe cv2-name" ref={probe} aria-hidden="true">x</span>
          <span className="cv2-probe cv2-preview" ref={probeSmall} aria-hidden="true">x</span>
          <div key={sys} className="cv2-sys" ref={sysEl}>{sysNode ? renderList(sysNode.children ?? [], 0, sysNode) : null}</div>
        </div>
      </div>
      <CasePane node={selNode} crumbs={selCrumbs} hue={paneHue} onBack={() => setPaneIn(false)} />
      {selNode && selNode.cases > 0 && (
        <button className="cv2-selbar" onClick={() => setPaneIn(true)} aria-label={`Show ${fmt(selNode.cases)} cases of ${selNode.name}`}>
          <span className="cv2-selbar-name">{selNode.name}</span>
          <span className="cv2-selbar-n">{fmt(selNode.cases)} {selNode.cases === 1 ? 'case' : 'cases'} ›</span>
        </button>
      )}
    </div>
  );
}

/** Right pane: the cases of the selected category, paged. Results are cached per node for the session. */
function CasePane({ node, crumbs, hue, onBack }: { node: TNode | null; crumbs: string[]; hue: number | null; onBack: () => void }) {
  const cache = useRef(new Map<string, CaseData>());
  const [data, setData] = useState<CaseData | null>(null);
  const [busy, setBusy] = useState(false);
  const pane = useRef<HTMLDivElement>(null);
  const id = node?.id ?? null;
  const load = useCallback(async (nid: string, page: number) => {
    setBusy(true);
    try {
      const r = await fetch(`/api/catv2/cases?id=${encodeURIComponent(nid)}&page=${page}`); if (!r.ok) throw new Error(String(r.status));
      const d: CaseData = await r.json();
      const prev = page > 1 ? cache.current.get(nid) : null;
      const next = { cases: prev ? [...prev.cases, ...d.cases] : d.cases, total: d.total };
      cache.current.set(nid, next);
      return next;
    } finally { setBusy(false); }
  }, []);
  useEffect(() => {
    let live = true;
    if (!id) { setData(null); return; }
    const c = cache.current.get(id);
    if (c) { setData(c); } else { setData(null); load(id, 1).then((d) => { if (live) setData(d); }).catch(() => { if (live) setData({ cases: [], total: 0 }); }); }
    pane.current?.scrollTo({ top: 0 });
    return () => { live = false; };
  }, [id, load]);
  const more = () => { if (id && data && !busy) load(id, Math.floor(data.cases.length / PAGE) + 1).then(setData); };
  return (
    <section className={`cv2-right${hue !== null ? ' hued' : ''}`} ref={pane} aria-live="polite" style={hue !== null ? ({ '--hue': hue } as React.CSSProperties) : undefined}>
      {!node && (
        <div className="cv2-empty">
          <p className="cv2-empty-t">Pick a category</p>
          <p>Open an organ on the left; the cases of whatever you select are listed here.</p>
        </div>
      )}
      {node && (
        <>
          <header className="cv2-pane-head">
            <button className="cv2-back" onClick={onBack} aria-label="Back to the tree"><svg viewBox="0 0 24 24" width="18" height="18"><path d="m15 6-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
            <div className="cv2-pane-text">
              {crumbs.length > 0 && <div className="cv2-pane-crumbs">{crumbs.join(' › ')}</div>}
              <h2 className="cv2-pane-name">{node.name}{node.note && <span className="cv2-note"> {node.note}</span>}</h2>
              <div className="cv2-pane-n">{data ? `${fmt(data.total)} ${data.total === 1 ? 'case' : 'cases'}` : node.cases ? `${fmt(node.cases)} cases` : 'No slides filed here'}</div>
            </div>
          </header>
          {!data && node.cases > 0 && <div className="cv2-skel" />}
          {data && (
            <div className="cv2-cases">
              {data.cases.map((c, i) => <CaseRow key={c.id} c={c} i={i} />)}
              {data.cases.length < data.total && (
                <button className="cv2-more" onClick={more} disabled={busy}>
                  {busy ? 'Loading…' : `Show ${Math.min(PAGE, data.total - data.cases.length)} more of ${fmt(data.total)}`}
                </button>
              )}
              {data.total === 0 && node.cases > 0 && <p className="cv2-empty">Nothing came back for this category.</p>}
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** Height-animated container. `height` is the Pretext prediction for the content about to mount.
 *  Height is owned imperatively (never via the style prop) so React re-renders cannot reset it mid-animation. */
function Collapse({ open, instant, height, render, refCb }: { open: boolean; instant?: boolean; height: number; render: () => React.ReactNode; refCb: (el: HTMLElement | null) => void }) {
  const el = useRef<HTMLDivElement | null>(null);
  const [phase, setPhase] = useState<'closed' | 'opening' | 'open' | 'closing'>(open ? 'opening' : 'closed');
  const timer = useRef(0);
  const reduce = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const finish = useCallback((p: 'open' | 'closed') => {
    const d = el.current; if (!d) return;
    window.clearTimeout(timer.current);
    d.style.height = p === 'open' ? 'auto' : '0px';
    setPhase(p);
  }, []);
  // open/close requests
  useLayoutEffect(() => {
    const d = el.current; if (!d) return;
    if (open && (phase === 'closed' || phase === 'closing')) {
      d.style.height = `${d.offsetHeight}px`; // from wherever we are (0 when closed)
      setPhase('opening');
    } else if (!open && (phase === 'open' || phase === 'opening')) {
      if (instant) { finish('closed'); return; }
      d.style.height = `${d.scrollHeight}px`; // one read: nested branches may be open
      setPhase('closing');
      requestAnimationFrame(() => { if (el.current) el.current.style.height = '0px'; });
      timer.current = window.setTimeout(() => finish('closed'), 420);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  // children are in the DOM once phase is 'opening': animate to the predicted height
  useLayoutEffect(() => {
    const d = el.current; if (!d || phase !== 'opening') return;
    if (reduce) { finish('open'); return; }
    if (!d.style.height || d.style.height === 'auto') d.style.height = '0px';
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => { if (el.current) el.current.style.height = `${Math.max(1, height)}px`; }));
    timer.current = window.setTimeout(() => finish('open'), 420);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const onEnd = (e: React.TransitionEvent) => {
    if (e.target !== el.current || e.propertyName !== 'height') return;
    if (phase === 'opening') finish('open'); else if (phase === 'closing') finish('closed');
  };
  return (
    <div ref={(n) => { el.current = n; refCb(n); }} className={`cv2-branch ${phase}`} onTransitionEnd={onEnd}
      style={{ transition: reduce ? 'none' : `height .34s ${ease}` }}>
      {phase !== 'closed' && render()}
    </div>
  );
}

function CaseRow({ c, i }: { c: TCase; i: number }) {
  const meta = [c.source, [c.age, c.sex].filter(Boolean).join(' '), c.site].filter((x) => x && String(x).trim()).join(' · ');
  const stain = c.n_he ? 'H&E' : (c.stains?.split(/[;,|]/)[0]?.trim().slice(0, 12) || '');
  return (
    <div className="cv2-case" style={{ '--i': Math.min(i, 8) } as React.CSSProperties}>
      <div className="cv2-case-main" onClick={(e) => { if ((e.target as HTMLElement).closest('a')) return; window.open(c.url, '_blank', 'noopener,noreferrer'); }}>
        <span className="cv2-case-text">
          <a className="cv2-case-title" href={c.url} target="_blank" rel="noopener noreferrer">{c.title}{c.qualifiers && <span className="cv2-qual"> {c.qualifiers}</span>}</a>
          <span className="cv2-case-meta">{meta}</span>
          {c.slides && c.slides.length > 1 && (
            <span className="cv2-chips">
              {c.slides.slice(0, 8).map((s, j) => <a key={j} className={`cv2-chip${s.he ? ' he' : ''}`} href={s.url} target="_blank" rel="noopener noreferrer">{s.stain || s.label || `Slide ${j + 1}`}</a>)}
              {c.slides.length > 8 && <span className="cv2-chip muted">+{c.slides.length - 8}</span>}
            </span>
          )}
        </span>
        <span className="cv2-case-right">
          <span className="cv2-case-n">{c.n_slides > 1 ? `${c.n_slides} slides` : stain}</span>
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
      </div>
    </div>
  );
}
