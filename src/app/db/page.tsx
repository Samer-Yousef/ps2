'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';

interface DbEntry {
  timestamp: string;
  event: string;
  detail: string;
  visitorId: string;
}

interface DbStats {
  totalStarts: number;
  totalCompleted: number;
  totalAbandoned: number;
  loadTimeMean: number;
  loadTimeMedian: number;
  secondsMean: number;
  secondsMedian: number;
}

export default function DbPage() {
  const { data: session, status } = useSession();
  const [entries, setEntries] = useState<DbEntry[]>([]);
  const [stats, setStats] = useState<DbStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);

  const fetchData = async () => {
    const res = await fetch('/api/db-stats');
    if (res.status === 401) {
      setUnauthorized(true);
      setLoading(false);
      return;
    }
    const data = await res.json();
    setEntries(data.entries || []);
    setStats(data.stats);
    setLoading(false);
  };

  useEffect(() => {
    if (status !== 'loading') fetchData();
  }, [status]);

  if (status === 'loading' || loading) return <div style={{ padding: '2rem', fontFamily: 'system-ui' }}>Loading...</div>;
  if (unauthorized) return <div style={{ padding: '2rem', fontFamily: 'system-ui' }}>Unauthorized</div>;

  const formatTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  };

  const eventColor = (event: string) => {
    if (event === 'DB_START') return '#2563eb';
    if (event === 'DB_LOADING') return '#d97706';
    if (event === 'DB_LOAD') return '#16a34a';
    return '#666';
  };

  return (
    <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>
      <nav style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', fontSize: '0.875rem' }}>
        <Link href="/stats" style={{ color: '#2563eb', textDecoration: 'none' }}>Search Logs</Link>
        <Link href="/db" style={{ color: '#999', textDecoration: 'none', pointerEvents: 'none' }}>DB Loads</Link>
        <Link href="/sqldb" style={{ color: '#2563eb', textDecoration: 'none' }}>Users</Link>
      </nav>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 600 }}>Database Load Logs</h1>
        <button
          onClick={() => { setLoading(true); fetchData(); }}
          style={{
            padding: '0.5rem 1rem',
            background: '#2563eb',
            color: 'white',
            border: 'none',
            borderRadius: '0.375rem',
            cursor: 'pointer',
            fontSize: '0.875rem',
          }}
        >
          Refresh
        </button>
      </div>

      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
          <div style={{ padding: '1rem', background: '#f0f9ff', borderRadius: '0.5rem', border: '1px solid #bae6fd' }}>
            <div style={{ fontSize: '0.75rem', color: '#666', marginBottom: '0.25rem' }}>Total Visits</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#000' }}>{stats.totalStarts}</div>
          </div>
          <div style={{ padding: '1rem', background: '#f0fdf4', borderRadius: '0.5rem', border: '1px solid #bbf7d0' }}>
            <div style={{ fontSize: '0.75rem', color: '#666', marginBottom: '0.25rem' }}>Completed Loads</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#000' }}>{stats.totalCompleted}</div>
          </div>
          <div style={{ padding: '1rem', background: '#fef2f2', borderRadius: '0.5rem', border: '1px solid #fecaca' }}>
            <div style={{ fontSize: '0.75rem', color: '#666', marginBottom: '0.25rem' }}>Abandoned</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#000' }}>{stats.totalAbandoned}</div>
          </div>
          <div style={{ padding: '1rem', background: '#fffbeb', borderRadius: '0.5rem', border: '1px solid #fde68a' }}>
            <div style={{ fontSize: '0.75rem', color: '#666', marginBottom: '0.25rem' }}>Mean Load Time</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#000' }}>{stats.loadTimeMean}ms</div>
          </div>
          <div style={{ padding: '1rem', background: '#fffbeb', borderRadius: '0.5rem', border: '1px solid #fde68a' }}>
            <div style={{ fontSize: '0.75rem', color: '#666', marginBottom: '0.25rem' }}>Median Load Time</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#000' }}>{stats.loadTimeMedian}ms</div>
          </div>
          <div style={{ padding: '1rem', background: '#faf5ff', borderRadius: '0.5rem', border: '1px solid #e9d5ff' }}>
            <div style={{ fontSize: '0.75rem', color: '#666', marginBottom: '0.25rem' }}>Mean Seconds</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#000' }}>{stats.secondsMean}s</div>
          </div>
          <div style={{ padding: '1rem', background: '#faf5ff', borderRadius: '0.5rem', border: '1px solid #e9d5ff' }}>
            <div style={{ fontSize: '0.75rem', color: '#666', marginBottom: '0.25rem' }}>Median Seconds</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#000' }}>{stats.secondsMedian}s</div>
          </div>
        </div>
      )}

      {loading ? (
        <p>Loading...</p>
      ) : entries.length === 0 ? (
        <p style={{ color: '#666' }}>No database logs yet.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
                <th style={{ padding: '0.5rem', whiteSpace: 'nowrap' }}>Time</th>
                <th style={{ padding: '0.5rem' }}>Event</th>
                <th style={{ padding: '0.5rem' }}>Detail</th>
                <th style={{ padding: '0.5rem' }}>Visitor ID</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '0.5rem', whiteSpace: 'nowrap', color: '#666' }}>{formatTime(e.timestamp)}</td>
                  <td style={{ padding: '0.5rem', fontWeight: 600, color: eventColor(e.event) }}>{e.event}</td>
                  <td style={{ padding: '0.5rem' }}>{e.detail}</td>
                  <td style={{ padding: '0.5rem', fontSize: '0.7rem', color: '#999' }}>{e.visitorId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
