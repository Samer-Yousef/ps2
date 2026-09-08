import { createHash, randomBytes } from 'node:crypto'
import { prisma } from '@/lib/prisma'

export const RESET_TOKEN_TTL_MINUTES = 60
// Minimum gap between two reset emails to the same account.
export const RESET_RESEND_COOLDOWN_MS = 2 * 60 * 1000

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function findUserByEmail(emailRaw: string) {
  const email = emailRaw.trim()
  if (!email) return null
  const exact = await prisma.user.findUnique({ where: { email } })
  if (exact) return exact
  // Accounts were registered with whatever casing the user typed, so fall back
  // to a case-insensitive match.
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM "User" WHERE lower(email) = lower(${email}) LIMIT 1`
  if (rows.length === 0) return null
  return prisma.user.findUnique({ where: { id: rows[0].id } })
}

/** Creates a fresh token for the user and returns the RAW token (never stored). */
export async function createResetToken(userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  await prisma.passwordResetToken.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expires: new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000),
    },
  })
  return token
}

/** True if a reset email was sent to this user within the cooldown window. */
export async function recentlyRequested(userId: string): Promise<boolean> {
  const latest = await prisma.passwordResetToken.findFirst({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  })
  return !!latest && Date.now() - latest.createdAt.getTime() < RESET_RESEND_COOLDOWN_MS
}

/** Returns the live token row for a raw token, or null if unknown/used/expired. */
export async function findValidToken(token: string) {
  if (!token || token.length > 200) return null
  return prisma.passwordResetToken.findFirst({
    where: { tokenHash: hashToken(token), usedAt: null, expires: { gt: new Date() } },
    include: { user: { select: { id: true, email: true, emailVerified: true } } },
  })
}

// --- Tiny in-memory per-IP limiter (single PM2 process, so this is sufficient). ---
const hits = new Map<string, number[]>()
export function ipAllowed(ip: string, limit = 5, windowMs = 15 * 60 * 1000): boolean {
  const now = Date.now()
  const arr = (hits.get(ip) || []).filter((t) => now - t < windowMs)
  if (arr.length >= limit) {
    hits.set(ip, arr)
    return false
  }
  arr.push(now)
  hits.set(ip, arr)
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (v.every((t) => now - t >= windowMs)) hits.delete(k)
  }
  return true
}

export function clientIp(req: Request): string {
  return (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown'
}
