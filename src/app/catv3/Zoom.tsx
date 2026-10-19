'use client';
// /catv3 — a zoomable tree of one organ. The tree is laid out once in world space (Pretext measures the text) as an
// indented outline: each level is drawn smaller than its parent, so deeper headings are only legible once you zoom in.
// The whole world is one transformed layer: wheel / pinch zooms, drag pans, a tap on a name flies to it and lists its
// cases in the side panel. Nothing collapses: below legibility a level shows as greek bars, the texture of a subtree.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { prepare, layout, measureNaturalWidth, type PreparedText } from '@chenglou/pretext';
import type { ZCase, ZNode } from '@/lib/catv3';

// ---- geometry (local units = CSS px at the node's own scale, 16px font) ----
const FONT = 16, LH = 20, MAXW = 300, PAD_X = 10, GAP_X = 22, GAP_Y = 6, HEAD = 6, FOOT = 8, IND = 18;
const GREEK_PX = 1.6;                            // on-screen font px at which greek bars appear
const textPx = () => (typeof window !== 'undefined' && window.innerWidth < 640 ? 9 : 7); // …and at which text appears
const MAX_DEPTH = 10, ZMAX = 48;
const LANDMARK_PX = [14, 13, 11];                // organ / mode / chapter labels never render smaller than this
const scaleAt = (d: number) => (d === 0 ? 2.4 : d === 1 ? 1.5 : Math.pow(0.72, d - 2));
const fmt = (n: number) => n.toLocaleString('en-GB');

interface L { uid: number; n: ZNode; d: number; s: number; mode?: string; lw: number; lh: number; w: number; h: number; x: number; y: number; wx: number; wy: number; parent: L | null; kids: L[]; i: number }
interface View { x: number; y: number; z: number }

class Measurer {
  private cache = new Map<string, PreparedText>();
  constructor(public font: string, public bold: string, public small: string) {}
  private prep(t: string, f: string) { const k = f + '|' + t; let p = this.cache.get(k); if (!p) { p = prepare(t, f); this.cache.set(k, p); } return p; }
  width(t: string, b = false) { return measureNaturalWidth(this.prep(t, b ? this.bold : this.font)); }
  widthSmall(t: string) { return measureNaturalWidth(this.prep(t, this.small)); }
  lines(t: string, w: number, b = false) { return layout(this.prep(t, b ? this.bold : this.font), w, LH).lineCount; }
}

/** Recursive layout. Organ and mode children are packed into columns (so the overview uses the width of the screen);
 *  from the chapter level down, children stack below their parent with an indent, like a printed table of contents. */
function build(n: ZNode, d: number, parent: L | null, m: Measurer, i: number, aspect: number, cols: boolean): L {
  const maxw = d <= 2 ? Infinity : MAXW;
  const text = n.note ? `${n.name} ${n.note}` : n.name;
  const bold = d <= 2;
  const natural = m.width(text, bold);
  const lines = natural <= maxw ? 1 : m.lines(text, maxw, bold);
  const cnt = n.cases ? m.widthSmall(fmt(n.cases)) + 8 : 0;
  const lw = Math.min(natural, maxw) + cnt, lh = lines * LH;
  const l: L = { uid: 0, n, d, s: scaleAt(d), mode: n.mode ?? parent?.mode, lw, lh, w: lw, h: lh, x: 0, y: 0, wx: 0, wy: 0, parent, kids: [], i };
  const kids = n.children ?? [];
  if (kids.length && d < MAX_DEPTH) {
    const r = scaleAt(d + 1) / scaleAt(d);
    const ks = kids.map((k, j) => build(k, d + 1, l, m, j, aspect, cols));
    l.kids = ks;
    if (d < 2 && cols) {
      const area = ks.reduce((a, k) => a + k.w * r * k.h * r, 0);
      const H = Math.max(Math.sqrt(area / aspect), 200);
      let x = PAD_X, y = lh + HEAD, colW = 0, maxY = 0;
      const y0 = y;
      for (const k of ks) {
        const w = k.w * r, h = k.h * r;
        if (y > y0 && y + h > y0 + H) { x += colW + GAP_X * r; y = y0; colW = 0; }
        k.x = x; k.y = y; y += h + GAP_Y * 2 * r; colW = Math.max(colW, w); maxY = Math.max(maxY, k.y + h);
      }
      l.w = Math.max(lw, x + colW + PAD_X); l.h = maxY + FOOT;
    } else {
      let y = lh + HEAD, maxX = 0;
      for (const k of ks) { k.x = IND; k.y = y; y += k.h * r + GAP_Y * r; maxX = Math.max(maxX, IND + k.w * r); }
      l.w = Math.max(lw, maxX); l.h = y - GAP_Y * r + FOOT;
    }
  }
  return l;
}
function place(l: L, wx: number, wy: number, out: L[]) { l.wx = wx; l.wy = wy; l.uid = out.length; out.push(l); for (const k of l.kids) place(k, wx + k.x * l.s, wy + k.y * l.s, out); }

// visibility by depth is pure CSS: the world element carries data-t (deepest legible level) and data-g (deepest greeked level)
const VIS_CSS = (() => {
  let css = '', hide = '';
  for (let N = 0; N <= MAX_DEPTH; N++) {
    const t = Array.from({ length: N + 1 }, (_, k) => `.zw[data-t="${N}"] .d${k} > .lbl`).join(',');
    const g = Array.from({ length: N + 1 }, (_, k) => `.zw[data-g="${N}"] .d${k} > .gk,.zw[data-g="${N}"] .d${k} > .rail`).join(',');
    const hg = Array.from({ length: N + 1 }, (_, k) => `.zw[data-t="${N}"] .d${k} > .gk`).join(',');
    css += `${t}{opacity:1;visibility:visible}${g}{opacity:1;visibility:visible}`;
    hide += `${hg}{opacity:0;visibility:hidden}`;
  }
  return css + hide;
})();

// every case under a node, in tree order (memoised per node)
const allCases = (() => { const memo = new WeakMap<ZNode, ZCase[]>(); const f = (n: ZNode): ZCase[] => { let v = memo.get(n); if (!v) { v = [...(n.items ?? []), ...(n.children ?? []).flatMap(f)]; memo.set(n, v); } return v; }; return f; })();
const PREVIEW = 6;

function CaseList({ l, onPick }: { l: L; onPick: (l: L) => void }) {
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  useEffect(() => setOpen(new Set()), [l]);
  const row = (c: ZCase) => (
    <a key={c.id} className="cv3-case" href={c.url} target="_blank" rel="noopener noreferrer">
      <span className="cv3-case-t">{c.title}</span>{c.note && <span className="cv3-case-n">{c.note}</span>}
    </a>
  );
  const groups = l.kids.filter((k) => k.n.cases > 0);
  return (
    <div className="cv3-side-body">
      <div className="cv3-side-head">
        <div className="cv3-side-name">{l.n.name}{l.n.note && <span className="cv3-side-note"> {l.n.note}</span>}</div>
        <div className="cv3-side-cnt">{fmt(l.n.cases)} {l.n.cases === 1 ? 'case' : 'cases'}{groups.length ? ` in ${groups.length} ${groups.length === 1 ? 'group' : 'groups'}` : ''}</div>
      </div>
      {l.n.items?.map(row)}
      {groups.map((k) => {
        const cs = allCases(k.n), more = cs.length - PREVIEW, isOpen = open.has(k.uid);
        return (
          <section key={k.uid} className="cv3-group">
            <button className="cv3-group-h" onClick={() => onPick(k)}><span className="cv3-group-t">{k.n.name}</span><span className="cv3-group-c">{fmt(k.n.cases)}</span></button>
            {(isOpen ? cs : cs.slice(0, PREVIEW)).map(row)}
            {more > 0 && !isOpen && <button className="cv3-more" onClick={() => setOpen((s) => new Set(s).add(k.uid))}>{fmt(more)} more</button>}
          </section>
        );
      })}
    </div>
  );
}

export default function Zoom({ root }: { root: ZNode }) {
  const stage = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLSpanElement>(null);
  const probeSmall = useRef<HTMLSpanElement>(null);
  const [nodes, setNodes] = useState<L[] | null>(null);
  const [path, setPath] = useState<L[]>([]);
  const [sel, setSelState] = useState<L | null>(null);
  const selRef = useRef<L | null>(null);
  const setSel = useCallback((l: L | null) => { if (selRef.current !== l) { selRef.current = l; setSelState(l); } }, []);
  const [zoomPct, setZoomPct] = useState(100);
  const view = useRef<View>({ x: 0, y: 0, z: 1 });
  const anim = useRef(0);
  const byId = useMemo(() => new Map<string, L>(), []);
  const landmarks = useRef<{ l: L; el: HTMLElement; shown: boolean | null }[]>([]);
  const settle = useRef(0);
  const box = () => { const r = stage.current?.getBoundingClientRect(); return { vw: r?.width ?? window.innerWidth, vh: r?.height ?? window.innerHeight }; };

  // ---- layout once the font is known ----
  useEffect(() => {
    const run = () => {
      const a = probe.current, b = probeSmall.current; if (!a || !b) return;
      const f = (e: Element) => { const s = getComputedStyle(e); return `${s.fontWeight} ${s.fontSize} ${s.fontFamily}`; };
      const m = new Measurer(f(a), f(a).replace(/^\d+/, '700'), f(b));
      const { vw, vh } = box();
      const aspect = Math.min(2.6, Math.max(0.6, (vw / vh) * 1.3));
      const tree = build(root, 0, null, m, 0, aspect, vw >= 640); // a phone gets one tall outline to pan down
      const out: L[] = []; place(tree, 0, 0, out);
      byId.clear(); for (const l of out) byId.set(String(l.uid), l);
      setNodes(out);
    };
    if (document.fonts?.ready) document.fonts.ready.then(run); else run();
  }, [root, byId]);

  useEffect(() => {
    if (!nodes || !world.current) return;
    const list = nodes.filter((l) => l.d <= 2).sort((a, b) => a.d - b.d || b.n.cases - a.n.cases);
    landmarks.current = list.map((l) => ({ l, el: world.current!.querySelector(`.zn[data-id="${l.uid}"] > .lbl`) as HTMLElement, shown: null })).filter((x) => x.el);
  }, [nodes]);

  // ---- view ----
  const apply = useCallback(() => {
    const w = world.current; if (!w) return;
    const { x, y, z } = view.current;
    w.style.transform = `translate(${x}px, ${y}px) scale(${z})`;
    w.style.setProperty('--z', String(z));
    // landmarks: bigger levels are placed first; a label that would overlap one already placed slides down inside its own
    // block until it finds room, and is hidden only when there is none
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    for (const lm of landmarks.current) {
      const { l, el } = lm;
      const k = Math.max(1, LANDMARK_PX[l.d] / (FONT * l.s * z));
      const r = { x: l.wx * z + x, y: l.wy * z + y, w: l.lw * l.s * z * k, h: l.lh * l.s * z * k };
      const y0 = r.y, bottom = (l.wy + l.h * l.s) * z + y;
      let ok = false;
      const roomy = l.d === 0 || r.w <= l.w * l.s * z * 1.5 + 24;
      for (let tries = 0; roomy && tries < 4; tries++) {
        const hits = placed.filter((p) => r.x < p.x + p.w && r.x + r.w > p.x && r.y < p.y + p.h && r.y + r.h > p.y);
        if (!hits.length) { ok = true; break; }
        r.y = Math.max(...hits.map((p) => p.y + p.h)) + 2;
        if (r.y + r.h > bottom) break;
      }
      if (ok) placed.push(r);
      const dy = ok ? (r.y - y0) / (l.s * z) : 0;
      const tf = `translate(0, ${dy.toFixed(2)}px) scale(${k.toFixed(4)})`;
      if (el.style.transform !== tf) el.style.transform = tf;
      if (lm.shown !== ok) { lm.shown = ok; el.style.visibility = ok ? 'visible' : 'hidden'; el.style.opacity = ok ? '1' : '0'; }
    }
    // while a gesture is running the world is a fixed raster; once it settles, drop will-change so Chrome re-rasterises crisp text
    const st = stage.current;
    if (st) { st.classList.add('zooming'); window.clearTimeout(settle.current); settle.current = window.setTimeout(() => st.classList.remove('zooming'), 160); }
    let t = -1, g = -1;
    const TP = textPx();
    for (let d = 0; d <= MAX_DEPTH; d++) { const px = FONT * scaleAt(d) * z; if (px >= TP) t = d; if (px >= GREEK_PX) g = d; }
    if (w.dataset.t !== String(t)) w.dataset.t = String(t);
    if (w.dataset.g !== String(g)) w.dataset.g = String(g);
  }, []);
  const rootL = nodes?.[0];
  const fitView = useCallback((l: L, padTop = 64): View => {
    const { vw, vh } = box(); const pad = 24;
    const bw = l.w * l.s, bh = l.h * l.s;
    if (!l.kids.length) { // a single heading: make it comfortably readable, centred
      const z = Math.min(ZMAX, Math.max(view.current.z, 18 / (FONT * l.s)));
      return { z, x: vw / 2 - (l.wx + (l.lw * l.s) / 2) * z, y: padTop + (vh - padTop) / 2 - (l.wy + (l.lh * l.s) / 2) * z };
    }
    const zfit = Math.min(ZMAX, (vw - pad * 2) / bw, (vh - padTop - pad) / bh);
    const zkids = (textPx() + 1.5) / (FONT * scaleAt(l.d + 1));
    const z = Math.min(ZMAX, Math.max(zfit, zkids));
    if (z > zfit * 1.02) return { z, x: pad - l.wx * z, y: padTop - l.wy * z }; // too big to fit: land at its top-left, reading order
    return { z, x: (vw - bw * z) / 2 - l.wx * z, y: padTop + (vh - padTop - pad - bh * z) / 2 - l.wy * z };
  }, []);
  const zmin = useCallback(() => (rootL ? fitView(rootL).z * 0.5 : 0.01), [rootL, fitView]);
  const clampZ = useCallback((z: number) => Math.max(zmin(), Math.min(ZMAX, z)), [zmin]);

  // sticky path = the deepest legible node under the viewport centre; the side panel follows it unless a tapped node is still on screen
  const updateHud = useCallback(() => {
    if (!nodes) return;
    const { x, y, z } = view.current; const { vw, vh } = box();
    const cx = (vw / 2 - x) / z, cy = (vh / 2 - y) / z;
    let best: L | null = null;
    for (const l of nodes) {
      if (!l.kids.length) continue;
      if (l.d > 2 && FONT * l.s * z < textPx()) continue;
      if (cx >= l.wx && cx <= l.wx + l.w * l.s && cy >= l.wy && cy <= l.wy + l.h * l.s && (!best || l.d > best.d)) best = l;
    }
    const chain: L[] = []; for (let p = best; p; p = p.parent) chain.unshift(p);
    setPath((prev) => (prev.length === chain.length && prev.every((p, i) => p === chain[i]) ? prev : chain));
    setZoomPct((p) => { const n = Math.round(z * 100); return n === p ? p : n; });
    const s = selRef.current;
    const onScreen = s && s.wx * z + x < vw && (s.wx + s.w * s.s) * z + x > 0 && s.wy * z + y < vh && (s.wy + s.h * s.s) * z + y > 0;
    if (!onScreen && best) setSel(best);
  }, [nodes, setSel]);
  const hudRaf = useRef(0);
  const setView = useCallback((v: View) => { view.current = v; apply(); if (!hudRaf.current) hudRaf.current = requestAnimationFrame(() => { hudRaf.current = 0; updateHud(); }); }, [apply, updateHud]);

  const flyTo = useCallback((target: View, ms = 520) => {
    cancelAnimationFrame(anim.current);
    const from = { ...view.current }, t0 = performance.now();
    const { vw, vh } = box();
    const c0 = { x: (vw / 2 - from.x) / from.z, y: (vh / 2 - from.y) / from.z };
    const c1 = { x: (vw / 2 - target.x) / target.z, y: (vh / 2 - target.y) / target.z };
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) ms = 0;
    const step = (now: number) => {
      const p = ms ? Math.min(1, (now - t0) / ms) : 1, e = 1 - Math.pow(1 - p, 3);
      const z = from.z * Math.pow(target.z / from.z, e);
      const cx = c0.x + (c1.x - c0.x) * e, cy = c0.y + (c1.y - c0.y) * e;
      setView({ z, x: vw / 2 - cx * z, y: vh / 2 - cy * z });
      if (p < 1) anim.current = requestAnimationFrame(step);
    };
    anim.current = requestAnimationFrame(step);
  }, [setView]);
  const fit = useCallback((l: L) => { setSel(l); flyTo(fitView(l)); }, [flyTo, fitView, setSel]);
  useEffect(() => { (window as unknown as { __cv3: unknown }).__cv3 = { view: () => view.current, last: () => lastHit.current, sel: () => selRef.current?.n.name }; }, []);
  const lastHit = useRef<string>('');

  // first view: the whole organ
  useEffect(() => { if (rootL) { setSel(rootL); setView(fitView(rootL)); } }, [rootL, fitView, setView, setSel]);
  useEffect(() => { const on = () => { if (rootL) setView({ ...view.current, z: clampZ(view.current.z) }); }; window.addEventListener('resize', on); return () => window.removeEventListener('resize', on); }, [rootL, clampZ, setView]);

  // ---- input ----
  useEffect(() => {
    const el = stage.current; if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault(); cancelAnimationFrame(anim.current);
      const { x, y, z } = view.current;
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
      const nz = clampZ(z * Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0018)));
      const k = nz / z;
      setView({ z: nz, x: e.clientX - (e.clientX - x) * k, y: e.clientY - (e.clientY - y) * k });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [clampZ, setView]);

  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ moved: boolean; dist: number; mid: { x: number; y: number }; target: EventTarget | null }>({ moved: false, dist: 0, mid: { x: 0, y: 0 }, target: null });
  const onDown = (e: React.PointerEvent) => {
    cancelAnimationFrame(anim.current);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current; g.moved = false; g.target = e.target;
    if (ptrs.current.size === 2) { const [a, b] = [...ptrs.current.values()]; g.dist = Math.hypot(a.x - b.x, a.y - b.y); g.mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
    stage.current?.classList.add('dragging');
  };
  const onMove = (e: React.PointerEvent) => {
    const prev = ptrs.current.get(e.pointerId); if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY }; ptrs.current.set(e.pointerId, cur);
    const g = gesture.current, v = view.current;
    if (ptrs.current.size === 1) {
      const dx = cur.x - prev.x, dy = cur.y - prev.y;
      if (Math.abs(cur.x - prev.x) + Math.abs(cur.y - prev.y) > 0 && (g.moved || Math.hypot(dx, dy) > 2)) g.moved = true;
      setView({ ...v, x: v.x + dx, y: v.y + dy });
    } else if (ptrs.current.size === 2) {
      g.moved = true;
      const [a, b] = [...ptrs.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y), mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const nz = clampZ(v.z * (dist / (g.dist || dist))), k = nz / v.z;
      setView({ z: nz, x: mid.x - (g.mid.x - v.x) * k, y: mid.y - (g.mid.y - v.y) * k });
      g.dist = dist; g.mid = mid;
    }
  };
  const onUp = (e: React.PointerEvent) => {
    ptrs.current.delete(e.pointerId);
    if (ptrs.current.size === 0) stage.current?.classList.remove('dragging');
    const g = gesture.current;
    if (g.moved || ptrs.current.size) return;
    const lbl = (g.target as HTMLElement | null)?.closest?.('.lbl'); const zn = lbl?.parentElement; const id = zn?.dataset.id;
    const l = id ? byId.get(id) : null; if (!l) return;
    lastHit.current = `${l.n.name} d${l.d}`;
    const target = fitView(l), cur = view.current;
    const already = Math.abs(Math.log(cur.z / target.z)) < 0.12 && Math.hypot(cur.x - target.x, cur.y - target.y) < 40;
    fit(already && selRef.current === l && l.parent ? l.parent : l);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!rootL) return;
      const v = view.current, { vw, vh } = box(), cx = vw / 2, cy = vh / 2;
      const zoomBy = (k: number) => { const nz = clampZ(v.z * k), r = nz / v.z; setView({ z: nz, x: cx - (cx - v.x) * r, y: cy - (cy - v.y) * r }); };
      if (e.key === '+' || e.key === '=') zoomBy(1.25); else if (e.key === '-') zoomBy(0.8);
      else if (e.key === '0') fit(rootL);
      else if (e.key === 'ArrowLeft') setView({ ...v, x: v.x + 80 }); else if (e.key === 'ArrowRight') setView({ ...v, x: v.x - 80 });
      else if (e.key === 'ArrowUp') setView({ ...v, y: v.y + 80 }); else if (e.key === 'ArrowDown') setView({ ...v, y: v.y - 80 });
      else if (e.key === 'Escape' && path.length > 1) fit(path[path.length - 2]);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [rootL, clampZ, setView, fit, path]);

  // ---- render ----
  return (
    <>
      <style>{VIS_CSS}</style>
      <span className="cv3-probe lbl" ref={probe} aria-hidden="true">x</span>
      <span className="cv3-probe cnt" ref={probeSmall} aria-hidden="true">x</span>
      <div className="cv3-stage" ref={stage} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <div className="zw" ref={world}>
          {nodes?.map((l) => (
            <div key={l.uid} className={`zn d${l.d} k-${l.n.kind}${l.mode ? ' m-' + l.mode : ''}${sel === l ? ' sel' : ''}`} data-id={l.uid}
              style={{ transform: `translate(${l.wx}px, ${l.wy}px) scale(${l.s})`, width: l.lw + 1 }}>
              {l.kids.length > 0 && l.d >= 1 && <div className="cloud" style={{ width: l.w, height: l.h }} />}
              {l.kids.length > 0 && l.d >= 2 && <div className="rail" style={{ left: 5, top: l.lh + HEAD - 2, height: l.h - l.lh - HEAD - FOOT + 2 }} />}
              <div className="gk" style={{ width: Math.min(l.lw, MAXW), height: l.lh }} />
              <div className="lbl">{l.n.name}{l.n.note && <span className="note"> {l.n.note}</span>}{l.n.cases > 0 && <span className="cnt">{fmt(l.n.cases)}</span>}</div>
            </div>
          ))}
        </div>
        <div className="cv3-hud">
          <a className="cv3-brand" href="/">Pathology Search</a>
          <nav className="cv3-path">
            {path.map((l, i) => (
              <button key={l.uid} className={`cv3-crumb${i === path.length - 1 ? ' last' : ''}`} onClick={() => fit(l)}>
                {i > 0 && <span className="cv3-sep">›</span>}<span className="cv3-crumb-t">{l.n.name}</span>
              </button>
            ))}
          </nav>
          <div className="cv3-tools">
            <span className="cv3-zoom">{zoomPct}%</span>
            <button className="cv3-btn" onClick={() => rootL && fit(rootL)} title="Fit the whole organ (0)">Fit</button>
          </div>
        </div>
        <div className="cv3-hint">Scroll or pinch to zoom · drag to pan · tap a name to fly to it</div>
      </div>
      <aside className="cv3-side">{sel ? <CaseList l={sel} onPick={fit} /> : <div className="cv3-side-empty">Tap a heading to list its cases</div>}</aside>
      {!nodes && <div className="cv3-loading">Laying out {root.name}…</div>}
    </>
  );
}
