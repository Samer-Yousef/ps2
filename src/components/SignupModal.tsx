'use client';

import { useState, useEffect } from 'react';
import { signIn } from 'next-auth/react';
import { getVisitorId } from '@/lib/analytics';

interface SignupModalProps {
  onClose: () => void;
  testMode?: boolean;
}

function logModal(event: string, detail: string = '') {
  fetch('/api/log-search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: 'MODAL',
      diagnosis: event,
      resultPosition: detail,
      visitorId: getVisitorId(),
    }),
  }).catch(() => {});
}

export function SignupModal({ onClose, testMode = false }: SignupModalProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  // Log modal shown on mount
  useEffect(() => {
    logModal('SHOWN', testMode ? 'test' : 'live');
  }, [testMode]);

  const handleDismiss = (method: string) => {
    logModal('DISMISSED', method);
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setLoading(true);

    if (testMode) {
      logModal('SIGNUP_EMAIL', 'test');
      setTimeout(() => {
        setSuccess(true);
        setLoading(false);
      }, 500);
      return;
    }

    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Failed to create account');
        setLoading(false);
        return;
      }

      logModal('SIGNUP_EMAIL', email);

      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        setError('Account created but failed to sign in. Please try logging in.');
        setLoading(false);
      } else {
        setSuccess(true);
        setLoading(false);
        setTimeout(() => {
          onClose();
          window.location.reload();
        }, 1000);
      }
    } catch {
      setError('An error occurred. Please try again.');
      setLoading(false);
    }
  };

  const handleGoogleSignup = () => {
    if (testMode) {
      logModal('SIGNUP_GOOGLE', 'test');
      setSuccess(true);
      return;
    }
    logModal('SIGNUP_GOOGLE', 'live');
    signIn('google', { callbackUrl: '/' });
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) handleDismiss('backdrop'); }}
    >
      <div
        style={{
          background: 'white', borderRadius: '0.75rem', padding: '1.5rem',
          width: '100%', maxWidth: '460px', margin: '1rem',
          boxShadow: '0 25px 50px rgba(0,0,0,0.25)',
          position: 'relative',
        }}
      >
        {/* Close button */}
        <button
          onClick={() => handleDismiss('x_button')}
          style={{
            position: 'absolute', top: '0.75rem', right: '0.75rem',
            background: '#f3f4f6', border: 'none',
            cursor: 'pointer', color: '#666',
            width: '2.5rem', height: '2.5rem', borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 0,
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="6" y1="6" x2="18" y2="18" />
            <line x1="18" y1="6" x2="6" y2="18" />
          </svg>
        </button>

        {success ? (
          <div style={{ textAlign: 'center', padding: '1rem 0' }}>
            <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>&#10003;</div>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.25rem' }}>
              {testMode ? 'Test: Would have created account' : 'Account created!'}
            </h3>
            <p style={{ fontSize: '0.8rem', color: '#666' }}>
              {testMode ? 'No changes made (test mode)' : 'You\'re now signed in'}
            </p>
          </div>
        ) : (
          <>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.5rem', paddingRight: '2rem', color: '#111' }}>
              You&apos;re on a roll — don&apos;t lose your progress
            </h3>
            <div style={{ fontSize: '0.8rem', color: '#444', marginBottom: '1rem', lineHeight: 1.5 }}>
              <div style={{ marginBottom: '0.35rem' }}>
                <span style={{ fontWeight: 600 }}>Save slides to your favorites</span> — build your own study collection
              </div>
              <div style={{ marginBottom: '0.35rem' }}>
                <span style={{ fontWeight: 600 }}>Review slides in your history</span> — repetition is the key to learning
              </div>
              <div>
                <span style={{ fontWeight: 600 }}>Pick up where you left off</span> — your progress follows you across devices
              </div>
            </div>

            {testMode && (
              <div style={{
                background: '#fef3c7', border: '1px solid #fde68a', borderRadius: '0.375rem',
                padding: '0.4rem 0.6rem', marginBottom: '0.75rem', fontSize: '0.7rem', color: '#92400e',
              }}>
                Test mode — no accounts will be created
              </div>
            )}

            {error && (
              <div style={{
                background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '0.375rem',
                padding: '0.4rem 0.6rem', marginBottom: '0.75rem', fontSize: '0.75rem', color: '#dc2626',
              }}>
                {error}
              </div>
            )}

            {/* Google button first — easiest path */}
            <button
              type="button"
              onClick={handleGoogleSignup}
              disabled={loading}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                gap: '0.5rem', padding: '0.6rem', border: '1px solid #ddd', borderRadius: '0.375rem',
                background: 'white', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 500,
                marginBottom: '0.75rem', opacity: loading ? 0.5 : 1,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Sign up with Google
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <div style={{ flex: 1, height: '1px', background: '#e5e7eb' }} />
              <span style={{ fontSize: '0.7rem', color: '#999' }}>or with email</span>
              <div style={{ flex: 1, height: '1px', background: '#e5e7eb' }} />
            </div>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <input
                type="text"
                placeholder="Name (optional)"
                value={name}
                onChange={e => setName(e.target.value)}
                disabled={loading}
                style={{
                  width: '100%', padding: '0.5rem 0.6rem', border: '1px solid #ddd',
                  borderRadius: '0.375rem', fontSize: '0.8rem', outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              <input
                type="email"
                placeholder="Email address"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                disabled={loading}
                style={{
                  width: '100%', padding: '0.5rem 0.6rem', border: '1px solid #ddd',
                  borderRadius: '0.375rem', fontSize: '0.8rem', outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              <input
                type="password"
                placeholder="Password (min 6 characters)"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                disabled={loading}
                style={{
                  width: '100%', padding: '0.5rem 0.6rem', border: '1px solid #ddd',
                  borderRadius: '0.375rem', fontSize: '0.8rem', outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              <input
                type="password"
                placeholder="Confirm password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                required
                disabled={loading}
                style={{
                  width: '100%', padding: '0.5rem 0.6rem', border: '1px solid #ddd',
                  borderRadius: '0.375rem', fontSize: '0.8rem', outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              <button
                type="submit"
                disabled={loading}
                style={{
                  width: '100%', padding: '0.6rem', background: '#2563eb', color: 'white',
                  border: 'none', borderRadius: '0.375rem', fontSize: '0.8rem', fontWeight: 500,
                  cursor: 'pointer', opacity: loading ? 0.5 : 1,
                }}
              >
                {loading ? 'Creating...' : 'Create account'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
