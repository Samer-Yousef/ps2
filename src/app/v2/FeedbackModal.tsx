'use client';

// Two-question pulse survey for RETURNING visitors only (people who had slide history
// before this session, i.e. they knew the old interface). Non-blocking corner card.
// Rows land in search-logs.txt as query=FEEDBACK:
//   SHOWN / DISMISSED / DESIGN new|old|unsure / UPLOAD yes|no
// and are excluded from all search metrics by the insights parser.

import { useEffect, useState } from 'react';
import { getVisitorId } from '@/lib/analytics';

function logFeedback(event: string, detail: string = '') {
  fetch('/api/log-search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'FEEDBACK', diagnosis: event, resultPosition: detail, visitorId: getVisitorId(), page: 'v2' }),
  }).catch(() => {});
}

export function FeedbackModal({ onClose }: { onClose: () => void }) {
  const [design, setDesign] = useState<string | null>(null);
  const [upload, setUpload] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => { logFeedback('SHOWN'); }, []);

  const dismiss = () => { logFeedback('DISMISSED'); onClose(); };

  const pickDesign = (v: string) => { if (design) return; setDesign(v); logFeedback('DESIGN', v); };
  const pickUpload = (v: string) => { if (upload) return; setUpload(v); logFeedback('UPLOAD', v); };

  // both answered -> brief thanks, then close on its own. Deliberately NOT keyed on
  // `done` or `onClose`: re-running the effect would clear the close timer it just set.
  useEffect(() => {
    if (!(design && upload)) return;
    setDone(true);
    const t = setTimeout(onClose, 1400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [design, upload]);

  return (
    <div className="psv2m-corner psv2f" role="dialog" aria-label="Quick feedback">
      <button className="psv2m-x" onClick={dismiss} aria-label="Close">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" />
        </svg>
      </button>

      {done ? (
        <div className="psv2f-thanks">Thanks, noted.</div>
      ) : (
        <>
          <h4 className="psv2m-ch">Two quick questions</h4>

          <div className="psv2f-q">The site got a redesign. Which do you prefer?</div>
          <div className="psv2f-opts">
            {[['new', 'New design'], ['old', 'The old one'], ['unsure', 'No opinion']].map(([v, label]) => (
              <button key={v} className={`psv2f-opt${design === v ? ' on' : ''}${design && design !== v ? ' dim' : ''}`}
                onClick={() => pickDesign(v)}>{label}</button>
            ))}
          </div>
          <a className="psv2f-peek" href="/old" target="_blank" rel="noreferrer">peek at the old site ↗</a>

          <div className="psv2f-q">If uploading slides were free, would you have slides to upload?</div>
          <div className="psv2f-opts">
            {[['yes', 'Yes'], ['no', 'No']].map(([v, label]) => (
              <button key={v} className={`psv2f-opt${upload === v ? ' on' : ''}${upload && upload !== v ? ' dim' : ''}`}
                onClick={() => pickUpload(v)}>{label}</button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
