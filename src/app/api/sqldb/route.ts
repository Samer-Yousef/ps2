import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

const ADMIN_EMAIL = 'fleshbits@gmail.com';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  if (session?.user?.email !== ADMIN_EMAIL) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const users = await prisma.user.findMany({
      select: {
        email: true,
        name: true,
        createdAt: true,
        image: true,
        passwordHash: false,
        _count: { select: { history: true, favorites: true, accounts: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const formatted = users.map(u => ({
      name: u.name || '',
      email: u.email,
      authMethod: u._count.accounts > 0 ? 'Google' : 'Email',
      history: u._count.history,
      favorites: u._count.favorites,
      createdAt: u.createdAt.toISOString(),
      hasImage: !!u.image,
    }));

    return NextResponse.json({ users: formatted, total: formatted.length });
  } catch {
    return NextResponse.json({ users: [], total: 0 }, { status: 500 });
  }
}
