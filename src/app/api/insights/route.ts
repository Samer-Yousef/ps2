import { NextResponse } from 'next/server';
import { readFile, stat } from 'fs/promises';
import { join } from 'path';
import { auth } from '@/lib/auth';
import { getBlockedVisitorIds } from '@/lib/botProtection';
import { AUTH_LOG } from '@/lib/authLog';
import { analyseAuthLog } from '@/lib/authLogStats';

const SEARCH_LOG = join(process.cwd(), 'search-logs.txt');
const ADMIN_EMAIL = 'fleshbits@gmail.com';

export const dynamic = 'force-dynamic';

// Aggregating ~40k log lines takes a few hundred ms, so hold the result until the log file
// actually changes. Keyed on size+mtime, which is enough for an append-only log.
let cache: { key: string; data: unknown } | null = null;

type Row = {
  t: number; day: string; hour: number; dow: number;
  q: string; dx: string; rank: number | null;
  organ: string; system: string; source: string;
  sim: number; who: string; vid: string; anon: boolean;
  page: string;   // 'home' | 'v2' (13th log column; '' = home)
};
type ModalEvent = { t: number; event: string; variant: string };

const tally = (rows: Row[], pick: (r: Row) => string) => {
  const m = new Map<string, number>();
  for (const r of rows) { const k = pick(r); if (k) m.set(k, (m.get(k) || 0) + 1); }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};
const share = (a: number, b: number) => (b ? +(a / b * 100).toFixed(1) : 0);
const median = (a: number[]) => (a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0);

function analyse(text: string, cutover: string | null) {
  const blocked = getBlockedVisitorIds();
  const rows: Row[] = [];
  const modal = new Map<string, number>();
  const modalEvents: ModalEvent[] = [];
  const feedback = new Map<string, number>();

  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const f = line.split('\t');
    if (f.length < 4) continue;
    const ms = Date.parse(f[0]);
    if (Number.isNaN(ms)) continue;
    const vid = (f[11] || '').trim();
    if (vid && blocked.has(vid)) continue;

    const query = (f[1] || '').trim();
    // The signup modal writes its own events into this log; they are not searches.
    if (query === 'MODAL') {
      const event = (f[2] || '').trim();
      const detail = (f[3] || '').trim();
      // previews and test-mode showings are the owner checking things, not users
      if (detail.startsWith('preview') || detail === 'test') continue;
      // variant key rides in the detail ("a", "b:backdrop", …); anything else is the
      // original home-page modal (whose SIGNUP_EMAIL detail is an email address).
      const head = detail.split(':')[0];
      const variant = head === 'a' || head === 'b' || head === 'c' ? head : 'original';
      modal.set(event, (modal.get(event) || 0) + 1);
      modalEvents.push({ t: ms, event, variant });
      continue;
    }
    // returning-user pulse survey rows (new-design verdict + upload interest) — not searches
    if (query === 'FEEDBACK') {
      const k = `${(f[2] || '').trim()}:${(f[3] || '').trim()}`;
      feedback.set(k, (feedback.get(k) || 0) + 1);
      continue;
    }
    const d = new Date(ms);
    const rank = parseInt(f[3], 10);
    const who = (f[9] || '').trim();
    rows.push({
      t: ms, day: f[0].slice(0, 10), hour: d.getUTCHours(), dow: d.getUTCDay(),
      q: query.toLowerCase(), dx: (f[2] || '').trim(),
      rank: Number.isFinite(rank) && rank > 0 ? rank : null,
      organ: (f[4] || '').trim(), system: (f[5] || '').trim(), source: (f[6] || '').trim(),
      sim: parseFloat(f[7]), who, vid, anon: !who || who === 'anonymous',
      page: (f[12] || '').trim() || 'home',
    });
  }

  const n = rows.length;
  if (!n) return { empty: true };

  // Organ-system names double as browse queries — classify them from the data itself so this
  // never drifts out of sync with the catalogue.
  const systemNames = new Set(
    tally(rows, r => r.system).filter(([, c]) => c >= 50).map(([s]) => s.toLowerCase())
  );
  const browse = rows.filter(r => systemNames.has(r.q));
  const search = rows.filter(r => !systemNames.has(r.q));

  const dayCounts = new Map<string, number>();
  for (const r of rows) dayCounts.set(r.day, (dayCounts.get(r.day) || 0) + 1);
  const dailySorted = [...dayCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  // per-visitor + session shape
  const byVid = new Map<string, number[]>();
  for (const r of rows) { if (!r.vid) continue; const a = byVid.get(r.vid); a ? a.push(r.t) : byVid.set(r.vid, [r.t]); }
  const perVisitor = [...byVid.values()].map(a => a.length).sort((a, b) => b - a);
  const top5pct = perVisitor.slice(0, Math.ceil(perVisitor.length * 0.05)).reduce((a, b) => a + b, 0);
  const visitorDays = new Map<string, Set<string>>();
  for (const r of rows) { if (!r.vid) continue; (visitorDays.get(r.vid) || visitorDays.set(r.vid, new Set()).get(r.vid)!).add(r.day); }
  const dayCountsPerVisitor = [...visitorDays.values()].map(s => s.size);

  let sessions = 0; const sessionSizes: number[] = [];
  for (const times of byVid.values()) {
    times.sort((a, b) => a - b);
    let cur = 0;
    for (let i = 0; i < times.length; i++) {
      if (i === 0 || times[i] - times[i - 1] > 30 * 60_000) { if (cur) sessionSizes.push(cur); sessions++; cur = 0; }
      cur++;
    }
    if (cur) sessionSizes.push(cur);
  }

  const ranked = search.filter(r => r.rank).map(r => r.rank as number).sort((a, b) => a - b);
  const at = (k: number) => share(ranked.filter(r => r <= k).length, ranked.length);

  const qByRank = new Map<string, number[]>();
  for (const r of search) if (r.rank) (qByRank.get(r.q) || qByRank.set(r.q, []).get(r.q)!).push(r.rank);

  const sims = rows.map(r => r.sim).filter(Number.isFinite).sort((a, b) => a - b);
  const words = search.map(r => r.q.split(/\s+/).filter(Boolean).length);

  const slideMeta = new Map<string, Row>();
  for (const r of rows) if (r.dx && !slideMeta.has(r.dx)) slideMeta.set(r.dx, r);

  const systemsAll = tally(rows, r => r.system);
  const sourcesAll = tally(rows, r => r.source).filter(([s]) => !systemNames.has(s.toLowerCase()));

  // ---- signup-prompt funnel per variant ----
  const variantOrder = ['original', 'a', 'b', 'c'];
  const modalVariants = variantOrder.map(v => {
    const ev = modalEvents.filter(e => e.variant === v);
    const count = (name: string) => ev.filter(e => e.event === name).length;
    const shown = count('SHOWN'), google = count('SIGNUP_GOOGLE'), email = count('SIGNUP_EMAIL');
    return { v, shown, dismissed: count('DISMISSED'), google, email,
             signups: google + email, conv: share(google + email, shown) };
  }).filter(x => x.shown > 0 || x.signups > 0);

  // ---- the same core metrics over an arbitrary subset (page cohorts + before/after) ----
  const metricSet = (rs: Row[], evs: ModalEvent[]) => {
    const m = rs.length;
    if (!m) return null;
    const days = new Set(rs.map(r => r.day)).size;
    const vids = new Set(rs.filter(r => r.vid).map(r => r.vid));
    const rk = rs.filter(r => r.rank).map(r => r.rank as number).sort((a, b) => a - b);
    const shown = evs.filter(e => e.event === 'SHOWN').length;
    const signups = evs.filter(e => e.event === 'SIGNUP_GOOGLE' || e.event === 'SIGNUP_EMAIL').length;
    return {
      clicks: m, days,
      clicksPerDay: +(m / days).toFixed(1),
      visitors: vids.size,
      visitorsPerDay: +(vids.size / days).toFixed(1),
      opensPerVisitor: +(m / Math.max(vids.size, 1)).toFixed(1),
      top1: share(rk.filter(r => r <= 1).length, rk.length),
      top10: share(rk.filter(r => r <= 10).length, rk.length),
      medianRank: median(rk),
      anonShare: share(rs.filter(r => r.anon).length, m),
      browseShare: share(rs.filter(r => systemNames.has(r.q)).length, m),
      loggedInShare: share(rs.filter(r => !r.anon).length, m),
      modalShown: shown, modalSignups: signups, modalConv: share(signups, shown),
    };
  };

  // home vs v2 cohorts (v2 rows exist once the tagged logging ships)
  const v2Rows = rows.filter(r => r.page === 'v2');
  const pages = {
    home: metricSet(rows.filter(r => r.page === 'home'), modalEvents.filter(e => e.variant === 'original')),
    v2: v2Rows.length ? metricSet(v2Rows, modalEvents.filter(e => e.variant !== 'original')) : null,
  };

  // before/after a cutover date (?cutover=YYYY-MM-DD) — for judging the v2 launch
  let compare = null;
  if (cutover && /^\d{4}-\d{2}-\d{2}$/.test(cutover)) {
    const cms = Date.parse(cutover + 'T00:00:00Z');
    compare = {
      cutover,
      before: metricSet(rows.filter(r => r.t < cms), modalEvents.filter(e => e.t < cms)),
      after: metricSet(rows.filter(r => r.t >= cms), modalEvents.filter(e => e.t >= cms)),
    };
  }

  const fb = (k: string) => feedback.get(k) || 0;

  return {
    modalVariants,
    pages,
    compare,
    feedback: {
      shown: fb('SHOWN:'),
      dismissed: fb('DISMISSED:'),
      design: { newUi: fb('DESIGN:new'), oldUi: fb('DESIGN:old'), unsure: fb('DESIGN:unsure') },
      upload: { yes: fb('UPLOAD:yes'), no: fb('UPLOAD:no') },
    },
    generatedAt: new Date().toISOString(),
    overview: {
      clicks: n,
      visitors: byVid.size,
      sessions,
      uniqueQueries: new Set(rows.map(r => r.q)).size,
      uniqueSlides: new Set(rows.map(r => r.dx.toLowerCase())).size,
      accounts: new Set(rows.filter(r => !r.anon).map(r => r.who)).size,
      anonShare: share(rows.filter(r => r.anon).length, n),
      first: dailySorted[0][0],
      last: dailySorted[dailySorted.length - 1][0],
      activeDays: dailySorted.length,
    },
    months: [...rows.reduce((m, r) => { const k = r.day.slice(0, 7); return m.set(k, (m.get(k) || 0) + 1); }, new Map<string, number>())]
      .sort((a, b) => a[0].localeCompare(b[0])),
    daily: dailySorted.slice(-90),
    mode: { browse: browse.length, search: search.length, browseShare: share(browse.length, n) },
    topSlides: tally(rows, r => r.dx).slice(0, 20).map(([dx, c]) => {
      const ex = slideMeta.get(dx)!;
      return { dx, n: c, system: ex.system, organ: ex.organ, source: ex.source };
    }),
    systems: systemsAll.filter(([, c]) => c >= 20).map(([s, c]) => ({ s, n: c, pct: share(c, n) })),
    systemsBrowsed: tally(browse, r => r.q).slice(0, 18).map(([s, c]) => ({ s, n: c })),
    organs: tally(rows, r => r.organ).slice(0, 12).map(([s, c]) => ({ s, n: c })),
    sources: sourcesAll.slice(0, 8).map(([s, c]) => ({ s, n: c, pct: share(c, n) })),
    topQueries: tally(search, r => r.q).slice(0, 20).map(([q, c]) => ({ q, n: c })),
    queryShape: {
      medianChars: median(search.map(r => r.q.length)),
      oneWord: share(words.filter(w => w === 1).length, words.length),
      twoWord: share(words.filter(w => w === 2).length, words.length),
      threePlus: share(words.filter(w => w >= 3).length, words.length),
    },
    engagement: {
      medianClicks: median(perVisitor),
      meanClicks: +(n / Math.max(byVid.size, 1)).toFixed(1),
      oneAndDone: share(perVisitor.filter(s => s === 1).length, perVisitor.length),
      heavy: share(perVisitor.filter(s => s >= 50).length, perVisitor.length),
      topShare: share(top5pct, n),
      returning: share(dayCountsPerVisitor.filter(d => d > 1).length, dayCountsPerVisitor.length),
      maxDays: dayCountsPerVisitor.length ? Math.max(...dayCountsPerVisitor) : 0,
      sessionMedian: median(sessionSizes),
      sessionMean: +(n / Math.max(sessions, 1)).toFixed(1),
    },
    ranking: {
      n: ranked.length, top1: at(1), top5: at(5), top10: at(10),
      beyond20: share(ranked.filter(r => r > 20).length, ranked.length),
      median: median(ranked), p90: ranked[Math.floor(ranked.length * 0.9)] ?? 0,
    },
    painQueries: [...qByRank.entries()]
      .filter(([, v]) => v.length >= 10)
      .map(([q, v]) => ({ q, n: v.length, med: median(v) }))
      .sort((a, b) => b.med - a.med).slice(0, 12),
    similarity: {
      median: +(sims[Math.floor(sims.length / 2)] ?? 0).toFixed(3),
      weakShare: share(sims.filter(s => s < 0.5).length, sims.length),
    },
    hours: Array.from({ length: 24 }, (_, h) => rows.filter(r => r.hour === h).length),
    dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
      .map((d, i) => ({ d, n: rows.filter(r => r.dow === i).length })),
    accounts: {
      loggedInShare: share(rows.filter(r => !r.anon).length, n),
      top: tally(rows.filter(r => !r.anon), r => r.who).slice(0, 12).map(([who, c]) => ({ who, n: c })),
    },
    modal: {
      shown: modal.get('SHOWN') || 0,
      dismissed: modal.get('DISMISSED') || 0,
      signups: (modal.get('SIGNUP_GOOGLE') || 0) + (modal.get('SIGNUP_EMAIL') || 0),
      google: modal.get('SIGNUP_GOOGLE') || 0,
      email: modal.get('SIGNUP_EMAIL') || 0,
    },
  };
}

export async function GET(request: Request) {
  const session = await auth();
  if (session?.user?.email !== ADMIN_EMAIL) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const cutover = new URL(request.url).searchParams.get('cutover');
    const st = await stat(SEARCH_LOG);
    // auth-logs.txt appears with the first password-reset request; absent = no resets yet
    const ast = await stat(AUTH_LOG).catch(() => null);
    const key = `${st.size}:${st.mtimeMs}:${ast?.size ?? 0}:${ast?.mtimeMs ?? 0}:${cutover || ''}`;
    if (cache?.key === key) return NextResponse.json(cache.data);

    const text = await readFile(SEARCH_LOG, 'utf-8');
    const authText = ast ? await readFile(AUTH_LOG, 'utf-8') : '';
    const data = { ...analyse(text, cutover), passwordReset: analyseAuthLog(authText) };
    cache = { key, data };
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
