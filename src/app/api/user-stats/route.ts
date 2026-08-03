import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Look up user by email (more reliable than session.user.id)
    const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } });
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });
    const userId = user.id;

    // User's slide counts by timeframe
    const [lifetime, month, week, today, favCount] = await Promise.all([
      prisma.slideHistory.count({ where: { userId } }),
      prisma.slideHistory.count({ where: { userId, viewedAt: { gte: monthAgo } } }),
      prisma.slideHistory.count({ where: { userId, viewedAt: { gte: weekAgo } } }),
      prisma.slideHistory.count({ where: { userId, viewedAt: { gte: last24h } } }),
      prisma.favorite.count({ where: { userId } }),
    ]);

    // Leaderboard: get all users' counts for ranking
    const allUsers = await prisma.user.findMany({
      select: {
        id: true,
        _count: { select: { history: true } },
      },
    });

    // Calculate timeframe counts for all users (for ranking)
    const allHistoryCounts = await prisma.slideHistory.groupBy({
      by: ['userId'],
      _count: { id: true },
    });

    const allMonthCounts = await prisma.slideHistory.groupBy({
      by: ['userId'],
      where: { viewedAt: { gte: monthAgo } },
      _count: { id: true },
    });

    const allWeekCounts = await prisma.slideHistory.groupBy({
      by: ['userId'],
      where: { viewedAt: { gte: weekAgo } },
      _count: { id: true },
    });

    const allTodayCounts = await prisma.slideHistory.groupBy({
      by: ['userId'],
      where: { viewedAt: { gte: last24h } },
      _count: { id: true },
    });

    // Rank helper
    const getRank = (counts: { userId: string; _count: { id: number } }[], myId: string) => {
      const sorted = [...counts].sort((a, b) => b._count.id - a._count.id);
      const idx = sorted.findIndex(c => c.userId === myId);
      return idx >= 0 ? idx + 1 : sorted.length + 1;
    };

    const totalUsersWithHistory = allHistoryCounts.length;

    // Percentile: % of users you have more slides than
    const lifetimeCounts = allHistoryCounts.map(c => c._count.id).sort((a, b) => a - b);
    const usersBelow = lifetimeCounts.filter(c => c < lifetime).length;
    const percentile = totalUsersWithHistory > 1
      ? Math.round((usersBelow / (totalUsersWithHistory - 1)) * 100)
      : 100;

    return NextResponse.json({
      slides: { lifetime, month, week, today },
      favorites: favCount,
      rank: {
        lifetime: getRank(allHistoryCounts, userId),
        month: getRank(allMonthCounts, userId),
        week: getRank(allWeekCounts, userId),
        today: getRank(allTodayCounts, userId),
      },
      percentile,
      totalUsers: allUsers.length,
    });
  } catch {
    return NextResponse.json({ error: 'Failed to load stats' }, { status: 500 });
  }
}
