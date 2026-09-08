import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendGoogleAccountEmail, sendPasswordResetEmail, siteUrl } from '@/lib/email'
import {
  RESET_TOKEN_TTL_MINUTES,
  clientIp,
  createResetToken,
  findUserByEmail,
  ipAllowed,
  recentlyRequested,
} from '@/lib/passwordReset'

// Always answers with the same success body so the endpoint cannot be used to
// discover which addresses have accounts.
const OK = { ok: true }

export async function POST(req: Request) {
  let email = ''
  try {
    const body = await req.json()
    email = typeof body?.email === 'string' ? body.email.trim() : ''
  } catch {
    /* fall through */
  }
  if (!email || email.length > 254 || !email.includes('@')) {
    return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 })
  }

  if (!ipAllowed(clientIp(req))) {
    return NextResponse.json({ error: 'Too many requests. Try again in a few minutes.' }, { status: 429 })
  }

  try {
    const user = await findUserByEmail(email)
    if (!user) return NextResponse.json(OK)
    if (await recentlyRequested(user.id)) return NextResponse.json(OK)

    if (!user.passwordHash) {
      const google = await prisma.account.findFirst({ where: { userId: user.id, provider: 'google' } })
      if (google) {
        // Record the request so the cooldown applies to these emails too.
        await createResetToken(user.id)
        await sendGoogleAccountEmail(user.email)
        return NextResponse.json(OK)
      }
      // No password and no Google account: nothing sensible to send.
      return NextResponse.json(OK)
    }

    const token = await createResetToken(user.id)
    const resetUrl = `${siteUrl()}/reset-password?token=${token}`
    await sendPasswordResetEmail(user.email, resetUrl, RESET_TOKEN_TTL_MINUTES)
    return NextResponse.json(OK)
  } catch (err) {
    console.error('forgot-password error:', err)
    // Still generic: the user sees the same message either way, the log has the detail.
    return NextResponse.json(OK)
  }
}
