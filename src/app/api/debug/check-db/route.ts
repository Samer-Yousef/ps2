import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET() {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        image: true,
        emailVerified: true,
        passwordHash: true,
        createdAt: true,
      }
    })

    const accounts = await prisma.account.findMany({
      include: {
        user: {
          select: {
            email: true,
            name: true,
          }
        }
      }
    })

    return NextResponse.json({
      users: users.map(u => ({
        ...u,
        passwordHash: u.passwordHash ? 'EXISTS' : null,
        image: u.image ? u.image.substring(0, 50) + '...' : null,
      })),
      accounts,
      summary: {
        totalUsers: users.length,
        totalAccounts: accounts.length,
        oauthUsers: users.filter(u => !u.passwordHash).length,
        credentialUsers: users.filter(u => u.passwordHash).length,
      }
    })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
