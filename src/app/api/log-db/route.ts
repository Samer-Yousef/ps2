import { NextRequest, NextResponse } from 'next/server';
import { appendFile } from 'fs/promises';
import { join } from 'path';
import { isBlockedVisitor, isRateLimited } from '@/lib/botProtection';

const LOG_FILE = join(process.cwd(), 'db-logs.txt');

export async function POST(request: NextRequest) {
  try {
    const data = await request.json();
    const visitorId = data.visitorId || '';

    // Block known bots
    if (isBlockedVisitor(visitorId)) {
      return NextResponse.json({ ok: true }); // Silent drop
    }

    // Rate limit
    if (isRateLimited(visitorId, 'db')) {
      return NextResponse.json({ ok: true }); // Silent drop
    }

    const timestamp = new Date().toISOString();
    const line = `${timestamp}\t${data.event || ''}\t${data.detail || ''}\t${visitorId}\n`;
    await appendFile(LOG_FILE, line);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
