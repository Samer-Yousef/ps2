// Known bot visitor IDs
const BLOCKED_VISITOR_IDS = new Set<string>([
  // v_znjmrjd7ft8mnecolb4 — cleared: likely human power user (Pakistan, pathology resident)
]);

// In-memory rate limiter (per visitor ID)
const requestCounts = new Map<string, { count: number; windowStart: number }>();
const WINDOW_MS = 60_000; // 1 minute window
const MAX_SEARCH_REQUESTS = 60; // max slide clicks logged per minute
const MAX_DB_REQUESTS = 120; // max db log entries per minute (DB_LOADING fires every second)

export function isBlockedVisitor(visitorId: string): boolean {
  return BLOCKED_VISITOR_IDS.has(visitorId);
}

export function isRateLimited(visitorId: string, type: 'search' | 'db'): boolean {
  if (!visitorId) return false;

  const key = `${type}:${visitorId}`;
  const now = Date.now();
  const limit = type === 'search' ? MAX_SEARCH_REQUESTS : MAX_DB_REQUESTS;
  const entry = requestCounts.get(key);

  if (!entry || now - entry.windowStart > WINDOW_MS) {
    requestCounts.set(key, { count: 1, windowStart: now });
    return false;
  }

  entry.count++;
  if (entry.count > limit) {
    return true;
  }

  return false;
}

// Cleanup old entries periodically to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of requestCounts) {
    if (now - entry.windowStart > WINDOW_MS * 2) {
      requestCounts.delete(key);
    }
  }
}, 5 * 60_000); // Clean every 5 minutes

// For stats filtering - export the blocked set
export function getBlockedVisitorIds(): Set<string> {
  return BLOCKED_VISITOR_IDS;
}
