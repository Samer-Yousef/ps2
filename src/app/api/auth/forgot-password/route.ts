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
import { logAuthEvent } from '@/lib/authLog'

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
    await logAuthEvent('RESET_RATE_LIMITED', email)
    return NextResponse.json({ error: 'Too many requests. Try again in a few minutes.' }, { status: 429 })
  }

  try {
    const user = await findUserByEmail(email)
    if (!user) {
      await logAuthEvent('RESET_UNKNOWN_EMAIL', email)
      return NextResponse.json(OK)
    }
    if (await recentlyRequested(user.id)) {
      await logAuthEvent('RESET_COOLDOWN', user.email)
      return NextResponse.json(OK)
    }

    if (!user.passwordHash) {
      const google = await prisma.account.findFirst({ where: { userId: user.id, provider: 'google' } })
      if (google) {
        // Record the request so the cooldown applies to these emails too.
        await createResetToken(user.id)
        await sendGoogleAccountEmail(user.email)
        await logAuthEvent('RESET_REQUESTED_GOOGLE', user.email)
        return NextResponse.json(OK)
      }
      // No password and no Google account: nothing sensible to send.
      await logAuthEvent('RESET_UNKNOWN_EMAIL', user.email, 'no-password-no-google')
      return NextResponse.json(OK)
    }

    const { token, id } = await createResetToken(user.id)
    const resetUrl = `${siteUrl()}/reset-password?token=${token}`
    try {
      await sendPasswordResetEmail(user.email, resetUrl, RESET_TOKEN_TTL_MINUTES)
    } catch (err) {
      await logAuthEvent('RESET_SEND_FAILED', user.email, String(err).slice(0, 200))
      throw err
    }
    await logAuthEvent('RESET_REQUESTED', user.email, id)
    return NextResponse.json(OK)
  } catch (err) {
    console.error('forgot-password error:', err)
    // Still generic: the user sees the same message either way, the log has the detail.
    return NextResponse.json(OK)
  }
}
