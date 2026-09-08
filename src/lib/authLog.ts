import { appendFile } from 'fs/promises'
import { join } from 'path'

// Append-only, tab-separated, server-only (gitignored like search-logs.txt).
// Columns: ISO timestamp, event, email, detail (token id where applicable).
export const AUTH_LOG = join(process.cwd(), 'auth-logs.txt')

export type AuthEvent =
  | 'RESET_REQUESTED'        // reset link emailed        detail = token id
  | 'RESET_REQUESTED_GOOGLE' // "use Google sign-in" emailed
  | 'RESET_UNKNOWN_EMAIL'    // no account for that address
  | 'RESET_COOLDOWN'         // skipped: emailed this account < 2 min ago
  | 'RESET_RATE_LIMITED'     // skipped: per-IP limit
  | 'RESET_SEND_FAILED'      // Resend rejected the email
  | 'RESET_LINK_OPENED'      // reset page loaded with a live token   detail = token id
  | 'RESET_LINK_INVALID'     // reset page loaded with a dead token
  | 'RESET_SUCCESS'          // password changed                     detail = token id
  | 'RESET_FAILED'           // POST with a dead token or bad password

export async function logAuthEvent(event: AuthEvent, email = '', detail = ''): Promise<void> {
  const clean = (s: string) => s.replace(/[\t\n\r]/g, ' ')
  try {
    await appendFile(AUTH_LOG, [new Date().toISOString(), event, clean(email), clean(detail)].join('\t') + '\n')
  } catch (err) {
    console.error('auth log write failed:', err)
  }
}
