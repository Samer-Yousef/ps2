'use client';

// Three signup-prompt variants for /v2, replacing the single shared SignupModal.
// Each SHOWN/DISMISSED/SIGNUP_* log row carries the variant key, so conversion per
// variant is measurable straight from search-logs.txt:
//   grep "MODAL" search-logs.txt | cut -f3,4   (event, "a|b|c[:detail]")
//
//   a — "your session": loss aversion, shows the actual slides viewed this session
//   b — "forgetting curve": retention angle, one-line copy + reviewed-vs-one-pass chart
//   c — "corner card":  non-blocking slide-in, one-click Google, page stays usable
//
// Preview any of them with  /v2?modal=a  (b, c) — preview impressions log as
// "preview-a" etc. so they never pollute the live conversion numbers.

import { useEffect, useState } from 'react';
import { signIn } from 'next-auth/react';
import { getVisitorId } from '@/lib/analytics';

export type ModalVariant = 'a' | 'b' | 'c';

// stable per-visitor assignment so one person always sees the same variant
export function pickVariant(visitorId: string): ModalVariant {
  let h = 0;
  for (let i = 0; i < visitorId.length; i++) h = (h * 31 + visitorId.charCodeAt(i)) >>> 0;
  return (['a', 'b', 'c'] as const)[h % 3];
}

function logModal(event: string, detail: string = '') {
  fetch('/api/log-search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'MODAL', diagnosis: event, resultPosition: detail, visitorId: getVisitorId(), page: 'v2' }),
  }).catch(() => {});
}

/* ---------- shared signup mechanics (same endpoints as the original modal) ---------- */
function useSignup(tag: string, onClose: () => void, preview: boolean) {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => { logModal('SHOWN', tag); }, [tag]);

  const dismiss = (method: string) => { logModal('DISMISSED', `${tag}:${method}`); onClose(); };

  const google = () => {
    logModal('SIGNUP_GOOGLE', tag);
    if (preview) { setSuccess(true); return; }
    signIn('google', { callbackUrl: '/' });
  };

  const submit = async (name: string, email: string, pw: string, cpw: string) => {
    setError('');
    if (pw !== cpw) { setError('Passwords do not match'); return; }
    if (pw.length < 6) { setError('Password must be at least 6 characters'); return; }
    setLoading(true);
    if (preview) { logModal('SIGNUP_EMAIL', tag); setTimeout(() => { setSuccess(true); setLoading(false); }, 500); return; }
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password: pw }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to create account'); setLoading(false); return; }
      logModal('SIGNUP_EMAIL', tag);
      const r = await signIn('credentials', { email, password: pw, redirect: false });
      if (r?.error) { setError('Account created but sign-in failed. Try logging in.'); setLoading(false); }
      else { setSuccess(true); setLoading(false); setTimeout(() => { onClose(); window.location.reload(); }, 1000); }
    } catch { setError('An error occurred. Please try again.'); setLoading(false); }
  };

  return { error, loading, success, dismiss, google, submit };
}

/* ---------- shared pieces ---------- */
function GoogleButton({ onClick, disabled, label = 'Continue with Google' }: { onClick: () => void; disabled?: boolean; label?: string }) {
  return (
    <button type="button" className="psv2m-goog" onClick={onClick} disabled={disabled}>
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
      </svg>
      {label}
    </button>
  );
}

function EmailForm({ hook }: { hook: ReturnType<typeof useSignup> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [cpw, setCpw] = useState('');
  if (!open) {
    return <button type="button" className="psv2m-alt" onClick={() => setOpen(true)}>or sign up with email</button>;
  }
  return (
    <form className="psv2m-form" onSubmit={(e) => { e.preventDefault(); hook.submit(name, email, pw, cpw); }}>
      <input type="text" placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} disabled={hook.loading} />
      <input type="email" placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} required disabled={hook.loading} />
      <input type="password" placeholder="Password (min 6 characters)" value={pw} onChange={(e) => setPw(e.target.value)} required disabled={hook.loading} />
      <input type="password" placeholder="Confirm password" value={cpw} onChange={(e) => setCpw(e.target.value)} required disabled={hook.loading} />
      <button type="submit" className="psv2m-cta" disabled={hook.loading}>{hook.loading ? 'Creating…' : 'Create account'}</button>
    </form>
  );
}

function Success({ preview }: { preview: boolean }) {
  return (
    <div className="psv2m-success">
      <div className="tick">✓</div>
      <h3>{preview ? 'Preview: would have created the account' : 'Account created!'}</h3>
      <p>{preview ? 'No changes made' : "You're now signed in"}</p>
    </div>
  );
}

function XButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="psv2m-x" onClick={onClick} aria-label="Close">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
        <line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" />
      </svg>
    </button>
  );
}

/* ---------- variant A: your session (loss aversion, personalised) ---------- */
function VariantA({ onClose, preview, viewedTitles }: { onClose: () => void; preview: boolean; viewedTitles: string[] }) {
  const hook = useSignup(preview ? 'preview-a' : 'a', onClose, preview);
  const titles = viewedTitles.slice(-5).reverse();
  return (
    <div className="psv2m-ovl" onClick={(e) => { if (e.target === e.currentTarget) hook.dismiss('backdrop'); }}>
      <div className="psv2m-card">
        <XButton onClick={() => hook.dismiss('x_button')} />
        {hook.success ? <Success preview={preview} /> : (
          <>
            <h3 className="psv2m-h">Your session so far</h3>
            <div className="psv2m-slides">
              {(titles.length ? titles : ['Kikuchi lymphadenitis', 'Sclerosing adenosis', 'Nodular fasciitis']).map((t, i) => (
                <div key={i} className="psv2m-slide"><span className="dot" />{t}</div>
              ))}
            </div>
            <p className="psv2m-sub">
              These disappear when you close the tab. With a free account every slide you review is
              kept in your history, and the good ones go in your favorites: your own study set,
              built as you browse.
            </p>
            {hook.error && <div className="psv2m-err">{hook.error}</div>}
            <GoogleButton onClick={hook.google} disabled={hook.loading} label="Keep my history with Google" />
            <EmailForm hook={hook} />
          </>
        )}
      </div>
    </div>
  );
}

/* ---------- variant B: retention (the forgetting curve) ---------- */
function VariantB({ onClose, preview }: { onClose: () => void; preview: boolean; sessionCount?: number }) {
  const hook = useSignup(preview ? 'preview-b' : 'b', onClose, preview);
  return (
    <div className="psv2m-ovl" onClick={(e) => { if (e.target === e.currentTarget) hook.dismiss('backdrop'); }}>
      <div className="psv2m-card">
        <XButton onClick={() => hook.dismiss('x_button')} />
        {hook.success ? <Success preview={preview} /> : (
          <>
            <h3 className="psv2m-h">Will you remember these in three months?</h3>
            <div className="psv2m-curve" aria-hidden="true">
              <svg viewBox="0 0 340 100" preserveAspectRatio="none">
                {/* one pass: exponential fade (stops short so its label sits clear) */}
                <path className="fade" d="M10 14 C 60 62, 120 78, 288 87" />
                {/* with review: same decay, reset upward at each revisit */}
                <path className="keep" d="M10 14 C 40 40, 65 52, 88 58 L 88 26
                                          C 118 40, 145 48, 168 52 L 168 24
                                          C 200 36, 230 42, 252 44 L 252 22
                                          C 285 30, 312 33, 330 34" />
              </svg>
              <div className="lbl fade-l">one pass</div>
              <div className="lbl keep-l">reviewed</div>
            </div>
            <p className="psv2m-sub">
              A slide seen once fades in days: your history and favorites bring it back until it sticks.
            </p>
            {hook.error && <div className="psv2m-err">{hook.error}</div>}
            <GoogleButton onClick={hook.google} disabled={hook.loading} label="Build my review set with Google" />
            <EmailForm hook={hook} />
          </>
        )}
      </div>
    </div>
  );
}

/* ---------- variant C: corner card (non-blocking, one decision) ---------- */
function VariantC({ onClose, preview, sessionCount }: { onClose: () => void; preview: boolean; sessionCount: number }) {
  const hook = useSignup(preview ? 'preview-c' : 'c', onClose, preview);
  return (
    <div className="psv2m-corner">
      <XButton onClick={() => hook.dismiss('x_button')} />
      {hook.success ? <Success preview={preview} /> : (
        <>
          <h4 className="psv2m-ch">{sessionCount > 1 ? `${sessionCount} slides viewed. Keep them?` : 'Nice slide. Keep it?'}</h4>
          <p className="psv2m-csub">Free account: history, favorites, and your progress on any device.</p>
          {hook.error && <div className="psv2m-err">{hook.error}</div>}
          <GoogleButton onClick={hook.google} disabled={hook.loading} />
          <a className="psv2m-alt" href="/register">or sign up with email →</a>
        </>
      )}
    </div>
  );
}

export function SignupVariant({ variant, onClose, preview = false, viewedTitles = [], sessionCount = 0 }: {
  variant: ModalVariant;
  onClose: () => void;
  preview?: boolean;
  viewedTitles?: string[];
  sessionCount?: number;
}) {
  if (variant === 'a') return <VariantA onClose={onClose} preview={preview} viewedTitles={viewedTitles} />;
  if (variant === 'b') return <VariantB onClose={onClose} preview={preview} sessionCount={sessionCount} />;
  return <VariantC onClose={onClose} preview={preview} sessionCount={sessionCount} />;
}
