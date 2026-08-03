'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';

interface UserEntry {
  name: string;
  email: string;
  authMethod: string;
  history: number;
  favorites: number;
  createdAt: string;
}

export default function SqlDbPage() {
  const { status } = useSession();
  const [users, setUsers] = useState<UserEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);

  const fetchData = async () => {
    const res = await fetch('/api/sqldb');
    if (res.status === 401) {
      setUnauthorized(true);
      setLoading(false);
      return;
    }
    const data = await res.json();
    setUsers(data.users || []);
    setTotal(data.total || 0);
    setLoading(false);
  };

  useEffect(() => {
    if (status !== 'loading') fetchData();
  }, [status]);

  if (status === 'loading' || loading) return <div style={{ padding: '2rem', fontFamily: 'system-ui' }}>Loading...</div>;
  if (unauthorized) return <div style={{ padding: '2rem', fontFamily: 'system-ui' }}>Unauthorized</div>;

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString();
    } catch {
      return iso;
    }
  };

  return (
    <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>
      <nav style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', fontSize: '0.875rem' }}>
        <Link href="/stats" style={{ color: '#2563eb', textDecoration: 'none' }}>Search Logs</Link>
        <Link href="/db" style={{ color: '#2563eb', textDecoration: 'none' }}>DB Loads</Link>
        <Link href="/sqldb" style={{ color: '#999', textDecoration: 'none', pointerEvents: 'none' }}>Users</Link>
      </nav>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 600 }}>Users</h1>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <span style={{ color: '#666', fontSize: '0.875rem' }}>{total} users</span>
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
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
              <th style={{ padding: '0.5rem' }}>#</th>
              <th style={{ padding: '0.5rem' }}>Name</th>
              <th style={{ padding: '0.5rem' }}>Email</th>
              <th style={{ padding: '0.5rem' }}>Auth</th>
              <th style={{ padding: '0.5rem' }}>History</th>
              <th style={{ padding: '0.5rem' }}>Favorites</th>
              <th style={{ padding: '0.5rem' }}>Joined</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ padding: '0.5rem', color: '#999' }}>{i + 1}</td>
                <td style={{ padding: '0.5rem', fontWeight: 500 }}>{u.name || <span style={{ color: '#999', fontStyle: 'italic' }}>no name</span>}</td>
                <td style={{ padding: '0.5rem' }}>{u.email}</td>
                <td style={{ padding: '0.5rem' }}>{u.authMethod}</td>
                <td style={{ padding: '0.5rem', textAlign: 'center' }}>{u.history}</td>
                <td style={{ padding: '0.5rem', textAlign: 'center' }}>{u.favorites}</td>
                <td style={{ padding: '0.5rem', whiteSpace: 'nowrap', color: '#666' }}>{formatDate(u.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
