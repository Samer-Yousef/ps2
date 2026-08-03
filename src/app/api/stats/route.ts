import { NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getBlockedVisitorIds } from '@/lib/botProtection';

const SEARCH_LOG = join(process.cwd(), 'search-logs.txt');
const DB_LOG = join(process.cwd(), 'db-logs.txt');
const ADMIN_EMAIL = 'fleshbits@gmail.com';
const DATA_START = '2026-04-01';

export const dynamic = 'force-dynamic';

function toDateStr(iso: string): string {
  return iso.slice(0, 10);
}

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export async function GET() {
  const session = await auth();
  if (session?.user?.email !== ADMIN_EMAIL) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Parse search logs
    let searchContent = '';
    try { searchContent = await readFile(SEARCH_LOG, 'utf-8'); } catch {}
    const searchLines = searchContent.trim().split('\n').filter(Boolean);
    const entries = searchLines.map(line => {
      const parts = line.split('\t');
      return {
        timestamp: parts[0] || '',
        query: parts[1] || '',
        diagnosis: parts[2] || '',
        resultPosition: parts[3] || '',
        organ: parts[4] || '',
        system: parts[5] || '',
        source: parts[6] || '',
        similarityScore: parts[7] || '',
        totalResults: parts[8] || '',
        userEmail: parts[9] || 'anonymous',
        userName: parts[10] || '',
        visitorId: parts[11] || '',
      };
    });

    // Parse DB logs for visitor data
    let dbContent = '';
    try { dbContent = await readFile(DB_LOG, 'utf-8'); } catch {}
    const dbLines = dbContent.trim().split('\n').filter(Boolean);
    const dbEntries = dbLines.map(line => {
      const parts = line.split('\t');
      return { timestamp: parts[0] || '', event: parts[1] || '', visitorId: parts[3] || '' };
    });

    // Filter to data from April 1st onwards, excluding known bots
    const blocked = getBlockedVisitorIds();
    const visits = dbEntries
      .filter(e => e.event === 'DB_START' && e.visitorId && toDateStr(e.timestamp) >= DATA_START && !blocked.has(e.visitorId))
      .map(e => ({ timestamp: e.timestamp, visitorId: e.visitorId, date: toDateStr(e.timestamp) }));

    const clicks = entries
      .filter(e => e.timestamp && e.visitorId && toDateStr(e.timestamp) >= DATA_START && !blocked.has(e.visitorId))
      .map(e => ({ timestamp: e.timestamp, visitorId: e.visitorId, query: e.query, date: toDateStr(e.timestamp) }));

    // Get user signups from database
    const users = await prisma.user.findMany({
      select: { createdAt: true },
      orderBy: { createdAt: 'asc' },
    });

    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const ms24h = 24 * 60 * 60 * 1000;
    const msWeek = 7 * ms24h;
    const msMonth = 30 * ms24h;
    const ms3Month = 90 * ms24h;

    // Unique visitors by timeframe
    const uniqueVisitors = (items: { timestamp: string; visitorId: string }[], filter: (ts: Date) => boolean) => {
      const ids = new Set<string>();
      for (const item of items) {
        const d = new Date(item.timestamp);
        if (filter(d)) ids.add(item.visitorId);
      }
      return ids.size;
    };

    const visitorStats = {
      lifetime: uniqueVisitors(visits, () => true),
      last3Months: uniqueVisitors(visits, d => now.getTime() - d.getTime() < ms3Month),
      lastMonth: uniqueVisitors(visits, d => now.getTime() - d.getTime() < msMonth),
      lastWeek: uniqueVisitors(visits, d => now.getTime() - d.getTime() < msWeek),
      last24h: uniqueVisitors(visits, d => now.getTime() - d.getTime() < ms24h),
      today: uniqueVisitors(visits, d => d.toISOString().slice(0, 10) === todayStr),
    };

    // Daily aggregations
    const allDates = new Set<string>();
    visits.forEach(v => allDates.add(v.date));
    clicks.forEach(c => allDates.add(c.date));
    const sortedDates = [...allDates].sort();

    // User signups by date
    const signupsByDate = new Map<string, number>();
    let cumulativeSignups = 0;
    // Count signups before DATA_START
    for (const u of users) {
      const d = toDateStr(u.createdAt.toISOString());
      if (d < DATA_START) {
        cumulativeSignups++;
      } else {
        signupsByDate.set(d, (signupsByDate.get(d) || 0) + 1);
      }
    }

    const dailyData = sortedDates.map(date => {
      const dayVisits = visits.filter(v => v.date === date);
      const dayClicks = clicks.filter(c => c.date === date);
      const uniqueQueries = new Set(dayClicks.map(c => c.query));
      const uniqueVisitorIds = new Set(dayVisits.map(v => v.visitorId));
      const newSignups = signupsByDate.get(date) || 0;
      cumulativeSignups += newSignups;

      return {
        date,
        searches: uniqueQueries.size,
        clicks: dayClicks.length,
        uniqueVisitors: uniqueVisitorIds.size,
        newSignups,
        totalUsers: cumulativeSignups,
      };
    });

    // --- Growth & engagement stats ---
    const dailyVisitorCounts = dailyData.map(d => d.uniqueVisitors);
    const dailyClickCounts = dailyData.map(d => d.clicks);

    // Visitor trailing averages
    const last7Visitors = dailyVisitorCounts.slice(-7);
    const last30Visitors = dailyVisitorCounts.slice(-30);
    const visitorWeeklyAvg = round1(avg(last7Visitors));
    const visitorMonthlyAvg = round1(avg(last30Visitors));
    const visitorTrend = visitorMonthlyAvg > 0
      ? round1(((visitorWeeklyAvg - visitorMonthlyAvg) / visitorMonthlyAvg) * 100)
      : 0;

    // Click trailing averages
    const last7Clicks = dailyClickCounts.slice(-7);
    const last30Clicks = dailyClickCounts.slice(-30);
    const clickWeeklyAvg = round1(avg(last7Clicks));
    const clickMonthlyAvg = round1(avg(last30Clicks));
    const clickTrend = clickMonthlyAvg > 0
      ? round1(((clickWeeklyAvg - clickMonthlyAvg) / clickMonthlyAvg) * 100)
      : 0;

    // Week-over-week visitor growth
    const prior7Visitors = dailyVisitorCounts.slice(-14, -7);
    const weekOverWeekGrowth = avg(prior7Visitors) > 0
      ? round1(((avg(last7Visitors) - avg(prior7Visitors)) / avg(prior7Visitors)) * 100)
      : 0;

    // Avg clicks per visitor
    const allVisitorIds = new Set(visits.map(v => v.visitorId));
    const avgClicksPerVisitor = allVisitorIds.size > 0
      ? round1(clicks.length / allVisitorIds.size)
      : 0;

    // Avg sessions per visitor
    const sessionsPerVisitor = new Map<string, number>();
    for (const v of visits) {
      sessionsPerVisitor.set(v.visitorId, (sessionsPerVisitor.get(v.visitorId) || 0) + 1);
    }
    const avgSessionsPerVisitor = allVisitorIds.size > 0
      ? round1(avg([...sessionsPerVisitor.values()]))
      : 0;

    // Return visitor rate
    const returnVisitorCount = [...sessionsPerVisitor.values()].filter(v => v > 1).length;
    const returnRate = allVisitorIds.size > 0
      ? round1((returnVisitorCount / allVisitorIds.size) * 100)
      : 0;

    // Return user engagement trend
    const returnVisitorIds = new Set(
      [...sessionsPerVisitor.entries()].filter(([, count]) => count > 1).map(([id]) => id)
    );
    const returnClicks = clicks.filter(c => returnVisitorIds.has(c.visitorId));
    const midpoint = sortedDates.length > 1 ? sortedDates[Math.floor(sortedDates.length / 2)] : todayStr;
    const returnClicksFirst = returnClicks.filter(c => c.date < midpoint);
    const returnClicksSecond = returnClicks.filter(c => c.date >= midpoint);
    const returnVFirst = new Set(returnClicksFirst.map(c => c.visitorId));
    const returnVSecond = new Set(returnClicksSecond.map(c => c.visitorId));
    const avgReturnEarly = returnVFirst.size > 0 ? round1(returnClicksFirst.length / returnVFirst.size) : 0;
    const avgReturnRecent = returnVSecond.size > 0 ? round1(returnClicksSecond.length / returnVSecond.size) : 0;
    const returnEngagementTrend = avgReturnEarly > 0
      ? round1(((avgReturnRecent - avgReturnEarly) / avgReturnEarly) * 100)
      : 0;

    // Signup stats
    const totalUsers = users.length;
    const signupsLastWeek = users.filter(u => now.getTime() - u.createdAt.getTime() < msWeek).length;
    const signupsLastMonth = users.filter(u => now.getTime() - u.createdAt.getTime() < msMonth).length;
    const signupWeeklyAvg = sortedDates.length >= 7
      ? round1(avg(dailyData.slice(-7).map(d => d.newSignups)))
      : 0;
    const signupMonthlyAvg = sortedDates.length >= 30
      ? round1(avg(dailyData.slice(-30).map(d => d.newSignups)))
      : 0;

    // Modal conversion stats
    const modalEntries = entries.filter(e => e.query === 'MODAL');
    const modalShown = modalEntries.filter(e => e.diagnosis === 'SHOWN').length;
    const modalDismissed = modalEntries.filter(e => e.diagnosis === 'DISMISSED').length;
    const modalSignupEmail = modalEntries.filter(e => e.diagnosis === 'SIGNUP_EMAIL').length;
    const modalSignupGoogle = modalEntries.filter(e => e.diagnosis === 'SIGNUP_GOOGLE').length;
    const modalSignups = modalSignupEmail + modalSignupGoogle;
    const modalConversionRate = modalShown > 0 ? round1((modalSignups / modalShown) * 100) : 0;

    const growthStats = {
      visitorWeeklyAvg,
      visitorMonthlyAvg,
      visitorTrend,
      clickWeeklyAvg,
      clickMonthlyAvg,
      clickTrend,
      weekOverWeekGrowth,
      avgClicksPerVisitor,
      avgSessionsPerVisitor,
      returnRate,
      returnVisitorCount,
      avgReturnEarly,
      avgReturnRecent,
      returnEngagementTrend,
      totalUsers,
      signupsLastWeek,
      signupsLastMonth,
      signupWeeklyAvg,
      signupMonthlyAvg,
      modalShown,
      modalDismissed,
      modalSignups,
      modalSignupEmail,
      modalSignupGoogle,
      modalConversionRate,
    };

    // Filter log entries for display (exclude bots)
    const filteredEntries = entries.filter(e => !blocked.has(e.visitorId));

    return NextResponse.json({
      entries: filteredEntries.reverse(),
      visitorStats,
      dailyData,
      growthStats,
    });
  } catch (err) {
    console.error('Stats API error:', err);
    return NextResponse.json({ entries: [], visitorStats: {}, dailyData: [], growthStats: {} });
  }
}
