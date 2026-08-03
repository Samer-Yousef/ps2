'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import './insights.css';

type Named = { s: string; n: number; pct?: number };
type Data = {
  generatedAt: string;
  overview: { clicks: number; visitors: number; sessions: number; uniqueQueries: number;
    uniqueSlides: number; accounts: number; anonShare: number; first: string; last: string; activeDays: number };
  months: [string, number][];
  daily: [string, number][];
  mode: { browse: number; search: number; browseShare: number };
  topSlides: { dx: string; n: number; system: string; organ: string; source: string }[];
  systems: Named[];
  systemsBrowsed: Named[];
  organs: Named[];
  sources: Named[];
  topQueries: { q: string; n: number }[];
  queryShape: { medianChars: number; oneWord: number; twoWord: number; threePlus: number };
  engagement: { medianClicks: number; meanClicks: number; oneAndDone: number; heavy: number;
    topShare: number; returning: number; maxDays: number; sessionMedian: number; sessionMean: number };
  ranking: { n: number; top1: number; top5: number; top10: number; beyond20: number; median: number; p90: number };
  painQueries: { q: string; n: number; med: number }[];
  similarity: { median: number; weakShare: number };
  hours: number[];
  dow: { d: string; n: number }[];
  accounts: { loggedInShare: number; top: { who: string; n: number }[] };
  modal: { shown: number; dismissed: number; signups: number; google: number; email: number };
  modalVariants: { v: string; shown: number; dismissed: number; google: number; email: number;
    signups: number; conv: number }[];
  pages: { home: Cohort | null; v2: Cohort | null };
  compare: { cutover: string; before: Cohort | null; after: Cohort | null } | null;
  feedback: { shown: number; dismissed: number;
    design: { newUi: number; oldUi: number; unsure: number };
    upload: { yes: number; no: number } };
};
type Cohort = {
  clicks: number; days: number; clicksPerDay: number; visitors: number; visitorsPerDay: number;
  opensPerVisitor: number; top1: number; top10: number; medianRank: number; anonShare: number;
  browseShare: number; loggedInShare: number; modalShown: number; modalSignups: number; modalConv: number;
};

const VARIANT_LABELS: Record<string, string> = {
  original: 'Original (home)', a: 'A · your session', b: 'B · forgetting curve', c: 'C · corner card',
};

// the rows of every cohort table, in display order
const COHORT_METRICS: { k: keyof Cohort; label: string; suffix?: string; higherIsBetter?: boolean }[] = [
  { k: 'clicks', label: 'Result opens' },
  { k: 'clicksPerDay', label: 'Opens / day', higherIsBetter: true },
  { k: 'visitorsPerDay', label: 'Visitors / day', higherIsBetter: true },
  { k: 'opensPerVisitor', label: 'Opens / visitor', higherIsBetter: true },
  { k: 'top1', label: 'Clicked rank 1', suffix: '%', higherIsBetter: true },
  { k: 'top10', label: 'Clicked in top 10', suffix: '%', higherIsBetter: true },
  { k: 'medianRank', label: 'Median clicked rank', higherIsBetter: false },
  { k: 'browseShare', label: 'Browse (vs typed)', suffix: '%' },
  { k: 'loggedInShare', label: 'Signed-in opens', suffix: '%', higherIsBetter: true },
  { k: 'modalConv', label: 'Signup-prompt conversion', suffix: '%', higherIsBetter: true },
];

function CohortTable({ a, b, aLabel, bLabel }: { a: Cohort; b: Cohort; aLabel: string; bLabel: string }) {
  return (
    <div className="psi-scroll">
      <table>
        <thead><tr><th>Metric</th><th className="num">{aLabel}</th><th className="num">{bLabel}</th><th className="num">Δ</th></tr></thead>
        <tbody>
          {COHORT_METRICS.map(({ k, label, suffix, higherIsBetter }) => {
            const av = a[k], bv = b[k];
            const delta = av ? ((bv - av) / av) * 100 : 0;
            const good = higherIsBetter === undefined ? null : (delta >= 0) === higherIsBetter;
            return (
              <tr key={k}>
                <td>{label}</td>
                <td className="num">{fmt(av)}{suffix}</td>
                <td className="num">{fmt(bv)}{suffix}</td>
                <td className="num" style={{ color: good == null ? undefined : good ? '#177245' : '#b3261e', fontWeight: 600 }}>
                  {av ? `${delta >= 0 ? '+' : ''}${delta.toFixed(0)}%` : '–'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const fmt = (n: number) => n.toLocaleString('en-GB');
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (ym: string) => MONTH[parseInt(ym.slice(5, 7), 10) - 1];
const prettyDate = (d: string) =>
  `${parseInt(d.slice(8), 10)} ${MONTH[parseInt(d.slice(5, 7), 10) - 1]} ${d.slice(0, 4)}`;

function Bars({ items, alt, showPct }: { items: Named[]; alt?: boolean; showPct?: boolean }) {
  const max = Math.max(...items.map(i => i.n), 1);
  return (
    <div className="psi-bars">
      {items.map(i => (
        <div className={`psi-bar${alt ? ' alt' : ''}`} key={i.s}>
          <span className="lab">{i.s}</span>
          <span className="v">{fmt(i.n)}{showPct && i.pct != null && <em> {i.pct}%</em>}</span>
          <span className="track"><span className="fill" style={{ width: `${i.n / max * 100}%` }} /></span>
        </div>
      ))}
    </div>
  );
}

export default function InsightsPage() {
  const [data, setData] = useState<Data | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'denied' | 'error'>('loading');

  useEffect(() => {
    // pass ?cutover=YYYY-MM-DD straight through to the API for the before/after panel
    const cutover = new URLSearchParams(window.location.search).get('cutover');
    fetch(`/api/insights${cutover ? `?cutover=${encodeURIComponent(cutover)}` : ''}`)
      .then(async res => {
        if (res.status === 401) { setState('denied'); return; }
        if (!res.ok) { setState('error'); return; }
        const json = await res.json();
        // an empty or rotated log yields no overview — show the error state rather than crash
        if (!json?.overview) { setState('error'); return; }
        setData(json);
        setState('ok');
      })
      .catch(() => setState('error'));
  }, []);

  if (state !== 'ok' || !data) {
    return (
      <div className="psi">
        <div className="psi-state">
          <div>
            {state === 'loading' && <><h2>Reading the logs…</h2><p>Aggregating search and click history.</p></>}
            {state === 'denied' && <><h2>Admin only</h2><p>Sign in with the owner account to view this page.</p><Link href="/">Back to search</Link></>}
            {state === 'error' && <><h2>Could not load the logs</h2><p>The search log could not be read on the server.</p><Link href="/">Back to search</Link></>}
          </div>
        </div>
      </div>
    );
  }

  const o = data.overview;
  const maxMonth = Math.max(...data.months.map(m => m[1]), 1);
  const peakMonth = maxMonth;
  const maxDaily = Math.max(...data.daily.map(d => d[1]), 1);
  const maxHour = Math.max(...data.hours, 1);
  const monthCols = { gridTemplateColumns: `repeat(${data.months.length}, 1fr)` };
  const latest = data.months[data.months.length - 1];
  const peak = data.months.reduce((a, b) => (b[1] > a[1] ? b : a));
  const declinePct = Math.round((1 - latest[1] / peak[1]) * 100);
  const busiestDay = data.dow.reduce((a, b) => (b.n > a.n ? b : a));
  const peakHour = data.hours.indexOf(maxHour);
  const modalRate = data.modal.shown ? (data.modal.signups / data.modal.shown * 100).toFixed(1) : '0';

  return (
    <div className="psi">
      <div className="psi-wrap">
        <div className="psi-head">
          <div>
            <div className="psi-eyebrow">Search &amp; click log analysis</div>
            <h1>What people actually do on the site</h1>
            <div className="psi-range">
              {prettyDate(o.first)} → {prettyDate(o.last)} · {o.activeDays} active days · updates live
            </div>
          </div>
          <Link href="/" className="psi-back">← Back to search</Link>
        </div>

        <div className="psi-kpis">
          <div className="psi-kpi"><b>{fmt(o.clicks)}</b><span>Result opens</span></div>
          <div className="psi-kpi"><b>{fmt(o.visitors)}</b><span>Visitors</span></div>
          <div className="psi-kpi"><b>{fmt(o.sessions)}</b><span>Sessions</span></div>
          <div className="psi-kpi"><b>{fmt(o.uniqueQueries)}</b><span>Unique queries</span></div>
          <div className="psi-kpi"><b>{fmt(o.uniqueSlides)}</b><span>Distinct slides</span></div>
          <div className="psi-kpi"><b>{fmt(o.accounts)}</b><span>Accounts</span></div>
        </div>

        <div className="psi-grid">

          <section className="psi-panel psi-c7">
            <h2>Traffic by month</h2>
            <p className="psi-note">
              Result opens per month. Peak was <strong>{monthLabel(peak[0])} ({fmt(peak[1])})</strong>;
              the latest month sits <strong>{declinePct}% below</strong> it. First and last months are
              partial.
            </p>
            <div className="psi-mval" style={monthCols}>
              {data.months.map(([m, c]) => <span key={m}>{fmt(c)}</span>)}
            </div>
            <div className="psi-months" style={monthCols}>
              {data.months.map(([m, c]) => (
                <i key={m} className={c === peakMonth ? 'peak' : ''} style={{ height: `${c / maxMonth * 100}%` }} />
              ))}
            </div>
            <div className="psi-mlab" style={monthCols}>
              {data.months.map(([m]) => <span key={m}>{monthLabel(m)}</span>)}
            </div>

            <h2 style={{ marginTop: 26 }}>Last {data.daily.length} days</h2>
            <p className="psi-note">Daily result opens.</p>
            <div className="psi-cols">
              {data.daily.map(([d, c]) => <i key={d} title={`${d}: ${c}`} style={{ height: `${c / maxDaily * 100}%` }} />)}
            </div>
            <div className="psi-axis">
              <span>{data.daily.length ? prettyDate(data.daily[0][0]) : ''}</span>
              <span>peak {fmt(maxDaily)}/day</span>
              <span>{data.daily.length ? prettyDate(data.daily[data.daily.length - 1][0]) : ''}</span>
            </div>
          </section>

          <section className="psi-panel psi-c5">
            <h2>A small core carries the site</h2>
            <p className="psi-note">Usage is heavily concentrated — this is a tool for regulars.</p>
            <div className="psi-split">
              <div className="psi-stat"><b>{data.engagement.topShare}%</b><span>of opens come from the top 5% of visitors</span></div>
              <div className="psi-stat"><b>{data.engagement.heavy}%</b><span>of visitors opened 50+ slides</span></div>
              <div className="psi-stat"><b>{data.engagement.returning}%</b><span>came back on another day</span></div>
              <div className="psi-stat"><b>{data.engagement.oneAndDone}%</b><span>opened one slide, then left</span></div>
            </div>
            <div className="psi-callout">
              <p>
                Median visitor opens <strong>{data.engagement.medianClicks}</strong> slides; the mean is{' '}
                <strong>{data.engagement.meanClicks}</strong>. The most persistent returned on{' '}
                <strong>{data.engagement.maxDays} separate days</strong>. Typical session:{' '}
                <strong>{data.engagement.sessionMedian}</strong> slides.
              </p>
            </div>
            <div className="psi-callout">
              <p>
                <strong>{o.anonShare}%</strong> of opens are anonymous, against{' '}
                <strong>{fmt(o.accounts)}</strong> registered accounts.
              </p>
            </div>
          </section>

          <section className="psi-panel psi-c6">
            <h2>Organ systems, by slides opened</h2>
            <p className="psi-note">What people actually look at, from the result they clicked.</p>
            <Bars items={data.systems} showPct />
          </section>

          <section className="psi-panel psi-c6">
            <h2>Organ systems, by filter use</h2>
            <p className="psi-note">
              <strong>{fmt(data.mode.browse)}</strong> opens ({data.mode.browseShare}%) came from clicking a
              system filter rather than typing. The ordering differs from search — worth comparing
              against the panel on the left.
            </p>
            <Bars items={data.systemsBrowsed} alt />
          </section>

          <section className="psi-panel psi-c6">
            <h2>Most-opened slides</h2>
            <div className="psi-scroll">
              <table>
                <thead><tr><th /><th>Diagnosis</th><th>System / organ</th><th className="num">Opens</th></tr></thead>
                <tbody>
                  {data.topSlides.map((s, i) => (
                    <tr key={s.dx}>
                      <td className="rank">{i + 1}</td>
                      <td>{s.dx}</td>
                      <td className="dim">{s.system}{s.organ ? ` · ${s.organ}` : ''}</td>
                      <td className="num">{fmt(s.n)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="psi-panel psi-c6">
            <h2>Most-typed queries</h2>
            <p className="psi-note">Excludes clicks that came from the organ-system filter.</p>
            <div className="psi-scroll">
              <table>
                <thead><tr><th /><th>Query</th><th className="num">Searches</th></tr></thead>
                <tbody>
                  {data.topQueries.map((q, i) => (
                    <tr key={q.q}>
                      <td className="rank">{i + 1}</td>
                      <td>{q.q}</td>
                      <td className="num">{fmt(q.n)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="psi-chips">
              <span className="psi-chip">median {data.queryShape.medianChars} characters</span>
              <span className="psi-chip">{data.queryShape.oneWord}% one word</span>
              <span className="psi-chip">{data.queryShape.twoWord}% two words</span>
              <span className="psi-chip">{data.queryShape.threePlus}% three or more</span>
            </div>
          </section>

          <section className="psi-panel psi-c7">
            <h2>Search quality</h2>
            <p className="psi-note">
              The rank of the result people clicked is a direct verdict on ranking. Measured over{' '}
              <strong>{fmt(data.ranking.n)}</strong> typed searches.
            </p>
            <div className="psi-split" style={{ marginBottom: 16 }}>
              <div className="psi-stat"><b>{data.ranking.top1}%</b><span>clicked the first result</span></div>
              <div className="psi-stat"><b>{data.ranking.beyond20}%</b><span>had to go past rank 20</span></div>
              <div className="psi-stat"><b>{data.ranking.median}</b><span>median rank clicked</span></div>
              <div className="psi-stat"><b>{data.ranking.p90}</b><span>90th-percentile rank</span></div>
            </div>
            <p className="psi-note">Queries where people had to dig deepest:</p>
            <div className="psi-scroll">
              <table>
                <thead><tr><th>Query</th><th className="num">Searches</th><th className="num">Median rank</th></tr></thead>
                <tbody>
                  {data.painQueries.map(p => (
                    <tr key={p.q}>
                      <td><span className={`psi-sev ${p.med >= 60 ? 'b' : 'w'}`} />{p.q}</td>
                      <td className="num">{fmt(p.n)}</td>
                      <td className="num">{p.med}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="psi-callout">
              <p>
                These are almost all <strong>broad category terms</strong> or{' '}
                <strong>partially typed words</strong> — the cases a flat keyword boost cannot rank.
                Median similarity of a clicked result is <strong>{data.similarity.median}</strong>, and{' '}
                <strong>{data.similarity.weakShare}%</strong> were a weak match (below 0.5).
              </p>
            </div>
          </section>

          <section className="psi-panel psi-c5">
            <h2>Where the slides come from</h2>
            <Bars items={data.sources} showPct />

            <h2 style={{ marginTop: 26 }}>When they study</h2>
            <p className="psi-note">
              By hour, UTC. Peak is <strong>{String(peakHour).padStart(2, '0')}:00</strong>, and the
              busiest day is <strong>{busiestDay.d}</strong>.
            </p>
            <div className="psi-cols" style={{ height: 76 }}>
              {data.hours.map((c, h) => (
                <i key={h} title={`${String(h).padStart(2, '0')}:00 — ${c}`}
                   className={c === maxHour ? 'peak' : ''} style={{ height: `${c / maxHour * 100}%` }} />
              ))}
            </div>
            <div className="psi-axis"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div>

            <h2 style={{ marginTop: 26 }}>Signup prompt</h2>
            <div className="psi-steps">
              <div className="psi-step"><span>Shown</span><b>{fmt(data.modal.shown)}</b></div>
              <div className="psi-step"><span>Dismissed</span><b>{fmt(data.modal.dismissed)}</b></div>
              <div className="psi-step win">
                <span>Signed up (Google {data.modal.google} · email {data.modal.email})</span>
                <b>{fmt(data.modal.signups)}</b>
              </div>
            </div>
            <div className="psi-callout"><p><strong>{modalRate}%</strong> conversion overall.</p></div>
          </section>

          <section className="psi-panel psi-c6">
            <h2>Signup prompt, by variant</h2>
            <p className="psi-note">
              /v2 rotates three prompts (a → b → c, one every 10 slides). The original modal on the
              home page acts as the control. Previews are excluded.
            </p>
            <div className="psi-scroll">
              <table>
                <thead><tr><th>Variant</th><th className="num">Shown</th><th className="num">Dismissed</th>
                  <th className="num">Google</th><th className="num">Email</th><th className="num">Conv</th></tr></thead>
                <tbody>
                  {data.modalVariants.map(m => (
                    <tr key={m.v}>
                      <td>{VARIANT_LABELS[m.v] ?? m.v}</td>
                      <td className="num">{fmt(m.shown)}</td>
                      <td className="num">{fmt(m.dismissed)}</td>
                      <td className="num">{fmt(m.google)}</td>
                      <td className="num">{fmt(m.email)}</td>
                      <td className="num"><strong>{m.conv}%</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="psi-callout">
              <p>Small samples mislead: at a ~3% base rate you need roughly{' '}
              <strong>500+ showings per variant</strong> before a difference is worth acting on.</p>
            </div>
          </section>

          <section className="psi-panel psi-c6">
            <h2>Returning-user survey</h2>
            <p className="psi-note">
              Shown once to visitors who used the site before the redesign
              (<strong>{fmt(data.feedback.shown)}</strong> shown, {fmt(data.feedback.dismissed)} dismissed).
            </p>
            <p className="psi-note" style={{ marginBottom: 6 }}><strong>New design or the old one?</strong></p>
            <Bars items={[
              { s: 'New design', n: data.feedback.design.newUi },
              { s: 'The old one', n: data.feedback.design.oldUi },
              { s: 'No opinion', n: data.feedback.design.unsure },
            ]} />
            <p className="psi-note" style={{ margin: '14px 0 6px' }}><strong>Would they have slides to upload (if free)?</strong></p>
            <Bars items={[
              { s: 'Yes', n: data.feedback.upload.yes },
              { s: 'No', n: data.feedback.upload.no },
            ]} alt />
          </section>

          {data.pages.v2 && data.pages.home && (
            <section className="psi-panel psi-c6">
              <h2>Home vs /v2</h2>
              <p className="psi-note">
                Same metrics, split by which interface logged the click (v2 rows exist from 3 Aug 2026).
                This compares the two UIs head-to-head regardless of launch date.
              </p>
              <CohortTable a={data.pages.home} b={data.pages.v2} aLabel="Home" bLabel="/v2" />
            </section>
          )}

          <section className="psi-panel psi-c6">
            <h2>Before / after v2 launch</h2>
            {data.compare && data.compare.before && data.compare.after ? (
              <>
                <p className="psi-note">
                  Split at <strong>{prettyDate(data.compare.cutover)}</strong>. Whole-site metrics
                  either side of the cutover — seasonality and cohort mix included, so read alongside
                  the head-to-head table.
                </p>
                <CohortTable a={data.compare.before} b={data.compare.after}
                  aLabel={`Before (${data.compare.before.days}d)`} bLabel={`After (${data.compare.after.days}d)`} />
              </>
            ) : (
              <div className="psi-callout">
                <p>
                  When v2 goes live, open this page as{' '}
                  <strong>/insights?cutover=YYYY-MM-DD</strong> (the launch date) and this panel fills
                  in with the same metric set computed before and after that day.
                </p>
              </div>
            )}
          </section>

          <section className="psi-panel psi-c6">
            <h2>Top organs</h2>
            <Bars items={data.organs} />
          </section>

          <section className="psi-panel psi-c6">
            <h2>Most active accounts</h2>
            <p className="psi-note">
              Signed-in activity is <strong>{data.accounts.loggedInShare}%</strong> of all opens.
            </p>
            <div className="psi-scroll">
              <table>
                <thead><tr><th /><th>Account</th><th className="num">Opens</th></tr></thead>
                <tbody>
                  {data.accounts.top.map((a, i) => (
                    <tr key={a.who}>
                      <td className="rank">{i + 1}</td>
                      <td>{a.who}</td>
                      <td className="num">{fmt(a.n)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

        </div>

        <div className="psi-foot">
          Source: search-logs.txt · {fmt(o.clicks)} result opens · signup-modal events excluded from
          search figures · generated {new Date(data.generatedAt).toLocaleString('en-GB')}
        </div>
      </div>
    </div>
  );
}
