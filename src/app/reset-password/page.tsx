'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import Link from 'next/link';

const inputClass =
  'appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 dark:border-gray-700 placeholder-gray-500 dark:placeholder-gray-400 text-gray-900 dark:text-white dark:bg-gray-800 focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm min-h-[44px]';

function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') || '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // null = still checking, false = bad link, true = usable
  const [valid, setValid] = useState<boolean | null>(token ? null : false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetch(`/api/auth/reset-password?token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setValid(!!d.valid);
      })
      .catch(() => {
        if (!cancelled) setValid(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Something went wrong. Please try again.');
        return;
      }
      setDone(true);
      // Sign them straight in with the new password; fall back to the login page.
      const result = await signIn('credentials', { email: data.email, password, redirect: false });
      if (result?.error) {
        router.push('/login');
      } else {
        router.push('/');
        router.refresh();
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const heading = (
    <div>
      <h2 className="mt-6 text-center text-3xl font-bold text-gray-900 dark:text-white">
        Choose a new password
      </h2>
      <p className="mt-2 text-center text-sm text-gray-600 dark:text-gray-400">
        {valid === false ? 'This link can no longer be used' : 'At least 6 characters'}
      </p>
    </div>
  );

  if (valid === false) {
    return (
      <>
        {heading}
        <div className="mt-8 space-y-6">
          <div className="rounded-md bg-red-50 dark:bg-red-900/20 p-4">
            <p className="text-sm text-red-800 dark:text-red-400">
              This reset link is invalid, has expired, or was already used. Request a new one and try again.
            </p>
          </div>
          <Link
            href="/forgot-password"
            className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 min-h-[44px] items-center"
          >
            Request a new link
          </Link>
          <div className="text-center">
            <Link href="/login" className="text-sm text-blue-600 dark:text-blue-400 hover:underline">
              Back to sign in
            </Link>
          </div>
        </div>
      </>
    );
  }

  if (done) {
    return (
      <>
        {heading}
        <div className="mt-8 rounded-md bg-green-50 dark:bg-green-900/20 p-4">
          <p className="text-sm text-green-800 dark:text-green-400">Password updated. Signing you in...</p>
        </div>
      </>
    );
  }

  return (
    <>
      {heading}
      <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
        {error && (
          <div className="rounded-md bg-red-50 dark:bg-red-900/20 p-4">
            <p className="text-sm text-red-800 dark:text-red-400">{error}</p>
          </div>
        )}
        <div className="rounded-md shadow-sm -space-y-px">
          <div>
            <label htmlFor="password" className="sr-only">
              New password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={6}
              autoFocus
              className={`${inputClass} rounded-t-md`}
              placeholder="New password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading || valid === null}
            />
          </div>
          <div>
            <label htmlFor="confirm" className="sr-only">
              Confirm new password
            </label>
            <input
              id="confirm"
              name="confirm"
              type="password"
              autoComplete="new-password"
              required
              minLength={6}
              className={`${inputClass} rounded-b-md`}
              placeholder="Confirm new password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              disabled={loading || valid === null}
            />
          </div>
        </div>

        <div>
          <button
            type="submit"
            disabled={loading || valid === null}
            className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
          >
            {loading ? 'Saving...' : valid === null ? 'Checking link...' : 'Set new password'}
          </button>
        </div>

        <div className="text-center">
          <Link href="/login" className="text-sm text-blue-600 dark:text-blue-400 hover:underline">
            Back to sign in
          </Link>
        </div>
      </form>
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <Suspense fallback={null}>
          <ResetPasswordForm />
        </Suspense>
      </div>
    </div>
  );
}
