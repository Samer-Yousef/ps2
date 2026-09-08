// Turns auth-logs.txt into the password-reset figures shown on /insights.

export type ResetRequestRow = {
  t: string            // ISO time of the request
  email: string
  outcome: 'reset' | 'opened' | 'sent' | 'google' | 'unknown' | 'expired'
  minutesToReset: number | null
}

export type ResetStats = {
  requests: number      // every submission of the forgot-password form that reached the server
  sent: number          // reset links actually emailed
  google: number        // "you use Google" emails
  unknown: number       // addresses with no account
  throttled: number     // cooldown + rate-limited
  sendFailed: number
  opened: number        // distinct links opened
  success: number       // distinct links that ended in a new password
  failed: number        // POSTs with a dead link / bad password
  invalidOpens: number  // reset page loaded with a dead link
  convSent: number      // success / sent, %
  convOpened: number    // success / opened, %
  medianMinutes: number | null
  daily: [string, number, number][]  // [day, sent, success] for the last 30 active days
  recent: ResetRequestRow[]           // last 20 emailed links, newest first
}

const pct = (a: number, b: number) => (b ? +((a / b) * 100).toFixed(1) : 0)

export function analyseAuthLog(text: string, now = Date.now(), ttlMinutes = 60): ResetStats {
  const counts = new Map<string, number>()
  const bump = (k: string) => counts.set(k, (counts.get(k) || 0) + 1)

  type Tok = { t: number; email: string; opened: boolean; success: number | null }
  const tokens = new Map<string, Tok>()
  const order: string[] = []

  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    const [ts, event, email = '', detail = ''] = line.split('\t')
    const ms = Date.parse(ts)
    if (Number.isNaN(ms) || !event) continue
    bump(event)
    if (event === 'RESET_REQUESTED' && detail) {
      tokens.set(detail, { t: ms, email, opened: false, success: null })
      order.push(detail)
    } else if (event === 'RESET_LINK_OPENED' && tokens.has(detail)) {
      tokens.get(detail)!.opened = true
    } else if (event === 'RESET_SUCCESS' && tokens.has(detail)) {
      const tok = tokens.get(detail)!
      if (tok.success == null) tok.success = ms
    }
  }

  const c = (k: string) => counts.get(k) || 0
  const toks = order.map((id) => tokens.get(id)!)
  const success = toks.filter((t) => t.success != null)
  const opened = toks.filter((t) => t.opened || t.success != null)
  const mins = success.map((t) => (t.success! - t.t) / 60000).sort((a, b) => a - b)

  const dailyMap = new Map<string, [number, number]>()
  for (const t of toks) {
    const day = new Date(t.t).toISOString().slice(0, 10)
    const d = dailyMap.get(day) || [0, 0]
    d[0]++
    if (t.success != null) d[1]++
    dailyMap.set(day, d)
  }

  const recent: ResetRequestRow[] = toks
    .slice(-20)
    .reverse()
    .map((t) => {
      const expired = t.success == null && now - t.t > ttlMinutes * 60000
      return {
        t: new Date(t.t).toISOString(),
        email: t.email,
        outcome: t.success != null ? 'reset' : t.opened ? 'opened' : expired ? 'expired' : 'sent',
        minutesToReset: t.success != null ? +((t.success - t.t) / 60000).toFixed(1) : null,
      }
    })

  const sent = c('RESET_REQUESTED')
  return {
    requests:
      sent + c('RESET_REQUESTED_GOOGLE') + c('RESET_UNKNOWN_EMAIL') + c('RESET_COOLDOWN') +
      c('RESET_RATE_LIMITED') + c('RESET_SEND_FAILED'),
    sent,
    google: c('RESET_REQUESTED_GOOGLE'),
    unknown: c('RESET_UNKNOWN_EMAIL'),
    throttled: c('RESET_COOLDOWN') + c('RESET_RATE_LIMITED'),
    sendFailed: c('RESET_SEND_FAILED'),
    opened: opened.length,
    success: success.length,
    failed: c('RESET_FAILED'),
    invalidOpens: c('RESET_LINK_INVALID'),
    convSent: pct(success.length, sent),
    convOpened: pct(success.length, opened.length),
    medianMinutes: mins.length ? +mins[Math.floor(mins.length / 2)].toFixed(1) : null,
    daily: [...dailyMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-30)
      .map(([d, [s, ok]]) => [d, s, ok]),
    recent,
  }
}
