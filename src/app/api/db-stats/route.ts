import { NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { auth } from '@/lib/auth';
import { getBlockedVisitorIds } from '@/lib/botProtection';

const LOG_FILE = join(process.cwd(), 'db-logs.txt');
const ADMIN_EMAIL = 'fleshbits@gmail.com';

export const dynamic = 'force-dynamic';

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

export async function GET() {
  const session = await auth();
  if (session?.user?.email !== ADMIN_EMAIL) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const content = await readFile(LOG_FILE, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    const blocked = getBlockedVisitorIds();
    const entries = lines.map(line => {
      const parts = line.split('\t');
      return {
        timestamp: parts[0] || '',
        event: parts[1] || '',
        detail: parts[2] || '',
        visitorId: parts[3] || '',
      };
    }).filter(e => !blocked.has(e.visitorId));

    // Calculate completed load times from DB_LOAD entries
    const loadTimes: number[] = [];
    for (const e of entries) {
      if (e.event === 'DB_LOAD') {
        const match = e.detail.match(/(\d+) entries in (\d+)ms/);
        if (match) loadTimes.push(parseInt(match[2]));
      }
    }

    // Calculate max seconds reached per session (DB_START to DB_LOAD or last DB_LOADING)
    const sessionSeconds: number[] = [];
    let currentMaxSeconds = 0;
    let inSession = false;
    for (const e of entries) {
      if (e.event === 'DB_START') {
        if (inSession && currentMaxSeconds > 0) {
          sessionSeconds.push(currentMaxSeconds);
        }
        currentMaxSeconds = 0;
        inSession = true;
      } else if (e.event === 'DB_LOADING') {
        const match = e.detail.match(/(\d+)s elapsed/);
        if (match) currentMaxSeconds = Math.max(currentMaxSeconds, parseInt(match[1]));
      } else if (e.event === 'DB_LOAD') {
        if (inSession && currentMaxSeconds > 0) {
          sessionSeconds.push(currentMaxSeconds);
        }
        currentMaxSeconds = 0;
        inSession = false;
      }
    }
    // Capture last incomplete session
    if (inSession && currentMaxSeconds > 0) {
      sessionSeconds.push(currentMaxSeconds);
    }

    // Count sessions
    const totalStarts = entries.filter(e => e.event === 'DB_START').length;
    const totalCompleted = entries.filter(e => e.event === 'DB_LOAD').length;
    const totalAbandoned = totalStarts - totalCompleted;

    const stats = {
      totalStarts,
      totalCompleted,
      totalAbandoned,
      loadTimeMean: Math.round(mean(loadTimes)),
      loadTimeMedian: Math.round(median(loadTimes)),
      secondsMean: Math.round(mean(sessionSeconds) * 10) / 10,
      secondsMedian: Math.round(median(sessionSeconds) * 10) / 10,
    };

    return NextResponse.json({ entries: entries.reverse(), stats });
  } catch {
    return NextResponse.json({ entries: [], stats: { totalStarts: 0, totalCompleted: 0, totalAbandoned: 0, loadTimeMean: 0, loadTimeMedian: 0, secondsMean: 0, secondsMedian: 0 } });
  }
}
