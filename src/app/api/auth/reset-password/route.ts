import { NextResponse } from 'next/server'
import { hash } from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { findValidToken } from '@/lib/passwordReset'
import { logAuthEvent } from '@/lib/authLog'

// GET /api/auth/reset-password?token=... -> { valid: boolean }
// Lets the page tell the user up front that a link is expired or already used.
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('token') || ''
  const row = await findValidToken(token)
  if (row) await logAuthEvent('RESET_LINK_OPENED', row.user.email, row.id)
  else await logAuthEvent('RESET_LINK_INVALID')
  return NextResponse.json({ valid: !!row })
}

export async function POST(req: Request) {
  let token = ''
  let password = ''
  try {
    const body = await req.json()
    token = typeof body?.token === 'string' ? body.token : ''
    password = typeof body?.password === 'string' ? body.password : ''
  } catch {
    /* fall through */
  }

  if (password.length < 6) {
    await logAuthEvent('RESET_FAILED', '', 'short-password')
    return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 })
  }
  if (password.length > 200) {
    return NextResponse.json({ error: 'Password is too long' }, { status: 400 })
  }

  const row = await findValidToken(token)
  if (!row) {
    await logAuthEvent('RESET_FAILED', '', 'dead-token')
    return NextResponse.json(
      { error: 'This reset link is invalid or has expired. Request a new one.' },
      { status: 400 }
    )
  }

  const passwordHash = await hash(password, 12)
  const now = new Date()

  await prisma.$transaction([
    prisma.user.update({
      where: { id: row.userId },
      data: {
        passwordHash,
        // They just proved they own the mailbox.
        emailVerified: row.user.emailVerified ?? now,
      },
    }),
    // Burn this token and any other outstanding ones for the account.
    prisma.passwordResetToken.updateMany({
      where: { userId: row.userId, usedAt: null },
      data: { usedAt: now },
    }),
  ])

  await logAuthEvent('RESET_SUCCESS', row.user.email, row.id)
  return NextResponse.json({ ok: true, email: row.user.email })
}
