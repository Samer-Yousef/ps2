'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';

interface LogEntry {
  timestamp: string;
  query: string;
  diagnosis: string;
  resultPosition: string;
  organ: string;
  system: string;
  source: string;
  similarityScore: string;
  totalResults: string;
  userEmail: string;
  userName: string;
  visitorId: string;
}

interface VisitorStats {
  lifetime: number;
  last3Months: number;
  lastMonth: number;
  lastWeek: number;
  last24h: number;
  today: number;
}

interface DailyData {
  date: string;
  searches: number;
  clicks: number;
  uniqueVisitors: number;
  newSignups: number;
  totalUsers: number;
}

interface GrowthStats {
  visitorWeeklyAvg: number;
  visitorMonthlyAvg: number;
  visitorTrend: number;
  clickWeeklyAvg: number;
  clickMonthlyAvg: number;
  clickTrend: number;
  weekOverWeekGrowth: number;
  avgClicksPerVisitor: number;
  avgSessionsPerVisitor: number;
  returnRate: number;
  returnVisitorCount: number;
  avgReturnEarly: number;
  avgReturnRecent: number;
  returnEngagementTrend: number;
  totalUsers: number;
  signupsLastWeek: number;
  signupsLastMonth: number;
  signupWeeklyAvg: number;
  signupMonthlyAvg: number;
  modalShown: number;
  modalDismissed: number;
  modalSignups: number;
  modalSignupEmail: number;
  modalSignupGoogle: number;
  modalConversionRate: number;
}

const PAGE_SIZE = 1000;

// --- Chart component ---
function LineChart({ data, series, height = 220, title }: {
  data: DailyData[];
  series: { key: string; color: string; label: string; getValue: (d: DailyData) => number }[];
  height?: number;
  title: string;
}) {
  if (data.length === 0) return null;

  const W = 900;
  const H = height;
  const padL = 45;
  const padR = 10;
  const padT = 25;
  const padB = 50;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;

  const maxVal = Math.max(1, ...data.flatMap(d => series.map(s => s.getValue(d))));
  const yTicks = 5;

  const x = (i: number) => padL + (data.length === 1 ? chartW / 2 : (i / (data.length - 1)) * chartW);
  const y = (v: number) => padT + chartH - (v / maxVal) * chartH;

  const labelInterval = Math.max(1, Math.floor(data.length / 8));

  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <h2 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.5rem', color: '#374151' }}>{title}</h2>
      <div style={{ background: '#fafafa', borderRadius: '0.5rem', border: '1px solid #e5e7eb', padding: '0.75rem' }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: W, height: 'auto', display: 'block' }}>
          {Array.from({ length: yTicks + 1 }, (_, i) => {
            const val = Math.round((maxVal / yTicks) * i);
            const yPos = y(val);
            return (
              <g key={i}>
                <line x1={padL} y1={yPos} x2={W - padR} y2={yPos} stroke="#eee" strokeWidth="1" />
                <text x={padL - 5} y={yPos + 3} textAnchor="end" fontSize="9" fill="#999">{val}</text>
              </g>
            );
          })}

          {series.map(s => {
            const points = data.map((d, i) => `${x(i)},${y(s.getValue(d))}`).join(' ');
            return <polyline key={s.key} points={points} fill="none" stroke={s.color} strokeWidth="2" />;
          })}

          {data.map((d, i) => (
            <g key={i}>
              {series.map(s => (
                <circle key={s.key} cx={x(i)} cy={y(s.getValue(d))} r="2" fill={s.color} />
              ))}
            </g>
          ))}

          {data.map((d, i) => {
            if (i % labelInterval !== 0 && i !== data.length - 1) return null;
            const label = d.date.slice(5);
            return (
              <text key={i} x={x(i)} y={H - 10} textAnchor="middle" fontSize="9" fill="#999" transform={`rotate(-30, ${x(i)}, ${H - 10})`}>
                {label}
              </text>
            );
          })}

          <g transform={`translate(${padL + 10}, ${padT + 5})`}>
            {series.map((s, i) => (
              <g key={s.key} transform={`translate(${i * 120}, 0)`}>
                <rect x="0" y="0" width="8" height="8" fill={s.color} />
                <text x="12" y="8" fontSize="9" fill="#666">{s.label}</text>
              </g>
            ))}
          </g>
        </svg>
      </div>
    </div>
  );
}

// --- Stat box ---
function StatBox({ label, value, desc, bg, border }: {
  label: string; value: string | number; desc: string; bg: string; border: string;
}) {
  return (
    <div style={{ padding: '0.5rem 0.75rem', background: bg, borderRadius: '0.375rem', border: `1px solid ${border}`, minWidth: '140px' }}>
      <div style={{ fontSize: '0.6rem', color: '#666' }}>{label}</div>
      <div style={{ fontSize: '1rem', fontWeight: 700, color: '#000' }}>{value}</div>
      <div style={{ fontSize: '0.55rem', color: '#999', marginTop: '0.15rem' }}>{desc}</div>
    </div>
  );
}

function trendStr(n: number): string {
  return `${n > 0 ? '+' : ''}${n}%`;
}

function trendColor(n: number): { bg: string; border: string } {
  return n >= 0
    ? { bg: '#f0fdf4', border: '#bbf7d0' }
    : { bg: '#fef2f2', border: '#fecaca' };
}

export default function StatsPage() {
  const { status } = useSession();
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [visitorStats, setVisitorStats] = useState<VisitorStats | null>(null);
  const [dailyData, setDailyData] = useState<DailyData[]>([]);
  const [growthStats, setGrowthStats] = useState<GrowthStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);
  const [page, setPage] = useState(0);

  const fetchData = async () => {
    const res = await fetch('/api/stats');
    if (res.status === 401) {
      setUnauthorized(true);
      setLoading(false);
      return;
    }
    const data = await res.json();
    setEntries(data.entries || []);
    setVisitorStats(data.visitorStats || null);
    setDailyData(data.dailyData || []);
    setGrowthStats(data.growthStats || null);
    setPage(0);
    setLoading(false);
  };

  useEffect(() => {
    if (status !== 'loading') fetchData();
  }, [status]);

  if (status === 'loading' || loading) return <div style={{ padding: '2rem', fontFamily: 'system-ui' }}>Loading...</div>;
  if (unauthorized) return <div style={{ padding: '2rem', fontFamily: 'system-ui' }}>Unauthorized</div>;

  const totalPages = Math.ceil(entries.length / PAGE_SIZE);
  const pageEntries = entries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const formatTime = (iso: string) => {
    try { return new Date(iso).toLocaleString(); } catch { return iso; }
  };
  const formatScore = (score: string) => {
    if (!score) return '';
    const n = parseFloat(score);
    return isNaN(n) ? score : (n * 100).toFixed(1) + '%';
  };

  const p = '0.2rem 0.4rem';
  const g = growthStats;

  return (
    <div style={{ padding: '1rem 2rem', maxWidth: '1400px', margin: '0 auto', fontFamily: 'system-ui, sans-serif', fontSize: '0.75rem' }}>
      <nav style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', fontSize: '0.875rem' }}>
        <Link href="/stats" style={{ color: '#999', textDecoration: 'none', pointerEvents: 'none' }}>Search Logs</Link>
        <Link href="/db" style={{ color: '#2563eb', textDecoration: 'none' }}>DB Loads</Link>
        <Link href="/sqldb" style={{ color: '#2563eb', textDecoration: 'none' }}>Users</Link>
      </nav>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Dashboard</h1>
        <button
          onClick={() => { setLoading(true); fetchData(); }}
          style={{ padding: '0.35rem 0.75rem', background: '#2563eb', color: 'white', border: 'none', borderRadius: '0.375rem', cursor: 'pointer', fontSize: '0.75rem' }}
        >
          Refresh
        </button>
      </div>

      {/* Unique Visitors */}
      {visitorStats && (
        <div style={{ marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.5rem', color: '#374151' }}>Unique Visitors (by visitor ID)</h2>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {[
              { label: 'Lifetime', value: visitorStats.lifetime, bg: '#f0f9ff', border: '#bae6fd' },
              { label: 'Last 3 Months', value: visitorStats.last3Months, bg: '#f0fdf4', border: '#bbf7d0' },
              { label: 'Last Month', value: visitorStats.lastMonth, bg: '#f0fdf4', border: '#bbf7d0' },
              { label: 'Last Week', value: visitorStats.lastWeek, bg: '#fffbeb', border: '#fde68a' },
              { label: 'Last 24h', value: visitorStats.last24h, bg: '#faf5ff', border: '#e9d5ff' },
              { label: 'Today', value: visitorStats.today, bg: '#fef2f2', border: '#fecaca' },
            ].map((s, i) => (
              <div key={i} style={{ padding: '0.5rem 0.75rem', background: s.bg, borderRadius: '0.375rem', border: `1px solid ${s.border}` }}>
                <div style={{ fontSize: '0.6rem', color: '#666' }}>{s.label}</div>
                <div style={{ fontSize: '1rem', fontWeight: 700, color: '#000' }}>{s.value}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Growth & Engagement Stats */}
      {g && (
        <div style={{ marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.5rem', color: '#374151' }}>Growth & Engagement</h2>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <StatBox label="Visitor 7d Avg" value={g.visitorWeeklyAvg} desc="Avg unique visitors/day over last 7 days" bg="#f0f9ff" border="#bae6fd" />
            <StatBox label="Visitor 30d Avg" value={g.visitorMonthlyAvg} desc="Avg unique visitors/day over last 30 days" bg="#f0f9ff" border="#bae6fd" />
            <StatBox label="Visitor Trend" value={trendStr(g.visitorTrend)} desc="7d avg vs 30d avg — is daily traffic rising or falling?" {...trendColor(g.visitorTrend)} />
            <StatBox label="Clicks 7d Avg" value={g.clickWeeklyAvg} desc="Avg slide clicks/day over last 7 days" bg="#fffbeb" border="#fde68a" />
            <StatBox label="Clicks 30d Avg" value={g.clickMonthlyAvg} desc="Avg slide clicks/day over last 30 days" bg="#fffbeb" border="#fde68a" />
            <StatBox label="Clicks Trend" value={trendStr(g.clickTrend)} desc="7d avg vs 30d avg — are users clicking more?" {...trendColor(g.clickTrend)} />
            <StatBox label="WoW Growth" value={trendStr(g.weekOverWeekGrowth)} desc="This week vs last week unique visitors" {...trendColor(g.weekOverWeekGrowth)} />
            <StatBox label="Clicks/Visitor" value={g.avgClicksPerVisitor} desc="Avg slides clicked per unique visitor (lifetime)" bg="#faf5ff" border="#e9d5ff" />
            <StatBox label="Sessions/Visitor" value={g.avgSessionsPerVisitor} desc="Avg visits per unique visitor — higher = more return visits" bg="#faf5ff" border="#e9d5ff" />
            <StatBox label={`Return Rate (${g.returnVisitorCount})`} value={`${g.returnRate}%`} desc="% of visitors who came back more than once" bg="#f0fdf4" border="#bbf7d0" />
            <StatBox label="Return Clicks (Early)" value={g.avgReturnEarly} desc="Avg clicks per return user in first half of data" bg="#fff7ed" border="#fed7aa" />
            <StatBox label="Return Clicks (Recent)" value={g.avgReturnRecent} desc="Avg clicks per return user in second half of data" bg="#fff7ed" border="#fed7aa" />
            <StatBox label="Return Engagement" value={trendStr(g.returnEngagementTrend)} desc="Are return users clicking more or less over time?" {...trendColor(g.returnEngagementTrend)} />
          </div>
        </div>
      )}

      {/* Signups */}
      {g && (
        <div style={{ marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.5rem', color: '#374151' }}>User Signups</h2>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <StatBox label="Total Users" value={g.totalUsers} desc="All registered accounts" bg="#f0f9ff" border="#bae6fd" />
            <StatBox label="Last Week" value={g.signupsLastWeek} desc="New signups in the past 7 days" bg="#f0fdf4" border="#bbf7d0" />
            <StatBox label="Last Month" value={g.signupsLastMonth} desc="New signups in the past 30 days" bg="#f0fdf4" border="#bbf7d0" />
            <StatBox label="Signup 7d Avg" value={g.signupWeeklyAvg} desc="Avg new signups/day over last 7 days" bg="#fffbeb" border="#fde68a" />
            <StatBox label="Signup 30d Avg" value={g.signupMonthlyAvg} desc="Avg new signups/day over last 30 days" bg="#fffbeb" border="#fde68a" />
          </div>
        </div>
      )}

      {/* Signup Modal Conversion */}
      {g && g.modalShown > 0 && (
        <div style={{ marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.5rem', color: '#374151' }}>Signup Modal Conversion</h2>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <StatBox label="Times Shown" value={g.modalShown} desc="Total times the signup modal was presented" bg="#f0f9ff" border="#bae6fd" />
            <StatBox label="Dismissed" value={g.modalDismissed} desc="Closed via X button or clicking outside" bg="#fef2f2" border="#fecaca" />
            <StatBox label="Signups" value={g.modalSignups} desc="Users who signed up from the modal" bg="#f0fdf4" border="#bbf7d0" />
            <StatBox label="Via Google" value={g.modalSignupGoogle} desc="Signed up with Google from modal" bg="#f0fdf4" border="#bbf7d0" />
            <StatBox label="Via Email" value={g.modalSignupEmail} desc="Signed up with email from modal" bg="#f0fdf4" border="#bbf7d0" />
            <StatBox label="Conversion Rate" value={`${g.modalConversionRate}%`} desc="% of modal views that led to a signup" bg={g.modalConversionRate >= 10 ? '#f0fdf4' : '#fffbeb'} border={g.modalConversionRate >= 10 ? '#bbf7d0' : '#fde68a'} />
          </div>
        </div>
      )}

      {/* Chart 1: Daily Activity */}
      <LineChart
        data={dailyData}
        title="Daily Activity (Visitors, Searches, Clicks)"
        series={[
          { key: 'visitors', color: '#16a34a', label: 'Unique Visitors', getValue: d => d.uniqueVisitors },
          { key: 'searches', color: '#2563eb', label: 'Unique Searches', getValue: d => d.searches },
          { key: 'clicks', color: '#ef4444', label: 'Slide Clicks', getValue: d => d.clicks },
        ]}
      />

      {/* Chart 2: User Growth */}
      <LineChart
        data={dailyData}
        title="Cumulative Users & Daily Signups"
        series={[
          { key: 'totalUsers', color: '#2563eb', label: 'Total Users', getValue: d => d.totalUsers },
          { key: 'signups', color: '#16a34a', label: 'New Signups', getValue: d => d.newSignups },
        ]}
      />

      {/* Chart 3: Engagement Depth (clicks per visitor per day) */}
      <LineChart
        data={dailyData.map(d => ({ ...d, clicksPerVisitor: d.uniqueVisitors > 0 ? Math.round((d.clicks / d.uniqueVisitors) * 10) / 10 : 0 }))}
        title="Engagement Depth (Clicks per Visitor per Day)"
        series={[
          { key: 'cpv', color: '#8b5cf6', label: 'Clicks/Visitor', getValue: (d: any) => d.clicksPerVisitor },
        ]}
        height={180}
      />

      {/* Log Table */}
      <h2 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.5rem', marginTop: '1rem', color: '#374151' }}>
        Search Logs <span style={{ fontWeight: 400, color: '#999' }}>({entries.length} entries)</span>
      </h2>

      {entries.length === 0 ? (
        <p style={{ color: '#666' }}>No search logs yet.</p>
      ) : (
        <>
          {totalPages > 1 && (
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                style={{ padding: '0.25rem 0.5rem', border: '1px solid #ddd', borderRadius: '0.25rem', cursor: page === 0 ? 'default' : 'pointer', opacity: page === 0 ? 0.4 : 1, background: 'white' }}>
                Prev
              </button>
              <span style={{ color: '#666' }}>Page {page + 1} of {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page === totalPages - 1}
                style={{ padding: '0.25rem 0.5rem', border: '1px solid #ddd', borderRadius: '0.25rem', cursor: page === totalPages - 1 ? 'default' : 'pointer', opacity: page === totalPages - 1 ? 0.4 : 1, background: 'white' }}>
                Next
              </button>
              <span style={{ color: '#999' }}>({page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, entries.length)})</span>
            </div>
          )}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
                  <th style={{ padding: p, whiteSpace: 'nowrap' }}>Time</th>
                  <th style={{ padding: p }}>User</th>
                  <th style={{ padding: p }}>Query</th>
                  <th style={{ padding: p }}>Diagnosis</th>
                  <th style={{ padding: p }}>Pos</th>
                  <th style={{ padding: p }}>Organ</th>
                  <th style={{ padding: p }}>System</th>
                  <th style={{ padding: p }}>Source</th>
                  <th style={{ padding: p }}>Score</th>
                  <th style={{ padding: p }}>Visitor ID</th>
                </tr>
              </thead>
              <tbody>
                {pageEntries.map((e, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: p, whiteSpace: 'nowrap', color: '#666' }}>{formatTime(e.timestamp)}</td>
                    <td style={{ padding: p, whiteSpace: 'nowrap' }}>
                      {e.userEmail === 'anonymous' ? (
                        <span style={{ color: '#999', fontStyle: 'italic' }}>anon</span>
                      ) : (
                        <span title={e.userEmail}>{e.userName || e.userEmail}</span>
                      )}
                    </td>
                    <td style={{ padding: p, fontWeight: 500 }}>{e.query}</td>
                    <td style={{ padding: p }}>{e.diagnosis}</td>
                    <td style={{ padding: p, textAlign: 'center' }}>{e.resultPosition}</td>
                    <td style={{ padding: p }}>{e.organ}</td>
                    <td style={{ padding: p }}>{e.system}</td>
                    <td style={{ padding: p }}>{e.source}</td>
                    <td style={{ padding: p, whiteSpace: 'nowrap' }}>{formatScore(e.similarityScore)}</td>
                    <td style={{ padding: p, fontSize: '0.65rem', color: '#999' }}>{e.visitorId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.5rem' }}>
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                style={{ padding: '0.25rem 0.5rem', border: '1px solid #ddd', borderRadius: '0.25rem', cursor: page === 0 ? 'default' : 'pointer', opacity: page === 0 ? 0.4 : 1, background: 'white' }}>
                Prev
              </button>
              <span style={{ color: '#666' }}>Page {page + 1} of {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page === totalPages - 1}
                style={{ padding: '0.25rem 0.5rem', border: '1px solid #ddd', borderRadius: '0.25rem', cursor: page === totalPages - 1 ? 'default' : 'pointer', opacity: page === totalPages - 1 ? 0.4 : 1, background: 'white' }}>
                Next
              </button>
              <span style={{ color: '#999' }}>({page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, entries.length)})</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
