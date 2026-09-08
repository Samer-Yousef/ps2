// Transactional email via Resend's HTTP API (no SDK dependency).
// Requires RESEND_API_KEY in .env. The sending domain is verified in Resend.

const FROM = 'Pathology Search <noreply@pathologysearch.com>'

export function siteUrl(): string {
  return (process.env.NEXTAUTH_URL || 'https://pathologysearch.com').replace(/\/$/, '')
}

interface SendArgs {
  to: string
  subject: string
  text: string
  html: string
}

export async function sendEmail({ to, subject, text, html }: SendArgs): Promise<void> {
  const key = process.env.RESEND_API_KEY
  if (!key) throw new Error('RESEND_API_KEY is not set')

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: FROM, to: [to], subject, text, html }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Resend ${res.status}: ${body}`)
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

function layout(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f6f7f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f7f9;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:480px;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:32px;">
        <tr><td style="font-family:Georgia,'Times New Roman',serif;font-size:22px;color:#0069ff;padding-bottom:20px;">Pathology Search</td></tr>
        <tr><td style="font-size:18px;font-weight:600;padding-bottom:12px;">${escapeHtml(title)}</td></tr>
        <tr><td style="font-size:15px;line-height:1.55;color:#374151;">${bodyHtml}</td></tr>
      </table>
      <p style="max-width:480px;font-size:12px;color:#9ca3af;margin:16px 0 0;">You received this because someone entered your address on pathologysearch.com. If that wasn't you, no action is needed.</p>
    </td></tr>
  </table>
</body></html>`
}

function button(href: string, label: string): string {
  return `<p style="margin:24px 0;"><a href="${escapeHtml(href)}" style="display:inline-block;background:#0069ff;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:8px;">${escapeHtml(label)}</a></p>`
}

export async function sendPasswordResetEmail(to: string, resetUrl: string, expiresMinutes: number): Promise<void> {
  const subject = 'Reset your Pathology Search password'
  const text = [
    'Someone asked to reset the password for your Pathology Search account.',
    '',
    `Open this link to choose a new password (valid for ${expiresMinutes} minutes, one use only):`,
    resetUrl,
    '',
    "If you didn't request this, you can ignore this email. Your password won't change.",
  ].join('\n')
  const html = layout(
    'Reset your password',
    `<p style="margin:0 0 8px;">Someone asked to reset the password for your Pathology Search account.</p>
     <p style="margin:0;">The link below is valid for ${expiresMinutes} minutes and can be used once.</p>
     ${button(resetUrl, 'Choose a new password')}
     <p style="margin:0;font-size:13px;color:#6b7280;">If the button doesn't work, paste this into your browser:<br><a href="${escapeHtml(resetUrl)}" style="color:#0069ff;word-break:break-all;">${escapeHtml(resetUrl)}</a></p>
     <p style="margin:16px 0 0;font-size:13px;color:#6b7280;">If you didn't request this, ignore this email. Your password won't change.</p>`
  )
  await sendEmail({ to, subject, text, html })
}

export async function sendGoogleAccountEmail(to: string): Promise<void> {
  const loginUrl = `${siteUrl()}/login`
  const subject = 'Your Pathology Search account uses Google sign-in'
  const text = [
    'Someone asked to reset the password for your Pathology Search account.',
    '',
    "This account doesn't have a password. It was created with Google sign-in, so there is nothing to reset.",
    `Sign in with Google here: ${loginUrl}`,
    '',
    "If you didn't request this, you can ignore this email.",
  ].join('\n')
  const html = layout(
    'No password to reset',
    `<p style="margin:0 0 8px;">Someone asked to reset the password for your Pathology Search account.</p>
     <p style="margin:0;">This account was created with <strong>Google sign-in</strong> and doesn't have a password, so there is nothing to reset. Use the Google button on the sign-in page.</p>
     ${button(loginUrl, 'Go to sign in')}
     <p style="margin:0;font-size:13px;color:#6b7280;">If you didn't request this, ignore this email.</p>`
  )
  await sendEmail({ to, subject, text, html })
}
