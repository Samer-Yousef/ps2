import { NextRequest, NextResponse } from 'next/server';
import { appendFile } from 'fs/promises';
import { join } from 'path';
import { isBlockedVisitor, isRateLimited } from '@/lib/botProtection';

const LOG_FILE = join(process.cwd(), 'search-logs.txt');

export async function POST(request: NextRequest) {
  try {
    const data = await request.json();
    const visitorId = data.visitorId || '';

    // Block known bots
    if (isBlockedVisitor(visitorId)) {
      return NextResponse.json({ ok: true }); // Silent drop
    }

    // Rate limit
    if (isRateLimited(visitorId, 'search')) {
      return NextResponse.json({ ok: true }); // Silent drop
    }

    const timestamp = new Date().toISOString();
    const fields = [
      timestamp,
      data.query || '',
      data.diagnosis || '',
      data.resultPosition ?? '',
      data.organ || '',
      data.system || '',
      data.source || '',
      data.similarityScore ?? '',
      data.totalResultsAvailable ?? '',
      data.userEmail || 'anonymous',
      data.userName || '',
      visitorId,
      data.page || '',          // 13th column: which interface logged this ('' = home, 'v2', …)
    ];
    await appendFile(LOG_FILE, fields.join('\t') + '\n');
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
