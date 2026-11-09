'use client';
// /catv4 — the catalogue as a classic outline with guide lines. Every nesting level draws a vertical rail with a tick
// into each row, so siblings read as one bracket and depth is counted by rails, not by guesswork about indentation.
// The rails along the path to the selected row are painted in the organ's colour; the rest stay faint.
// Every open heading sticks to the top of the pane while you are inside it, one line per level, so the stack of
// frozen rows is always the branch you are in — and because a parent's rail keeps running past the open child,
// the sibling branches one step up stay visible around it. Rows are one line each, so the stack has a fixed rhythm.
// Terminal leaves open their slides in place; any other row lists its cases in the right pane (over the tree on a phone).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { TNode, TCase } from '@/lib/catv2';

const fmt = (n: number) => n.toLocaleString('en-GB');
const PAGE = 60;
const SLIDE_ROW = 29, SLIDE_ROWS = 10; // keep in sync with catv2.css (.cv2-slide 26px + 3px gap)
const isSys = (id: string) => /^s\d+$/.test(id);
type Hit = { id: string; name: string; cases: number; chain: string[]; crumbs: string[] };
interface CaseData { cases: TCase[]; total: number }
const slideCache = new Map<string, CaseData>();
function indexInto(nodes: Map<string, TNode>, parent: Map<string, string | null>, list: TNode[], p: string | null) {
  for (const n of list) { nodes.set(n.id, n); parent.set(n.id, p); if (n.children) indexInto(nodes, parent, n.children, n.id); }
}

export default function Tree4({ root, initial, total }: { root: TNode[]; initial: string | null; total: number }) {
  const [sys, setSys] = useState<string>(() => (initial?.split('.')[0] && root.some((s) => s.id === initial.split('.')[0]) ? initial.split('.')[0] : root[0]?.id) ?? '');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState<string | null>(null);
  const [leaf, setLeaf] = useState<string | null>(null);
  const [showEmpty, setShowEmpty] = useState<Set<string>>(new Set());
  const [, bump] = useState(0);
  // node and parent lookups live in state-held maps (mutated in place, never replaced) so render may read them
  const [nodes] = useState(() => new Map<string, TNode>());
  const [parent] = useState(() => new Map<string, string | null>());
  const index = useCallback((list: TNode[], p: string | null) => indexInto(nodes, parent, list, p), [nodes, parent]);
  useMemo(() => index(root, null), [root, index]);
  const chainOf = useCallback((id: string) => { const out: string[] = []; let c: string | null | undefined = id; while (c) { out.unshift(c); c = parent.get(c); } return out; }, [parent]);
  const organOf = useCallback((id: string) => chainOf(id).find((x) => nodes.get(x)?.kind === 'organ'), [chainOf, nodes]);

  // ---- data ----
  const inflight = useRef(new Map<string, Promise<void>>());
  const ensureOrgan = useCallback((id: string) => {
    const n = nodes.get(id); if (!n || !n.lazy || n.children) return Promise.resolve();
    let p = inflight.current.get(id);
    if (!p) {
      p = (async () => {
        const r = await fetch(`/api/catv2/organ/${id.slice(1)}`); const kids: TNode[] = await r.json();
        n.children = kids; n.lazy = false; index(kids, id); bump((x) => x + 1);
      })().finally(() => inflight.current.delete(id));
      inflight.current.set(id, p);
    }
    return p;
  }, [index, nodes]);

  // ---- url ----
  const syncUrl = useCallback((chain: string[]) => { const u = new URL(window.location.href); u.searchParams.set('n', chain.join('.')); window.history.replaceState(null, '', u); }, []);
  const select = useCallback((id: string) => { setSel(id); syncUrl(chainOf(id)); }, [chainOf, syncUrl]);
  const close = useCallback((id: string) => setOpen((s) => { const t = new Set(s); for (const x of s) if (x === id || chainOf(x).includes(id)) t.delete(x); return t; }), [chainOf]);
  const scrollToRow = useCallback((id: string) => {
    const el = document.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"] > .t4-row`); if (!el) return;
    const depth = Number(el.style.getPropertyValue('--d') || 0);
    el.style.scrollMarginTop = `${depth * 36 + 8}px`; el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, []);
  const toggle = useCallback(async (id: string) => {
    const n = nodes.get(id); if (!n) return;
    if (n.leaf) { setLeaf(sel === id && leaf === id ? null : id); select(id); return; }
    if (open.has(id)) { close(id); select(id); return; }
    if (n.lazy) await ensureOrgan(id);
    // one organ open at a time: the tree stays short enough to see where you are
    if (n.kind === 'organ' && !chainOf(id).slice(0, -1).some((x) => nodes.get(x)?.kind === 'organ'))
      setOpen((s) => { const t = new Set<string>(); for (const x of s) { const o = organOf(x); if (!o || o === id) t.add(x); } return t.add(id); });
    else setOpen((s) => new Set(s).add(id));
    select(id);
  }, [open, close, ensureOrgan, organOf, select, sel, leaf, chainOf, nodes]);
  const jumpTo = useCallback(async (chain: string[]) => {
    for (const id of chain) {
      const n = nodes.get(id); if (!n) break;
      if (isSys(id)) { setSys(id); continue; }
      if (n.lazy) await ensureOrgan(id);
      if (!n.leaf) setOpen((s) => new Set(s).add(id));
      const p = parent.get(id); const pn = p ? nodes.get(p) : null;
      if (pn && !n.cases && !n.children?.length) setShowEmpty((s) => new Set(s).add(pn.id));
    }
    const last = chain[chain.length - 1];
    if (nodes.has(last)) { setSel(last); if (nodes.get(last)?.leaf) setLeaf(last); syncUrl(chain); }
    setTimeout(() => scrollToRow(last), 80);
  }, [ensureOrgan, syncUrl, scrollToRow, nodes, parent]);
  const booted = useRef(false);
  useEffect(() => { if (booted.current) return; booted.current = true; if (initial) { const t = setTimeout(() => jumpTo(initial.split('.')), 0); return () => clearTimeout(t); } }, [initial, jumpTo]);

  // ---- search ----
  const [q, setQ] = useState(''); const [hits, setHits] = useState<Hit[] | null>(null); const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const ctl = new AbortController(); const t = setTimeout(async () => {
      if (q.trim().length < 2) { setHits(null); return; }
      try { const r = await fetch(`/api/catv2/search?q=${encodeURIComponent(q.trim())}`, { signal: ctl.signal }); setHits(await r.json()); setActive(0); } catch { /* typed on */ }
    }, 160);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q]);
  const go = (h: Hit) => { setQ(''); setHits(null); jumpTo(h.chain); };

  // ---- derived ----
  const selChain = useMemo(() => new Set(sel ? chainOf(sel) : []), [sel, chainOf]);
  const system = root.find((s) => s.id === sys);
  // a system with a single organ (Skin, Breast, Eye …) would repeat the pill as its only row: skip that row and show the organ's groups directly
  const solo = system?.children?.length === 1 ? system.children[0] : null;
  useEffect(() => {
    if (!solo) return;
    const id = solo.id;
    ensureOrgan(id).then(() => setOpen((s) => (s.has(id) ? s : new Set(s).add(id))));
  }, [solo, ensureOrgan]);

  const renderList = (list: TNode[], depth: number, owner: TNode | null): React.ReactNode => {
    const hideable = owner && (owner.kind === 'who' || owner.kind === 'mode');
    const hidden = hideable && !showEmpty.has(owner.id) ? list.filter((k) => !k.cases && !k.children?.length) : [];
    const shown = hidden.length ? list.filter((k) => k.cases || k.children?.length) : list;
    return (
      <ul className="t4-list">
        {shown.map((n, i) => {
          const isOpen = open.has(n.id); const last = i === shown.length - 1 && !hidden.length;
          return (
            <li key={n.id} data-id={n.id} className={`t4-item${isOpen ? ' open' : ''}${sel === n.id ? ' sel' : ''}${selChain.has(n.id) && sel !== n.id ? ' path' : ''}${last ? ' last' : ''}${n.leaf ? ' leaf' : ''} k-${n.kind ?? 'x'}${n.mode ? ' m-' + n.mode : ''}`} style={{ '--d': depth } as React.CSSProperties}>
              <div className="t4-row" role="button" tabIndex={0} style={{ '--d': depth } as React.CSSProperties}
                onClick={() => toggle(n.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(n.id); } }}>
                <span className={`t4-chev${n.leaf ? ' dot' : ''}`}>{!n.leaf && <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>}</span>
                <span className="t4-name" title={n.name}>{n.name}{n.note && <span className="t4-note"> {n.note}</span>}</span>
                {!n.leaf && !isOpen && n.children && <span className="t4-kids">{n.children.length}</span>}
                <span className={`t4-count${n.cases ? '' : ' zero'}`}>{n.cases ? fmt(n.cases) : '·'}</span>
              </div>
              {n.leaf && sel === n.id && leaf === n.id && <div className="t4-branch"><LeafSlides id={n.id} name={n.name} count={n.cases} /></div>}
              {!n.leaf && isOpen && (n.children ? <div className="t4-branch">{renderList(n.children, depth + 1, n)}</div> : <div className="t4-branch t4-loading">Loading…</div>)}
            </li>
          );
        })}
        {hidden.length > 0 && (
          <li className="t4-item last t4-ghost" style={{ '--d': depth } as React.CSSProperties}>
            <div className="t4-row" role="button" tabIndex={0} onClick={() => setShowEmpty((s) => new Set(s).add(owner!.id))}>
              <span className="t4-chev">+</span><span className="t4-name">{hidden.length} WHO {hidden.length === 1 ? 'heading' : 'headings'} without slides</span>
            </div>
          </li>
        )}
      </ul>
    );
  };

  return (
    <div className="cv2-shell t4-shell">
      <section className="cv2-left">
        <div className={`cv2-top${q || hits ? ' searching' : ''}`}>
          <Link className="cv2-wordmark" href="/">pathologysearch</Link>
          <span className="cv2-total">{fmt(total)} cases</span>
          <div className="cv2-search">
            <button className="cv2-search-btn" onClick={() => inputRef.current?.focus()} aria-label="Search the tree"><svg viewBox="0 0 24 24" width="18" height="18"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" /><path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg></button>
            <input ref={inputRef} className="cv2-input" value={q} placeholder="Jump to an organ, heading or pattern" onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (!hits?.length) return; if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, hits.length - 1)); } else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); } else if (e.key === 'Enter') go(hits[active]); else if (e.key === 'Escape') { setQ(''); setHits(null); } }} />
            {hits && (
              <ul className="cv2-hits">
                {hits.length === 0 && <li className="cv2-hit empty">Nothing matches</li>}
                {hits.map((h, i) => (
                  <li key={h.id + i} className={`cv2-hit${i === active ? ' active' : ''}`} onMouseDown={() => go(h)}>
                    <span className="cv2-hit-name">{h.name}</span><span className="cv2-hit-crumbs">{h.crumbs.join(' › ')}</span><span className="cv2-hit-count">{h.cases ? fmt(h.cases) : ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <nav className="cv2-tabs" aria-label="Systems">
          {root.map((s) => <button key={s.id} className={`cv2-tab${s.id === sys ? ' on' : ''}`} onClick={() => setSys(s.id)}>{s.name}<span className="cv2-tab-n">{fmt(s.cases)}</span></button>)}
        </nav>
        <div className="t4-tree" key={sys}>
          {solo ? (solo.children ? renderList(solo.children, 0, solo) : <div className="t4-loading">Loading…</div>) : system?.children && renderList(system.children, 0, null)}
        </div>
      </section>
    </div>
  );
}

function LeafSlides({ id, name, count }: { id: string; name: string; count: number }) {
  const [data, setData] = useState<CaseData | null>(() => slideCache.get(id) ?? null);
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);
  const load = useCallback(async (page: number) => {
    if (busy.current) return; busy.current = true;
    try {
      const r = await fetch(`/api/catv2/cases?id=${encodeURIComponent(id)}&page=${page}`); if (!r.ok) throw new Error(String(r.status));
      const d: CaseData = await r.json();
      const prev = page > 1 ? slideCache.get(id) : null;
      const next = { cases: prev ? [...prev.cases, ...d.cases] : d.cases, total: d.total };
      slideCache.set(id, next); setData(next);
    } catch { setFailed(true); } finally { busy.current = false; }
  }, [id]);
  useEffect(() => { if (count > 0 && !slideCache.has(id)) load(1); }, [id, count, load]);
  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (data && data.cases.length < data.total && el.scrollTop + el.clientHeight > el.scrollHeight - SLIDE_ROW * 3) load(Math.floor(data.cases.length / PAGE) + 1);
  };
  return (
    <div className="cv2-slides">
      {count > SLIDE_ROWS && <div className="cv2-slides-n">{fmt(count)} cases</div>}
      <div className="cv2-slides-list" style={{ height: Math.min(Math.max(count, 1), SLIDE_ROWS) * SLIDE_ROW - 3 }} onScroll={onScroll}>
        {count === 0 && <span className="cv2-slide-note">No slides filed here</span>}
        {failed && !data && <span className="cv2-slide-note">Couldn’t load these slides</span>}
        {data?.cases.map((c) => (
          <a key={c.id} className="cv2-slide" href={c.url} target="_blank" rel="noopener noreferrer">
            {c.title.trim().toLowerCase() !== name.trim().toLowerCase()
              ? <span className="cv2-slide-title">{c.title}{c.qualifiers && <span className="cv2-qual"> {c.qualifiers}</span>}</span>
              : c.qualifiers && <span className="cv2-slide-title">{c.qualifiers}</span>}
            <span className="cv2-slide-meta">{[c.source, [c.age, c.sex].filter(Boolean).join(' '), c.site].filter((x) => x && String(x).trim()).join(' · ')}</span>
            {c.n_slides > 1 && <span className="cv2-slide-n">×{c.n_slides}</span>}
          </a>
        ))}
      </div>
    </div>
  );
}
